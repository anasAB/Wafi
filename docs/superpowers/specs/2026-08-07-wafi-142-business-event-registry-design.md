# WAFI-142 — Business Event Registry (SIGNALS.md) — Design Spec

## Goal

Create `docs/architecture/SIGNALS.md`, a living registry documenting every domain event
actually implemented in this codebase today: its producer(s), its consumer(s), its version,
and any known gap between what the event system is supposed to guarantee and what it
actually delivers right now. This closes a dangling reference — `WAFI_Production_Readiness_Plan_v3.md`'s
PR checklist (line 441) has said "Signal documented in SIGNALS.md (if applicable, per
WAFI-142)" since before this ticket existed, pointing at a file that didn't exist.

This is a documentation-only ticket. No source code changes, no schema changes, no new
producers or consumers. The value is in ground-truthing: ten of this repo's 17 implemented
events were found, during this design's research pass, to have a gap between their intended
and actual consumer coverage — three "registered but writes nothing" no-op consumers, two
fully dormant events with zero consumers, and one event with no audit-log path at all. A
registry that only listed what *should* work would have hidden all six.

## Non-Goals

- **Auto-generated dependency graph** — explicitly called out in
  `WAFI_Production_Readiness_Plan_v3.md` as "(Phase 2)" for this ticket. Not built here.
- **The full canonical/aspirational event list** — `WAFI_Production_Readiness_Plan_v3.md`'s
  "Canonical Events (26+)" table includes several events that don't exist in code yet
  (e.g. `sale.voided`, `supplier.order_placed`, `credit.limit_changed`). This registry
  documents **only what's implemented**, verified against the actual tree, not the roadmap.
- **CI enforcement / staleness detection** — this doc is maintained by convention (same
  discipline as `docs/architecture/EVENT_SUBSCRIBERS.md`), not enforced by a script. Adding
  that enforcement is exactly the kind of thing a *future* ticket could build on top of this
  one, once there's a stable table shape to check against.
- **Fixing the gaps this doc surfaces** — the dormant `shift.*` events and the three no-op
  audit consumers are pre-existing, intentional-at-the-time states (see code comments cited
  in the Registry section below). This ticket documents them; it does not resolve them. A
  future ticket may decide to wire `shift.opened`/`shift.closed` into `AUDITED_EVENT_TYPES`,
  or decide the current state is fine — that decision is out of scope here.

## File Location

`docs/architecture/SIGNALS.md` — alongside `EVENT_SUBSCRIBERS.md`, `PRINCIPLES.md`,
`PATTERNS.md`, `ENFORCEMENT.md`. This repo's architecture docs all live under
`docs/architecture/`; a repo-root `SIGNALS.md` would break that convention for no reason.

## Content Outline

### 1. Intro

One short paragraph: what this file is (a living registry of implemented business events),
who/when it's updated (maintainer adds a row when they add a producer or consumer, in the
same PR — see Maintenance Convention), and its scope boundary (implemented only, not the
aspirational roadmap; see Non-Goals).

### 2. Golden Rules

Copied verbatim from `WAFI_Production_Readiness_Plan_v3.md`'s "Golden Rules (from Staff
Engineer review)" section (the same 5 rules already governing this ticket's own scope
decision):

1. Events NEVER mutate business data — subscribers only update caches, analytics,
   notifications, reports, indexes, read models.
2. Domain Events vs. Integration Events — separate streams, separate storage, separate
   retention. (Today: only Domain Events are implemented; no Integration Event has shipped
   yet. Noted honestly, not silently dropped.)
3. Event Naming Convention — past tense, lowercase, dot notation, no abbreviations, no UI
   terminology.
4. Event Versioning Policy — never modify an existing version's payload; ship v2; support
   both; deprecate after migration.
5. Telemetry Events are separate from Business Events (printer errors, Bluetooth status,
   sync retries) — not covered by this registry.

### 3. Versioning Policy (expanded)

Restates Golden Rule #4 with the actual current state: every one of the 17 events below is
at `payloadVersion: 1`. No event has ever shipped a v2 or been deprecated. The policy is
declared and enforced by convention (`payloadVersion` is a required field on every
`DomainEvent`), but genuinely untested by a real version bump — worth knowing before anyone
assumes the multi-version support path has been exercised.

### 4. The Registry

One table, all 17 currently-implemented events, columns: **Event | Producer(s) | Consumer(s)
| Version | Notes**. Content ground-truthed via a full grep pass (this design session) against
`publishEvent()` call sites (direct and via `executeBusinessOperation`'s `toEvent` hook) and
`useEventSubscription`/`runDurableSubscriber` call sites. Every producer/consumer cell carries
a `file:line` reference, not just a service name.

Confirmed content (to be transcribed into the table, exact file:line refs re-verified at
write time in case of drift between this design pass and implementation):

| Event | Producer(s) | Consumer(s) | Notes |
|---|---|---|---|
| `expense.recorded` | `expense.service.ts` `recordExpense()` (`toEvent`) | auditSubscriber (durable) — real row | |
| `stock.received` | `inventory.service.ts` `receiveStock()` (`toEvent`) | auditSubscriber (durable) — **no-op**, mapping returns `null` | legacy manual audit call is the real path |
| `inventory.adjusted` | `inventory.service.ts` `adjustInventory()` (`toEvent`) | auditSubscriber (durable) — **no-op** | legacy manual audit call is the real path |
| `customer.debt_changed` | `useReturnSheet.ts` `confirm()` — bespoke direct `publishEvent()` | auditSubscriber (durable) — real row | only the return/refund path publishes this; no producer for credit-sale creation |
| `installment.due_paid` | `customer.service.ts` `recordPayment()` (`toEvent`) | auditSubscriber (durable) — real row (mapped to legacy `customer.payment_recorded`) | |
| `sale.completed` | `sales.service.ts` `completeSale()` (`toEvent`) | `startDailyEventCountsProjection` (lightweight), `startDashboardRevenueProjection` (lightweight), auditSubscriber (durable, real row) | only event with 3 consumers |
| `sale.discounted` | `sales.service.ts` — bespoke direct `publishEvent()`, two sites (per-line, sale-level) | `startNotificationSubscribers` (durable) — only produces a notification when `belowCost \|\| pinApproval` | **no audit-log consumer at all** — not in `AUDITED_EVENT_TYPES` |
| `shift.opened` | `staff.service.ts` `openShift()` (`toEvent`) | **none** — dormant | switch case exists but not registered in `AUDITED_EVENT_TYPES` |
| `shift.closed` | `staff.service.ts` `closeShift()` (`toEvent`) | **none** — dormant | same as above |
| `settlement.paid` | `staff.service.ts` `paySettlement()` (`toEvent`) | auditSubscriber (durable) — real row (mapped to legacy `staff_settlement.paid`) | |
| `staff.ledger_entry_added` | `staff.service.ts` `addLedgerEntry()` (`toEvent`) | auditSubscriber (durable) — real row (mapped to legacy `staff_ledger.entry_created`) | |
| `sale.returned` | `useReturnSheet.ts` `confirm()` (`toEvent`) | auditSubscriber (durable) — real row (mapped to legacy `return.processed`) | |
| `cash.movement_recorded` | `useCashMovements.ts` `record()` (`toEvent`) | auditSubscriber (durable) — real row (mapped to legacy `cash_movement.recorded`) | |
| `stock.taken` | `useStockTake.ts` `confirmSession()` (`toEvent`) | auditSubscriber (durable) — real row (mapped to legacy `stock_take.completed`) | |
| `product.price_changed` | `useProducts.ts` `save()` (`toEvent`) | auditSubscriber (durable) — real row (product name not carried) | shares one `toEvent` slot with `cost_updated`; if both change in one save, only `cost_updated` fires |
| `product.cost_updated` | `useProducts.ts` `save()` (`toEvent`) | auditSubscriber (durable) — **no-op**, deliberately deferred (RLS-widening concern) | wins over `price_changed` when both change in one save |
| `product.created` | `useProducts.ts` `save()` create branch (`toEvent`) | auditSubscriber (durable) — real row (verbatim payload) | |
| `device.registered` | `useDeviceRegistration.ts` `registerDevice()` — bespoke direct `publishEvent()` | auditSubscriber (durable) — real row (verbatim payload) | RPC + local insert, not a local-write/audit pair, hence bespoke |

### 5. Known Gaps

Called out explicitly, not buried in table notes, so the doc's own existence surfaces them
rather than requiring a reader to notice the pattern across scattered "Notes" cells:

- **Dormant events:** `shift.opened` and `shift.closed` are produced on every shift
  open/close, but nothing subscribes to them — `mapEventToAuditEntry`'s switch has cases for
  both, but neither is registered in `AUDITED_EVENT_TYPES`, so `runDurableSubscriber` never
  starts for them. The manual `logShiftOpened`/`logShiftClosed` calls remain the only audit
  path, entirely outside the event system.
- **No-op consumers:** `stock.received`, `inventory.adjusted`, and `product.cost_updated`
  each have a durable subscriber that IS registered and DOES mark the event processed in the
  idempotency ledger, but whose mapping function deliberately returns `null` — no audit row
  results. Legacy manual audit calls remain the real path for these three, same end state as
  the dormant events above but reached differently (registered-no-op vs. never-registered).
- **Missing audit coverage:** `sale.discounted` has no audit-log consumer at all (it's not in
  `AUDITED_EVENT_TYPES`). Its audit trail comes entirely from the pre-existing manual
  `audit.logDiscountApplied()` calls that sit beside the `publishEvent()` calls in
  `sales.service.ts` — the event system's copy of this event is consumed only by the
  notification subscriber, not by auditing.

None of these are being fixed by this ticket (see Non-Goals) — they're pre-existing,
already-reasoned-about states from prior tickets' final reviews. This section exists so the
next person touching any of these six doesn't have to re-discover the gap by reading five
different files.

### 6. Maintenance Convention

One paragraph, mirroring `EVENT_SUBSCRIBERS.md`'s existing convention: whoever adds a new
event, a new producer for an existing event, or a new consumer, updates this table in the
same PR — same discipline already established for that file. This doc is reviewed at PR
time (per the readiness plan's own checklist item), not CI-enforced; automated staleness
detection is explicitly out of scope (see Non-Goals — that's the Phase 2 dependency-graph
ticket's territory).

## Cross-Epic Edge-Case Checklist (design time)

Matrix rows consulted: Sales, Events, Inventory, Customer, Staff, Cash, Product, Device,
Notifications — every domain that appears as a producer or consumer in the registry table.

This ticket makes **no code change** to any of them — it is a read-only documentation pass.
The only cross-epic risk is the registry going stale relative to future changes in any of
these domains, which the Maintenance Convention section addresses by making the update part
of the same PR discipline already used for `EVENT_SUBSCRIBERS.md`. No new domain interaction
is introduced; no existing interaction is modified.

## Testing / Verification

No automated tests (documentation-only ticket, consistent with `EVENT_SUBSCRIBERS.md`'s
own precedent). Verification is: every producer and consumer `file:line` reference in the
table must be re-confirmed against the actual tree at write time (not just this design
session's snapshot) — a grep-and-check pass per row, same rigor as the ground-truthing
already done for this spec. If any reference has drifted (a file moved, a line shifted),
correct it before committing; do not commit a stale reference.
