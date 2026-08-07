# WAFI-142 — Business Event Registry (SIGNALS.md) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `docs/architecture/SIGNALS.md`, a living registry documenting every one of
this codebase's 17 implemented business events — producer, consumer, version, and any gap
between intended and actual coverage — closing the dangling `SIGNALS.md` reference already
sitting in `WAFI_Production_Readiness_Plan_v3.md`'s PR checklist.

**Architecture:** Single new markdown file, no code changes. All content (the Golden Rules,
the registry table, the known-gaps list) is fully specified below, ground-truthed against
the actual tree as of this plan's writing — verify each `file:line` reference is still
accurate at write time (files can drift between planning and implementation), don't
transcribe blindly.

**Tech Stack:** Markdown only. No build/test tooling touches this file.

## Global Constraints

- File lives at `docs/architecture/SIGNALS.md` — this repo's other living architecture docs
  (`EVENT_SUBSCRIBERS.md`, `PRINCIPLES.md`, `PATTERNS.md`, `ENFORCEMENT.md`) all live under
  `docs/architecture/`; a repo-root file would break that convention.
- This registry documents **implemented events only** — not the aspirational "Canonical
  Events (26+)" roadmap list in `WAFI_Production_Readiness_Plan_v3.md`. If a table row would
  require inventing a producer or consumer that doesn't exist in code, it's out of scope.
- No auto-generation, no CI enforcement — this is a hand-maintained doc updated by PR
  convention, same discipline as `EVENT_SUBSCRIBERS.md`. That's explicitly Phase 2, not this
  ticket (design spec's Non-Goals).
- Design spec: `docs/superpowers/specs/2026-08-07-wafi-142-business-event-registry-design.md`
  — read in full before implementing; this plan assumes familiarity with it.
- Do not fix any of the gaps this doc surfaces (dormant `shift.opened`/`shift.closed`, the
  three no-op audit consumers, `sale.discounted`'s missing audit coverage) — document them
  as-is. Fixing them is explicitly out of scope (design spec Non-Goals).

---

### Task 1: Write and verify `docs/architecture/SIGNALS.md`

**Files:**
- Create: `docs/architecture/SIGNALS.md`

**Interfaces:** None — this is the only task in this plan; the file is the complete
deliverable.

- [ ] **Step 1: Re-verify every producer file:line reference**

Run each of the following and confirm the line numbers below still match (they were
confirmed accurate as of this plan's writing — re-check for drift before transcribing):

```bash
grep -n "toEvent:" src/services/expense.service.ts
grep -n "toEvent:" src/services/inventory.service.ts
grep -n "toEvent:" src/services/customer.service.ts
grep -n "toEvent:\|void publishEvent" src/services/sales.service.ts
grep -n "toEvent:" src/services/staff.service.ts
grep -n "toEvent:\|await publishEvent" src/features/returns/composables/useReturnSheet.ts
grep -n "toEvent:" src/features/shifts/composables/useCashMovements.ts
grep -n "toEvent:" src/features/stock-take/composables/useStockTake.ts
grep -n "toEvent:" src/features/products/composables/useProducts.ts
grep -n "void publishEvent" src/features/devices/composables/useDeviceRegistration.ts
```

Confirmed as of this plan's writing:

| Event | Producer file:line | Function |
|---|---|---|
| `expense.recorded` | `src/services/expense.service.ts:105` | `recordExpense()` |
| `stock.received` | `src/services/inventory.service.ts:141` | `receiveStock()` |
| `inventory.adjusted` | `src/services/inventory.service.ts:221` | `adjustInventory()` |
| `customer.debt_changed` | `src/features/returns/composables/useReturnSheet.ts:363` | `confirm()` (bespoke `publishEvent`) |
| `installment.due_paid` | `src/services/customer.service.ts:101` | `recordPayment()` |
| `sale.completed` | `src/services/sales.service.ts:324` | `completeSale()` |
| `sale.discounted` | `src/services/sales.service.ts:276` (per-line), `:306` (sale-level) | `completeSale()` (bespoke `publishEvent`, 2 sites) |
| `shift.opened` | `src/services/staff.service.ts:179` | `openShift()` |
| `shift.closed` | `src/services/staff.service.ts:211` (function start — grep for `toEvent:` inside it to confirm exact line) | `closeShift()` |
| `settlement.paid` | `src/services/staff.service.ts:109` | `paySettlement()` |
| `staff.ledger_entry_added` | `src/services/staff.service.ts:68` | `addLedgerEntry()` |
| `sale.returned` | `src/features/returns/composables/useReturnSheet.ts:328` | `confirm()` |
| `cash.movement_recorded` | `src/features/shifts/composables/useCashMovements.ts:81` | `record()` |
| `stock.taken` | `src/features/stock-take/composables/useStockTake.ts:204` | `confirmSession()` |
| `product.price_changed` | `src/features/products/composables/useProducts.ts:115` | `save()` (shares `toEvent` slot with `cost_updated`) |
| `product.cost_updated` | `src/features/products/composables/useProducts.ts:115` | `save()` (wins over `price_changed` when both change) |
| `product.created` | `src/features/products/composables/useProducts.ts:157` | `save()` create branch |
| `device.registered` | `src/features/devices/composables/useDeviceRegistration.ts:39` | `registerDevice()` (bespoke `publishEvent`) |

- [ ] **Step 2: Re-verify every consumer file:line reference**

```bash
grep -n "AUDITED_EVENT_TYPES\s*:\|AUDITED_EVENT_TYPES = \[" src/services/events/auditSubscriber.ts
grep -n "case '" src/services/events/auditSubscriber.ts
grep -n "startAuditSubscribers\|startDailyEventCountsProjection\|startDashboardRevenueProjection\|startNotificationSubscribers" src/App.vue
grep -n "eventType:" src/services/events/notificationSubscriber.ts
```

Confirmed as of this plan's writing:
- `src/services/events/auditSubscriber.ts:152-156` — `AUDITED_EVENT_TYPES` array — contains:
  `product.cost_updated`, `product.price_changed`, `product.created`, `device.registered`,
  `stock.taken`, `stock.received`, `cash.movement_recorded`, `sale.completed`,
  `sale.returned`, `customer.debt_changed`, `installment.due_paid`, `inventory.adjusted`,
  `staff.ledger_entry_added`, `settlement.paid`, `expense.recorded`. **Not present:**
  `shift.opened`, `shift.closed`, `sale.discounted`.
- `src/services/events/auditSubscriber.ts:45-51` — `case 'product.cost_updated'` returns
  `null` (no-op).
- `src/services/events/auditSubscriber.ts` — `case 'stock.received'` returns `null` (no-op;
  find via the grep above, exact line may have shifted).
- `src/services/events/auditSubscriber.ts:116-117` — `case 'inventory.adjusted'` returns
  `null` (no-op).
- `src/services/events/auditSubscriber.ts:144-146` — `case 'shift.opened'` / `case
  'shift.closed'` both return `null`, AND neither string appears in `AUDITED_EVENT_TYPES` —
  so `runDurableSubscriber` is never even started for these two; fully dormant.
- `src/services/events/notificationSubscriber.ts:69` — `eventType: 'sale.discounted'`,
  the only consumer for this event; `mapEventToNotification` only produces an entry when
  `belowCost || pinApproval` (check the file for the exact line of that condition).
- `src/services/events/dailyEventCountsProjection.ts` and
  `src/services/events/dashboardRevenueProjection.ts` — both subscribe to `sale.completed`
  only (lightweight, `useEventSubscription` + `processProjectionAtMostOnce`).
- `src/App.vue:131,138,139,143` — confirms all four subscriber-starter functions
  (`startDailyEventCountsProjection`, `startDashboardRevenueProjection`,
  `startNotificationSubscribers`, `startAuditSubscribers`) are actually called, not just
  imported.

- [ ] **Step 3: Write the file**

Create `docs/architecture/SIGNALS.md` with this exact content (adjust any `file:line`
reference that Step 1/2's re-verification found to have drifted):

```markdown
# SIGNALS.md — Business Event Registry

This is a living registry of every business (domain) event actually implemented in this
codebase today — its producer(s), its consumer(s), and any known gap between what it's
supposed to deliver and what it actually delivers. It documents **implemented events only**,
not the aspirational roadmap in `WAFI_Production_Readiness_Plan_v3.md`'s "Canonical Events
(26+)" table. See that file's Golden Rules section (reproduced below) for the policy this
registry enforces by convention.

Maintenance: whoever adds a new event, a new producer for an existing event, or a new
consumer, updates the table below in the same PR — the same discipline already used for
`EVENT_SUBSCRIBERS.md`. This doc is reviewed at PR time, not CI-enforced; automated
staleness detection and an auto-generated dependency graph are explicitly out of scope here
(WAFI-142 Phase 2, not this ticket).

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
| `shift.closed` | `staff.service.ts:211` `closeShift()` | **none** — dormant | same as above |
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
```

- [ ] **Step 4: Cross-check the finished table against `domainEvent.types.ts`**

Run: `grep -n "^  [A-Za-z].*: '" src/services/events/domainEvent.types.ts | wc -l`
Expected: `17` (or whatever the current count is — if it's grown since this plan was
written, add the new event(s) to the table before proceeding; do not ship a registry
missing an event that exists in the type file).

- [ ] **Step 5: Confirm no build/type-check impact**

Run: `npx vue-tsc -b --noEmit`
Expected: PASS (this step touches no `.ts`/`.vue` file, so this should be a no-op
confirmation, not a real risk — but confirm it anyway per this repo's practice of never
skipping a verification step).

- [ ] **Step 6: Commit**

```bash
git add docs/architecture/SIGNALS.md
git commit -m "docs(WAFI-142): add Business Event Registry (SIGNALS.md)"
```
