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
export const SubscriberId = {
  DailyEventCounts: 'daily_event_counts_projection',
} as const
export type SubscriberId = typeof SubscriberId[keyof typeof SubscriberId]

/** At-most-once, NOT exactly-once: if the process crashes between the ledger insert and
 *  `action()` running, this row is marked processed forever and `action()` never retries.
 *  Named to make that failure mode undeniable at every call site, instead of a generic
 *  `handleOnce` that reads as a stronger guarantee than it is. Acceptable today only because
 *  the sole caller (`daily_event_counts`) is a best-effort dashboard number, not a financial
 *  ledger. Any future subscriber whose action is a financial write, or otherwise cannot
 *  tolerate silently losing an action on crash, must NOT use this helper as-is — it needs a
 *  real transactional guarantee this ledger does not provide. */
async function processAtMostOnce(subscriberId: SubscriberId, eventId: string, action: () => Promise<void>) {
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

`dailyEventCountsProjection.ts` (Sprint 1's reference read-model) is retrofitted to call
`processAtMostOnce(SubscriberId.DailyEventCounts, event.id, () => incrementCount(...))`, closing
the double-count limitation Sprint 1 flagged as known-and-accepted. `subscriber_id` values are
always drawn from the `SubscriberId` const object, never a raw string literal at the call site —
same enforced-by-the-type-system discipline Sprint 1 used for `DomainEventType`, so a typo
(`'daily_projection'` vs `'daily_event_counts_projection'`) can't silently create a second,
never-populated ledger identity.

## 4. Offline replay — publish-failure retry queue

```sql
-- new table, local-only, not synced
create table event_publish_retries (
  id text primary key,           -- crypto.randomUUID(), generated client-side
  event_json text not null,      -- JSON.stringify(DomainEvent) — full event, duplicating what
                                  -- events/payload/staff/shop/time already store per-row once
                                  -- the row lands. Deliberate duplication, not an oversight:
                                  -- this row exists precisely because the real `events` insert
                                  -- FAILED, so there is no synced row yet to read the event back
                                  -- from — the retry queue must be fully self-contained. This is
                                  -- acceptable because publish failures are expected to be rare;
                                  -- do not "optimize" this into a foreign key/reference later
                                  -- without re-solving that ordering problem.
  failure_kind text not null,     -- 'transient' | 'permanent' — see classification below
  attempts integer not null default 0,
  last_error text,
  next_retry_at text not null,   -- ISO string; see backoff schedule below
  created_at text not null       -- ISO string; local-only table, no timestamptz needed
)
create index event_publish_retries_next_retry_idx on event_publish_retries (next_retry_at)
```

**Index on `next_retry_at`, not `created_at`.** The replay sweep's query is "which rows are due
now," not "which rows are oldest" — `next_retry_at` is what it filters/sorts on. Ordering is `order
by next_retry_at asc` (oldest-due-first), which for rows created around the same time and given the
same backoff schedule also happens to process them in roughly creation order — but the ordering
column is chosen for what the query actually needs, not as an approximation of insertion order.

`publishEvent()` changes from "log and drop" to "log and enqueue":

```ts
export async function publishEvent<T>(event: DomainEvent<T>): Promise<void> {
  try {
    await insertEventRow(event) // same db.execute as Sprint 1
  } catch (err) {
    eventPublishFailureCount.value += 1
    logger.error('[publishEvent] failed to persist event, queuing for retry', event.type, err)
    await enqueueForRetry(event, String(err)).catch(() => {
      // even the retry-queue write can fail (e.g. local disk full) — nothing further to do;
      // this event is genuinely lost, same as Sprint 1's behavior, but now the rare/logged case
      // instead of the common one.
    })
  }
}
```

(`logger.error` — a thin wrapper around `console.error` today, introduced so Sprint 3's real
alerting/telemetry work is a change to one module, not a grep-and-replace across every
`console.error` call site added by this ticket.)

**Failure classification (transient vs. permanent).** Not every `db.execute` failure deserves 5
retries — a schema mismatch or a malformed payload will never succeed no matter how many times it's
retried, and retrying it forever is exactly the "retry storm" this section exists to prevent.
`enqueueForRetry` classifies the caught error before writing `failure_kind`:

- **`transient`** — SQLite/PowerSync busy/locked errors, generic I/O errors: worth retrying on the
  backoff schedule below.
- **`permanent`** — constraint violations (e.g. a malformed `payload_version`), SQL syntax/shape
  errors: written to the queue for visibility (so the failure isn't silently invisible) but **not
  retried** — the sweep skips `permanent` rows entirely after their first classification, logging
  once via `logger.error` rather than repeating that log every sweep.

The exact error-string-to-classification mapping (e.g. which SQLite error codes count as
`transient`) is deferred to the implementation plan / Sprint 3 as noted in §2 — this spec commits
to the *shape* of the distinction (a `failure_kind` column and a sweep that respects it), not the
full exhaustive classifier, since getting that list right benefits from real production error
samples this sprint won't yet have.

**Backoff schedule.** `next_retry_at` replaces a bare `attempts` counter as the sweep's gate — a
row is only retried once `now() >= next_retry_at`. Schedule (by `attempts` count so far): 1 min, 5
min, 30 min, 2 hr, then **stop** (matches the existing "5 attempts" cap, now spaced out instead of
firing on every single reconnect). `retryPendingEventPublishes()` runs once on app start and once
on every PowerSync reconnect transition (reusing the existing connection-status listener
`useSync.ts` already has, not a new polling mechanism), querying only rows where `failure_kind =
'transient' and next_retry_at <= now()`, ordered `next_retry_at asc`.

On success: **delete the retry row in the same local transaction as the successful `events`
insert**, not as two separate statements — if the process crashes between "insert into events
succeeds" and "delete the retry row," the next sweep would re-insert the same event a second time
(a real duplicate `events` row, not just a re-attempt) with no ledger protection, since
`event_processed_ledger` only guards subscriber-side processing, not publish-side duplication.
Wrapping insert+delete in one transaction (PowerSync/local SQLite supports `db.writeTransaction` /
equivalent) makes this atomic: either both happen or neither does, so a crash mid-retry leaves the
retry row in place for the next sweep to safely re-attempt rather than silently duplicating the
underlying event.

On failure (attempts < 5, `transient`): increment `attempts`, overwrite `last_error`, advance
`next_retry_at` per the schedule above. Rows reaching **5 attempts** stop being retried — `logger.
error` once, louder, and the row is left in place for manual inspection rather than deleted
(deleting would silently lose the last record that this event ever existed) — see retention policy
in §3a for how long it's kept after that.

### 4a. Retention & cleanup

Same class of problem Sprint 1 flagged for `events` itself (§4 of the Sprint 1 spec: unbounded
local growth, deferred decision) now applies to two more local tables:

- **`event_processed_ledger`** grows one row per (subscriber, event) pair processed — over a year
  this is the dominant growth rate of the three tables (every event, times every subscriber that
  ever handles it). Safe cleanup rule: **a ledger row is safe to delete once the `events` row it
  references is no longer synced locally** (per whatever local retention window `events` itself
  eventually adopts — Sprint 1 named 90 days as an example, not yet implemented). A ledger entry
  for an event no longer present locally can never be "re-processed" anyway, so keeping it serves
  no purpose. Not implemented this sprint (`events` itself has no retention job yet to hang this
  off), but the rule is recorded now so it isn't rediscovered as a surprise later.
- **`event_publish_retries`** stays small under normal operation (publish failures are rare) and is
  self-cleaning for the common case (successful retry deletes its own row). The only rows that
  persist are `permanent`-classified or exhausted-`transient` (5-attempt) rows — by definition
  already flagged for manual inspection. No automatic purge this sprint; if this table is ever
  found accumulating unboundedly in practice, that itself is a signal worth investigating (a
  systemic publish problem), not something to silently paper over with a cleanup job.

Both are explicit **deferred decisions**, matching Sprint 1's own posture on `events` retention —
not implemented now, but written down so a future sprint doesn't have to rediscover the reasoning.

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
also changed), and `product.price_changed` only when cost did **not** change. `product.created`
always wins over both on the insert branch (a newly created product's price/cost are not
"changes"). **This priority is a single-event-per-write limitation inherited from Sprint 1's
contract, not a claim that cost is architecturally more important than price** — the event bus has
no business opinion on that. Cost was picked as the side that "wins" only because it's the rarer of
the two changes in practice (per WAFI-013's cost-freshness work, cost edits are infrequent and
high-signal; price edits are comparatively routine), so defaulting to the rarer fact loses less
information on average. A future ticket could split `toEvent` into `toEvents` (plural) if a real
consumer needs both facts from the same write, but no such consumer exists yet — this is a
temporary compromise to fit Sprint 1's shape, not a permanent design stance.

### 5b. Event versioning — already covered, confirmed not re-litigated

Sprint 1's `DomainEvent<T>` already carries `payloadVersion: number`, starting at `1` for every
event, with an explicit policy (Sprint 1 spec §4): never change an existing version's payload
shape; a breaking change ships as `payloadVersion: 2` with both versions supported until
deprecated. All 8 new event types in this sprint use the same generic `DomainEvent<T>` and inherit
`payloadVersion: 1` automatically — no new versioning mechanism is needed or added here. Flagging
this explicitly so it isn't mistaken for a gap: the field exists, the policy is written down, and
this sprint's events comply with it by construction, not by omission.

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
- Vitest: `processAtMostOnce()` ledger guard — invoked twice with the same `(subscriberId, eventId)` runs
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

### 7a. Subscriber lifecycle (confirming, not changing, Sprint 1's contract)

Sprint 1's spec already requires every `useEventSubscription` call site to own disposal explicitly
— `onUnmounted` for component-scoped subscribers, an explicit `stop()` for store/app-init-level
ones — and that contract is unchanged here. Restating it because this sprint adds the first
subscriber-side dedup logic (`processAtMostOnce`): a subscriber that fails to unsubscribe and gets
re-mounted (e.g. a component remount without a full page reload) would otherwise re-attach a second
live watch query — the ledger insert's unique-violation guard means the second instance's handler
correctly no-ops on already-processed rows, so a lifecycle leak degrades to "wasted watch query,"
not "double-processed event," but it's still a leak worth catching. `dailyEventCountsProjection`'s
existing disposal path is re-verified (not re-built) as part of this sprint's retrofit.

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
| Events | `events`, `daily_event_counts`, `event_processed_ledger` (local-only), `event_publish_retries` (local-only) | Sales, Returns, Customer Credit, Inventory, Staff, Expense, Cash/Shifts, Products, Suppliers, Devices (all event producers) | `useEventSubscription`, `processAtMostOnce`, `retryPendingEventPublishes` | none yet (still no user-facing consumer — WAFI-143/144/145/146) |

## 9. Out-of-scope call-outs (explicitly deferred, not silently dropped)

- The 8 events listed in §5's deferred table — each has its own specific blocking reason, not a
  generic "later."
- Cross-device dedup (§2, §3) — this sprint's ledger is single-device-replay protection only.
- `sale.discounted` and `drawer.varianced` as genuinely distinct events, if product later decides
  the folded-in-payload approach isn't enough — would need its own small design note, not a re-open
  of this spec.
- Owner-facing alerting on exhausted publish retries (still dev-console-only, matching Sprint 1's
  posture on the failure counter).
