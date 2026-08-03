# WAFI-140 Sprint 2 — Idempotency, Offline Replay, and 8 More Events (Design Spec)

**Status:** Draft — pending user review
**Date:** 2026-08-03
**Scope:** Sprint 2 of 3 for WAFI-140 (Business Event & Automation Platform). Sprint 1
(`docs/superpowers/specs/2026-07-31-wafi-140-event-bus-sprint1-design.md`) shipped the core bus:
`events`/`daily_event_counts` tables (migration 074), `publishEvent()`, `useEventSubscription()`,
and 9 typed events (only wired via 5 `.service.ts` call sites). Sprint 3 (security hardening, rate
limiting, event contract tests, per-event-type RLS) is explicitly out of scope here.

---

## 1. Problem

Sprint 1 explicitly left two gaps open, both called out in its own spec:

- **No idempotency.** Subscribers (including the reference `daily_event_counts` projection) can
  double-process the same `events` row on re-delivery — app crash mid-handler, relaunch, a watch
  query re-firing on an already-synced row. Sprint 1's projection is documented as tolerating this
  as a known limitation, not fixed.
- **No publish-failure recovery.** If `publishEvent()`'s `db.execute` throws, the event is silently
  dropped — only an in-memory dev-visibility counter increments. Nothing retries it.

Separately, the roadmap calls for 16 more canonical events beyond Sprint 1's 9. Auditing every
proposed event's actual call site (not just its name in the roadmap table) found only 9 have a
real write site to hang an event on today; the rest don't yet exist as features/schema in this
codebase (see §5).

## 2. Non-goals (deferred to later sprints/tickets, or indefinitely until their prerequisite exists)

- **Events deferred, no real write site exists yet** — see §5 for the full list and reasons:
  `sale.voided`, `sale.discounted` (as its own event), `credit.limit_changed`, `drawer.varianced`,
  `staff.performance_updated`, `supplier.order_placed`, `sync.completed`, `user.authenticated`.
- Rate limiting, per-event-type RLS ("cashier can't subscribe to `staff.ledger_entry_added`"),
  cross-tenant penetration testing — WAFI-140 Sprint 3.
- Dashboard/notification/report consumers actually reading these new events — WAFI-143/144/145/146.
- Migrating `audit_log` to be event-driven — WAFI-150.
- Cross-device dedup (two devices racing to process the same event) — the ledger this sprint
  guards single-device re-delivery only; see §3.
- Strict event ordering — unchanged from Sprint 1's position: handlers derive order from
  `occurred_at` themselves if they need it.

## 3. Idempotency — processed-event ledger

```sql
-- new table, local-only (not synced — see rationale below)
create table event_processed_ledger (
  subscriber_id text not null,   -- e.g. 'daily_event_counts_projection'
  event_id uuid not null,        -- references events(id) conceptually; not synced, no real FK
  processed_at timestamptz not null default now(),
  primary key (subscriber_id, event_id)
);
```

**Local-only, not synced to Postgres** (explicit scope decision, not an oversight): this sprint's
goal is protecting a single device against re-processing a row it already folded in during its own
crash/relaunch/re-fire cycle — not against two different devices racing to process the same event
concurrently (out of scope, §2). A local-only table needs no RLS, no publication wiring, and no
`shop_id` column (there is exactly one shop in scope on any given device already, enforced by every
other synced table's RLS). If cross-device dedup is ever needed, it becomes its own ticket with a
proper synced ledger + RLS design, not a retrofit of this one.

**Usage pattern**, every subscriber must follow:

```ts
async function handleOnce(subscriberId: string, eventId: string, action: () => Promise<void>) {
  try {
    await localDb.execute(
      `insert into event_processed_ledger (subscriber_id, event_id) values (?, ?)`,
      [subscriberId, eventId],
    )
  } catch {
    return // unique-violation: already processed, skip the action entirely
  }
  await action()
}
```

The insert-first-then-act order means a crash *between* the ledger insert and the action still
looks "processed" and won't retry — an accepted tradeoff (favors "never double-count" over "never
under-count") consistent with `daily_event_counts` being a best-effort dashboard number, not a
financial ledger. This must **not** be used for any future subscriber whose action is itself a
financial write (none exist yet; if one is proposed later, it needs a transactional guarantee this
ledger does not provide).

`dailyEventCountsProjection.ts` (Sprint 1's reference read-model) is retrofitted to call
`handleOnce('daily_event_counts_projection', event.id, () => incrementCount(...))`, closing the
double-count limitation Sprint 1 flagged as known-and-accepted.

## 4. Offline replay — publish-failure retry queue

```sql
-- new table, local-only, not synced
create table event_publish_retries (
  id text primary key,           -- crypto.randomUUID(), generated client-side
  event_json text not null,      -- JSON.stringify(DomainEvent) — full event, so retry doesn't need
                                  -- to reconstruct staffId/shopId/occurredAt from anywhere else
  attempts integer not null default 0,
  last_error text,
  created_at text not null       -- ISO string; local-only table, no timestamptz needed
)
```

`publishEvent()` changes from "log and drop" to "log and enqueue":

```ts
export async function publishEvent<T>(event: DomainEvent<T>): Promise<void> {
  try {
    await insertEventRow(event) // same db.execute as Sprint 1
  } catch (err) {
    eventPublishFailureCount.value += 1
    console.error('[publishEvent] failed to persist event, queuing for retry', event.type, err)
    await enqueueForRetry(event, String(err)).catch(() => {
      // even the retry-queue write can fail (e.g. local disk full) — nothing further to do;
      // this event is genuinely lost, same as Sprint 1's behavior, but now the rare/logged case
      // instead of the common one.
    })
  }
}
```

`retryPendingEventPublishes()` runs once on app start and once on every PowerSync reconnect
transition (reusing the existing connection-status listener `useSync.ts` already has, not a new
polling mechanism): for each queued row, re-attempt the insert; on success, delete the row; on
failure, increment `attempts` and overwrite `last_error`. Rows reaching **5 attempts** stop being
silently retried forever — log a louder `console.error` (still dev-visibility only, matching
Sprint 1's non-goal on owner-facing alerting) and leave the row in place for manual inspection
rather than deleting it (deleting would silently lose the last record that this event ever
existed).

## 5. Event audit — what's buildable this sprint vs. deferred

Every event proposed in the original roadmap table was checked against the actual codebase for a
real write call site (not just a plausible-sounding name).

**Wired this sprint (8 events, revised from a naive 9 — see note below):**

| Event | Call site | Plumbing |
|---|---|---|
| `sale.returned` | `useReturnSheet.ts` confirm | trivial — already calls `executeBusinessOperation`, just add `toEvent` |
| `customer.debt_changed` | same call site as `sale.returned`, only fired when the returned sale's payment method was credit | trivial, same reason — see note below |
| `cash.movement_recorded` | `useCashMovements.ts`, 2 call sites (pay-in/pay-out, drop) | trivial — already calls `executeBusinessOperation` |
| `stock.taken` | `useStockTake.ts` `confirmSession()` | retrofit: currently a raw write + direct `useAuditLog().logStockTakeCompleted()` call, not routed through `executeBusinessOperation`. Must move the existing audit call into the wrapper's `hooks.audit` (not duplicate it) |
| `product.price_changed` | `useProducts.ts` `save()`, update branch | retrofit: same "move existing direct audit call into the wrapper" pattern |
| `product.cost_updated` | `useProducts.ts` `save()`, same function, different branch | retrofit, same call site as above — one `executeBusinessOperation` call can emit at most one event per Sprint 1's contract, so if both price and cost change in the same save, see §5a |
| `product.created` | `useProducts.ts` `save()`, insert branch | retrofit, same file |
| `supplier.receiving_posted` | `useReceivingSheet.ts` | retrofit: no `executeBusinessOperation` today, needs wrapping |
| `device.registered` | `useDeviceRegistration.ts` `registerDevice()` | bespoke: this is an RPC call + local insert, not a local-write-then-audit pair, so it calls `publishEvent()` directly after success rather than going through `executeBusinessOperation` |

**Note on `customer.debt_changed`:** Sprint 1 deferred this event, reasoning that its
credit-sale-return call site lived in `returns.service.ts`, "explicitly excluded from WAFI-152's
business-services migration and not yet on `executeBusinessOperation`." That premise is now stale —
`useReturnSheet.ts` already calls `executeBusinessOperation` directly (confirmed by code audit; it
was migrated onto the wrapper without ever gaining a `toEvent` hook or a formal `returns.service.ts`
file). Wiring `sale.returned` and `customer.debt_changed` from the same call site costs nothing
beyond what `sale.returned` alone already requires, so both ship together this sprint.

**Deferred, with reasons (8 events — no real write site exists in this codebase today):**

| Event | Why deferred |
|---|---|
| `sale.voided` | No void/cancel-sale flow exists anywhere in the app — only returns exist. Modeling "void" as "immediate full return" is a product decision, not an engineering one; not assumed here. |
| `sale.discounted` (as its own event) | Discount is already a field on `sale.completed`'s existing payload (`discountApplied`), not a separate write. Shipping it as its own event would require inventing a standalone discount-application write path that doesn't exist. |
| `credit.limit_changed` | No `credit_limit` column or UI anywhere in the customer feature or schema — this is WAFI-017/v1.5 AR-limit territory, not built yet. |
| `drawer.varianced` | No "variance exceeds threshold" branch exists — variance is just a field on `shift.closed`'s payload. A distinct event implies a policy decision (what threshold, does it block close, who gets notified) that belongs in its own design, not folded into this sprint. |
| `staff.performance_updated` | `useStaffPerformanceMetrics.ts` (WAFI-018) is a pure on-the-fly SQL aggregation with no write/materialization anywhere to hang an event on. Materializing it would invent cache-invalidation problems the dashboard doesn't have today. |
| `supplier.order_placed` | This app has receiving, not order-placement — no such feature exists. Building it is its own ticket. |
| `sync.completed` | No discrete "completed" write exists — `useSync.ts` tracks live pending/blocked counts via a reactive listener on the PowerSync connector's status, not a one-shot completion event. Hooking a status *transition* is a different (and reasonable) future design, not assumed here. |
| `user.authenticated` | Real write site exists (`signIn()` in `src/data/supabase/auth.ts`), but the identity/shop context available at that point (before operator switch, per WAFI-203) doesn't cleanly map onto `DomainEvent`'s `staffId`/`shopId` fields without a real design decision on what "authenticated" means at the device-login vs. operator-switch layer. Deferred rather than rushed. |

### §5a — one call site, two events (`product.price_changed` + `product.cost_updated`)

`useProducts.ts`'s `save()` can change both price and cost in a single edit. Sprint 1's contract is
one event per `executeBusinessOperation` call (`hooks.toEvent` returns a single `DomainEvent`).
Resolution: `toEvent` returns `product.cost_updated` when cost changed (regardless of whether price
also changed — cost changes are the rarer, more consequential fact per WAFI-013's cost-freshness
work), and `product.price_changed` only when cost did **not** change. `product.created` always wins
over both on the insert branch (a newly created product's price/cost are not "changes"). This is a
pragmatic single-event-per-write simplification, documented here so it isn't mistaken for a bug —
a future ticket could split `toEvent` into `toEvents` (plural) if a real consumer needs both facts
from the same write, but no such consumer exists yet.

## 6. Payloads & `entity_id`

New typed payload interfaces added to `domainEvent.types.ts`, following Sprint 1's per-domain-file
split (`ReturnsEventType`, `ProductEventType`, `SupplierEventType`, `DeviceEventType` groups; cash
movement joins the existing `StaffEventType` file since `useCashMovements.ts` lives under
shifts/staff-adjacent scope — actually a new `CashEventType` group, since cash movements are not a
staff-ledger concept — see rationale below).

| Event | `entity_id` | Payload |
|---|---|---|
| `sale.returned` | the return's `id` | `{ returnId, saleId, refundAmountUsd, restockedItemCount }` |
| `customer.debt_changed` | `customerId` | `{ customerId, deltaUsd, newBalanceUsd, reason: 'return' }` (`reason` is a literal union so future non-return debt changes don't get mislabeled) |
| `cash.movement_recorded` | movement's `id` | `{ movementId, shiftId, type: 'pay_in' \| 'pay_out' \| 'drop', amountUsd }` |
| `stock.taken` | `sessionId` | `{ sessionId, productCount, unexplainedVarianceCount }` |
| `product.price_changed` | `productId` | `{ productId, oldPriceUsd, newPriceUsd }` |
| `product.cost_updated` | `productId` | `{ productId, oldCostUsd, newCostUsd }` |
| `product.created` | `productId` | `{ productId, name, categoryId }` |
| `supplier.receiving_posted` | `receivingId` | `{ receivingId, supplierId, skuCount, totalCostUsd }` |
| `device.registered` | `deviceId` | `{ deviceId, staffId, deviceName }` |

`cash.movement_recorded` gets its own `CashEventType` group rather than joining `StaffEventType` —
a cash movement is attributable to a shift/staff member but is conceptually a cash-drawer fact, not
a staff-ledger fact (matches this codebase's existing separation of `cashier_shifts`/
`cash_movements` tables from `staff_ledger_entries`).

## 7. Testing

- Vitest per new `toEvent` hook: payload shape matches its typed interface (mirrors Sprint 1's
  per-event test pattern).
- Vitest: `handleOnce()` ledger guard — invoked twice with the same `(subscriberId, eventId)` runs
  its action once; invoked with two different `eventId`s for the same subscriber runs it twice;
  invoked with the same `eventId` but two different `subscriberId`s runs independently for each
  (proves the ledger is per-subscriber, not global).
- Vitest: `dailyEventCountsProjection` no longer double-counts when the same `sale.completed` row
  is handled twice (this directly replaces Sprint 1's test that asserted the *opposite* — that it
  *did* double-count — as a known limitation; that test is deleted/inverted here, not left
  contradicting the new behavior).
- Vitest: retry queue — a failed publish enqueues into `event_publish_retries`; a successful retry
  sweep drains and deletes it; a row that fails 5 times stops incrementing past 5 and logs loudly
  instead of retrying forever; the sweep itself never throws even if every queued row fails.
- Vitest: `useProducts.ts save()` retrofit — single price-only change emits `product.price_changed`
  only; single cost-only change emits `product.cost_updated` only; combined price+cost change
  emits `product.cost_updated` only (per §5a); insert emits `product.created` only; the existing
  direct `useAuditLog()` calls are removed from `save()`/`confirmSession()`/receiving in favor of
  `executeBusinessOperation`'s `hooks.audit`, with a regression test proving exactly one audit row
  is still written per operation (not zero, not two).

## 8. Cross-Epic Edge-Case Checklist (design time)

```
Domains touched: Returns, Customer Credit, Cash/Shifts, Inventory/Stock-take, Products, Suppliers,
                 Devices, Event/Automation (ledger + retry queue additions to the Events domain)
Matrix rows consulted: Returns, Customer Credit, Shifts, Products, Suppliers, Devices, Events,
                 Audit (every retrofit moves an existing direct audit-log call into
                 executeBusinessOperation's hooks.audit — must not become double-logged)
Open cross-feature questions:
  - stock.taken, product.*, and supplier.receiving_posted are the first composables retrofitted
    onto executeBusinessOperation that had a PRE-EXISTING direct audit-log call. Each retrofit is a
    pure refactor (identical audit content, moved call site) — verified per-composable with a
    before/after audit-log-content regression test, same discipline WAFI-007 used for its 6
    retrofits.
  - customer.debt_changed firing alongside sale.returned: does any existing Reports/Dashboards
    consumer assume debt changes only come from recordPayment (installment.due_paid)? Checked —
    useDashboardMetrics.ts/useProfitTrend.ts (WAFI-008's `sources` filter work) key off `sales`/
    `returns` tables directly, not off events, so this is not a behavioral risk for existing
    reports; only future WAFI-143+ event consumers need to know both events can represent debt
    decreases.
  - event_processed_ledger and event_publish_retries are both new LOCAL-ONLY tables — must be
    added to the app's local PowerSync schema as non-synced tables (or a plain local SQLite table
    outside PowerSync's schema entirely, if that's cleaner architecturally — an implementation
    detail for the plan, not re-litigated here), and must NOT be added to any Postgres migration
    or sync-rule/publication list, unlike every other table this ticket touches.
```

Updated DOMAIN INTERACTION MATRIX row (`AI_PRINCIPAL_ENGINEER_REVIEW.md`):

| Domain | Writes to (tables) | Reads from (other domains) | Key composables | Reports/Dashboards affected |
|---|---|---|---|---|
| Events | `events`, `daily_event_counts`, `event_processed_ledger` (local-only), `event_publish_retries` (local-only) | Sales, Returns, Customer Credit, Inventory, Staff, Expense, Cash/Shifts, Products, Suppliers, Devices (all event producers) | `useEventSubscription`, `handleOnce`, `retryPendingEventPublishes` | none yet (still no user-facing consumer — WAFI-143/144/145/146) |

## 9. Out-of-scope call-outs (explicitly deferred, not silently dropped)

- The 8 events listed in §5's deferred table — each has its own specific blocking reason, not a
  generic "later."
- Cross-device dedup (§2, §3) — this sprint's ledger is single-device-replay protection only.
- `sale.discounted` and `drawer.varianced` as genuinely distinct events, if product later decides
  the folded-in-payload approach isn't enough — would need its own small design note, not a re-open
  of this spec.
- Owner-facing alerting on exhausted publish retries (still dev-console-only, matching Sprint 1's
  posture on the failure counter).
