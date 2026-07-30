# WAFI-152: Business Services Layer — Design Spec

**Date:** 2026-07-30
**Status:** NOT IMPLEMENTED YET — spec refined and reviewed, READY TO BE IMPLEMENTED
**Macro-Phase:** 2A (Architecture Transformation) — lead track, prerequisite for WAFI-140 (Event Bus)
**Sequencing assumption:** This spec assumes Macro-Phase 1 (RLS, real auth, device registration, audit wiring — WAFI-001/002/003/004/007) has shipped first, per the plan's stated critical path (`001 → 002 → 003 → 004 → 152`). It does not re-verify Phase 1 completion.

---

## 1. Problem

Business logic (validation, financial calculations, permission checks, DB writes, audit calls) currently lives inline inside Vue composables, mixed with reactive UI state (`ref`/`computed`). This was confirmed by a codebase survey (2026-07-30):

| Domain | Composable(s) | Size | Notes |
|---|---|---|---|
| Sales/payment | `src/features/payment/usePayment.ts`, `useFastCash.ts` | 397 / 41 lines | Cash reconciliation, split-payment math, `db.writeTransaction`, audit calls, all interleaved with UI state |
| Inventory receiving | `src/features/suppliers/composables/useReceivingSheet.ts`, `useReceivings.ts` | 157 / 79 lines | |
| Customer debt/credit | `src/features/customers/composables/useCustomerBalance.ts` | 208 lines | |
| Staff shifts | `src/features/shifts/composables/useShift.ts`, `useShiftDetail.ts` | 452 lines (+detail) | |
| Staff ledger/settlement | `src/features/staff/composables/useStaffLedger.ts`, `useStaffSettlement.ts` | 99 / 265 lines | Related to shifts but separate; folded into StaffService (see §4) |
| Expenses | `src/features/expenses/composables/useExpenses.ts` | 273 lines | |

No repository/service abstraction exists — composables import `db` directly from `src/data/powersync/db` and call `db.writeTransaction(...)` inline. The only existing abstraction is `src/composables/executeFinancialWrite.ts`, a wrapper that enforces "every financial write pairs with exactly one audit-log call" plus an optional permission check (WAFI-007). No event-publishing mechanism exists anywhere in the codebase (confirmed via grep — zero matches for `eventbus`, `publish(`, `emitEvent`, `domain event`).

This blocks WAFI-140 (Event Bus): events must originate from a single reusable place, not from UI-facing composables, so that future APIs, batch imports, barcode scanners, and automation can trigger the same business logic without duplicating it.

## 2. Goal

Extract business logic out of the 6 composable groups above into 5 framework-agnostic TypeScript services under `src/services/`. Composables become thin wrappers: they keep their Vue-facing reactive API but delegate all validation/calculation/write logic to the corresponding service method. Each service method, as part of one atomic write+audit+event operation, emits a stub domain event — defining the contract WAFI-140 will later wire a real bus underneath.

Services are organized by cohesive business capability. If a service grows beyond a manageable size or accumulates unrelated responsibilities (e.g. `SalesService` sprouting `giftCard()`, `loyalty()`, `layaway()` alongside `completeSale()`), extract a new service rather than letting one service become a catch-all business layer.

## 3. Non-Goals (explicitly out of scope for this ticket)

- **Repository layer.** The plan's diagram shows `UI → Business Service → Repository → Event`, but no repository abstraction exists today and introducing one is a separate architectural investment. Services call PowerSync's `db.writeTransaction` directly, exactly as composables do today. A repository layer can be inserted later without changing the Service public interface.
- **Real event bus / subscribers.** WAFI-140's job. This ticket only defines the event *shape* and a no-op publish step so every service already has the call site in place.
- **Generalized offline write-queue.** PowerSync's existing sync-queue already provides offline durability for `db.writeTransaction` calls; only sale drafts currently use a dedicated Dexie queue (`src/data/dexie/draft.db.ts`), and this ticket does not generalize that pattern.
- **Any change to RLS, auth, or the `executeFinancialWrite` permission-check semantics.** Services must preserve existing behavior exactly, not extend it.

## 4. Services & Extraction Map

All services live in `src/services/`, one file per service, pure TypeScript (no Vue imports, no store imports — see §6a). Filenames follow the repo's existing lowercase dot-notation convention for non-composable files (`audit.types.ts`, `customer.types.ts`, `export.validation.ts`), not PascalCase.

### SalesService (`src/services/sales.service.ts`)
Extracted from `usePayment.ts`, `useFastCash.ts`.
- `completeSale(input: CompleteSaleInput): Promise<Sale>` → `DomainEventType.SaleCompleted`
  `{ saleId, shopId, staffId, totalUsd, totalSyp, paymentSummary: { cashUsd, cashSyp, cardTotal, creditTotal, methodCount }, itemCount, discountApplied }`
- `voidSale(saleId: string, reason: string): Promise<void>` → `DomainEventType.SaleVoided`
  `{ saleId, reason, voidedBy }`
- `returnSale(saleId: string, items: ReturnItem[]): Promise<Return>` → `DomainEventType.SaleReturned`
  `{ saleId, returnId, itemCount, refundAmount }`

### InventoryService (`src/services/inventory.service.ts`)
Extracted from `useReceivingSheet.ts`, `useReceivings.ts`.
- `receiveStock(input: ReceiveStockInput): Promise<Receiving>` → `DomainEventType.StockReceived`
  `{ receivingId, supplierId, skuCount, totalCost }`
- `adjustInventory(input: AdjustInventoryInput): Promise<Adjustment>` → `DomainEventType.InventoryAdjusted`
  `{ productId, deltaQty, reason }`

### CustomerService (`src/services/customer.service.ts`)
Extracted from `useCustomerBalance.ts`.
- `updateDebt(customerId: string, amount: number, reason: string): Promise<CustomerBalance>` → `DomainEventType.CustomerDebtChanged`
  `{ customerId, previousBalance, newBalance, amount, reason }`
- `recordPayment(customerId: string, amount: number): Promise<Payment>` → `DomainEventType.InstallmentDuePaid`
  `{ customerId, amount, remainingBalance }`

### StaffService (`src/services/staff.service.ts`)
Extracted from `useShift.ts`, `useShiftDetail.ts`, `useStaffLedger.ts`, `useStaffSettlement.ts`.
- `openShift(staffId: string, openingCash: number): Promise<Shift>` → `DomainEventType.ShiftOpened`
  `{ shiftId, staffId, openingCash }`
- `closeShift(shiftId: string, countedCash: number): Promise<Shift>` → `DomainEventType.ShiftClosed`
  `{ shiftId, staffId, expectedCash, countedCash, variance }`
- `paySettlement(staffId: string, amount: number): Promise<Settlement>` → `DomainEventType.SettlementPaid`
  `{ staffId, amount, ledgerBalanceAfter }`
- `addLedgerEntry(staffId: string, entry: LedgerEntryInput): Promise<LedgerEntry>` → `DomainEventType.StaffLedgerEntryAdded`
  `{ staffId, entryType, amount }`

### ExpenseService (`src/services/expense.service.ts`)
Extracted from `useExpenses.ts`.
- `recordExpense(input: RecordExpenseInput): Promise<Expense>` → `DomainEventType.ExpenseRecorded`
  `{ expenseId, category, amountUsd, staffId, photoUrl? }`

Event payloads above are stable business facts, not UI DTOs — e.g. `SalesService.completeSale` reports a `paymentSummary` (aggregated totals per method) rather than the raw `paymentMethods[]` array a payment screen would render, and `returnSale`/`receiveStock` report counts/totals rather than full item arrays. Once WAFI-140 ships, subscribers depend on these shapes as a contract; reshaping them later is a breaking change, so each payload is scoped to what a subscriber plausibly needs, not what the UI happened to have on hand.

## 5. Event Type Registry & Payload Shape

`type` is a closed enum, not a free-form string — a free-form string lets `sale.completed`, `sale.complete`, and `saleCompleted` all compile, and WAFI-140 would have no way to catch a subscriber wired to the wrong string.

```ts
// src/services/events/domainEvent.types.ts
export enum DomainEventType {
  SaleCompleted = 'sale.completed',
  SaleVoided = 'sale.voided',
  SaleReturned = 'sale.returned',
  StockReceived = 'stock.received',
  InventoryAdjusted = 'inventory.adjusted',
  CustomerDebtChanged = 'customer.debt_changed',
  InstallmentDuePaid = 'installment.due_paid',
  ShiftOpened = 'shift.opened',
  ShiftClosed = 'shift.closed',
  SettlementPaid = 'settlement.paid',
  StaffLedgerEntryAdded = 'staff.ledger_entry_added',
  ExpenseRecorded = 'expense.recorded',
}

export interface DomainEvent<TPayload = unknown> {
  type: DomainEventType
  payload: TPayload
  staffId: string
  shopId: string
  occurredAt: string    // ISO timestamp
}
```

Event `type` values and payload shapes match this spec's §4 exactly, so WAFI-140 can wire subscribers directly against this enum without renaming or reshaping anything. No separate `publishEvent()` call site exists — see §6, which folds event emission into the same wrapper that owns the write and the audit call.

## 6. Preserving Existing Invariants

### 6a. Services never read identity from Vue/session state

Services receive all identity (`staffId`, `shopId`, permission context) through input arguments only. A service file never imports `useSessionStore`, `useSession()`, or any other Vue store — that is what keeps `src/services/` genuinely framework-agnostic, testable without mounting Vue, and reusable from a future API/import/webhook path that has no session store at all.

The one nuance: `executeBusinessWrite` (below) itself still calls `useSessionStore()` internally to perform the optional permission check, exactly as `executeFinancialWrite` does today. That's the wrapper's responsibility, not the service's — the service passes a `requiredPermission` key, not a session object, and never reads the store directly.

### 6b. Write, audit, and event are one atomic operation — not three separate calls

The current `executeFinancialWrite` wrapper only owns write+audit. Bolting `publishEvent()` on as a separate call after it recreates exactly the bug this spec is trying to prevent: the invariant is actually "one business write → one audit → one event," and if publishing is a separate statement, someone will eventually add a new service method, remember the write and the audit, and forget the event.

`executeFinancialWrite` is renamed/extended to `executeBusinessWrite`, which owns all three steps as a single unit:

```ts
// src/composables/executeBusinessWrite.ts
export async function executeBusinessWrite<T>(
  write: () => Promise<T>,
  audit: (result: T) => Promise<void>,
  toEvent: (result: T) => DomainEvent,
  requiredPermission?: keyof StaffPermissions,
): Promise<T> {
  if (requiredPermission) {
    const session = useSessionStore()
    if (!canUserDo(session.activeStaff, requiredPermission)) {
      throw new Error(`permission denied: ${requiredPermission} required`)
    }
  }
  const result = await write()
  await audit(result)
  await publishEvent(toEvent(result))   // internal to this module; not exported for direct use
  return result
}
```

Every service method that performs a financial write calls `executeBusinessWrite` with all three arguments — there is no path that writes without also auditing and publishing. `publishEvent` itself stays a no-op until WAFI-140 wires a real bus, but it is only ever called from inside `executeBusinessWrite`, never directly from service code.

### 6c. Service methods are transaction roots

A service method that opens `db.writeTransaction(...)` is the root of that transaction. Service methods never call another service's method that itself opens a transaction — nested `writeTransaction` calls are not something PowerSync's API is designed around, and the moment WAFI-140 subscribers start composing flows (e.g. "close shift → complete sale → apply customer credit → award reward points"), naive service-calls-service would silently nest transactions.

If a flow genuinely needs to compose multiple services' logic inside one transaction, the composing service exposes an internal `...WithinTx(tx, ...)` helper — following the pattern already established in this codebase for `cancelPlanWithinTx` (`src/features/installments/composables/useInstallmentPlan.ts`, WAFI-010) and its equivalent in `useReturnSheet.ts`. The public `completeSale()`-style method remains the only entry point that opens the transaction; a `completeSaleWithinTx(tx, ...)` variant is what another service's transaction root would call if composition is ever needed. This ticket does not need to build any such composition — WAFI-152's 5 services have no cross-service calls — but the convention is established now so WAFI-140/143 don't invent something incompatible later.

## 7. Composables After Extraction

Composables keep their public API (so calling components need no changes) but internally become thin delegators:

```ts
// usePayment.ts, after extraction
async function pay(input: PaymentInput) {
  isProcessing.value = true
  try {
    const sale = await salesService.completeSale(toCompleteSaleInput(input))
    lastSale.value = sale
    return sale
  } finally {
    isProcessing.value = false
  }
}
```

Return types (`Sale`, `Receiving`, `Shift`, etc. in §4) are provisional — as each service is extracted (§9), check whether the caller actually needs the full persisted row or just a summary (id, computed totals, receipt data). Returning a full DB row by default is acceptable for this ticket, but don't reflexively widen a return type to "the whole row" if a narrower shape is all any caller uses — a wide return type leaks schema details upward and is harder to narrow later than to narrow now.

Acceptance criteria (from the plan, verified against this design):
- [ ] Zero business logic in Vue components (already true today — logic lives in composables, moving to services)
- [ ] All composables are thin wrappers around services
- [ ] Services are pure TypeScript, framework-agnostic (no `ref`/`computed`/Vue imports in `src/services/`)
- [ ] Services publish domain events via `executeBusinessWrite` (§6b) — no service calls a publish function directly
- [ ] Unit tests for all services (Vitest) — see §8 for coverage framing
- [ ] Services work offline (unchanged — PowerSync `db.writeTransaction` semantics carry over)

## 8. Testing Strategy

- **New service tests:** `src/services/__tests__/<service>.service.test.ts`, one per service — this is where business-rule assertions live going forward. Critical business rules (discount math, cash reconciliation, debt calculation, variance calculation) must have unit tests; a blanket percentage target is not the goal in itself. The plan's WAFI-152 AC states ">80% coverage" as its literal acceptance criterion — treat that as the plan's own bar for this ticket's sign-off, but let "is every business rule actually tested" be the working standard while writing tests, not the percentage.
- **Existing composable tests trimmed:** `usePayment.test.ts`, `useShift.deactivation.test.ts`, `useExpenses.test.ts`, `useReceivings.test.ts`, `useReceivingSheet.test.ts`, `useStaffSettlement.test.ts`, `useStaffLedger.test.ts` keep only delegation and reactive-state assertions (e.g. "calling `pay()` invokes `SalesService.completeSale` with the mapped input and toggles `isProcessing`"). Business-rule test cases move to the new service test files rather than being duplicated.
- **Error handling:** services throw typed domain errors (exact error class names/hierarchy are an implementation-planning detail, not fixed here). One of these is the existing permission-denied error already thrown by `executeFinancialWrite`/`executeBusinessWrite` — that behavior is unchanged. Composables catch and map thrown errors to existing UI-facing error state; no user-visible behavior change.

## 9. Migration Approach

Extract one service at a time, in this order (simplest → most complex, matching survey findings):
1. ExpenseService (273 lines, single composable)
2. InventoryService (157 + 79 lines, two composables)
3. CustomerService (208 lines, single composable)
4. SalesService (397 + 41 lines — largest single-domain extraction)
5. StaffService (452 + related ledger/settlement files — most files touched)

Each extraction is a self-contained PR: move logic to the service, add service tests, trim the composable test file, verify the composable's calling components are unaffected (no prop/emit changes).

## 10. Open Questions for Implementation Planning

- None — all decisions in this spec were made during brainstorming (see decision list below). The writing-plans phase should sequence the 5 extractions above and produce per-extraction task breakdowns.

---

## Decisions Made During Brainstorming

1. Scope: WAFI-152 only (not 2A+2B, not full Macro-Phase 2).
2. Assume Macro-Phase 1 ships first; this spec does not hedge against Phase 1 being incomplete.
3. All 5 services in one spec (not SalesService-first).
4. Services emit event stubs now (no-op publish), not deferred to WAFI-140.
5. No repository layer yet — services call PowerSync directly.
6. Event payload shapes defined concretely now, not left loosely typed.
7. Staff-ledger/settlement logic folds into StaffService now, not a fast-follow.
8. Business-rule tests move to new service test files; composable tests trimmed to delegation/reactive-state checks only.

## Decisions Made During Review (post-draft)

9. `publishEvent` is not called directly by services — write, audit, and event publish are folded into one wrapper (`executeBusinessWrite`, §6b) so no service method can write+audit without also publishing.
10. Event `type` is a closed `DomainEventType` enum (§5), not a free-form string.
11. Event payloads are stable business facts (aggregated summaries/counts), not UI-shaped DTOs (§4) — e.g. `paymentSummary` instead of a raw `paymentMethods[]` array.
12. Services never import Vue stores or read session state directly; all identity flows through input arguments (§6a). The permission check inside `executeBusinessWrite` is the one place session state is read, and that's the wrapper's job, not the service's.
13. Service methods are transaction roots; cross-service composition (if ever needed) uses a `...WithinTx(tx, ...)` helper, following the existing `cancelPlanWithinTx` (WAFI-010) convention — not nested `db.writeTransaction` calls (§6c).
14. Error section states "typed domain errors" generically rather than committing to specific class names now.
15. Service filenames use the repo's existing lowercase dot-notation convention (`sales.service.ts`), not PascalCase.
16. Coverage: kept the plan's literal ">80%" AC as the ticket's stated sign-off bar, but reframed the day-to-day testing standard as "every critical business rule has a test" rather than chasing the percentage (§8).
17. Added an explicit anti-pattern note against services accumulating unrelated responsibilities ("god services") — extract a new service instead (§2).
18. Return types are flagged as provisional — narrow to what callers need during extraction rather than defaulting to full DB rows if a caller only needs a summary (§7).
