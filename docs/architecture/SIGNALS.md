# SIGNALS.md — Business Event Registry

This is a living registry of every business (domain) event actually implemented in this
codebase today — its producer(s), its consumer(s), and any known gap between what it's
supposed to deliver and what it actually delivers. It documents **implemented events only**,
not the aspirational roadmap in `WAFI_Production_Readiness_Plan_v3.md`'s "Canonical Events
(26+)" table. See that file's Golden Rules section (reproduced below) for the policy this
registry enforces by convention.

Maintenance: whoever adds a new event, a new producer for an existing event, or a new
consumer, updates the table below in the same PR. This doc is reviewed at PR time, not
CI-enforced; automated staleness detection and an auto-generated dependency graph are
explicitly out of scope here (WAFI-142 Phase 2, not this ticket).

## Golden Rules

(Copied from `WAFI_Production_Readiness_Plan_v3.md`'s "Golden Rules (from Staff Engineer
review)" — the enforceable contract every event in this registry follows.)

1. **Events NEVER mutate business data** — subscribers only update caches, analytics,
   notifications, reports, indexes, read models. Inventory, customer balance, ledger entries
   happen in the transaction itself.
2. **Domain Events vs. Integration Events** — separate streams, separate storage, separate
   retention. Today: only Domain Events are implemented; no Integration Event has shipped.
3. **Event Naming Convention** — past tense, lowercase, dot notation (`sale.completed`,
   `inventory.adjusted`). No abbreviations, no UI terminology, no "clicked" or "saved".
4. **Event Versioning Policy** — never modify an existing version's payload. Create v2.
   Support both. Deprecate after migration. See "Versioning Policy" below for current state.
5. **Telemetry Events are separate** — printer errors, Bluetooth status, sync retries belong
   to Telemetry Events, not Business Events, and are not covered by this registry.

## Versioning Policy

Every event below is at `payloadVersion: 1`. No event has ever shipped a v2 or been
deprecated. The policy (Golden Rule #4) is declared and structurally enforced — every
`DomainEvent` requires a `payloadVersion` field — but genuinely unexercised: nothing in this
codebase has tested the multi-version-support path in practice.

## The Registry

| Event | Producer(s) | Consumer(s) | Notes |
|---|---|---|---|
| `expense.recorded` | `expense.service.ts:105` `recordExpense()` | auditSubscriber (durable) — real row | |
| `stock.received` | `inventory.service.ts:141` `receiveStock()` | auditSubscriber (durable) — **no-op**, mapping returns `null` | legacy manual audit call is the real path |
| `inventory.adjusted` | `inventory.service.ts:221` `adjustInventory()` | auditSubscriber (durable) — **no-op** | legacy manual audit call is the real path |
| `customer.debt_changed` | `useReturnSheet.ts:363` `confirm()` — bespoke direct `publishEvent()` | auditSubscriber (durable) — real row | only the return/refund path publishes this; no producer for credit-sale creation |
| `installment.due_paid` | `customer.service.ts:101` `recordPayment()` | auditSubscriber (durable) — real row (mapped to legacy `customer.payment_recorded`) | |
| `sale.completed` | `sales.service.ts:324` `completeSale()` | `startDailyEventCountsProjection` (lightweight), `startDashboardRevenueProjection` (lightweight), auditSubscriber (durable, real row) | only event with 3 consumers |
| `sale.discounted` | `sales.service.ts:276` (per-line), `:306` (sale-level) — bespoke direct `publishEvent()`, 2 sites | `startNotificationSubscribers` (durable) — only produces a notification when `belowCost \|\| pinApproval` | **no audit-log consumer at all** — not in `AUDITED_EVENT_TYPES` |
| `shift.opened` | `staff.service.ts:179` `openShift()` | **none** — dormant | switch case exists but not registered in `AUDITED_EVENT_TYPES` |
| `shift.closed` | `staff.service.ts:211` `closeShift()` (`toEvent:` at `:244`) | **none** — dormant | same as above |
| `settlement.paid` | `staff.service.ts:109` `paySettlement()` | auditSubscriber (durable) — real row (mapped to legacy `staff_settlement.paid`) | |
| `staff.ledger_entry_added` | `staff.service.ts:68` `addLedgerEntry()` | auditSubscriber (durable) — real row (mapped to legacy `staff_ledger.entry_created`) | |
| `sale.returned` | `useReturnSheet.ts:328` `confirm()` | auditSubscriber (durable) — real row (mapped to legacy `return.processed`) | |
| `cash.movement_recorded` | `useCashMovements.ts:81` `record()` | auditSubscriber (durable) — real row (mapped to legacy `cash_movement.recorded`) | |
| `stock.taken` | `useStockTake.ts:204` `confirmSession()` | auditSubscriber (durable) — real row (mapped to legacy `stock_take.completed`) | |
| `product.price_changed` | `useProducts.ts:115` `save()` | auditSubscriber (durable) — real row (product name not carried) | shares one `toEvent` slot with `cost_updated`; if both change in one save, only `cost_updated` fires |
| `product.cost_updated` | `useProducts.ts:115` `save()` | auditSubscriber (durable) — **no-op**, deliberately deferred (RLS-widening concern) | wins over `price_changed` when both change in one save |
| `product.created` | `useProducts.ts:157` `save()` create branch | auditSubscriber (durable) — real row (verbatim payload) | |
| `device.registered` | `useDeviceRegistration.ts:39` `registerDevice()` — bespoke direct `publishEvent()` | auditSubscriber (durable) — real row (verbatim payload) | RPC + local insert, not a local-write/audit pair, hence bespoke |

## Known Gaps

- **Dormant events:** `shift.opened` and `shift.closed` are produced on every shift
  open/close, but nothing subscribes to them — `mapEventToAuditEntry`'s switch has cases for
  both (both return `null`), but neither string is registered in `AUDITED_EVENT_TYPES`, so
  `runDurableSubscriber` never starts for them. The manual `logShiftOpened`/`logShiftClosed`
  calls remain the only audit path, entirely outside the event system.
- **No-op consumers:** `stock.received`, `inventory.adjusted`, and `product.cost_updated`
  each have a durable subscriber that IS registered and DOES mark the event processed in the
  idempotency ledger, but whose mapping function deliberately returns `null` — no audit row
  results. Legacy manual audit calls remain the real path for these three.
- **Missing audit coverage:** `sale.discounted` has no audit-log consumer at all (not in
  `AUDITED_EVENT_TYPES`). Its audit trail comes entirely from the pre-existing manual
  `audit.logDiscountApplied()` calls that sit beside the `publishEvent()` calls in
  `sales.service.ts` — the event system's copy of this event is consumed only by the
  notification subscriber (WAFI-143), not by auditing.

None of these gaps are fixed by this registry — they're pre-existing, already-reasoned-about
states from prior tickets' final reviews (see `WAFI_Production_Readiness_Plan_v3.md`'s
WAFI-150/WAFI-143 entries for the review context). This section exists so the next person
touching any of these six doesn't have to re-discover the gap by reading five different
files.
