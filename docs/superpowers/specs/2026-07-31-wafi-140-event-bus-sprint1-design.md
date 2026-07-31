# WAFI-140 Sprint 1 — Business Event Bus Core (Design Spec)

**Status:** Draft — pending user review
**Date:** 2026-07-31
**Scope:** Sprint 1 of 3 for WAFI-140 (Business Event & Automation Platform). Sprints 2 (idempotency,
offline replay) and 3 (security hardening, rate limiting, contract tests) are explicitly out of scope
and get their own specs once this sprint's shape is proven.

---

## 1. Problem

WAFI-152 (Business Services Layer) shipped `executeBusinessOperation`, which already calls
`publishEvent()` from 9 call sites across `staff.service.ts`, `sales.service.ts`,
`customer.service.ts`, `inventory.service.ts`, and `expense.service.ts`. `publishEvent()` is
currently a documented no-op (`src/services/events/publishEvent.ts`) — events are constructed but
discarded. Nothing downstream (dashboards, audit automation, notifications, reports) can react to
business activity yet.

Sprint 1 makes `publishEvent()` real: events are persisted, offline-safe, tenant-isolated, and at
least one subscriber proves the publish → persist → react loop end-to-end.

## 2. Non-goals (deferred to later sprints/tickets)

- Idempotency / dedup keys, offline replay queue tooling — WAFI-140 Sprint 2.
- Rate limiting, cross-tenant penetration testing, "cashier can't publish for another cashier" —
  WAFI-140 Sprint 3.
- Migrating the existing manual `audit_log` writes to be event-driven — WAFI-150.
- Dashboard/notification/report consumers — WAFI-143/144/145/146.
- Event registry documentation UI — WAFI-142.

## 3. Architecture

```
Service (executeBusinessOperation)
        │ toEvent(result)
        ▼
publishEvent()  ──── PowerSync local write ────▶  events table (Postgres, RLS-scoped)
                                                          │
                                                          ▼ (synced, reactive watch query)
                                          useEventSubscription(type, handler)
                                                          │
                                                          ▼
                                          demo subscriber → daily_event_counts (read-model)
```

`publishEvent()` stops being a no-op and performs a PowerSync `db.execute` insert into a new
`events` table — the same offline-write pattern already used for every domain table (`sales`,
`stock_adjustments`, etc.), so no new offline logic is invented. Writes queue locally when offline
and sync out via the existing PowerSync connection; nothing here changes offline behavior beyond
what PowerSync already guarantees for any local write.

Subscribers are client-side: a new `useEventSubscription(type, handler)` composable wraps a
PowerSync watch query over `events` filtered by `type`, invoking `handler` reactively whenever a
matching row appears (including rows that arrive via sync, not just local writes) — this is how a
subscriber "reacts" without a server-side push mechanism.

## 4. Data model

```sql
-- 074_events_table.sql
create table events (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  entity_id text not null,
  payload jsonb not null,
  staff_id uuid not null,
  shop_id uuid not null references shops(id),
  occurred_at timestamptz not null default now()
);
create index events_shop_type_idx on events (shop_id, type, occurred_at desc);

alter table events enable row level security;
-- Tenant scoping follows the existing owner_user_id -> auth.uid() pattern
-- (see docs/architecture — no JWT claim/hook), identical shape to every
-- other RLS'd table in this schema.
create policy events_tenant_isolation on events
  for all
  using (shop_id in (select id from shops where owner_user_id = auth.uid()))
  with check (shop_id in (select id from shops where owner_user_id = auth.uid()));
```

`events` must be added to the PowerSync sync rules / publication (same step every new synced table
requires — see migrations 004/010 for the existing pattern) and to `src/data/powersync/schema.ts`.

Demo read-model table:

```sql
create table daily_event_counts (
  shop_id uuid not null references shops(id),
  event_type text not null,
  day date not null,
  count integer not null default 0,
  primary key (shop_id, event_type, day)
);
alter table daily_event_counts enable row level security;
create policy daily_event_counts_tenant_isolation on daily_event_counts
  for all
  using (shop_id in (select id from shops where owner_user_id = auth.uid()))
  with check (shop_id in (select id from shops where owner_user_id = auth.uid()));
```

## 5. Event set (10 events)

The 9 events already wired via `toEvent` hooks start persisting the moment `publishEvent()` is
real — no service code changes required:

| Event | Service call site |
|---|---|
| `expense.recorded` | `expense.service.ts` |
| `stock.received` | `inventory.service.ts` |
| `inventory.adjusted` | `inventory.service.ts` |
| `sale.completed` | `sales.service.ts` |
| `staff.ledger_entry_added` | `staff.service.ts` |
| `settlement.paid` | `staff.service.ts` |
| `shift.opened` | `staff.service.ts` |
| `shift.closed` | `staff.service.ts` |
| `installment.due_paid` | `customer.service.ts` |

10th event added this sprint: `customer.debt_changed` (`CustomerEventType.DebtChanged` is already
typed in `domainEvent.types.ts` but has no `toEvent` hook yet) — wired into the customer-payment
service call that currently changes `customer_payments` balance without an event.

## 6. `publishEvent()` implementation

```ts
export async function publishEvent<T>(event: DomainEvent<T>): Promise<void> {
  await db.execute(
    `insert into events (type, entity_id, payload, staff_id, shop_id, occurred_at)
     values (?, ?, ?, ?, ?, ?)`,
    [event.type, event.entityId, JSON.stringify(event.payload), event.staffId, event.shopId, event.occurredAt],
  )
}
```

`executeBusinessOperation` already wraps this in fire-and-forget (`void publishEvent(...).catch(() => {})`)
— unchanged this sprint. Added: a `console.error` on catch, plus an in-memory counter
(`eventPublishFailureCount`, exposed for dev/debug only) so silent failures are at least visible.
Full retry/replay is Sprint 2.

## 7. Demo subscriber

`useEventSubscription(SalesEventType.Completed, handler)` watches `events` for `sale.completed`
rows and upserts an increment into `daily_event_counts` for `(shop_id, 'sale.completed', today)`.
This is deliberately not wired into `audit_log` — see non-goals — to avoid creating duplicate or
conflicting audit rows ahead of WAFI-150's dedicated migration.

## 8. Testing

- Vitest: `publishEvent()` writes the correct row shape (mock PowerSync `db.execute`).
- Vitest: `useEventSubscription` invokes handler on matching inserts, ignores non-matching types.
- Vitest: demo subscriber increments `daily_event_counts` correctly, including same-day multiple
  increments and day rollover.
- pgTAP: `events` and `daily_event_counts` RLS policies reject cross-shop reads/writes, following
  the existing `supabase/tests/*_role_enforcement.test.sql` pattern.

## 9. Cross-Epic Edge-Case Checklist (design time)

```
Domains touched: Sales, Inventory, Customer Credit, Staff, Expense (as event producers, unchanged),
                 new Event/Automation domain (event bus itself)
Matrix rows consulted: Sales, Inventory, Installments, Customer Credit, Staff, Audit
                 (all already-wired services and the existing audit_log table)
Open cross-feature questions:
  - The new "Event" domain has no row yet in the DOMAIN INTERACTION MATRIX — added below.
  - customer.debt_changed's exact service call site needs confirming against current
    customer.service.ts balance-mutation logic during implementation (not fully enumerated
    in this design pass).
```

New DOMAIN INTERACTION MATRIX row (to add to `AI_PRINCIPAL_ENGINEER_REVIEW.md` as part of this
ticket's implementation):

| Domain | Writes to (tables) | Reads from (other domains) | Key composables | Reports/Dashboards affected |
|---|---|---|---|---|
| Events | `events`, `daily_event_counts` | Sales, Inventory, Customer Credit, Staff, Expense (all event producers) | `useEventSubscription` | none yet (Sprint 1 has no user-facing consumer) |

## 10. Out-of-scope call-outs (explicitly deferred, not silently dropped)

- `customer.debt_changed` full downstream reactions (notifications, reports) — later tickets, this
  sprint only ensures the event is emitted and persisted.
- Any UI surface for browsing raw events — WAFI-142 (Event Registry) territory.
- Sprint 1's failure-counter is dev-visibility only, not owner-facing alerting.
