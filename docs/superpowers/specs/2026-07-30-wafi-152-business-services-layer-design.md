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
| Staff ledger/settlement | `src/features/staff-ledger/composables/useStaffLedger.ts`, `useStaffSettlement.ts` | 99 / 265 lines | Related to shifts but separate; folded into StaffService (see §4) |
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
Extracted from `usePayment.ts`'s `confirm()` only.

**Correction (2026-07-30 codebase survey):** there is no "void" concept anywhere in this codebase, and no `voidSale`/`returnSale` function exists in `usePayment.ts` or anywhere else. Refunds/returns are a genuinely separate feature (`src/features/returns/composables/useReturnSheet.ts`) with their own transaction, audit calls, and installment-plan-cancellation coupling (`cancelPlanWithinTx`). **`voidSale`/`returnSale` are dropped from WAFI-152's scope entirely** — a returns-extraction service (`ReturnsService`, or folded into `SalesService` later) is a follow-up ticket, not part of this one. There is also no existing `PaymentInput` type; `usePayment.confirm()` currently takes only an optional `customerId: string`, reading everything else off the composable's own refs (`method`, `amountReceived`, `pendingPayments`). `CompleteSaleInput` is therefore a **new** type this ticket introduces, shaped to carry what `confirm()` today reads from refs.

- `completeSale(input: CompleteSaleInput): Promise<Sale>` → `DomainEventType.SaleCompleted`
  `{ saleId, shopId, staffId, totalUsd, totalSyp, paymentSummary: { cashUsd, cashSyp, cardTotal, creditTotal, methodCount }, itemCount, discountApplied }`

### InventoryService (`src/services/inventory.service.ts`)

**Correction (2026-07-30 codebase survey):** `adjustInventory` does not belong to `useReceivingSheet.ts`/`useReceivings.ts` — that logic actually lives in `src/features/products/composables/useProducts.ts` (`adjustStock` for absolute values, `adjustStockBy` for deltas — the latter used by stock-take, WAFI-121). `receiveStock` extracts from `useReceivingSheet.ts` as originally planned, **including its own inline stock-increment block** (lines 101–124 of that file) — that increment has different semantics from `adjustStock`/`adjustStockBy` (no `stock_adjustments` row; folded into the `receiving.created` audit event instead of `stock.adjusted`) and stays a separate code path rather than being consolidated. No `ReceiveStockInput`/`Adjustment`/`AdjustInventoryInput` types exist today; all are new types this ticket introduces. `StockAdjustment` (`src/features/products/product.types.ts`) is the closest existing analog for `Adjustment`'s shape (`{ id, productId, oldValue, newValue, reason, notes?, createdAt, deviceId }`).

- `receiveStock(input: ReceiveStockInput): Promise<Receiving>` → `DomainEventType.StockReceived` (extracted from `useReceivingSheet.ts`)
  `{ receivingId, supplierId, skuCount, totalCost }`
- `adjustInventory(input: AdjustInventoryInput): Promise<Adjustment>` → `DomainEventType.InventoryAdjusted` (extracted from `useProducts.ts`'s `adjustStock`/`adjustStockBy` — `AdjustInventoryInput` carries a discriminated `mode: 'absolute' | 'delta'` so one method covers both call shapes)
  `{ productId, deltaQty, reason }`

### CustomerService (`src/services/customer.service.ts`)
Extracted from `useCustomerBalance.ts` only.

**Correction (2026-07-30 codebase survey):** no `CustomerBalance` type and no `updateDebt` function exist anywhere in the codebase — the spec's original assumption of an existing type/function to extract was wrong. The current balance shape is implicit (a bare `number` plus separately-tracked `pendingSyncCount`/`openInvoices`/`payments` refs); `CustomerBalance` below is a **new** type this ticket introduces to give that implicit shape a name. There is also no single `recordPayment` — ad-hoc invoice collections (`useCustomerBalance.ts`) and installment-due payments (`useInstallmentPlan.ts`) are two separate, independently-evolved code paths with different transaction/audit patterns (the former calls `db.writeTransaction` directly and awaits the audit call manually; the latter routes through `executeFinancialWrite`). **WAFI-152 extracts only `useCustomerBalance.ts`'s `recordPayment`** (ad-hoc collections against open invoices); `useInstallmentPlan.ts`'s `recordDuePayment` stays untouched and is a candidate for a later ticket once this pattern is proven. `updateDebt` is dropped — there is nothing to extract it from; if a direct debt-adjustment method is needed later, it is designed fresh in that follow-up ticket, not invented here.

- `recordPayment(customerId: string, allocations: PaymentAllocation[]): Promise<CustomerBalance>` → `DomainEventType.InstallmentDuePaid`
  `{ customerId, amount, remainingBalance }`

### StaffService (`src/services/staff.service.ts`)

**Correction (2026-07-30 codebase survey):** `useStaffLedger.ts`/`useStaffSettlement.ts` do not live at `src/features/staff/composables/` as the spec originally assumed — the real path is `src/features/staff-ledger/composables/`.

Extracted from `useShift.ts`, `useShiftDetail.ts`, `src/features/staff-ledger/composables/useStaffLedger.ts`, `src/features/staff-ledger/composables/useStaffSettlement.ts`.
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

**Correction (2026-07-30 codebase survey):** the existing input type is `NewExpense` (`src/features/expenses/expense.types.ts`), not `RecordExpenseInput` as originally assumed — `recordExpense`'s input parameter is `NewExpense`, reusing the existing type rather than introducing a new one. Two behavioral gaps found in `useExpenses.ts` that this extraction should preserve as-is (not silently fix): `duplicateLastMonth` currently issues no audit call at all, unlike `save`/`updateExpense`/`deleteExpense` — this ticket keeps that inconsistency rather than changing behavior, and flags it in the extracted service with a comment for a future ticket. The recurring-expense insert loop in `save` (one `db.execute` per month, no `writeTransaction` wrapper) also stays as-is — no transaction is added — since fixing that data-integrity gap is out of scope for a like-for-like extraction.

- `recordExpense(input: NewExpense): Promise<Expense>` → `DomainEventType.ExpenseRecorded`
  `{ expenseId, category, amountUsd, staffId, photoUrl? }`

Event payloads above are stable business facts, not UI DTOs — e.g. `SalesService.completeSale` reports a `paymentSummary` (aggregated totals per method) rather than the raw `paymentMethods[]` array a payment screen would render, and `returnSale`/`receiveStock` report counts/totals rather than full item arrays. Once WAFI-140 ships, subscribers depend on these shapes as a contract; reshaping them later is a breaking change, so each payload is scoped to what a subscriber plausibly needs, not what the UI happened to have on hand.

## 5. Event Type Registry & Payload Shape

`type` is a closed enum, not a free-form string — a free-form string lets `sale.completed`, `sale.complete`, and `saleCompleted` all compile, and WAFI-140 would have no way to catch a subscriber wired to the wrong string.

```ts
// src/services/events/domainEvent.types.ts
export enum DomainEventType {
  SaleCompleted = 'sale.completed',
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
- **Existing composable tests trimmed:** `usePayment.test.ts`, `useShift.deactivation.test.ts`, `useExpenses.test.ts`, `useReceivings.test.ts`, `useReceivingSheet.test.ts`, `useProducts.test.ts` (adjustStock/adjustStockBy cases only), `useCustomerBalance.test.ts`, `src/__tests__/features/useStaffSettlement.test.ts`, `useStaffLedger.test.ts` keep only delegation and reactive-state assertions (e.g. "calling `pay()` invokes `SalesService.completeSale` with the mapped input and toggles `isProcessing`"). Business-rule test cases move to the new service test files rather than being duplicated.
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

## Decisions Made During Codebase Verification (pre-plan)

A full-file read of all 6 composable groups (2026-07-30) surfaced several places where this spec's original assumptions didn't match the real code. Corrections, inline above in §4:

19. **Sales:** dropped `voidSale`/`returnSale` from WAFI-152 entirely — no void concept exists anywhere in the codebase, and refunds live in a wholly separate feature (`useReturnSheet.ts`) with their own transaction and installment-plan coupling. `SalesService` in this ticket is `completeSale` only; returns extraction is a follow-up ticket. `CompleteSaleInput` is a new type (no `PaymentInput` existed to extract from).
20. **Inventory:** `adjustInventory` extracts from `useProducts.ts` (`adjustStock`/`adjustStockBy`), not from `useReceivingSheet.ts`/`useReceivings.ts` as originally assumed. `receiveStock` keeps its own separate inline stock-increment logic rather than being consolidated onto `adjustInventory` — the two have different semantics today (no `stock_adjustments` row / different audit event) and unifying them is out of scope. `ReceiveStockInput`/`Adjustment`/`AdjustInventoryInput` are all new types.
21. **Customer:** dropped `updateDebt` — no such function or `CustomerBalance` type exists to extract from. `CustomerService.recordPayment` extracts only `useCustomerBalance.ts`'s ad-hoc-collection path; `useInstallmentPlan.ts`'s separate `recordDuePayment` path stays untouched (candidate for a later ticket once this pattern is proven, rather than unifying two independently-evolved payment flows in one sprint).
22. **Staff:** corrected file paths — `useStaffLedger.ts`/`useStaffSettlement.ts` live in `src/features/staff-ledger/composables/`, not `src/features/staff/composables/`.
23. **Expenses:** corrected input type — reuse the existing `NewExpense` type rather than inventing `RecordExpenseInput`. Two pre-existing behavioral quirks (`duplicateLastMonth` has no audit call; the recurring-expense insert loop has no transaction wrapper) are preserved as-is during extraction, not fixed — flagged inline in the service for a future ticket rather than silently changed as a side effect of this one.
