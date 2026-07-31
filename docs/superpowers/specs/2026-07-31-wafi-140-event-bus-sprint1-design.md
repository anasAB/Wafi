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
                                          reference read-model → daily_event_counts (projection)
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

**Delivery guarantees this sprint (explicit, not implied):**

- **Publish is best-effort, not transactional.** `write → audit → publish` (§6) means a publish
  failure never rolls back or blocks the write — the business operation is already committed and
  audited before `publishEvent` is even attempted. This sprint does **not** guarantee "every
  business operation emits exactly one event"; it guarantees the write/audit invariant only.
  Making publish part of the transaction boundary (e.g. outbox pattern) is a Sprint 2+ decision,
  not assumed here.
- **At-least-once, not exactly-once.** A watch-query-driven subscriber can observe the same row
  more than once — e.g. app crash mid-handler, relaunch, watch query re-fires on the same
  already-synced row. Sprint 1 subscribers (including the reference read-model in §7) **must**
  be written to tolerate duplicate execution; they must not assume exactly-once delivery. Making
  this idempotent (dedup keys, processed-event ledger) is explicitly Sprint 2 scope.
- **No ordering guarantee.** PowerSync watch queries are not a strict FIFO queue. If multiple
  `sale.completed` events arrive together, a subscriber must not assume they are handled in
  emission order. Handlers that need order must derive it themselves from `occurred_at` (or a
  future sequence number, if Sprint 2 adds one) rather than relying on delivery order.
- **Subscriber lifecycle.** `useEventSubscription` is a Vue composable: it starts its watch query
  on setup and must stop it via `onUnmounted` (or an explicitly returned `stop()` for subscribers
  that outlive a single component, e.g. a store-level subscriber started once at app init). The
  spec requires every call site to own disposal explicitly — no subscription may be started
  without a corresponding stop path.

## 4. Data model

```sql
-- 074_events_table.sql
create table events (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  entity_id text not null,
  payload jsonb not null,
  payload_version integer not null default 1,
  staff_id uuid not null,
  shop_id uuid not null references shops(id),
  occurred_at timestamptz not null,     -- business-meaningful time the fact became true
  created_at timestamptz not null default now()  -- when this row was persisted (may lag occurred_at while offline)
);
create index events_shop_type_idx on events (shop_id, type, occurred_at desc);

alter table events enable row level security;
-- Tenant scoping via the existing public.auth_shop_id() helper (015_rls_tenant_scoping.sql) —
-- the same shop_id = (select public.auth_shop_id()) shape used by every RLS'd table in this
-- schema. INSERT stays open shop-wide (matches audit_log's pattern, 061_audit_domain_rls.sql —
-- every domain's mutations write their own audit/event entries, system-generated). No UPDATE/
-- DELETE policy is created: events are append-only, denied to everyone by omission, matching
-- audit_log (018_audit_log_append_only.sql). Per-event-type SELECT restriction (e.g. cashier
-- cannot subscribe to staff.ledger_entry_added) is explicitly Sprint 3 — SELECT here is shop-wide.
create policy events_select_all on events
  for select to authenticated, anon
  using (shop_id = (select public.auth_shop_id()));
create policy events_insert_all on events
  for insert to authenticated, anon
  with check (shop_id = (select public.auth_shop_id()));
```

`events` must be added to the PowerSync sync rules / publication (same step every new synced table
requires — see migrations 004/010 for the existing pattern) and to `src/data/powersync/schema.ts`.

**`payload_version`** starts at `1` for every event this sprint and is unused otherwise — cheap to
add now, expensive to retrofit once historical rows exist without it. Policy (per the Golden Rules
in the WAFI-140 plan doc): never change an existing version's payload shape; a breaking payload
change ships as `payload_version: 2` with both versions supported by subscribers until deprecated.

**Local database growth (explicit deferred decision, not an oversight).** Sprint 1 intentionally
persists all events with no retention/pruning. A shop doing ~500 events/day accumulates ~180k rows/
year locally — untenable to leave unaddressed indefinitely, but out of scope for proving the bus
works. Before GA, retention must be defined via **PowerSync sync-rule time-scoping** (e.g. sync
only the last 90 days to the client), not ad-hoc client-side deletion — the Postgres `events` table
remains the system of record and keeps full history; only what's synced to a given device should be
time-bounded. This decision must be revisited no later than Sprint 3 (security/hardening sprint).

### Event contract rules

- **`type` is always a `DomainEventType` value, never a free-form string.** `publishEvent<T>(event:
  DomainEvent<T>)` already types `event.type` as `DomainEventType` (`domainEvent.types.ts`), so this
  is enforced at compile time, not just by convention — no call site can pass `"sale_complete"` or
  similar and have it type-check. Documented here so it's explicit as a contract, not just an
  incidental consequence of the current type signature.
- **`entity_id` is the primary business entity subscribers will index/query by for that event
  type — not necessarily the row the write created.** Verified against all 9 existing call sites;
  it is *not* uniformly "the aggregate root produced by the operation":

  | Event | `entity_id` | Note |
  |---|---|---|
  | `sale.completed` | `completed.saleId` | the sale itself |
  | `expense.recorded` | `expense.id` | the expense record |
  | `stock.received` | `receiving.id` | the receiving record |
  | `inventory.adjusted` | `input.productId` | the **product**, not the adjustment row — subscribers care what changed, not the audit row id |
  | `installment.due_paid` | `customerId` | the **customer**, not the installment/payment batch |
  | `staff.ledger_entry_added` | `created.id` | the ledger entry |
  | `settlement.paid` | `settlementId` | the settlement |
  | `shift.opened` / `shift.closed` | `shift.id` / `shiftId` | the shift |

  New events (including `customer.debt_changed`) must pick `entity_id` the same way: whatever a
  subscriber would most usefully filter/look up by, documented per-event in this table as the set
  grows (WAFI-142's event registry is the long-term home for this once it exists).
- **Payload contains immutable business facts and identifiers only** — no UI state, no computed/
  derived display values, no localized strings. Mutable personal information (customer name,
  phone, address) must not be duplicated into a payload unless the specific event is an
  intentional, legally-immutable audit snapshot (none of the 9 Sprint 1 events are). This keeps
  events from slowly becoming ad-hoc DTOs, and avoids stale-PII drift between an event payload and
  the current customer record.
- **Typed payloads, not anonymous objects.** Each event type gets its own payload interface in
  `domainEvent.types.ts` (e.g. `SaleCompletedPayload`, `ExpenseRecordedPayload`), with
  `DomainEvent<SaleCompletedPayload>` etc. replacing today's inline object-literal payloads. Applies
  to all 9 Sprint 1 events (a small refactor of their existing `toEvent` hooks, not a behavior
  change).

Reference read-model (projection) table:

```sql
create table daily_event_counts (
  shop_id uuid not null references shops(id),
  event_type text not null,
  day date not null,
  count integer not null default 0,
  primary key (shop_id, event_type, day)
);
alter table daily_event_counts enable row level security;
-- Full CRUD (unlike events/audit_log): this is a mutable projection, incremented
-- in place by the reference read-model subscriber (§7), not an append-only log.
create policy daily_event_counts_select_all on daily_event_counts
  for select to authenticated, anon
  using (shop_id = (select public.auth_shop_id()));
create policy daily_event_counts_insert_all on daily_event_counts
  for insert to authenticated, anon
  with check (shop_id = (select public.auth_shop_id()));
create policy daily_event_counts_update_all on daily_event_counts
  for update to authenticated, anon
  using (shop_id = (select public.auth_shop_id()))
  with check (shop_id = (select public.auth_shop_id()));
```

## 5. Event set (9 events)

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

`customer.debt_changed` (already typed in `domainEvent.types.ts`) is deliberately **not** wired
this sprint. Investigated during planning: the only debt-decreasing call site on
`executeBusinessOperation` today is `customer.service.ts`'s `recordPayment`, which already emits
`installment.due_paid` — adding a second event to the same call site means both fire together for
every payment, which is redundant. The other debt-changing path (returning a credit sale) lives in
`returns.service.ts`, explicitly excluded from WAFI-152's business-services migration and not yet
on `executeBusinessOperation`. Wiring `customer.debt_changed` waits until returns joins that layer
— a separate, later piece of work, not squeezed into Sprint 1.

## 6. `publishEvent()` implementation

```ts
export async function publishEvent<T>(event: DomainEvent<T>): Promise<void> {
  await db.execute(
    `insert into events (type, entity_id, payload, payload_version, staff_id, shop_id, occurred_at)
     values (?, ?, ?, ?, ?, ?, ?)`,
    [event.type, event.entityId, JSON.stringify(event.payload), 1, event.staffId, event.shopId, event.occurredAt],
  )
}
```

`executeBusinessOperation` already wraps this in fire-and-forget (`void publishEvent(...).catch(() => {})`)
— unchanged this sprint. Added: a `console.error` on catch, plus an in-memory counter
(`eventPublishFailureCount`, exposed for dev/debug only) so silent failures are at least visible.
Full retry/replay is Sprint 2.

## 7. Reference read-model (proof-of-concept projection)

`useEventSubscription(SalesEventType.Completed, handler)` watches `events` for `sale.completed`
rows and upserts an increment into `daily_event_counts` for `(shop_id, 'sale.completed', today)`.
This is a **projection** — `events` (source of truth for what happened) → subscriber → materialized
read-model table — and is the reference implementation future dashboard/report consumers
(WAFI-143/144/145/146) should follow, not a disposable demo. It is deliberately not wired into
`audit_log` — see non-goals — to avoid creating duplicate or conflicting audit rows ahead of
WAFI-150's dedicated migration.

Because delivery is at-least-once (§3), this increment can double-count on duplicate handler
execution (e.g. crash-and-replay re-firing the watch query on an already-processed row). Guarding
against that — tracking which `events.id` rows have already been folded in — is Sprint 2's
idempotency work, not Sprint 1's. The reference read-model accepts this over-counting risk as a
known, documented limitation (§3) rather than working around it ad hoc.

Every watch query — this one included — must filter on an indexed predicate: `shop_id` + `type` at
minimum (`events_shop_type_idx` covers this), and should add an `occurred_at` bound whenever the
full history isn't needed, so query cost doesn't grow unbounded as the table grows (see local
database growth note in §4).

## 8. Testing

- Vitest: `publishEvent()` writes the correct row shape (mock PowerSync `db.execute`), including
  `payload_version` defaulting to `1` and `occurred_at`/`created_at` both present.
- Vitest: each of the 9 `toEvent` hooks produces a payload matching its typed interface (compile-
  time check via the type system, plus a runtime shape assertion per event).
- Vitest: `useEventSubscription` invokes handler on matching inserts, ignores non-matching types,
  and its returned `stop()`/`onUnmounted` path actually detaches the watch query.
- Vitest: reference read-model increments `daily_event_counts` correctly, including same-day
  multiple increments, day rollover, and — documenting the known limitation from §3/§7 — a test
  asserting the handler *does* double-count when invoked twice for the same row (proves the
  limitation is real and understood, not silently "probably fine").
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
  - customer.debt_changed's call site was investigated during planning (see §5) and resolved:
    not wired this sprint, deferred until returns.service.ts joins executeBusinessOperation.
```

New DOMAIN INTERACTION MATRIX row (to add to `AI_PRINCIPAL_ENGINEER_REVIEW.md` as part of this
ticket's implementation):

| Domain | Writes to (tables) | Reads from (other domains) | Key composables | Reports/Dashboards affected |
|---|---|---|---|---|
| Events | `events`, `daily_event_counts` | Sales, Inventory, Customer Credit, Staff, Expense (all event producers) | `useEventSubscription` | none yet (Sprint 1 has no user-facing consumer) |

## 10. Out-of-scope call-outs (explicitly deferred, not silently dropped)

- `customer.debt_changed` itself — not wired this sprint (see §5); deferred until
  `returns.service.ts` joins `executeBusinessOperation`.
- Any UI surface for browsing raw events — WAFI-142 (Event Registry) territory.
- Sprint 1's failure-counter is dev-visibility only, not owner-facing alerting.
- Retention/pruning of synced `events` rows on-device — must be solved via PowerSync sync-rule
  time-scoping no later than Sprint 3 (§4); Sprint 1 ships with unbounded local retention.
- Exactly-once delivery / idempotent subscriber execution — Sprint 2 (§3, §7).
- Strict event ordering guarantees — not planned as a Sprint 2/3 item either unless a concrete
  consumer needs it; handlers should derive order from `occurred_at` themselves (§3).
