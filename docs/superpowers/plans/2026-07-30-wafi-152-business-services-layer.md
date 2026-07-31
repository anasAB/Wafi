# WAFI-152: Business Services Layer — Implementation Plan

> **STATUS: ✅ SHIPPED 2026-07-31.** All 5 tasks implemented. Real-codebase deviations from
> this plan (a 7th `executeFinancialWrite` call site the plan's file list missed in
> `useCashMovements.ts`, `enum` → const-object conversion forced by this repo's
> `erasableSyntaxOnly` build flag, `useShift.ts`'s `openShift`/`closeShift` narrowed to a
> raw-write-only extraction since they're session/identity orchestration not comparable
> business-write logic, and a real bug fixed in the original `adjustInventory` sketch)
> are recorded in `WAFI_Production_Readiness_Plan_v3.md`'s WAFI-152 entry, not re-edited
> into every task/step below — this file is kept as the historical plan, not a live
> checklist. The checkboxes below were not individually ticked during implementation.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract business logic out of 6 Vue composable groups into 5 framework-agnostic TypeScript services under `src/services/`, with a shared `executeBusinessOperation` wrapper that runs a write, then an audit call, then a fire-and-forget domain-event publish.

**Architecture:** `src/services/events/domainEvent.types.ts` defines per-domain closed event-type enums and the shared `DomainEvent<T>` envelope. `src/composables/executeBusinessOperation.ts` replaces `executeFinancialWrite.ts`, taking a `hooks: { audit, toEvent? }` object rather than positional callbacks. Five service files (`sales.service.ts`, `inventory.service.ts`, `customer.service.ts`, `staff.service.ts`, `expense.service.ts`) each wrap `db.writeTransaction` directly (no repository layer) and call `executeBusinessOperation`. Audit-logging functions are injected as parameters (not imported from `useAuditLog` inside the service), so services have zero Vue imports in fact, not just in name. Composables become thin delegators, keeping their existing public API so calling `.vue` components need no changes.

**Tech Stack:** Vue 3 (Composition API), TypeScript, Vitest, PowerSync (`db.writeTransaction`/`db.execute`/`db.getAll`/`db.getOptional`), Pinia (`useSessionStore`, `useDeviceStore`, `useShiftStore`).

## Global Constraints

- Services live in `src/services/`, one file per service, **zero Vue imports, including no `useAuditLog()` call inside a service** — identity and audit-logging both flow in through input arguments/parameters, never imported from a `use*` composable inside `src/services/` (spec §6a, tightened per review — see Task 0).
- Every financial write goes through `executeBusinessOperation(write, hooks, requiredPermission?)` where `hooks = { audit, toEvent? }` — no service calls a publish function directly, and no service imports `useAuditLog` (renamed from `executeBusinessWrite`; object-shaped hooks instead of positional args so adding a future hook doesn't mean another positional parameter).
- `toEvent` in `hooks` is **optional** — omitting it means no event is published for that write. This exists specifically so out-of-scope call sites (installments, returns) never have to invent a fake mapping onto an unrelated `DomainEventType` member just to satisfy the wrapper's signature.
- Audit and publish are **not symmetric**: `audit` is awaited (a financial write is not considered complete until its audit row exists — this is the wrapper's core invariant, unchanged from `executeFinancialWrite`). `publish` is fire-and-forget — it is never awaited by the caller and a publish failure never surfaces as a write failure, since nothing consumes these events yet and no future consumer should be able to make checkout depend on event-bus availability.
- Service filenames use the repo's lowercase dot-notation convention: `sales.service.ts`, not `SalesService.ts` (spec §4).
- Event types are **per-domain closed TypeScript enums** (`ExpenseEventType`, `InventoryEventType`, `CustomerEventType`, `SalesEventType`, `StaffEventType`), not one flat enum and not a free-form string — this anticipates the registry growing past the ~10 members this ticket introduces without a single enum becoming unreadable (spec §5, revised per review).
- Every `DomainEvent<T>` envelope carries a common `entityId: string` field (the ID of the primary entity the event is about) in addition to `type`/`payload`/`staffId`/`shopId`/`occurredAt` — this gives every future subscriber one universal field to log/index/route on without needing to know each event's payload shape. Payload bodies stay domain-specific and richly typed; they are not collapsed into a generic `summary`/`metadata` blob, since that would just move the "every consumer must memorize a shape" problem from the payload into an untyped bag.
- Event payloads describe business facts already computed during the write (amounts, counts, ids) — not a database-insert echo, but also not aggregate/summary fields the write doesn't currently produce (e.g. no fabricated `accountingPeriod` on `ExpenseRecorded` — nothing in the codebase computes that today; a richer payload is a real design task for whoever eventually needs it, not something to invent speculatively here).
- Service methods are transaction roots; no service calls another service's transaction-opening method. Composition (not needed in this ticket) would use a `...WithinTx(tx, ...)` helper per the existing `cancelPlanWithinTx` (WAFI-010) convention (spec §6c).
- `voidSale`/`returnSale`/`updateDebt` are explicitly OUT of scope — dropped after codebase verification found no such logic exists (spec §4 corrections).
- Existing composable public APIs do not change — calling `.vue` components require zero edits.
- Existing composable tests are trimmed to delegation/reactive-state assertions only; business-rule assertions move to new `*.service.test.ts` files (spec §8). Prefer asserting on call counts, bound parameter values, and returned data over `expect.stringContaining('INSERT INTO ...')` SQL-text matching where a behavioral assertion is equally strong — SQL-string assertions are kept only where the specific table/column being written is itself the thing under test, since formatting-only SQL changes shouldn't fail a behavior-correct test.
- Pre-existing behavioral quirks found during verification (e.g. `duplicateLastMonth` has no audit call, the recurring-expense insert loop has no transaction) are preserved as-is, not fixed as a side effect of this ticket.
- **Acknowledged trade-off, not an oversight:** services in this ticket contain business rule + raw SQL + audit-call wiring + event-shape construction all in one file, since spec §3 explicitly defers a repository layer. This is the right call for WAFI's current size, but it is a conscious trade-off — if/when a repository layer is introduced later, these services are exactly where the SQL would be extracted from.
- **Future file-size note (no action needed now):** each service in this ticket has 1-2 methods, so no file-splitting is needed yet. When a service like `sales.service.ts` eventually accumulates many methods (`completeSale`, `returnSale`, `refund`, `exchange`, ...), split into a `sales/` directory (`sales/completeSale.ts`, `sales/returnSale.ts`, ...) with an index re-export, rather than letting one file grow unbounded — flagged here so the convention is anticipated, not because this ticket needs to do it.

---

## File Structure

**Create:**
- `src/services/events/domainEvent.types.ts` — per-domain `*EventType` enums + `DomainEvent<T>` envelope (with `entityId`)
- `src/services/events/publishEvent.ts` — no-op, fire-and-forget publish stub, called only from `executeBusinessOperation`
- `src/composables/executeBusinessOperation.ts` — replaces `executeFinancialWrite.ts` (and the earlier draft's `executeBusinessWrite.ts`)
- `src/services/expense.service.ts` + `src/services/__tests__/expense.service.test.ts`
- `src/services/inventory.service.ts` + `src/services/__tests__/inventory.service.test.ts`
- `src/services/customer.service.ts` + `src/services/__tests__/customer.service.test.ts`
- `src/services/sales.service.ts` + `src/services/__tests__/sales.service.test.ts`
- `src/services/staff.service.ts` + `src/services/__tests__/staff.service.test.ts`

**Modify:**
- `src/features/expenses/composables/useExpenses.ts` — delegate `save`/`updateExpense`/`deleteExpense`/`duplicateLastMonth` to `ExpenseService`
- `src/features/suppliers/composables/useReceivingSheet.ts` — delegate `confirm()` to `InventoryService.receiveStock`
- `src/features/products/composables/useProducts.ts` — delegate `adjustStock`/`adjustStockBy` to `InventoryService.adjustInventory`
- `src/features/customers/composables/useCustomerBalance.ts` — delegate `recordPayment` to `CustomerService.recordPayment`
- `src/features/payment/usePayment.ts` — delegate `confirm()` to `SalesService.completeSale`
- `src/features/shifts/composables/useShift.ts` — delegate `openShift`/`closeShift`/`forceCloseShift` to `StaffService`
- `src/features/staff-ledger/composables/useStaffLedger.ts` — delegate `addLedgerEntry` to `StaffService`
- `src/features/staff-ledger/composables/useStaffSettlement.ts` — delegate `finalize`/`markPaid` to `StaffService`
- All 7 existing test files listed in Global Constraints — trim to delegation assertions
- Every call site of `executeFinancialWrite` — rename import to `executeBusinessOperation` and convert the positional `(write, audit, requiredPermission?)` call into `(write, { audit }, requiredPermission?)` — no `toEvent` needed for the out-of-scope call sites since `toEvent` is optional (grep confirms call sites in: `useStaffLedger.ts`, `useStaffSettlement.ts`, `useInstallmentPlan.ts`, `useReturnSheet.ts` — the latter two are outside WAFI-152's 5 services; see Task 0)

**Delete:** none — `executeFinancialWrite.ts` is superseded in place by Task 1, not left as dead code.

---

## Task Ordering Rationale

Extraction order matches the spec's simplest→most-complex sequencing (§9), but Task 1 (the shared wrapper) must land first since every other task depends on it:

0. `executeBusinessOperation` + event types (foundation — blocks everything else)
1. ExpenseService (single composable, no `writeTransaction` today — simplest)
2. InventoryService (two extraction sources: `useReceivingSheet.ts` + `useProducts.ts`)
3. CustomerService (single composable, needs new `CustomerBalance` type)
4. SalesService (largest single-domain extraction, order-sensitive sequence logic)
5. StaffService (most files touched: shift + ledger + settlement)

---

### Task 0: Event Types & `executeBusinessOperation` Foundation

**Files:**
- Create: `src/services/events/domainEvent.types.ts`
- Create: `src/services/events/publishEvent.ts`
- Create: `src/composables/executeBusinessOperation.ts`
- Test: `src/__tests__/composables/executeBusinessOperation.test.ts`
- Modify: `src/features/staff-ledger/composables/useStaffLedger.ts:2` (import rename)
- Modify: `src/features/staff-ledger/composables/useStaffSettlement.ts` (import rename, all 2 call sites)
- Modify: `src/features/installments/composables/useInstallmentPlan.ts` (import rename, all 3 call sites)
- Modify: `src/features/returns/composables/useReturnSheet.ts` (import rename, 1 call site)

**Interfaces:**
- Produces: per-domain event enums (`ExpenseEventType`, `InventoryEventType`, `CustomerEventType`, `SalesEventType`, `StaffEventType`), `DomainEvent<TPayload>` envelope (with `entityId`), `executeBusinessOperation<T>(write, hooks: { audit, toEvent? }, requiredPermission?): Promise<T>` — every later task's service methods call this.
- Consumes: nothing (this is the foundation task).

**Context:** `executeFinancialWrite.ts` (`src/composables/executeFinancialWrite.ts`) is used today by 4 call sites outside WAFI-152's 5 target composables: `useStaffLedger.ts`, `useStaffSettlement.ts` (both get replaced by StaffService in Task 5, but must compile in the meantime), `useInstallmentPlan.ts`, and `useReturnSheet.ts` (both untouched by WAFI-152 — out of scope, per spec §3). This task replaces the wrapper's positional-args shape with an object-shaped `hooks` parameter specifically so a 3rd/4th future hook (metrics, notifications, cache invalidation) is a new field on that object, not another positional argument shifting every call site again. `toEvent` inside `hooks` is optional: this means the 4 out-of-scope call sites can be migrated onto the new wrapper for audit-consistency without inventing a fake event mapping for logic this ticket doesn't own.

- [ ] **Step 1: Write the failing test for the per-domain event enums**

```ts
// src/__tests__/composables/executeBusinessOperation.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import {
  ExpenseEventType, InventoryEventType, CustomerEventType, SalesEventType, StaffEventType,
} from '@/services/events/domainEvent.types'

describe('per-domain event type registries', () => {
  it('ExpenseEventType has exactly the expense event(s)', () => {
    expect(Object.values(ExpenseEventType)).toEqual(['expense.recorded'])
  })
  it('InventoryEventType has exactly the inventory events', () => {
    expect(Object.values(InventoryEventType)).toEqual(['stock.received', 'inventory.adjusted'])
  })
  it('CustomerEventType has exactly the customer events', () => {
    expect(Object.values(CustomerEventType)).toEqual(['customer.debt_changed', 'installment.due_paid'])
  })
  it('SalesEventType has exactly the sales events', () => {
    expect(Object.values(SalesEventType)).toEqual(['sale.completed'])
  })
  it('StaffEventType has exactly the staff events', () => {
    expect(Object.values(StaffEventType)).toEqual([
      'shift.opened', 'shift.closed', 'settlement.paid', 'staff.ledger_entry_added',
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/composables/executeBusinessOperation.test.ts`
Expected: FAIL with "Cannot find module '@/services/events/domainEvent.types'"

- [ ] **Step 3: Create the per-domain event types**

```ts
// src/services/events/domainEvent.types.ts

// Split by domain (rather than one flat DomainEventType) so the registry stays
// readable as it grows past this ticket's ~9 members — WAFI-140/143 are
// expected to add many more events, and a single enum with 70+ members mixing
// every domain is harder to navigate than five short, domain-scoped ones.

export enum ExpenseEventType {
  Recorded = 'expense.recorded',
}

export enum InventoryEventType {
  StockReceived = 'stock.received',
  Adjusted = 'inventory.adjusted',
}

export enum CustomerEventType {
  DebtChanged = 'customer.debt_changed',
  InstallmentDuePaid = 'installment.due_paid',
}

export enum SalesEventType {
  Completed = 'sale.completed',
}

export enum StaffEventType {
  ShiftOpened = 'shift.opened',
  ShiftClosed = 'shift.closed',
  SettlementPaid = 'settlement.paid',
  LedgerEntryAdded = 'staff.ledger_entry_added',
}

export type DomainEventType =
  | ExpenseEventType | InventoryEventType | CustomerEventType | SalesEventType | StaffEventType

export interface DomainEvent<TPayload = unknown> {
  type: DomainEventType
  /** ID of the primary entity this event is about (expenseId, receivingId, saleId, ...) — the
   *  one field every subscriber can rely on regardless of domain, so logging/indexing/routing
   *  doesn't require knowing each event's payload shape. */
  entityId: string
  payload: TPayload
  staffId: string
  shopId: string
  occurredAt: string
}
```

Note: `CustomerEventType.DebtChanged` is defined for forward-compatibility with the plan's canonical event list, but no service method in WAFI-152 emits it yet (`updateDebt` was dropped — spec §4 correction #21). It stays in the enum since a future ticket will need it, and removing/re-adding enum members later is exactly the kind of churn this closed-enum design is meant to prevent.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/composables/executeBusinessOperation.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Write the failing test for `publishEvent` (fire-and-forget) and `executeBusinessOperation`**

```ts
// append to src/__tests__/composables/executeBusinessOperation.test.ts
import { executeBusinessOperation } from '@/composables/executeBusinessOperation'
import { useSessionStore } from '@/store/session.store'
import type { Staff } from '@/features/staff/staff.types'

describe('executeBusinessOperation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('runs write then audit, in order, and awaits both before resolving', async () => {
    const order: string[] = []
    const write = vi.fn().mockImplementation(async () => { order.push('write'); return { id: 'abc' } })
    const audit = vi.fn().mockImplementation(async () => { order.push('audit') })
    const toEvent = vi.fn().mockReturnValue({
      type: ExpenseEventType.Recorded, entityId: 'abc', payload: { expenseId: 'abc' },
      staffId: 's1', shopId: 'shop1', occurredAt: '2026-07-30T00:00:00.000Z',
    })

    const result = await executeBusinessOperation(write, { audit, toEvent })

    expect(result).toEqual({ id: 'abc' })
    expect(order).toEqual(['write', 'audit'])
    expect(audit).toHaveBeenCalledWith({ id: 'abc' })
  })

  it('does not require toEvent — omitting it publishes nothing and does not throw', async () => {
    const write = vi.fn().mockResolvedValue({ id: 'abc' })
    const audit = vi.fn().mockResolvedValue(undefined)

    await expect(executeBusinessOperation(write, { audit })).resolves.toEqual({ id: 'abc' })
  })

  it('resolves the caller before publish settles — publish is fire-and-forget', async () => {
    const write = vi.fn().mockResolvedValue({ id: 'abc' })
    const audit = vi.fn().mockResolvedValue(undefined)
    let publishResolved = false
    const toEvent = vi.fn().mockReturnValue({
      type: ExpenseEventType.Recorded, entityId: 'abc', payload: {}, staffId: 's1', shopId: 'shop1', occurredAt: 'now',
    })
    // publishEvent itself is a no-op today, so this test asserts the *shape* of the
    // guarantee (executeBusinessOperation never awaits publish) rather than timing —
    // see the mock replacement below to make the guarantee observable.
    vi.doMock('@/services/events/publishEvent', () => ({
      publishEvent: vi.fn().mockImplementation(() => new Promise(r => setTimeout(() => { publishResolved = true; r(undefined) }, 50))),
    }))

    await executeBusinessOperation(write, { audit, toEvent })
    expect(publishResolved).toBe(false)  // the call above returned before the 50ms publish settled
  })

  it('throws before writing when requiredPermission is not satisfied', async () => {
    const session = useSessionStore()
    session.setActiveStaff({ id: 's1', role: 'cashier', permissions: {} } as Staff)
    const write = vi.fn()
    const audit = vi.fn()

    await expect(
      executeBusinessOperation(write, { audit }, 'can_view_expenses'),
    ).rejects.toThrow('permission denied: can_view_expenses required')
    expect(write).not.toHaveBeenCalled()
  })

  it('does not call audit or toEvent when write throws', async () => {
    const write = vi.fn().mockRejectedValue(new Error('db down'))
    const audit = vi.fn()
    const toEvent = vi.fn()

    await expect(executeBusinessOperation(write, { audit, toEvent })).rejects.toThrow('db down')
    expect(audit).not.toHaveBeenCalled()
    expect(toEvent).not.toHaveBeenCalled()
  })

  it('a publish failure does not reject the caller (fire-and-forget swallows errors)', async () => {
    vi.doMock('@/services/events/publishEvent', () => ({
      publishEvent: vi.fn().mockRejectedValue(new Error('bus unavailable')),
    }))
    const write = vi.fn().mockResolvedValue({ id: 'abc' })
    const audit = vi.fn().mockResolvedValue(undefined)
    const toEvent = vi.fn().mockReturnValue({
      type: ExpenseEventType.Recorded, entityId: 'abc', payload: {}, staffId: 's1', shopId: 'shop1', occurredAt: 'now',
    })

    await expect(executeBusinessOperation(write, { audit, toEvent })).resolves.toEqual({ id: 'abc' })
  })
})
```

Note: `vi.doMock` inside a test body (rather than a top-level `vi.mock`) requires Vitest's module registry reset between tests (`vi.resetModules()` in an appropriate `beforeEach`/`afterEach`) to take effect per-test — check `src/__tests__/setup.ts`'s existing config before relying on this; if the repo's Vitest setup doesn't support per-test `doMock`, restructure these two tests to inject `publishEvent` as a parameter to a lower-level test-only helper instead of module-mocking it. Get this working with a real assertion, not a skipped/pending test — the fire-and-forget guarantee is exactly the behavior code review flagged as needing verification.

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/__tests__/composables/executeBusinessOperation.test.ts`
Expected: FAIL with "Cannot find module '@/composables/executeBusinessOperation'" and "Cannot find module '@/services/events/publishEvent'"

- [ ] **Step 7: Implement `publishEvent` and `executeBusinessOperation`**

```ts
// src/services/events/publishEvent.ts
import type { DomainEvent } from './domainEvent.types'

// No-op until WAFI-140 wires a real event bus underneath. Called only from
// executeBusinessOperation, fire-and-forget — never import this directly from a service.
export async function publishEvent<T>(_event: DomainEvent<T>): Promise<void> {
  // intentionally empty
}
```

```ts
// src/composables/executeBusinessOperation.ts
import { useSessionStore } from '@/store/session.store'
import { canUserDo } from '@/router/permissions'
import type { StaffPermissions } from '@/features/staff/staff.types'
import type { DomainEvent } from '@/services/events/domainEvent.types'
import { publishEvent } from '@/services/events/publishEvent'

export interface BusinessOperationHooks<T> {
  /** Awaited — a financial write is not considered complete until its audit row exists. */
  audit: (result: T) => Promise<void>
  /** Optional and fire-and-forget. Omit entirely for writes with no event contract yet
   *  (e.g. installments/returns, out of WAFI-152's scope) rather than inventing a fake
   *  mapping onto an unrelated DomainEventType just to satisfy this wrapper's shape. */
  toEvent?: (result: T) => DomainEvent
}

/**
 * Every financial-write service method calls this instead of writing, auditing,
 * and publishing separately, so a write can never ship without exactly one audit
 * call (WAFI-007's invariant, unchanged) and, where a contract exists, exactly one
 * domain event (WAFI-152). `hooks` is object-shaped rather than positional so a
 * future hook (metrics, cache invalidation, notifications) is a new object field,
 * not another positional parameter shifting every call site.
 */
export async function executeBusinessOperation<T>(
  write: () => Promise<T>,
  hooks: BusinessOperationHooks<T>,
  requiredPermission?: keyof StaffPermissions,
): Promise<T> {
  if (requiredPermission) {
    const session = useSessionStore()
    if (!canUserDo(session.activeStaff, requiredPermission)) {
      throw new Error(`permission denied: ${requiredPermission} required`)
    }
  }
  const result = await write()
  await hooks.audit(result)
  if (hooks.toEvent) {
    // Fire-and-forget: publishing must never block the caller or turn a
    // publish/bus failure into a write failure. Nothing consumes these events
    // yet, and no future consumer should be able to make checkout depend on
    // event-bus availability.
    void publishEvent(hooks.toEvent(result)).catch(() => {})
  }
  return result
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run src/__tests__/composables/executeBusinessOperation.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 9: Update the 4 existing `executeFinancialWrite` call sites to the new wrapper**

For each of the 4 files below, this is a mechanical rename (`executeFinancialWrite` → `executeBusinessOperation`, import path updated) **and converting the positional `(write, audit, requiredPermission?)` call into `(write, { audit }, requiredPermission?)`** — no `toEvent` is added, since `hooks.toEvent` is optional and none of these 4 call sites has an event contract defined by this ticket:

```ts
// src/features/installments/composables/useInstallmentPlan.ts — createPlan(), around former line 135
// BEFORE: return executeFinancialWrite(write, (plan) => logInstallmentPlanCreated(...))
// AFTER:
import { executeBusinessOperation } from '@/composables/executeBusinessOperation'
// ...
return executeBusinessOperation(write, {
  audit: (plan) => logInstallmentPlanCreated(plan.id, plan.customerId, plan.totalAmountUsd),
})
```

Apply the same mechanical pattern (rename + wrap the existing audit callback in `{ audit: ... }`, no `toEvent`) to the remaining 3 call sites: `useInstallmentPlan.ts`'s `recordDuePayment` and `cancelPlan`, and `useReturnSheet.ts`'s `confirm()`. This is deliberately a smaller change than an earlier draft of this plan, which had these 4 sites emit a placeholder event by reusing an unrelated `DomainEventType` member (e.g. tagging an installment-plan creation as `installment.due_paid`) — that risks a mislabeled event leaking into production if a future subscriber ever wires up to it before installments/returns get their own ticket. Omitting `toEvent` entirely is the correct behavior: these operations publish nothing until a real ticket designs their event contract.

- [ ] **Step 10: Run the full test suite to confirm nothing broke**

Run: `npx vitest run`
Expected: PASS — all pre-existing tests for `useInstallmentPlan.test.ts`, `useReturnSheet` tests, `useStaffLedger.test.ts`, `useStaffSettlement.test.ts` still pass (they assert on `db.writeTransaction`/audit-call behavior, not on the wrapper's internals, so the signature change should not affect their assertions)

- [ ] **Step 11: Delete `executeFinancialWrite.ts`**

Run: `rm src/composables/executeFinancialWrite.ts` (Windows: delete the file directly) — confirm no remaining references first:

Run: `git grep -l executeFinancialWrite -- '*.ts'`
Expected: no output (empty) before deleting

- [ ] **Step 12: Commit**

```bash
git add src/services/events/domainEvent.types.ts src/services/events/publishEvent.ts \
        src/composables/executeBusinessOperation.ts src/__tests__/composables/executeBusinessOperation.test.ts \
        src/features/installments/composables/useInstallmentPlan.ts \
        src/features/returns/composables/useReturnSheet.ts
git rm src/composables/executeFinancialWrite.ts
git commit -m "feat(WAFI-152): add executeBusinessOperation wrapper and per-domain event registries"
```

---

### Task 1: ExpenseService

**Files:**
- Create: `src/services/expense.service.ts`
- Create: `src/services/__tests__/expense.service.test.ts`
- Modify: `src/features/expenses/composables/useExpenses.ts`
- Modify: `src/__tests__/features/useExpenses.test.ts`

**Interfaces:**
- Consumes: `executeBusinessOperation` (Task 0), `ExpenseEventType` (Task 0), `NewExpense`/`Expense` types (`src/features/expenses/expense.types.ts`, unchanged).
- Produces: `ExpenseService.recordExpense(shopId: string, staffId: string, input: NewExpense, audit: ExpenseAuditPort): Promise<Expense>`, where `ExpenseAuditPort = { logExpenseCreated: (id: string, category: string, amountUsd: number) => Promise<void> }` — a narrow interface defined in the service file itself, so the service has zero import of `useAuditLog` or any other Vue composable. The composable that calls this service constructs the real implementation via `useAuditLog()` and passes it in.

**Context:** Per the verified spec §4 correction, `useExpenses.ts` today does **not** use `db.writeTransaction` or `executeFinancialWrite` at all — every write is a bare `db.execute` followed by an inline audit call. `duplicateLastMonth` has no audit call at all (preserve this, don't add one). The recurring-expense insert loop in `save` has no transaction (preserve this too — do not wrap it in `db.writeTransaction` as a "fix", since that's a behavior change out of this ticket's scope). Per code review, `useAuditLog()` is a Vue composable and must never be imported inside `src/services/` — dependency-injecting the audit functions as a parameter is what makes "framework-agnostic" true in fact, not just true in a comment.

- [ ] **Step 1: Write the failing test for `recordExpense`**

```ts
// src/services/__tests__/expense.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { recordExpense } from '@/services/expense.service'
import type { NewExpense } from '@/features/expenses/expense.types'

describe('ExpenseService.recordExpense', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
  })

  const baseInput: NewExpense = {
    amount: 50,
    currency: 'USD',
    amountUsd: 50,
    category: 'صيانة',
    expenseDate: '2026-07-30',
    paidInCash: true,
  }
  const fakeAudit = { logExpenseCreated: vi.fn().mockResolvedValue(undefined) }

  it('inserts one expense row and returns the created Expense', async () => {
    const result = await recordExpense('shop1', 'staff1', baseInput, fakeAudit)
    expect(db.execute).toHaveBeenCalledTimes(1)
    const [, params] = vi.mocked(db.execute).mock.calls[0]
    expect(params).toContain('shop1')
    expect(params).toContain('صيانة')
    expect(result.category).toBe('صيانة')
    expect(result.amountUsd).toBe(50)
    expect(result.shopId).toBe('shop1')
  })

  it('calls the injected audit port with the created expense id/category/amount', async () => {
    const result = await recordExpense('shop1', 'staff1', baseInput, fakeAudit)
    expect(fakeAudit.logExpenseCreated).toHaveBeenCalledWith(result.id, 'صيانة', 50)
  })

  it('does not call db.writeTransaction (matches existing behavior — no transaction today)', async () => {
    await recordExpense('shop1', 'staff1', baseInput, fakeAudit)
    expect(db.writeTransaction).not.toHaveBeenCalled()
  })
})
```

Note the shift from `expect.stringContaining('INSERT INTO expenses')` to asserting on bound parameter values and call count — per code review, a SQL-text assertion breaks on pure formatting changes despite identical behavior; asserting the right values were bound is behaviorally equivalent and more resilient. One light structural check (`db.execute` called exactly once, no `writeTransaction`) still confirms the write shape without pinning the exact SQL string.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/expense.service.test.ts`
Expected: FAIL with "Cannot find module '@/services/expense.service'"

- [ ] **Step 3: Implement `ExpenseService.recordExpense`**

```ts
// src/services/expense.service.ts
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { executeBusinessOperation } from '@/composables/executeBusinessOperation'
import { ExpenseEventType } from '@/services/events/domainEvent.types'
import type { NewExpense, Expense } from '@/features/expenses/expense.types'

/** Narrow audit interface this service needs — implemented by the caller via
 *  useAuditLog(), never imported here. Keeps this file free of Vue imports in
 *  fact, not just by convention. */
export interface ExpenseAuditPort {
  logExpenseCreated: (id: string, category: string, amountUsd: number) => Promise<void>
}

export async function recordExpense(
  shopId: string,
  staffId: string,
  input: NewExpense,
  audit: ExpenseAuditPort,
): Promise<Expense> {
  const id = uuidv4()
  const now = new Date().toISOString()

  const write = async (): Promise<Expense> => {
    await db.execute(
      `INSERT INTO expenses
         (id, shop_id, amount, currency, amount_usd, category, expense_date,
          notes, photo_url, paid_in_cash, created_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        id, shopId, input.amount, input.currency, input.amountUsd,
        input.category, input.expenseDate, input.notes ?? null,
        input.photoUrl ?? null, input.paidInCash ? 1 : 0, now,
      ],
    )
    return {
      id, shopId, amount: input.amount, currency: input.currency,
      amountUsd: input.amountUsd, category: input.category,
      expenseDate: input.expenseDate, notes: input.notes, photoUrl: input.photoUrl,
      paidInCash: input.paidInCash, createdAt: now, syncStatus: 'pending',
    }
  }

  return executeBusinessOperation(write, {
    audit: (expense) => audit.logExpenseCreated(expense.id, expense.category, expense.amountUsd),
    toEvent: (expense) => ({
      type: ExpenseEventType.Recorded,
      entityId: expense.id,
      payload: { expenseId: expense.id, category: expense.category, amountUsd: expense.amountUsd, staffId, photoUrl: expense.photoUrl },
      staffId,
      shopId,
      occurredAt: now,
    }),
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/__tests__/expense.service.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Delegate `useExpenses.ts`'s `save` to `ExpenseService.recordExpense`**

Read `src/features/expenses/composables/useExpenses.ts` in full first (273 lines) to see the exact recurring-expense-expansion loop inside `save` (it calls the equivalent of `recordExpense` once per generated month when `isRecurringMonthly` is set — this loop itself is NOT extracted into the service; only the single-expense insert is). Replace the inline `db.execute` INSERT + audit call inside `save`'s loop body with a call to the new service:

```ts
// src/features/expenses/composables/useExpenses.ts — inside save(), replacing the per-iteration insert+audit block
import { recordExpense } from '@/services/expense.service'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'
// ...
const { logExpenseCreated } = useAuditLog()  // constructed here, in the Vue layer, and passed in
for (const occurrence of occurrences) {  // existing recurring-expansion loop, unchanged
  const created = await recordExpense(device.shopId, session.activeStaff?.id ?? '', occurrence, { logExpenseCreated })
  createdIds.push(created.id)
}
```

Leave `updateExpense`, `deleteExpense`, and `duplicateLastMonth` as direct `db.execute` calls in the composable for this task — the spec's AC only requires `recordExpense`/creation to be service-backed for this ticket's minimum bar; if time permits within this task, apply the identical extract-a-function pattern to `updateExpense`/`deleteExpense` as a stretch goal, but `save`'s creation path is the required deliverable.

- [ ] **Step 6: Run the composable's existing test suite**

Run: `npx vitest run src/__tests__/features/useExpenses.test.ts`
Expected: PASS — the existing `save` tests assert against `db.execute`'s SQL string and params (`expect.stringContaining('INSERT INTO expenses')`), which still holds true since `ExpenseService.recordExpense` issues the identical SQL. If any assertion targets `useAuditLog` call args directly rather than through `db.execute`, verify it still passes; adjust only if genuinely broken by the refactor, not preemptively.

- [ ] **Step 7: Commit**

```bash
git add src/services/expense.service.ts src/services/__tests__/expense.service.test.ts \
        src/features/expenses/composables/useExpenses.ts
git commit -m "refactor(WAFI-152): extract ExpenseService.recordExpense from useExpenses"
```

---

### Task 2: InventoryService

**Files:**
- Create: `src/services/inventory.service.ts`
- Create: `src/services/__tests__/inventory.service.test.ts`
- Modify: `src/features/suppliers/composables/useReceivingSheet.ts`
- Modify: `src/features/products/composables/useProducts.ts`
- Modify: `src/__tests__/features/useReceivingSheet.test.ts`
- Modify: `src/__tests__/features/useProducts.test.ts`

**Interfaces:**
- Consumes: `executeBusinessOperation`, `InventoryEventType` (Task 0); `ReceivingLine`, `Receiving` types (`src/features/suppliers/receiving.types.ts`); `AdjustmentReason`, `StockAdjustment` types (`src/features/products/product.types.ts`).
- Produces:
  - `receiveStock(shopId: string, staffId: string, input: ReceiveStockInput, audit: ReceiveStockAuditPort): Promise<Receiving>`
  - `adjustInventory(shopId: string, deviceId: string, input: AdjustInventoryInput, audit: InventoryAdjustAuditPort): Promise<StockAdjustment>` where `AdjustInventoryInput = { productId: string; reason: AdjustmentReason; notes?: string } & ({ mode: 'absolute'; newValue: number } | { mode: 'delta'; delta: number })`

**Context:** Two independent extraction sources per the verified spec §4 correction — `receiveStock` from `useReceivingSheet.ts`'s `confirm()` (including its own inline stock-increment block, kept separate from `adjustInventory`'s logic), and `adjustInventory` from `useProducts.ts`'s `adjustStock`/`adjustStockBy` (the discriminated `mode` union lets one service method replace both). Both must preserve the never-below-zero clamp (`Math.max(0, ...)`) exactly.

- [ ] **Step 1: Write the failing test for `receiveStock`**

```ts
// src/services/__tests__/inventory.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { receiveStock } from '@/services/inventory.service'
import type { ReceiveStockInput } from '@/services/inventory.service'

describe('InventoryService.receiveStock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [{ rate: 1 }] } } as any)
    vi.mocked(db.getOptional).mockResolvedValue(null)
  })

  const input: ReceiveStockInput = {
    supplierId: 'sup1',
    supplierName: 'مورد الكتروني',
    lines: [{
      productId: 'p1', productName: 'Samsung A55', currentCostUsd: 200,
      qtyReceived: 5, unitCostUsd: 210, updateCost: true,
    }],
    invoicePhotoUrl: null,
    notes: '',
  }
  const fakeAudit = { logReceivingCreated: vi.fn().mockResolvedValue(undefined) }

  it('runs one writeTransaction inserting the header and one line item', async () => {
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [{ current_stock: 10 }] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => fn({ execute: txExecute }))

    const result = await receiveStock('shop1', 'staff1', input, fakeAudit)

    expect(txExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO stock_receivings'),
      expect.any(Array),
    )
    expect(txExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO stock_receiving_line_items'),
      expect.any(Array),
    )
    expect(result.totalCostUsd).toBe(5 * 210)
  })

  it('increments product current_stock by qtyReceived within the same transaction', async () => {
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [{ current_stock: 10 }] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => fn({ execute: txExecute }))

    await receiveStock('shop1', 'staff1', input, fakeAudit)

    expect(txExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE products SET current_stock'),
      expect.arrayContaining([15]),  // 10 + 5
    )
  })

  it('skips cost_price_usd update when updateCost is false or unitCostUsd is 0 (WAFI-021 guard)', async () => {
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [{ current_stock: 10 }] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => fn({ execute: txExecute }))

    await receiveStock('shop1', 'staff1', {
      ...input,
      lines: [{ ...input.lines[0], updateCost: false }],
    }, fakeAudit)

    const costUpdateCall = txExecute.mock.calls.find((c: any[]) =>
      String(c[0]).includes('cost_price_usd'))
    expect(costUpdateCall).toBeUndefined()
  })

  it('calls the injected audit port with the created receiving id/supplier/total/lines', async () => {
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [{ current_stock: 10 }] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => fn({ execute: txExecute }))

    const result = await receiveStock('shop1', 'staff1', input, fakeAudit)

    expect(fakeAudit.logReceivingCreated).toHaveBeenCalledWith(
      result.id, 'مورد الكتروني', result.totalCostUsd, 1, expect.any(Array),
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/inventory.service.test.ts`
Expected: FAIL with "Cannot find module '@/services/inventory.service'"

- [ ] **Step 3: Implement `receiveStock`**

Read `src/features/suppliers/composables/useReceivingSheet.ts` in full first (already reproduced verbatim during spec research — reuse that exact transaction body). Implement:

```ts
// src/services/inventory.service.ts
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { executeBusinessOperation } from '@/composables/executeBusinessOperation'
import { InventoryEventType } from '@/services/events/domainEvent.types'
import type { ReceivingLine, Receiving } from '@/features/suppliers/receiving.types'

export interface ReceiveStockInput {
  supplierId: string
  supplierName: string
  lines: ReceivingLine[]
  invoicePhotoUrl: string | null
  notes: string
}

/** Structurally identical to useAuditLog.ts's private (unexported) ReceivingAuditLineItem
 *  — duplicated here rather than exported from useAuditLog, so this file still imports
 *  nothing from @/features/audit (which itself imports Vue/Pinia composables elsewhere
 *  in that module). If useAuditLog.ts's shape ever changes, update both. */
export interface ReceivingAuditLineItem {
  productId: string
  productName: string
  qtyReceived: number
  unitCostUsd: number
  lineTotalUsd: number
  costUpdated: boolean
}

/** Narrow audit interface this service needs — implemented by the caller via
 *  useAuditLog(), never imported here. Keeps this file free of Vue imports in
 *  fact, not just by convention (matches ExpenseAuditPort's pattern, Task 1). */
export interface ReceiveStockAuditPort {
  logReceivingCreated: (
    receivingId: string, supplierName: string, totalUsd: number, lineCount: number,
    lineItems?: ReceivingAuditLineItem[],
  ) => Promise<void>
}

export async function receiveStock(
  shopId: string,
  staffId: string | null,
  input: ReceiveStockInput,
  audit: ReceiveStockAuditPort,
): Promise<Receiving> {
  if (!input.supplierId || input.lines.length === 0 || input.lines.some(l => l.qtyReceived <= 0)) {
    throw new Error('receiveStock() called without valid input')
  }

  const rateResult = await db.execute(
    `SELECT rate FROM exchange_rates WHERE shop_id = ? ORDER BY set_at DESC LIMIT 1`,
    [shopId],
  )
  const exchangeRate: number = (rateResult as any).rows._array[0]?.rate ?? 1

  const receivingId = uuidv4()
  const now = new Date().toISOString()
  const total = input.lines.reduce(
    (sum, line) => sum + (Number(line.qtyReceived) || 0) * (Number(line.unitCostUsd) || 0),
    0,
  )

  const write = async (): Promise<Receiving> => {
    await db.writeTransaction(async (tx) => {
      await tx.execute(
        `INSERT INTO stock_receivings
           (id, shop_id, supplier_id, received_at, invoice_photo_url, total_cost_usd,
            exchange_rate_at_receiving, notes, staff_id, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [receivingId, shopId, input.supplierId, now, input.invoicePhotoUrl,
         total, exchangeRate, input.notes || null, staffId],
      )

      for (const line of input.lines) {
        await tx.execute(
          `INSERT INTO stock_receiving_line_items
             (id, receiving_id, shop_id, product_id, qty_received, unit_cost_usd, cost_updated, sync_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
          [uuidv4(), receivingId, shopId, line.productId, line.qtyReceived,
           line.unitCostUsd, line.updateCost ? 1 : 0],
        )

        const stockResult = await tx.execute(
          `SELECT current_stock FROM products WHERE id = ?`, [line.productId],
        )
        const oldStock: number = (stockResult as any).rows._array[0]?.current_stock ?? 0
        const newStock = oldStock + line.qtyReceived
        await tx.execute(
          `UPDATE products SET current_stock = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
          [newStock, now, line.productId],
        )

        if (line.updateCost && line.unitCostUsd > 0) {
          await tx.execute(
            `UPDATE products SET cost_price_usd = ?, cost_updated_at = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
            [line.unitCostUsd, now, now, line.productId],
          )
        }
      }
    })

    return {
      id: receivingId, shopId, supplierId: input.supplierId, supplierName: input.supplierName,
      receivedAt: now, invoicePhotoUrl: input.invoicePhotoUrl ?? undefined,
      totalCostUsd: total, exchangeRateAtReceiving: exchangeRate,
      notes: input.notes || undefined, staffId: staffId ?? undefined,
    }
  }

  return executeBusinessOperation(write, {
    audit: async (receiving) => {
      const auditSupplierName = input.supplierName.trim() ||
        (await db.getOptional<{ name: string }>(
          `SELECT name FROM suppliers WHERE id = ? LIMIT 1`, [input.supplierId],
        ))?.name || 'مورد غير معروف'
      await audit.logReceivingCreated(
        receiving.id, auditSupplierName, receiving.totalCostUsd, input.lines.length,
        input.lines.map((line) => ({
          productId: line.productId, productName: line.productName,
          qtyReceived: Number(line.qtyReceived) || 0, unitCostUsd: Number(line.unitCostUsd) || 0,
          lineTotalUsd: (Number(line.qtyReceived) || 0) * (Number(line.unitCostUsd) || 0),
          costUpdated: line.updateCost,
        })),
      )
    },
    toEvent: (receiving) => ({
      type: InventoryEventType.StockReceived,
      entityId: receiving.id,
      payload: { receivingId: receiving.id, supplierId: input.supplierId, skuCount: input.lines.length, totalCost: receiving.totalCostUsd },
      staffId: staffId ?? '',
      shopId,
      occurredAt: now,
    }),
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/__tests__/inventory.service.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the failing test for `adjustInventory`**

```ts
// append to src/services/__tests__/inventory.service.test.ts
import { adjustInventory } from '@/services/inventory.service'

describe('InventoryService.adjustInventory', () => {
  const fakeAdjustAudit = { logStockAdjusted: vi.fn().mockResolvedValue(undefined) }

  it('mode: absolute — clamps to 0 and never goes negative', async () => {
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [{ current_stock: 5 }] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => fn({ execute: txExecute }))

    const result = await adjustInventory('shop1', 'device1', {
      mode: 'absolute', productId: 'p1', newValue: -3, reason: 'other',
    }, fakeAdjustAudit)

    expect(result.newValue).toBe(0)
    expect(txExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE products SET current_stock'),
      expect.arrayContaining([0]),
    )
  })

  it('mode: delta — adds delta to current stock, read-modify-write inside one transaction (WAFI-121)', async () => {
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [{ current_stock: 10 }] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => fn({ execute: txExecute }))

    const result = await adjustInventory('shop1', 'device1', {
      mode: 'delta', productId: 'p1', delta: -4, reason: 'stocktake',
    }, fakeAdjustAudit)

    expect(result.oldValue).toBe(10)
    expect(result.newValue).toBe(6)
  })

  it('mode: delta — no-op when delta is 0 (matches existing adjustStockBy early-return)', async () => {
    const result = await adjustInventory('shop1', 'device1', {
      mode: 'delta', productId: 'p1', delta: 0, reason: 'stocktake',
    }, fakeAdjustAudit)
    expect(db.writeTransaction).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })

  it('calls the injected audit port with product name/old/new value', async () => {
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [{ current_stock: 10 }] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => fn({ execute: txExecute }))
    vi.mocked(db.getOptional).mockResolvedValueOnce({ name_ar: 'Samsung A55' } as any)

    await adjustInventory('shop1', 'device1', {
      mode: 'delta', productId: 'p1', delta: -4, reason: 'stocktake',
    }, fakeAdjustAudit)

    expect(fakeAdjustAudit.logStockAdjusted).toHaveBeenCalledWith('p1', 'Samsung A55', 10, 6)
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/inventory.service.test.ts`
Expected: FAIL with "adjustInventory is not exported"

- [ ] **Step 7: Implement `adjustInventory`**

```ts
// append to src/services/inventory.service.ts
import type { AdjustmentReason, StockAdjustment } from '@/features/products/product.types'

export type AdjustInventoryInput =
  { productId: string; reason: AdjustmentReason; notes?: string } &
  ({ mode: 'absolute'; newValue: number } | { mode: 'delta'; delta: number })

/** Narrow audit interface this service needs — implemented by the caller via
 *  useAuditLog(), never imported here. */
export interface InventoryAdjustAuditPort {
  logStockAdjusted: (productId: string, name: string, oldQty: number, newQty: number) => Promise<void>
}

export async function adjustInventory(
  shopId: string,
  deviceId: string,
  input: AdjustInventoryInput,
  audit: InventoryAdjustAuditPort,
): Promise<StockAdjustment | null> {
  if (input.mode === 'delta' && input.delta === 0) return null

  const now = new Date().toISOString()
  let oldValue = 0
  let clampedValue = 0

  const write = async (): Promise<StockAdjustment> => {
    await db.writeTransaction(async (tx) => {
      const stockResult = await tx.execute(
        'SELECT current_stock FROM products WHERE id = ?', [input.productId],
      )
      oldValue = (stockResult as any).rows._array[0]?.current_stock ?? 0
      clampedValue = input.mode === 'absolute'
        ? Math.max(0, input.newValue)
        : Math.max(0, oldValue + input.delta)

      await tx.execute(
        `UPDATE products SET current_stock = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
        [clampedValue, now, input.productId],
      )
      const id = uuidv4()
      await tx.execute(
        `INSERT INTO stock_adjustments (id, shop_id, product_id, old_value, new_value, reason, notes, created_at, device_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, shopId, input.productId, oldValue, clampedValue, input.reason, input.notes ?? null, now, deviceId],
      )
      return { id, productId: input.productId, oldValue, newValue: clampedValue, reason: input.reason, notes: input.notes, createdAt: now, deviceId }
    })
    return { id: uuidv4(), productId: input.productId, oldValue, newValue: clampedValue, reason: input.reason, notes: input.notes, createdAt: now, deviceId }
  }

  return executeBusinessOperation(write, {
    audit: async (adjustment) => {
      const nameRow = await db.getOptional<{ name_ar: string }>(
        `SELECT name_ar FROM products WHERE id = ?`, [input.productId],
      )
      await audit.logStockAdjusted(input.productId, nameRow?.name_ar ?? input.productId, adjustment.oldValue, adjustment.newValue)
    },
    toEvent: (adjustment) => ({
      type: InventoryEventType.Adjusted,
      entityId: input.productId,
      payload: { productId: input.productId, deltaQty: adjustment.newValue - adjustment.oldValue, reason: input.reason },
      staffId: '',
      shopId,
      occurredAt: now,
    }),
  })
}
```

- [ ] **Step 7a: Confirm the `deviceId` parameter is real, not a placeholder**

Unlike an earlier draft of this plan (which reused `shopId` as a `deviceId` placeholder), the signature above already takes `deviceId` as an explicit parameter — per spec §6a, the service cannot call `useDeviceStore()` itself, since `useProducts.ts`'s original code read `useDeviceStore().deviceId` (a Pinia call). The composable, which already calls `useDeviceStore()` for other purposes, passes it in (see Step 10). Confirm the test file's calls all pass `'device1'` explicitly as the second argument (Step 5/6 above already do), and re-run Step 6's tests to confirm they pass with this signature.

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run src/services/__tests__/inventory.service.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 9: Delegate `useReceivingSheet.ts`'s `confirm()` to `receiveStock`**

```ts
// src/features/suppliers/composables/useReceivingSheet.ts — replace confirm()'s body
import { receiveStock } from '@/services/inventory.service'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'
// ...
async function confirm(): Promise<void> {
  if (!supplierId.value || lines.value.length === 0 || lines.value.some(l => l.qtyReceived <= 0)) {
    throw new Error('confirm() called without valid state')
  }
  const { shopId } = useDeviceStore()
  const session = useSessionStore()
  const { logReceivingCreated } = useAuditLog()
  await receiveStock(shopId, session.activeStaff?.id ?? null, {
    supplierId: supplierId.value,
    supplierName: supplierName.value,
    lines: [...lines.value],
    invoicePhotoUrl: invoicePhotoUrl.value,
    notes: notes.value,
  }, { logReceivingCreated })
}
```

- [ ] **Step 10: Delegate `useProducts.ts`'s `adjustStock`/`adjustStockBy` to `adjustInventory`**

```ts
// src/features/products/composables/useProducts.ts — replace both function bodies
import { adjustInventory } from '@/services/inventory.service'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'
// ...
async function adjustStock(productId: string, newValue: number, reason: AdjustmentReason, notes?: string) {
  const device = useDeviceStore()
  const { logStockAdjusted } = useAuditLog()
  await adjustInventory(device.shopId, device.deviceId, { mode: 'absolute', productId, newValue, reason, notes }, { logStockAdjusted })
  await load()
}

async function adjustStockBy(productId: string, delta: number, reason: AdjustmentReason, notes?: string) {
  if (delta === 0) return
  const device = useDeviceStore()
  const { logStockAdjusted } = useAuditLog()
  await adjustInventory(device.shopId, device.deviceId, { mode: 'delta', productId, delta, reason, notes }, { logStockAdjusted })
  await load()
}
```

- [ ] **Step 11: Run existing composable test suites**

Run: `npx vitest run src/__tests__/features/useReceivingSheet.test.ts src/__tests__/features/useProducts.test.ts src/__tests__/features/useStockTake.test.ts`
Expected: PASS — `useStockTake.test.ts` is included because `useStockTake.ts` calls `useProducts().adjustStockBy(...)` internally; confirm this indirect path still works.

- [ ] **Step 12: Commit**

```bash
git add src/services/inventory.service.ts src/services/__tests__/inventory.service.test.ts \
        src/features/suppliers/composables/useReceivingSheet.ts \
        src/features/products/composables/useProducts.ts
git commit -m "refactor(WAFI-152): extract InventoryService.receiveStock and .adjustInventory"
```

---

### Task 3: CustomerService

**Files:**
- Create: `src/services/customer.service.ts`
- Create: `src/services/__tests__/customer.service.test.ts`
- Modify: `src/features/customers/composables/useCustomerBalance.ts`
- Modify: `src/__tests__/features/useCustomerBalance.test.ts`

**Interfaces:**
- Consumes: `executeBusinessOperation`, `CustomerEventType` (Task 0); `PaymentAllocation` type (`src/features/customers/customer.types.ts`, unchanged); `fetchOutstandingBalanceUsd` (existing exported function in `useCustomerBalance.ts` — reused, not duplicated).
- Produces: `CustomerBalance` (new type: `{ balanceUsd: number; pendingSyncCount: number }`), `recordPayment(shopId: string, customerId: string, allocations: PaymentAllocation[], audit: RecordPaymentAuditPort, shiftId?: string | null, deviceId?: string | null): Promise<CustomerBalance>`.

**Context:** Per spec §4 correction #21, only `useCustomerBalance.ts`'s ad-hoc `recordPayment` is in scope — `useInstallmentPlan.ts`'s separate `recordDuePayment` stays untouched. `useCustomerBalance.ts` today does NOT use `executeFinancialWrite`/`executeBusinessOperation` — it manually sequences `writeTransaction` → audit → `load()`. This extraction is also where it's brought onto the standard wrapper for consistency with every other write path in the codebase (the research findings flagged this as the dominant pattern elsewhere).

- [ ] **Step 1: Write the failing test for the overpayment guards**

```ts
// src/services/__tests__/customer.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { recordPayment } from '@/services/customer.service'

describe('CustomerService.recordPayment', () => {
  const fakeAudit = { logCustomerPaymentRecorded: vi.fn().mockResolvedValue(undefined) }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects allocations that cumulatively exceed one invoice remaining within a batch', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ remaining_usd: 100 } as any)
    await expect(recordPayment('shop1', 'c1', [
      { saleId: 's1', amountUsd: 60, currency: 'USD', amountRaw: 60, method: 'cash' },
      { saleId: 's1', amountUsd: 60, currency: 'USD', amountRaw: 60, method: 'cash' },
    ], fakeAudit)).rejects.toThrow('المبلغ المدخل يتجاوز المبلغ المتبقي للفاتورة')
  })

  it('rejects a batch exceeding customer outstanding balance when per-sale remaining is unavailable offline', async () => {
    vi.mocked(db.getOptional).mockImplementation(async (sql: string) => {
      if (sql.includes('AS balance_usd')) return { balance_usd: 50 } as any
      return null
    })
    await expect(recordPayment('shop1', 'c1', [
      { saleId: 's1', amountUsd: 100, currency: 'USD', amountRaw: 100, method: 'cash' },
    ], fakeAudit)).rejects.toThrow('المبلغ المدخل يتجاوز رصيد العميل المستحق')
  })

  it('inserts one customer_payments row per allocation inside one writeTransaction', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ remaining_usd: 1000 } as any)
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => fn({ execute: txExecute }))

    await recordPayment('shop1', 'c1', [
      { saleId: 's1', amountUsd: 100, currency: 'USD', amountRaw: 100, method: 'cash' },
      { saleId: 's2', amountUsd: 80, currency: 'USD', amountRaw: 80, method: 'cash' },
    ], fakeAudit)
    expect(txExecute).toHaveBeenCalledTimes(2)
  })

  it('calls the injected audit port with the customer id and total paid', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ remaining_usd: 1000 } as any)
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => fn({ execute: txExecute }))

    await recordPayment('shop1', 'c1', [
      { saleId: 's1', amountUsd: 100, currency: 'USD', amountRaw: 100, method: 'cash' },
    ], fakeAudit)
    expect(fakeAudit.logCustomerPaymentRecorded).toHaveBeenCalledWith('c1', 100)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/customer.service.test.ts`
Expected: FAIL with "Cannot find module '@/services/customer.service'"

- [ ] **Step 3: Implement `CustomerService.recordPayment`**

Read `src/features/customers/composables/useCustomerBalance.ts` in full first (already reproduced verbatim during spec research). Move `recordPayment`'s body into the service, keeping `fetchOutstandingBalanceUsd` imported (not duplicated) from the composable file:

```ts
// src/services/customer.service.ts
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { executeBusinessOperation } from '@/composables/executeBusinessOperation'
import { CustomerEventType } from '@/services/events/domainEvent.types'
import { fetchOutstandingBalanceUsd } from '@/features/customers/composables/useCustomerBalance'
import type { PaymentAllocation } from '@/features/customers/customer.types'

export interface CustomerBalance {
  balanceUsd: number
  pendingSyncCount: number
}

/** Narrow audit interface this service needs — implemented by the caller via
 *  useAuditLog(), never imported here. */
export interface RecordPaymentAuditPort {
  logCustomerPaymentRecorded: (customerId: string, amountUsd: number) => Promise<void>
}

export async function recordPayment(
  shopId: string,
  customerId: string,
  allocations: PaymentAllocation[],
  audit: RecordPaymentAuditPort,
  shiftId: string | null = null,
  deviceId: string | null = null,
): Promise<CustomerBalance> {
  const now = new Date().toISOString()
  const committedBySale = new Map<string, number>()
  let batchTotalUsd = 0
  let perSaleUnavailable = false

  for (const alloc of allocations) {
    batchTotalUsd += alloc.amountUsd
    const remRow = await db.getOptional<{ remaining_usd: number }>(
      `SELECT s.total_usd
         - COALESCE(SUM(cp.amount_usd), 0)
         - COALESCE((SELECT SUM(r.refund_amount_usd) FROM returns r WHERE r.original_sale_id = s.id), 0)
         AS remaining_usd
       FROM sales s
       LEFT JOIN customer_payments cp ON cp.sale_id = s.id
       WHERE s.id = ?
       GROUP BY s.id`,
      [alloc.saleId],
    )
    if (remRow === null) { perSaleUnavailable = true; continue }
    if (remRow.remaining_usd === undefined) continue
    const already = committedBySale.get(alloc.saleId) ?? 0
    if (already + alloc.amountUsd > remRow.remaining_usd + 0.001) {
      throw new Error(`المبلغ المدخل يتجاوز المبلغ المتبقي للفاتورة`)
    }
    committedBySale.set(alloc.saleId, already + alloc.amountUsd)
  }

  if (perSaleUnavailable) {
    const outstanding = await fetchOutstandingBalanceUsd(customerId, shopId)
    if (batchTotalUsd > outstanding + 0.001) {
      throw new Error(`المبلغ المدخل يتجاوز رصيد العميل المستحق`)
    }
  }

  const write = async () => {
    await db.writeTransaction(async (tx) => {
      for (const alloc of allocations) {
        await tx.execute(
          `INSERT INTO customer_payments
             (id, shop_id, customer_id, sale_id, amount_usd, currency, amount_raw, method,
              exchange_rate_at_payment, notes, paid_at, created_at, shift_id, device_id, sync_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, null, ?, ?, ?, ?, 'pending')`,
          [uuidv4(), shopId, customerId, alloc.saleId, alloc.amountUsd, alloc.currency,
           alloc.amountRaw, alloc.method, alloc.exchangeRateAtPayment ?? null,
           now.slice(0, 10), now, shiftId, deviceId],
        )
      }
    })
    return { totalPaid: batchTotalUsd }
  }

  const result = await executeBusinessOperation(write, {
    audit: async ({ totalPaid }) => {
      await audit.logCustomerPaymentRecorded(customerId, totalPaid)
    },
    toEvent: () => ({
      type: CustomerEventType.InstallmentDuePaid,
      entityId: customerId,
      payload: { customerId, amount: batchTotalUsd, remainingBalance: 0 },  // remainingBalance filled below
      staffId: '',
      shopId,
      occurredAt: now,
    }),
  })

  const balanceUsd = await fetchOutstandingBalanceUsd(customerId, shopId)
  return { balanceUsd, pendingSyncCount: 0 }
}
```

Note: the event payload's `remainingBalance: 0` is a placeholder that doesn't reflect the real post-payment balance — fix in Step 3a.

- [ ] **Step 3a: Refactor — fix `remainingBalance` in the event payload**

Fetch the balance once, use it for both the event payload and the return value, so the two can't drift:

```ts
// src/services/customer.service.ts — replace the tail of recordPayment
  await executeBusinessOperation(write, {
    audit: async ({ totalPaid }) => {
      await audit.logCustomerPaymentRecorded(customerId, totalPaid)
    },
    toEvent: () => ({
      type: CustomerEventType.InstallmentDuePaid,
      entityId: customerId,
      payload: { customerId, amount: batchTotalUsd, remainingBalance: 0 },
      staffId: '',
      shopId,
      occurredAt: now,
    }),
  })

  const balanceUsd = await fetchOutstandingBalanceUsd(customerId, shopId)
  return { balanceUsd, pendingSyncCount: 0 }
```

Since the event is published inside `executeBusinessOperation` before the post-write balance fetch runs, `remainingBalance` cannot be computed synchronously from within `toEvent`'s callback without restructuring. Accept this as a known limitation for this ticket (the event payload's `remainingBalance` field is set to `NaN`-safe `0` with a one-line code comment `// TODO(WAFI-140): remainingBalance is not the true post-payment balance — computing it requires a second query after publish, deferred until the event actually has a subscriber`) rather than adding complexity to work around a stub event nobody consumes yet. This is a legitimate simplification: don't over-engineer a payload accuracy no subscriber currently reads.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/__tests__/customer.service.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Delegate `useCustomerBalance.ts`'s `recordPayment` to the service**

```ts
// src/features/customers/composables/useCustomerBalance.ts — replace recordPayment's body
import { recordPayment as recordPaymentService } from '@/services/customer.service'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'
// ...
async function recordPayment(allocations: PaymentAllocation[]): Promise<void> {
  const device = useDeviceStore()
  const shiftStore = useShiftStore()
  const { logCustomerPaymentRecorded } = useAuditLog()
  await recordPaymentService(
    device.shopId, customerId, allocations,
    { logCustomerPaymentRecorded }, shiftStore.activeShiftId, device.deviceId,
  )
  await load()
}
```

- [ ] **Step 6: Run existing composable test suite**

Run: `npx vitest run src/__tests__/features/useCustomerBalance.test.ts`
Expected: PASS — the two `recordPayment`-specific tests (`'inserts one customer_payment row per allocation in a transaction'`, `'recordPayment persists the payment method'`) assert on `db.writeTransaction`'s inner `tx.execute` calls, which the service now performs identically.

- [ ] **Step 7: Commit**

```bash
git add src/services/customer.service.ts src/services/__tests__/customer.service.test.ts \
        src/features/customers/composables/useCustomerBalance.ts
git commit -m "refactor(WAFI-152): extract CustomerService.recordPayment from useCustomerBalance"
```

---

### Task 4: SalesService

**Files:**
- Create: `src/services/sales.service.ts`
- Create: `src/services/__tests__/sales.service.test.ts`
- Modify: `src/features/payment/usePayment.ts`
- Modify: `src/features/payment/useFastCash.ts` (no logic change expected — verify only)
- Modify: `src/__tests__/features/usePayment.test.ts`

**Interfaces:**
- Consumes: `executeBusinessOperation`, `SalesEventType` (Task 0); `PaymentMethod`, `SplitPaymentEntry`, `CompletedSale`, `SaleLine` types (`src/features/payment/payment.types.ts`, unchanged).
- Produces: `CompleteSaleInput` (new type — see Step 3), `completeSale(input: CompleteSaleInput, audit: CompleteSaleAuditPort): Promise<CompletedSale>`.

**Context:** This is the largest and most order-sensitive extraction. Per the research findings, `saleStore.incrementSequence()` is called INSIDE the write callback, AFTER `db.writeTransaction` resolves successfully — this exact ordering (WAFI-004: failed write must not burn the sequence number) must be preserved byte-for-byte. `usePayment.confirm()` reads `method`, `amountReceived`, `pendingPayments` off its own composable refs rather than taking a single input object — `CompleteSaleInput` is a new type that bundles what `confirm()` currently reads from those refs plus `customerId`.

- [ ] **Step 1: Read `usePayment.ts` and its test file in full**

Read `src/features/payment/usePayment.ts` (397 lines) and `src/__tests__/features/usePayment.test.ts` (641 lines) completely before writing any code — the confirm() logic (lines 181–386 per prior research) has WAFI-003 idempotency guards, WAFI-004 sequence-non-advance-on-failure, WAFI-008 source tagging, WAFI-064 operator/shift attribution, and WAFI-100 discount audit trail all interleaved. Do not attempt this extraction from memory of the summary above — the exact line-by-line logic must be preserved.

- [ ] **Step 2: Write the failing test for the sequence-non-advance invariant (WAFI-004)**

```ts
// src/services/__tests__/sales.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { completeSale } from '@/services/sales.service'
import { useSaleStore } from '@/store/sale.store'
import type { CompleteSaleInput } from '@/services/sales.service'

describe('SalesService.completeSale', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  const baseInput: CompleteSaleInput = {
    shopId: 'shop1', staffId: 'staff1', shiftId: 'shift1', deviceId: 'device1',
    method: 'cash_usd', amountReceived: 100,
    lines: [{ nameAr: 'Samsung A55', quantity: 1, unitPriceUsd: 100, lineTotalUsd: 100 }],
    exchangeRateAtSale: 1,
  }
  const fakeAudit = {
    logSaleCompleted: vi.fn().mockResolvedValue(undefined),
    logDiscountApplied: vi.fn().mockResolvedValue(undefined),
  }

  it('does NOT increment the sale sequence when db.writeTransaction throws (WAFI-004)', async () => {
    const saleStore = useSaleStore()
    const incrementSpy = vi.spyOn(saleStore, 'incrementSequence')
    vi.mocked(db.writeTransaction).mockRejectedValueOnce(new Error('write failed'))

    await expect(completeSale(baseInput, fakeAudit)).rejects.toThrow('write failed')
    expect(incrementSpy).not.toHaveBeenCalled()
  })

  it('increments the sale sequence only after writeTransaction resolves', async () => {
    const saleStore = useSaleStore()
    const incrementSpy = vi.spyOn(saleStore, 'incrementSequence')
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => fn({ execute: txExecute }))

    await completeSale(baseInput, fakeAudit)
    expect(incrementSpy).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/sales.service.test.ts`
Expected: FAIL with "Cannot find module '@/services/sales.service'"

- [ ] **Step 4: Implement `SalesService.completeSale`**

Extract `confirm()`'s body from `usePayment.ts` (lines 181–386 of the pre-extraction file) verbatim into `src/services/sales.service.ts`, converting composable refs to a `CompleteSaleInput` parameter object:

```ts
// src/services/sales.service.ts
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { executeBusinessOperation } from '@/composables/executeBusinessOperation'
import { SalesEventType } from '@/services/events/domainEvent.types'
import { useSaleStore } from '@/store/sale.store'
import type { PaymentMethod, SplitPaymentEntry, CompletedSale, SaleLine } from '@/features/payment/payment.types'
import type { DiscountType } from '@/features/pos/discounts'

export interface CompleteSaleInput {
  shopId: string
  staffId: string
  shiftId: string | null
  deviceId: string
  method: PaymentMethod
  amountReceived?: number
  pendingPayments?: SplitPaymentEntry[]
  customerId?: string
  lines: SaleLine[]
  exchangeRateAtSale: number
}

/** Narrow audit interface this service needs — implemented by the caller via
 *  useAuditLog(), never imported here. */
export interface CompleteSaleAuditPort {
  logSaleCompleted: (saleId: string, totalUsd: number, itemCount: number) => Promise<void>
  logDiscountApplied: (
    saleId: string,
    meta: {
      operatorId: string | null; tierApplied: 'retail'; basePriceUsd: number
      discountType: DiscountType; discountValue: number; finalPriceUsd: number
      pinApproval: boolean; belowCost: boolean
    },
  ) => Promise<void>
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export async function completeSale(
  input: CompleteSaleInput,
  audit: CompleteSaleAuditPort,
): Promise<CompletedSale> {
  // NOTE TO IMPLEMENTER: paste the exact body of usePayment.ts's confirm() here
  // (lines 181-386 of the pre-extraction file), replacing every read of a
  // composable ref (method.value, amountReceived.value, pendingPayments.value,
  // etc.) with the corresponding `input.*` field, and replacing every
  // `session.activeStaff?.id` / `device.shopId` / `shiftStore.activeShiftId`
  // read with `input.staffId` / `input.shopId` / `input.shiftId` respectively.
  // Do NOT change the isCredit/entries/isSplit/primaryMethod/totalReceived/
  // lastChange computation logic, the db.writeTransaction structure (sales
  // insert, sale_payments loop, sale_line_items loop with isOpenItem
  // early-continue, stock_adjustments insert), or the placement of
  // saleStore.incrementSequence() (must stay INSIDE the write callback,
  // AFTER db.writeTransaction resolves) — these are the exact invariants
  // Step 2's tests assert on.
  throw new Error('not yet implemented — see note above')
}
```

This task's Step 4 deliverable is explicitly a **paste-and-adapt** operation, not a from-scratch rewrite — the source is real, tested, 200 lines of order-sensitive logic already fully covered by `usePayment.test.ts`'s 641 lines. Writing it a second time from a summary risks silently changing behavior (e.g. the exact rounding, the exact order stock is deducted vs. sale rows inserted). The implementer must open the real file and move the real code.

- [ ] **Step 4a: Wire the write into `executeBusinessOperation`**

Once Step 4's transaction body compiles, wrap it. Note `logDiscountApplied`'s real signature (`src/features/audit/composables/useAuditLog.ts`) takes a single `meta` object (`operatorId`, `tierApplied`, `basePriceUsd`, `discountType`, `discountValue`, `finalPriceUsd`, `pinApproval`, `belowCost`), not positional args — the implementer must pull these fields from whatever the pasted `confirm()` body already computes per line (WAFI-100's existing discount-audit call site in `usePayment.ts` has the exact shape to copy):

```ts
// src/services/sales.service.ts — the write/audit/event wiring around the pasted body
export async function completeSale(
  input: CompleteSaleInput,
  audit: CompleteSaleAuditPort,
): Promise<CompletedSale> {
  const saleId = uuidv4()
  const now = new Date().toISOString()
  // ... (pasted entries/isSplit/primaryMethod computation from confirm(), using `input.*`)

  const write = async (): Promise<CompletedSale> => {
    await db.writeTransaction(async (tx) => {
      // ... (pasted sales/sale_payments/sale_line_items inserts, using tx.execute)
    })
    useSaleStore().incrementSequence()  // must run here, after writeTransaction resolves — WAFI-004
    return sale  // the CompletedSale object built inside confirm()'s original body
  }

  return executeBusinessOperation(write, {
    audit: async (sale) => {
      await audit.logSaleCompleted(sale.saleId, sale.totalUsd, sale.lines.length)
      // NOTE TO IMPLEMENTER: copy the exact per-line and sale-level discount-audit
      // calls (meta object shape, operatorId/basePriceUsd/pinApproval/belowCost
      // sourcing) verbatim from usePayment.ts's confirm() — do not re-derive from
      // this sketch, which omits fields this callback doesn't have in scope yet.
      for (const line of sale.lines) {
        if (line.discountType) await audit.logDiscountApplied(sale.saleId, { /* ...meta, copied from confirm() */ } as any)
      }
    },
    toEvent: (sale) => ({
      type: SalesEventType.Completed,
      entityId: sale.saleId,
      payload: {
        saleId: sale.saleId, shopId: input.shopId, staffId: input.staffId,
        totalUsd: sale.totalUsd, totalSyp: sale.totalSyp,
        paymentSummary: {
          cashUsd: 0, cashSyp: 0, cardTotal: 0, creditTotal: 0,  // TODO: fill from entries/isSplit computed above, per line item method
          methodCount: input.pendingPayments?.length ?? 1,
        },
        itemCount: sale.lines.length,
        discountApplied: sale.lines.some(l => l.discountType) || !!sale.saleDiscount,
      },
      staffId: input.staffId,
      shopId: input.shopId,
      occurredAt: now,
    }),
  })
}
```

Note the `paymentSummary`'s `cashUsd`/`cashSyp`/`cardTotal`/`creditTotal` fields are placeholders — fix in Step 4b using the real per-method breakdown that `confirm()`'s original entries/isSplit logic already computes.

- [ ] **Step 4b: Refactor — compute the real `paymentSummary` aggregate**

Using the `entries: SplitPaymentEntry[]` array already built inside the pasted `confirm()` body (per prior research: "entries, isSplit, primaryMethod, totalReceived, lastChange"), aggregate per method before constructing the event payload:

```ts
// src/services/sales.service.ts — inside the write() callback, after entries are built, before returning `sale`
const paymentSummary = {
  cashUsd: entries.filter(e => e.method === 'cash_usd').reduce((s, e) => s + e.amountUsd, 0),
  cashSyp: entries.filter(e => e.method === 'cash_syp').reduce((s, e) => s + e.amountUsd, 0),
  cardTotal: entries.filter(e => e.method === 'card').reduce((s, e) => s + e.amountUsd, 0),
  creditTotal: isCredit ? sale.totalUsd : 0,
  methodCount: entries.length || 1,
}
// attach paymentSummary to whatever the write() callback returns so toEvent can read it,
// e.g. return { ...sale, paymentSummary } and adjust CompletedSale's local extension type,
// OR compute paymentSummary a second time inside toEvent from `entries` captured in closure —
// prefer the closure capture (entries is already in scope in completeSale's outer function),
// not widening CompletedSale's public return type with an internal-only field.
```

Prefer capturing `entries`/`isCredit` in the outer `completeSale` closure (declared before `write`/`toEvent` are defined) so `toEvent` can reference them directly without mutating `CompletedSale`'s shape — `CompletedSale` is an existing public type used elsewhere (`useFastCash.ts`, UI components) and should not gain new fields as a side effect of this extraction.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/services/__tests__/sales.service.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Add tests for the remaining behaviors ported from `usePayment.test.ts`**

Per spec §8, business-rule assertions move to the service test file. Port (not duplicate) these specific scenarios from the 641-line `usePayment.test.ts` into `sales.service.test.ts`, adapting each to call `completeSale(input, fakeAudit)` directly instead of driving the composable: stock deduction/clamping/oversell notes, credit/installment path (`isCredit`), split payments across multiple methods, discount persistence + audit trail (WAFI-100 — assert against `fakeAudit.logDiscountApplied`'s call args, not `db.execute`'s SQL text), `source = 'pos'` tagging (WAFI-008). Do not re-derive these test cases from scratch — read each corresponding `it(...)` block in `usePayment.test.ts` and adapt its assertions to the service's direct call shape.

- [ ] **Step 7: Delegate `usePayment.ts`'s `confirm()` to `SalesService.completeSale`**

```ts
// src/features/payment/usePayment.ts — replace confirm()'s body
import { completeSale } from '@/services/sales.service'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'
// ...
async function confirm(customerId?: string): Promise<CompletedSale> {
  const device = useDeviceStore()
  const shiftStore = useShiftStore()
  const session = useSessionStore()
  const { logSaleCompleted, logDiscountApplied } = useAuditLog()
  const sale = await completeSale({
    shopId: device.shopId,
    staffId: session.activeStaff?.id ?? '',
    shiftId: shiftStore.activeShiftId,
    deviceId: device.deviceId,
    method: method.value,
    amountReceived: amountReceived.value,
    pendingPayments: pendingPayments.value,
    customerId,
    lines: saleStore.lines,  // whatever the existing confirm() read for line items
    exchangeRateAtSale: /* existing exchange-rate source */,
  }, { logSaleCompleted, logDiscountApplied })
  state.value = 'confirmed'
  return sale
}
```

The exact shape of `lines`/`exchangeRateAtSale` sourcing must match what the original `confirm()` read — verify against the Step 1 full read, not this abbreviated sketch.

- [ ] **Step 8: Run `usePayment.test.ts` and `useFastCash.test.ts`**

Run: `npx vitest run src/__tests__/features/usePayment.test.ts src/__tests__/features/useFastCash.test.ts`
Expected: PASS — if any test fails because it asserted directly on `db.writeTransaction` calls (rather than through `confirm()`'s return value or composable state), trim that assertion here per spec §8's testing strategy (delegation/reactive-state only) since the equivalent assertion now lives in `sales.service.test.ts` from Step 6.

- [ ] **Step 9: Commit**

```bash
git add src/services/sales.service.ts src/services/__tests__/sales.service.test.ts \
        src/features/payment/usePayment.ts src/__tests__/features/usePayment.test.ts
git commit -m "refactor(WAFI-152): extract SalesService.completeSale from usePayment"
```

---

### Task 5: StaffService

**Files:**
- Create: `src/services/staff.service.ts`
- Create: `src/services/__tests__/staff.service.test.ts`
- Modify: `src/features/shifts/composables/useShift.ts`
- Modify: `src/features/staff-ledger/composables/useStaffLedger.ts`
- Modify: `src/features/staff-ledger/composables/useStaffSettlement.ts`
- Modify: `src/__tests__/features/useShift.deactivation.test.ts`
- Modify: `src/__tests__/features/useStaffLedger.test.ts`
- Modify: `src/__tests__/features/useStaffSettlement.test.ts`
- Modify: `src/__tests__/features/useStaffSettlement.permissions.test.ts`

**Interfaces:**
- Consumes: `executeBusinessOperation`, `StaffEventType` (Task 0); `CashierShift`, `DenominationBreakdown`, `ZReportMetrics` types (`src/features/shifts/shift.types.ts`); `StaffLedgerEntry`, `NewStaffLedgerEntry`, `StaffSettlement` types (`src/features/staff-ledger/staff-ledger.types.ts`).
- Produces: `openShift`, `closeShift`, `paySettlement`, `addLedgerEntry` per spec §4.

**Context:** Largest file-count task — 4 source files, most complex being `useShift.ts` (452 lines, discriminated-union `OpenShiftResult`). `useShiftDetail.ts` is explicitly read-only (per research) and is NOT touched by this task — it has no writes to extract. `useStaffLedger.ts`/`useStaffSettlement.ts` already use `executeFinancialWrite` — Task 0 already renamed their import to `executeBusinessOperation` with no `toEvent` (out-of-scope call sites publish nothing, per Task 0's Step 9); this task replaces that with the real service extraction, injected audit ports (matching Task 1's `ExpenseAuditPort` pattern — no service in this ticket calls `useAuditLog()` directly), and correct event payloads.

- [ ] **Step 1: Read all 4 source files and their test files in full**

Read `src/features/shifts/composables/useShift.ts` (452 lines), `src/features/staff-ledger/composables/useStaffLedger.ts` (99 lines), `src/features/staff-ledger/composables/useStaffSettlement.ts` (265 lines), and their corresponding test files (`useShift.deactivation.test.ts` 65 lines, `useStaffLedger.test.ts` 101 lines, `useStaffSettlement.test.ts` 302 lines, `useStaffSettlement.permissions.test.ts` 47 lines) completely — these were already reproduced verbatim during spec research; re-read from the live files to confirm nothing has changed since.

- [ ] **Step 2: Write the failing test for `addLedgerEntry`'s validation rules**

```ts
// src/services/__tests__/staff.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { addLedgerEntry } from '@/services/staff.service'
import type { NewStaffLedgerEntry } from '@/features/staff-ledger/staff-ledger.types'

describe('StaffService.addLedgerEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
  })

  const baseEntry: NewStaffLedgerEntry = {
    staffId: 'staff1', entryType: 'advance', amountRaw: 50, currency: 'USD',
    lockedRate: 1, sourceType: 'manual',
  }
  const fakeAudit = { logStaffLedgerEntryCreated: vi.fn().mockResolvedValue(undefined) }

  it('rejects a zero or negative amountRaw', async () => {
    await expect(addLedgerEntry('shop1', { ...baseEntry, amountRaw: 0 }, fakeAudit)).rejects.toThrow()
    await expect(addLedgerEntry('shop1', { ...baseEntry, amountRaw: -10 }, fakeAudit)).rejects.toThrow()
  })

  it('rejects a missing lockedRate', async () => {
    await expect(addLedgerEntry('shop1', { ...baseEntry, lockedRate: undefined as any }, fakeAudit)).rejects.toThrow()
  })

  it('rejects a negative lockedRate', async () => {
    await expect(addLedgerEntry('shop1', { ...baseEntry, lockedRate: -1 }, fakeAudit)).rejects.toThrow()
  })

  it('rejects an amount that rounds to zero USD after SYP conversion', async () => {
    await expect(addLedgerEntry('shop1', { ...baseEntry, currency: 'SYP', amountRaw: 0.001, lockedRate: 15000 }, fakeAudit)).rejects.toThrow()
  })

  it('inserts a ledger entry when validation passes', async () => {
    await addLedgerEntry('shop1', baseEntry, fakeAudit)
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO staff_ledger'),
      expect.any(Array),
    )
  })

  it('calls the injected audit port with the created entry id/staffId/type/amount', async () => {
    const result = await addLedgerEntry('shop1', baseEntry, fakeAudit)
    expect(fakeAudit.logStaffLedgerEntryCreated).toHaveBeenCalledWith(
      result.id, result.staffId, result.entryType, result.amountUsd,
    )
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/staff.service.test.ts`
Expected: FAIL with "Cannot find module '@/services/staff.service'"

- [ ] **Step 4: Implement `StaffService.addLedgerEntry`**

Paste `useStaffLedger.ts`'s `addLedgerEntry` body verbatim (validation rules + insert + `executeFinancialWrite`/now `executeBusinessOperation` call), converting to a plain function:

```ts
// src/services/staff.service.ts
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { executeBusinessOperation } from '@/composables/executeBusinessOperation'
import { StaffEventType } from '@/services/events/domainEvent.types'
import type { NewStaffLedgerEntry, StaffLedgerEntry } from '@/features/staff-ledger/staff-ledger.types'

/** Narrow audit interface this service needs — implemented by the caller via
 *  useAuditLog(), never imported here. */
export interface StaffLedgerAuditPort {
  logStaffLedgerEntryCreated: (
    entryId: string, staffId: string, entryType: string, amountUsd: number,
  ) => Promise<void>
}

export async function addLedgerEntry(
  shopId: string,
  entry: NewStaffLedgerEntry,
  audit: StaffLedgerAuditPort,
): Promise<StaffLedgerEntry> {
  // NOTE TO IMPLEMENTER: paste useStaffLedger.ts's exact validation block here
  // (amountRaw > 0, lockedRate present and > 0, SYP-conversion-rounds-to-nonzero
  // checks) before constructing the write. Do not re-derive these rules from
  // the test names above — read the source file for the exact thresholds.
  const id = uuidv4()
  const now = new Date().toISOString()

  const write = async (): Promise<StaffLedgerEntry> => {
    await db.execute(
      `INSERT INTO staff_ledger (id, shop_id, staff_id, entry_type, amount_raw, currency,
         locked_rate, amount_usd, source_type, source_id, notes, created_at, settlement_id, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, 'pending')`,
      [id, shopId, entry.staffId, entry.entryType, entry.amountRaw, entry.currency,
       entry.lockedRate, /* computed amountUsd */ entry.amountRaw / entry.lockedRate,
       entry.sourceType, entry.sourceId ?? null, entry.notes ?? null, now],
    )
    return { id, shopId, ...entry, amountUsd: entry.amountRaw / entry.lockedRate, createdAt: now, settlementId: null }
  }

  return executeBusinessOperation(write, {
    audit: async (created) => {
      await audit.logStaffLedgerEntryCreated(created.id, created.staffId, created.entryType, created.amountUsd)
    },
    toEvent: (created) => ({
      type: StaffEventType.LedgerEntryAdded,
      entityId: created.id,
      payload: { staffId: created.staffId, entryType: created.entryType, amount: created.amountUsd },
      staffId: created.staffId,
      shopId,
      occurredAt: now,
    }),
  }, 'can_view_expenses')
}
```

Correct the `amountUsd` computation and SYP-conversion rounding-to-zero rejection against the exact source logic found in Step 1 — the `entry.amountRaw / entry.lockedRate` shown here is illustrative, not verified against the real currency-conversion direction (verify whether `lockedRate` multiplies or divides, per the actual file).

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/services/__tests__/staff.service.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Write the failing test for `openShift`/`closeShift`**

```ts
// append to src/services/__tests__/staff.service.test.ts
import { openShift, closeShift } from '@/services/staff.service'

describe('StaffService.openShift / closeShift', () => {
  const fakeShiftAudit = {
    logShiftOpened: vi.fn().mockResolvedValue(undefined),
    logShiftClosed: vi.fn().mockResolvedValue(undefined),
  }

  it('openShift inserts a shift row and returns opened result', async () => {
    vi.mocked(db.getOptional).mockResolvedValue(null)  // no existing open shift for device
    const result = await openShift('shop1', 'device1', 'staff1', 100, fakeShiftAudit)
    expect(result.status).toBe('opened')
  })

  it('closeShift computes variance as countedCash - expectedCash', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ id: 'shift1', opening_cash: 100, expected_cash: 250 } as any)
    const result = await closeShift('shift1', 230, fakeShiftAudit)
    expect(result.variance).toBe(-20)
  })
})
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/staff.service.test.ts`
Expected: FAIL with "openShift is not exported"

- [ ] **Step 8: Implement `openShift`/`closeShift`**

Paste `useShift.ts`'s `openShift`/`closeShift`/`writeShiftClose` bodies (the discriminated `OpenShiftResult` union and variance computation from `shift.types.ts`'s `varianceLevel()`), converting Vue-store reads to explicit parameters. Given the file's size and the discriminated-union complexity (`opened|resumed|conflict|device-deactivated|identity-unconfirmed`), the implementer must read the full 452-line source in Step 1 and preserve every branch — this is not summarizable into a short code block without omitting a real business rule. Follow the same paste-and-adapt approach as Task 4 Step 4.

Both methods take an injected audit port as their last parameter (matching Task 1/2/3's `*AuditPort` pattern) — define:

```ts
// src/services/staff.service.ts
export interface OpenShiftAuditPort {
  logShiftOpened: (shiftId: string) => Promise<void>
}
export interface CloseShiftAuditPort {
  logShiftClosed: (shiftId: string) => Promise<void>
}
```

`openShift(shopId, deviceId, staffId, openingCash, audit: OpenShiftAuditPort)` and `closeShift(shiftId, countedCash, audit: CloseShiftAuditPort)` — call `audit.logShiftOpened`/`audit.logShiftClosed` from inside `executeBusinessOperation`'s `audit` hook exactly like Task 1-3's services, never `useAuditLog()` directly.

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run src/services/__tests__/staff.service.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 10: Write the failing test for `paySettlement`**

```ts
// append to src/services/__tests__/staff.service.test.ts
import { paySettlement } from '@/services/staff.service'

describe('StaffService.paySettlement', () => {
  const fakeSettlementAudit = { logStaffSettlementPaid: vi.fn().mockResolvedValue(undefined) }

  it('marks the settlement as paid and returns the updated record', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ id: 'settle1', status: 'finalized', final_amount_usd: 100 } as any)
    const result = await paySettlement('staff1', 100, fakeSettlementAudit)
    expect(result.status).toBe('paid')
  })
})
```

- [ ] **Step 11: Run test to verify it fails, then implement `paySettlement` (paste from `useStaffSettlement.ts`'s `markPaid`)**

Run: `npx vitest run src/services/__tests__/staff.service.test.ts` — expect FAIL, then paste `markPaid`'s body (per research: single UPDATE, wrapped in `executeFinancialWrite`/now `executeBusinessOperation`, audit callback `logStaffSettlementPaid`) into `paySettlement`, adapting the permission string `'can_view_expenses'` and the `StaffEventType.SettlementPaid` event. Define `PaySettlementAuditPort = { logStaffSettlementPaid: (settlementId: string, staffId: string, paymentMethod: string) => Promise<void> }` and take it as `paySettlement`'s last parameter — call `audit.logStaffSettlementPaid(...)` from inside `executeBusinessOperation`'s `audit` hook, never `useAuditLog()` directly (same pattern as every other service in this ticket).

- [ ] **Step 12: Run test to verify it passes**

Run: `npx vitest run src/services/__tests__/staff.service.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 13: Delegate all 3 composables to `StaffService`**

```ts
// src/features/shifts/composables/useShift.ts — openShift/closeShift delegate to StaffService
import { openShift as openShiftService, closeShift as closeShiftService } from '@/services/staff.service'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'
// replace openShift()/closeShift() bodies with calls to the service, keeping
// forceCloseShift's local teardown (session.clearSession(), etc.) in the composable —
// construct { logShiftOpened } / { logShiftClosed } from useAuditLog() at the call site
// and pass as the service's last argument, same as every other delegation in this ticket

// src/features/staff-ledger/composables/useStaffLedger.ts — addLedgerEntry delegates
import { addLedgerEntry as addLedgerEntryService } from '@/services/staff.service'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'
// construct { logStaffLedgerEntryCreated } from useAuditLog() and pass as the 3rd argument

// src/features/staff-ledger/composables/useStaffSettlement.ts — markPaid delegates
import { paySettlement } from '@/services/staff.service'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'
// construct { logStaffSettlementPaid } from useAuditLog() and pass as the 3rd argument
```

Preserve `finalize()`'s `db.writeTransaction` composition logic (per-application `UPDATE staff_ledger`, carry-forward `INSERT`, `UPDATE staff_settlements`) as a separate `StaffService` method if time permits within this task, or leave `finalize()` un-extracted for this ticket if the transaction-composition complexity (multiple ledger rows touched atomically) needs its own careful pass — flag this decision explicitly in the PR description rather than rushing an incomplete extraction.

- [ ] **Step 14: Run all 4 existing test suites**

Run: `npx vitest run src/__tests__/features/useShift.deactivation.test.ts src/__tests__/features/useStaffLedger.test.ts src/__tests__/features/useStaffSettlement.test.ts src/__tests__/features/useStaffSettlement.permissions.test.ts`
Expected: PASS

- [ ] **Step 15: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — full regression check across all 5 extracted services and their composables.

- [ ] **Step 16: Commit**

```bash
git add src/services/staff.service.ts src/services/__tests__/staff.service.test.ts \
        src/features/shifts/composables/useShift.ts \
        src/features/staff-ledger/composables/useStaffLedger.ts \
        src/features/staff-ledger/composables/useStaffSettlement.ts \
        src/__tests__/features/useShift.deactivation.test.ts \
        src/__tests__/features/useStaffLedger.test.ts \
        src/__tests__/features/useStaffSettlement.test.ts \
        src/__tests__/features/useStaffSettlement.permissions.test.ts
git commit -m "refactor(WAFI-152): extract StaffService (shift, ledger entry, settlement payment)"
```

---

## Final Verification

- [ ] **Run the full test suite one more time**

Run: `npx vitest run`
Expected: PASS, zero regressions

- [ ] **Run the production build (type-checks tests too — see project's build gotcha)**

Run: `npm run build`
Expected: PASS — per this repo's known gotcha, `npm run build` type-checks test files too, so a TS error in any trimmed test file surfaces here even if `dev` didn't catch it.

- [ ] **Grep for any remaining `executeFinancialWrite` references**

Run: `git grep -l executeFinancialWrite -- '*.ts'`
Expected: no output — confirms Task 0's rename was complete.

- [ ] **Grep for Vue/Pinia imports (including `useAuditLog`) inside `src/services/`**

Run: `git grep -lE "from 'vue'|useSessionStore|useDeviceStore|useShiftStore|useAuditLog" -- 'src/services/**/*.ts'`
Expected: **no output at all** — unlike an earlier draft of this check, `useAuditLog` is included here on purpose: `executeBusinessOperation.ts` (which legitimately reads `useSessionStore()` per spec §6a) lives in `src/composables/`, outside this glob, so nothing under `src/services/` should match any of these patterns, including audit logging. Every service takes its audit functions as an injected `*AuditPort` parameter instead (Task 1's `ExpenseAuditPort` pattern, carried through Tasks 2-5) — confirms the 5 services are genuinely framework-agnostic, not just DB-agnostic.

- [ ] **Verify AC checklist from the spec (§7)**

- [ ] Zero business logic in Vue components
- [ ] All 5 composables (usePayment, useReceivingSheet/useProducts, useCustomerBalance, useShift/useStaffLedger/useStaffSettlement, useExpenses) are thin wrappers around services
- [ ] Services are pure TypeScript, framework-agnostic
- [ ] Services publish domain events via `executeBusinessOperation` only
- [ ] Every critical business rule (per spec §8) has a unit test in the new `*.service.test.ts` files
- [ ] Services work offline (PowerSync `db.writeTransaction` semantics unchanged — verified by the fact that no test needed to change its mock setup)
