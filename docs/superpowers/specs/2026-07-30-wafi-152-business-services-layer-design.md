# WAFI-152: Business Services Layer — Design Spec

**Date:** 2026-07-30
**Status:** Approved for planning
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

Extract business logic out of the 6 composable groups above into 5 framework-agnostic TypeScript services under `src/services/`. Composables become thin wrappers: they keep their Vue-facing reactive API but delegate all validation/calculation/write logic to the corresponding service method. Each service method, after a successful write+audit, emits a stub domain event — defining the contract WAFI-140 will later wire a real bus underneath.

## 3. Non-Goals (explicitly out of scope for this ticket)

- **Repository layer.** The plan's diagram shows `UI → Business Service → Repository → Event`, but no repository abstraction exists today and introducing one is a separate architectural investment. Services call PowerSync's `db.writeTransaction` directly, exactly as composables do today. A repository layer can be inserted later without changing the Service public interface.
- **Real event bus / subscribers.** WAFI-140's job. This ticket only defines the event *shape* and a no-op `publishEvent()` so every service already has the call site in place.
- **Generalized offline write-queue.** PowerSync's existing sync-queue already provides offline durability for `db.writeTransaction` calls; only sale drafts currently use a dedicated Dexie queue (`src/data/dexie/draft.db.ts`), and this ticket does not generalize that pattern.
- **Any change to RLS, auth, or the `executeFinancialWrite` permission-check semantics.** Services must preserve existing behavior exactly, not extend it.

## 4. Services & Extraction Map

All services live in `src/services/`, one file per service, pure TypeScript (no Vue imports).

### SalesService (`src/services/SalesService.ts`)
Extracted from `usePayment.ts`, `useFastCash.ts`.
- `completeSale(input: CompleteSaleInput): Promise<Sale>` → `sale.completed`
  `{ saleId, shopId, staffId, totalUsd, totalSyp, paymentMethods: {cash, card, credit}[], itemCount, discountApplied }`
- `voidSale(saleId: string, reason: string): Promise<void>` → `sale.voided`
  `{ saleId, reason, voidedBy }`
- `returnSale(saleId: string, items: ReturnItem[]): Promise<Return>` → `sale.returned`
  `{ saleId, returnId, items, refundAmount }`

### InventoryService (`src/services/InventoryService.ts`)
Extracted from `useReceivingSheet.ts`, `useReceivings.ts`.
- `receiveStock(input: ReceiveStockInput): Promise<Receiving>` → `stock.received`
  `{ receivingId, supplierId, items: {sku, qty, unitCost}[], totalCost }`
- `adjustInventory(input: AdjustInventoryInput): Promise<Adjustment>` → `inventory.adjusted`
  `{ productId, deltaQty, reason }`

### CustomerService (`src/services/CustomerService.ts`)
Extracted from `useCustomerBalance.ts`.
- `updateDebt(customerId: string, amount: number, reason: string): Promise<CustomerBalance>` → `customer.debt_changed`
  `{ customerId, previousBalance, newBalance, amount, reason }`
- `recordPayment(customerId: string, amount: number): Promise<Payment>` → `installment.due_paid`
  `{ customerId, amount, remainingBalance }`

### StaffService (`src/services/StaffService.ts`)
Extracted from `useShift.ts`, `useShiftDetail.ts`, `useStaffLedger.ts`, `useStaffSettlement.ts`.
- `openShift(staffId: string, openingCash: number): Promise<Shift>` → `shift.opened`
  `{ shiftId, staffId, openingCash }`
- `closeShift(shiftId: string, countedCash: number): Promise<Shift>` → `shift.closed`
  `{ shiftId, staffId, expectedCash, countedCash, variance }`
- `paySettlement(staffId: string, amount: number): Promise<Settlement>` → `settlement.paid`
  `{ staffId, amount, ledgerBalanceAfter }`
- `addLedgerEntry(staffId: string, entry: LedgerEntryInput): Promise<LedgerEntry>` → `staff.ledger_entry_added`
  `{ staffId, entryType, amount }`

### ExpenseService (`src/services/ExpenseService.ts`)
Extracted from `useExpenses.ts`.
- `recordExpense(input: RecordExpenseInput): Promise<Expense>` → `expense.recorded`
  `{ expenseId, category, amountUsd, staffId, photoUrl? }`

## 5. Event Stub Interface

```ts
// src/services/events/domainEvent.ts
export interface DomainEvent<TPayload = unknown> {
  type: string          // e.g. 'sale.completed' — matches WAFI-140 canonical event names
  payload: TPayload
  staffId: string
  shopId: string
  occurredAt: string    // ISO timestamp
}

// src/services/events/publishEvent.ts
export async function publishEvent<T>(event: DomainEvent<T>): Promise<void> {
  // no-op until WAFI-140 wires a real event bus underneath
}
```

Each service method calls `publishEvent()` immediately after the write+audit succeeds — never before, and never if the write fails (matches the plan's ADR-002: events never precede a durable mutation, since replay must be safe). Event `type` strings and payload shapes match this spec's §4 exactly, so WAFI-140 can wire subscribers directly without renaming or reshaping anything.

## 6. Preserving Existing Invariants

Every service method that performs a financial write must still route through `executeFinancialWrite` (`src/composables/executeFinancialWrite.ts`), unchanged:

```ts
return executeFinancialWrite(
  () => db.writeTransaction(...),
  (result) => audit(result),
  requiredPermission,
)
```

This guarantees the existing "no write without exactly one audit call" and permission-check invariants carry over unchanged from the composables into the services. Services do not alter `executeFinancialWrite`'s semantics.

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

Acceptance criteria (from the plan, verified against this design):
- [ ] Zero business logic in Vue components (already true today — logic lives in composables, moving to services)
- [ ] All composables are thin wrappers around services
- [ ] Services are pure TypeScript, framework-agnostic (no `ref`/`computed`/Vue imports in `src/services/`)
- [ ] Services publish domain events (stub, per §5)
- [ ] Unit tests for all services (Vitest, >80% coverage)
- [ ] Services work offline (unchanged — PowerSync `db.writeTransaction` semantics carry over)

## 8. Testing Strategy

- **New service tests:** `src/services/__tests__/<Service>.test.ts`, one per service, targeting >80% coverage on validation and calculation logic — this is where business-rule assertions live going forward.
- **Existing composable tests trimmed:** `usePayment.test.ts`, `useShift.deactivation.test.ts`, `useExpenses.test.ts`, `useReceivings.test.ts`, `useReceivingSheet.test.ts`, `useStaffSettlement.test.ts`, `useStaffLedger.test.ts` keep only delegation and reactive-state assertions (e.g. "calling `pay()` invokes `SalesService.completeSale` with the mapped input and toggles `isProcessing`"). Business-rule test cases move to the new service test files rather than being duplicated.
- **Error handling:** services throw typed errors (e.g. `InsufficientStockError`, `PermissionDeniedError` — the latter already thrown by `executeFinancialWrite`). Composables catch and map these to existing UI-facing error state; no user-visible behavior change.

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
4. Services emit event stubs now (no-op `publishEvent`), not deferred to WAFI-140.
5. No repository layer yet — services call PowerSync directly.
6. Event payload shapes defined concretely now, not left loosely typed.
7. Staff-ledger/settlement logic folds into StaffService now, not a fast-follow.
8. Business-rule tests move to new service test files; composable tests trimmed to delegation/reactive-state checks only.
