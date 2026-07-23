# WAFI-007 Financial Write Wrapper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the existing `executeFinancialWrite` helper beyond the staff-ledger feature, retrofit all 6 financial-write composables to use it, and backfill the audit viewer's stale filter dropdown.

**Architecture:** Relocate one existing composable, add an optional parameter to it, update 6 call sites to route through it (pure refactor — no behavior change to any write or audit call), and append missing options to one array literal in a Vue page.

**Tech Stack:** Vue 3, Pinia, PowerSync (`db`), Vitest.

## Global Constraints

- Do not change `useAuditLog.ts`'s `_log`/`_logSensitive` failure semantics — untouched by this plan.
- Do not add a hard runtime guarantee (transactional coupling, DB trigger) that would fail a financial write if its audit log write fails — this app deliberately treats sale/financial audit logging as best-effort, non-blocking (see design doc's Context section). `executeFinancialWrite` guarantees the *call* happens, not that it *succeeds*.
- Every retrofit in this plan must preserve the exact existing write SQL and exact existing audit-log call arguments — this is a structural refactor, not a behavior change. If any existing test fails after a retrofit, that's a sign the refactor changed behavior — stop and investigate, don't adjust the test to match.
- `useStaffLedger.ts`/`useStaffSettlement.ts` (already using the old `executeFinancialWrite`) must keep passing `'can_view_expenses'` explicitly after the relocation — this preserves their current permission check unchanged.

---

### Task 1: Relocate and generalize `executeFinancialWrite`

**Files:**
- Create: `src/composables/executeFinancialWrite.ts`
- Delete: `src/features/staff-ledger/composables/executeFinancialWrite.ts`
- Modify: `src/__tests__/features/executeFinancialWrite.test.ts` (update import path + add new-behavior tests)
- Modify: `src/features/staff-ledger/composables/useStaffLedger.ts:7` (import path only)
- Modify: `src/features/staff-ledger/composables/useStaffSettlement.ts` (import path only — find its import line with `grep -n "executeFinancialWrite" src/features/staff-ledger/composables/useStaffSettlement.ts`)

**Interfaces:**
- Produces: `executeFinancialWrite<T>(write: () => Promise<T>, audit: (result: T) => Promise<void>, requiredPermission?: keyof StaffPermissions): Promise<T>` from `@/composables/executeFinancialWrite`. Tasks 2–5 import this exact path and signature.
- Consumes: `useSessionStore()` from `@/store/session.store`, `canUserDo` from `@/router/permissions`, `StaffPermissions` type from `@/features/staff/staff.types` — all already used by the original implementation, just moving with it.

- [ ] **Step 1: Read the current test file's expectations**

The existing `src/__tests__/features/executeFinancialWrite.test.ts` (already shown in full — see below) tests the OLD hardcoded-`can_view_expenses` behavior with no permission parameter. Since the new signature makes the permission check optional, two of these three existing tests need their call sites updated to pass `'can_view_expenses'` explicitly (preserving their original intent), and new tests are added for the optional-permission behavior.

- [ ] **Step 2: Write the updated/new test file**

Replace `src/__tests__/features/executeFinancialWrite.test.ts` in full with:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSessionStore } from '@/store/session.store'
import { executeFinancialWrite } from '@/composables/executeFinancialWrite'
import type { Staff } from '@/features/staff/staff.types'

const grantedStaff: Staff = {
  id: 'staff-1', shopId: 'shop-1', name: 'Ahmed', pinHash: 'x', pinSalt: null,
  role: 'manager',
  permissions: { can_view_reports: false, can_manage_products: true, can_manage_customers: true, can_view_expenses: true, can_manage_settings: false, can_manage_inventory: false, can_manage_suppliers: false, can_manage_stock_take: false, can_view_staff_ledger: false },
  isActive: true, createdAt: '2026-01-01T00:00:00Z',
}

const cashierStaff: Staff = {
  ...grantedStaff, id: 'staff-2', role: 'cashier',
  permissions: { ...grantedStaff.permissions, can_view_expenses: false },
}

describe('executeFinancialWrite', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('runs the write and audit callback when the active staff has the required permission', async () => {
    useSessionStore().setActiveStaff(grantedStaff)
    const write = vi.fn().mockResolvedValue('result')
    const audit = vi.fn().mockResolvedValue(undefined)

    const result = await executeFinancialWrite(write, audit, 'can_view_expenses')

    expect(result).toBe('result')
    expect(write).toHaveBeenCalledOnce()
    expect(audit).toHaveBeenCalledWith('result')
  })

  it('throws and never calls write when the active staff lacks the required permission', async () => {
    useSessionStore().setActiveStaff(cashierStaff)
    const write = vi.fn()
    const audit = vi.fn()

    await expect(executeFinancialWrite(write, audit, 'can_view_expenses')).rejects.toThrow(/permission/i)
    expect(write).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it('throws when there is no active staff and a permission is required (fail closed)', async () => {
    const write = vi.fn()
    const audit = vi.fn()
    await expect(executeFinancialWrite(write, audit, 'can_view_expenses')).rejects.toThrow(/permission/i)
    expect(write).not.toHaveBeenCalled()
  })

  it('runs write and audit with no permission check when requiredPermission is omitted', async () => {
    // No active staff at all -- still succeeds, since no permission was required.
    const write = vi.fn().mockResolvedValue(42)
    const audit = vi.fn().mockResolvedValue(undefined)

    const result = await executeFinancialWrite(write, audit)

    expect(result).toBe(42)
    expect(write).toHaveBeenCalledOnce()
    expect(audit).toHaveBeenCalledWith(42)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/features/executeFinancialWrite.test.ts`
Expected: FAIL — `@/composables/executeFinancialWrite` does not exist yet (the file is still at its old path).

- [ ] **Step 4: Create the relocated, generalized implementation**

Create `src/composables/executeFinancialWrite.ts`:

```ts
import { useSessionStore } from '@/store/session.store'
import { canUserDo } from '@/router/permissions'
import type { StaffPermissions } from '@/features/staff/staff.types'

/**
 * Every financial-write composable calls this instead of writing + auditing
 * separately, so a write can never ship without exactly one audit-log call
 * (originally WAFI-138 Invariant 9 for staff-ledger only; generalized in
 * WAFI-007 to every financial-write composable). This guarantees the audit
 * CALL happens after a successful write -- it does not change useAuditLog's
 * own best-effort failure semantics (a failed audit write inside `audit()`
 * is useAuditLog's `_log`/`_logSensitive` distinction to handle, not this
 * wrapper's).
 *
 * `requiredPermission` is optional: pass it when this call site needs its
 * own defense-in-depth permission re-check (WAFI-058 pattern: never trust
 * the router alone); omit it when the caller is already gated elsewhere and
 * doesn't have an equivalent single-permission requirement to duplicate.
 */
export async function executeFinancialWrite<T>(
  write: () => Promise<T>,
  audit: (result: T) => Promise<void>,
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
  return result
}
```

- [ ] **Step 5: Delete the old file and update its two existing callers' import paths**

```bash
git rm src/features/staff-ledger/composables/executeFinancialWrite.ts
```

In `src/features/staff-ledger/composables/useStaffLedger.ts:7`, change:
```ts
import { executeFinancialWrite } from '@/features/staff-ledger/composables/executeFinancialWrite'
```
to:
```ts
import { executeFinancialWrite } from '@/composables/executeFinancialWrite'
```

Then find its ONE call site in that file (`grep -n "executeFinancialWrite(" src/features/staff-ledger/composables/useStaffLedger.ts`) and add the permission argument to preserve the original check:
```ts
    return executeFinancialWrite(
      async () => { /* ...unchanged... */ },
      (entry) => logStaffLedgerEntryCreated(entry.id, entry.staffId, entry.entryType, entry.amountUsd),
      'can_view_expenses',
    )
```

In `src/features/staff-ledger/composables/useStaffSettlement.ts`, find its import line and both call sites:
```bash
grep -n "executeFinancialWrite" src/features/staff-ledger/composables/useStaffSettlement.ts
```
Update the import path the same way as above, and add `'can_view_expenses'` as the third argument to each of its (likely two) `executeFinancialWrite(...)` calls, matching the pattern shown for `useStaffLedger.ts` above.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/features/executeFinancialWrite.test.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 7: Run the staff-ledger/settlement test files to confirm no regression**

Run: `npx vitest run src/__tests__ -t "useStaffLedger" ; npx vitest run src/__tests__ -t "useStaffSettlement"` (or locate and run their exact test file paths with `find src -iname "useStaffLedger.test.ts" -o -iname "useStaffSettlement.test.ts"` first if the `-t` pattern doesn't match)
Expected: PASS, no failures — behavior unchanged, only the import path and an explicit (previously implicit) permission argument changed.

- [ ] **Step 8: Commit**

```bash
git add src/composables/executeFinancialWrite.ts src/__tests__/features/executeFinancialWrite.test.ts src/features/staff-ledger/composables/useStaffLedger.ts src/features/staff-ledger/composables/useStaffSettlement.ts
git commit -m "refactor(wafi-007): relocate and generalize executeFinancialWrite

Moves from features/staff-ledger/composables to composables/ (matching
this codebase's convention for cross-feature composables) and makes the
permission check optional via a new requiredPermission parameter, instead
of hardcoding can_view_expenses. Existing callers (useStaffLedger.ts,
useStaffSettlement.ts) now pass 'can_view_expenses' explicitly -- same
behavior as before, just no longer implicit."
```

---

### Task 2: Retrofit `usePayment.ts`'s sale-completion path

**Files:**
- Modify: `src/features/payment/usePayment.ts:225-327` (the `confirm()` function's try block)
- Test: locate with `find src -iname "usePayment.test.ts"` — run its existing suite before and after, do not add new tests (this is a pure refactor of already-tested behavior)

**Interfaces:**
- Consumes: `executeFinancialWrite` from Task 1 (`@/composables/executeFinancialWrite`).
- Produces: no new exports — `confirm()`'s public behavior (return type `CompletedSale`, thrown errors) is unchanged.

- [ ] **Step 1: Locate and run the existing test file first, to have a passing baseline**

```bash
find src -iname "usePayment.test.ts"
```
Run whatever file that finds (e.g. `npx vitest run <path>`) and confirm it passes BEFORE making any change — this is your regression baseline.

- [ ] **Step 2: Add the import**

At the top of `src/features/payment/usePayment.ts`, add:
```ts
import { executeFinancialWrite } from '@/composables/executeFinancialWrite'
```

- [ ] **Step 3: Wrap the write + audit call**

The current `confirm()` function's `try` block (lines 225-327) reads:

```ts
    try {
      // All writes for one sale run in a single transaction so a mid-way failure
      // can't leave a sale row without its line items, payments, or stock movements.
      await db.writeTransaction(async (tx) => {
        // ...(all the tx.execute(...) calls, UNCHANGED -- do not touch this block's contents)...
      })

      // Write succeeded — only now commit the sequence advance (WAFI-004).
      saleStore.incrementSequence()
      await clearDraft()
      saleStore.clear()
      pendingPayments.value = []
      state.value           = 'confirmed'
      isOpen.value          = false
      await logSaleCompleted(saleId, sale.totalUsd, sale.lines.length)
      return sale
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Payment failed'
      state.value = method.value === 'card'        ? 'card-confirm'
                  : method.value === 'credit'      ? 'credit-confirm'
                  : method.value === 'installment' ? 'installment-confirm'
                  : 'amount-entry'
      throw err
    }
  }
```

Change it to (the `db.writeTransaction(...)` block's internal contents are byte-for-byte identical to the original file — only the surrounding structure changes):

```ts
    try {
      await executeFinancialWrite(
        async () => {
          // All writes for one sale run in a single transaction so a mid-way failure
          // can't leave a sale row without its line items, payments, or stock movements.
          await db.writeTransaction(async (tx) => {
            await tx.execute(
              `INSERT INTO sales (id, shop_id, device_id, device_sequence, display_sale_number,
                created_at, total_usd, total_syp, exchange_rate_at_sale, payment_method,
                amount_received, amount_received_currency, change_due, customer_id, is_credit, is_split, shift_id, staff_id, sync_status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                saleId, deviceStore.shopId, deviceStore.deviceId,
                saleSeq, displayNum, now,
                totalUsd.value, totalSyp.value, saleStore.lockedExchangeRate,
                primaryMethod, totalReceived, 'USD', lastChange || null,
                customerId ?? null, isCredit ? 1 : 0, isSplit ? 1 : 0,
                shiftStore.activeShiftId,
                // Attribution rule: the operator active at confirmation owns the sale
                // (the cart can change hands via switch-operator). shift_id stays the
                // cash-period link.
                sessionStore.activeStaff?.id ?? null,
                'pending',
              ]
            )

            // Insert one row per payment entry into sale_payments
            for (const entry of entries) {
              await tx.execute(
                `INSERT INTO sale_payments (id, sale_id, shop_id, method, amount_raw, currency,
                  amount_usd, exchange_rate, change_due, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  uuidv4(), saleId, deviceStore.shopId, entry.method, entry.amountRaw,
                  entry.currency, entry.amountUsd, entry.exchangeRate,
                  entry.changeDue || null, now,
                ]
              )
            }

            for (const line of saleStore.lines) {
              // WAFI-101 — open items are a hidden synthetic product with no real
              // stock: never touch current_stock or write a stock_adjustments row.
              if (line.isOpenItem) {
                await tx.execute(
                  `INSERT INTO sale_line_items (id, sale_id, shop_id, product_id, quantity, unit_price_usd, unit_cost_usd, line_total_usd)
                   VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
                  [uuidv4(), saleId, deviceStore.shopId, line.productId,
                   line.quantity, line.unitPriceUsd, line.lineTotalUsd]
                )
                continue
              }

              const res = await tx.execute(
                'SELECT cost_price_usd, current_stock FROM products WHERE id = ?',
                [line.productId]
              )
              const row          = (res as any).rows?._array?.[0]
              const unitCostUsd  = row?.cost_price_usd ?? 0
              const currentStock = row?.current_stock ?? 0
              // Clamp at 0: a sale must never drive on-hand stock negative (e.g. when
              // the cart was built against stale stock, or an offline oversell).
              const newStock     = Math.max(0, currentStock - line.quantity)
              // When clamping drops fewer units than were sold, the count was stale.
              // Mark the oversold quantity on the adjustment so reconciliation can see
              // the gap between the line quantity and the recorded stock movement.
              const oversoldBy   = line.quantity - (currentStock - newStock)
              const adjustNote   = oversoldBy > 0 ? `oversold:${oversoldBy}` : null

              await tx.execute(
                `INSERT INTO sale_line_items (id, sale_id, shop_id, product_id, quantity, unit_price_usd, unit_cost_usd, line_total_usd)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [uuidv4(), saleId, deviceStore.shopId, line.productId,
                 line.quantity, line.unitPriceUsd, unitCostUsd, line.lineTotalUsd]
              )
              await tx.execute(
                `UPDATE products SET current_stock = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
                [newStock, now, line.productId]
              )
              await tx.execute(
                `INSERT INTO stock_adjustments (id, shop_id, product_id, old_value, new_value, reason, notes, created_at, device_id)
                 VALUES (?, ?, ?, ?, ?, 'sale', ?, ?, ?)`,
                [uuidv4(), deviceStore.shopId, line.productId, currentStock, newStock, adjustNote, now, deviceStore.deviceId]
              )
            }
          })

          // Write succeeded — only now commit the sequence advance (WAFI-004).
          saleStore.incrementSequence()
          await clearDraft()
          saleStore.clear()
          pendingPayments.value = []
          state.value           = 'confirmed'
          isOpen.value          = false
        },
        () => logSaleCompleted(saleId, sale.totalUsd, sale.lines.length),
      )
      return sale
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Payment failed'
      state.value = method.value === 'card'        ? 'card-confirm'
                  : method.value === 'credit'      ? 'credit-confirm'
                  : method.value === 'installment' ? 'installment-confirm'
                  : 'amount-entry'
      throw err
    }
  }
```

Note: no `requiredPermission` is passed here — sale completion doesn't have an existing single-permission gate to duplicate (per the design doc's Section 1). The `write` closure's return type is `void` (nothing new needed from it — `sale` is already in scope via closure for both the audit call and the final `return sale`), so `audit`'s parameter is unused; that's fine, `executeFinancialWrite<T>`'s `audit: (result: T) => Promise<void>` accepts a zero-arg arrow function since TypeScript allows a function expecting no parameters to satisfy a callback type expecting one — do not add an unused parameter to silence anything, this is normal.

- [ ] **Step 4: Run the existing test suite to verify no regression**

Run the same command as Step 1.
Expected: PASS, identical results to the baseline — this is a pure structural refactor.

- [ ] **Step 5: Commit**

```bash
git add src/features/payment/usePayment.ts
git commit -m "refactor(wafi-007): route sale completion through executeFinancialWrite

Pure structural refactor -- same writeTransaction contents, same
logSaleCompleted call, same success-path state updates. No behavior
change; existing usePayment tests pass unchanged."
```

---

### Task 3: Retrofit `useReturnSheet.ts`'s return-processing path

**Files:**
- Modify: `src/features/returns/composables/useReturnSheet.ts:136-180` (the `confirm()` function's write + audit section)
- Test: locate with `find src -iname "useReturnSheet.test.ts"` — run before and after, no new tests

**Interfaces:**
- Consumes: `executeFinancialWrite` from Task 1.
- Produces: no new exports.

- [ ] **Step 1: Run the existing test file first, for a baseline**

```bash
find src -iname "useReturnSheet.test.ts"
```
Run it, confirm PASS before changing anything.

- [ ] **Step 2: Add the import**

At the top of `src/features/returns/composables/useReturnSheet.ts`, add:
```ts
import { executeFinancialWrite } from '@/composables/executeFinancialWrite'
```

- [ ] **Step 3: Wrap the write + audit call**

The current code (lines 136-180) reads:

```ts
    await db.writeTransaction(async (tx) => {
      // Insert returns row (shift_id links cash refunds to the open shift for the Z-report)
      await tx.execute(
        `INSERT INTO returns (id, shop_id, original_sale_id, created_at, refund_method, refund_amount_usd, refund_amount_syp, exchange_rate_at_return, reason, notes, shift_id, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [returnId, shopId, saleId, now, refundMethod.value!, refundAmountUsd, refundAmountSyp, exchangeRate, reason.value || null, notes.value || null, shiftStore.activeShiftId ?? null],
      )

      // Insert return_line_items
      for (const line of selectedLines) {
        await tx.execute(
          `INSERT INTO return_line_items (id, return_id, shop_id, product_id, qty_returned, unit_price_usd, unit_price_syp, restock, sync_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
          [uuidv4(), returnId, shopId, line.productId, line.qtyToReturn, line.unitPriceUsd, Math.round(line.unitPriceUsd * exchangeRate), line.restock ? 1 : 0],
        )
      }

      // Restock + stock_adjustments. Open-item lines never restock — they have no
      // real catalog stock to add back to (WAFI-101).
      for (const line of selectedLines.filter(l => l.restock && !l.isOpenItem)) {
        const stockResult = await tx.execute(
          `SELECT current_stock FROM products WHERE id = ?`,
          [line.productId],
        )
        const oldStock: number = (stockResult as any).rows._array[0]?.current_stock ?? 0
        const newStock          = oldStock + line.qtyToReturn
        await tx.execute(
          `UPDATE products SET current_stock = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
          [newStock, now, line.productId],
        )
        await tx.execute(
          `INSERT INTO stock_adjustments (id, shop_id, product_id, old_value, new_value, reason, created_at, device_id)
           VALUES (?, ?, ?, ?, ?, 'return', ?, ?)`,
          [uuidv4(), shopId, line.productId, oldStock, newStock, now, deviceId],
        )
      }

      // Note: a returned credit sale reduces the customer's outstanding balance
      // through the `returns` table itself (see useCustomerBalance / the dashboard
      // credit count), so no customer_payments row is written here. Doing so would
      // double-count the return — and a negative payment would wrongly INCREASE the
      // balance under the `sales - payments` formula.
    })

    await logReturnProcessed(returnId, saleId, refundAmountUsd)
  }
```

Change it to (the `db.writeTransaction(...)` block's internal contents are byte-for-byte identical to the original file):

```ts
    await executeFinancialWrite(
      async () => {
        await db.writeTransaction(async (tx) => {
          // Insert returns row (shift_id links cash refunds to the open shift for the Z-report)
          await tx.execute(
            `INSERT INTO returns (id, shop_id, original_sale_id, created_at, refund_method, refund_amount_usd, refund_amount_syp, exchange_rate_at_return, reason, notes, shift_id, sync_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
            [returnId, shopId, saleId, now, refundMethod.value!, refundAmountUsd, refundAmountSyp, exchangeRate, reason.value || null, notes.value || null, shiftStore.activeShiftId ?? null],
          )

          // Insert return_line_items
          for (const line of selectedLines) {
            await tx.execute(
              `INSERT INTO return_line_items (id, return_id, shop_id, product_id, qty_returned, unit_price_usd, unit_price_syp, restock, sync_status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
              [uuidv4(), returnId, shopId, line.productId, line.qtyToReturn, line.unitPriceUsd, Math.round(line.unitPriceUsd * exchangeRate), line.restock ? 1 : 0],
            )
          }

          // Restock + stock_adjustments. Open-item lines never restock — they have no
          // real catalog stock to add back to (WAFI-101).
          for (const line of selectedLines.filter(l => l.restock && !l.isOpenItem)) {
            const stockResult = await tx.execute(
              `SELECT current_stock FROM products WHERE id = ?`,
              [line.productId],
            )
            const oldStock: number = (stockResult as any).rows._array[0]?.current_stock ?? 0
            const newStock          = oldStock + line.qtyToReturn
            await tx.execute(
              `UPDATE products SET current_stock = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
              [newStock, now, line.productId],
            )
            await tx.execute(
              `INSERT INTO stock_adjustments (id, shop_id, product_id, old_value, new_value, reason, created_at, device_id)
               VALUES (?, ?, ?, ?, ?, 'return', ?, ?)`,
              [uuidv4(), shopId, line.productId, oldStock, newStock, now, deviceId],
            )
          }

          // Note: a returned credit sale reduces the customer's outstanding balance
          // through the `returns` table itself (see useCustomerBalance / the dashboard
          // credit count), so no customer_payments row is written here. Doing so would
          // double-count the return — and a negative payment would wrongly INCREASE the
          // balance under the `sales - payments` formula.
        })
      },
      () => logReturnProcessed(returnId, saleId, refundAmountUsd),
    )
  }
```

No `requiredPermission` — matches the design doc's rationale (returns don't have an existing single-permission gate to duplicate here).

- [ ] **Step 4: Run the existing test suite to verify no regression**

Run the same command as Step 1.
Expected: PASS, unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/features/returns/composables/useReturnSheet.ts
git commit -m "refactor(wafi-007): route return processing through executeFinancialWrite

Pure structural refactor -- same writeTransaction contents, same
logReturnProcessed call. No behavior change."
```

---

### Task 4: Retrofit `useCashMovements.ts`'s two write paths

**Files:**
- Modify: `src/features/shifts/composables/useCashMovements.ts:59-99` (`record()` and `voidMovement()`)
- Test: locate with `find src -iname "useCashMovements.test.ts"` — run before and after, no new tests

**Interfaces:**
- Consumes: `executeFinancialWrite` from Task 1.
- Produces: no new exports.

- [ ] **Step 1: Run the existing test file first, for a baseline**

```bash
find src -iname "useCashMovements.test.ts"
```
Run it, confirm PASS.

- [ ] **Step 2: Add the import**

At the top of `src/features/shifts/composables/useCashMovements.ts`, add:
```ts
import { executeFinancialWrite } from '@/composables/executeFinancialWrite'
```

- [ ] **Step 3: Wrap both write + audit calls**

Current `record()` (lines 59-76):
```ts
  async function record(input: RecordCashMovementInput): Promise<string> {
    if (input.shift.status !== 'open') {
      throw new Error('لا يمكن تسجيل حركة نقدية على وردية غير مفتوحة')
    }
    if (!(input.amount > 0)) {
      throw new Error('المبلغ يجب أن يكون أكبر من صفر')
    }
    if (input.currency === 'SYP' && !Number.isInteger(input.amount)) {
      throw new Error('مبلغ الليرة يجب أن يكون رقماً صحيحاً')
    }
    const id = await insert({
      shiftId: input.shift.id, direction: input.direction, category: input.category,
      currency: input.currency, amount: input.amount, note: input.note ?? null,
      voidsMovementId: null,
    })
    await logCashMovementRecorded(id, input.direction, input.category, input.currency, input.amount)
    return id
  }
```

Change to:
```ts
  async function record(input: RecordCashMovementInput): Promise<string> {
    if (input.shift.status !== 'open') {
      throw new Error('لا يمكن تسجيل حركة نقدية على وردية غير مفتوحة')
    }
    if (!(input.amount > 0)) {
      throw new Error('المبلغ يجب أن يكون أكبر من صفر')
    }
    if (input.currency === 'SYP' && !Number.isInteger(input.amount)) {
      throw new Error('مبلغ الليرة يجب أن يكون رقماً صحيحاً')
    }
    return executeFinancialWrite(
      () => insert({
        shiftId: input.shift.id, direction: input.direction, category: input.category,
        currency: input.currency, amount: input.amount, note: input.note ?? null,
        voidsMovementId: null,
      }),
      (id) => logCashMovementRecorded(id, input.direction, input.category, input.currency, input.amount),
    )
  }
```

Current `voidMovement()` (lines 78-99):
```ts
  async function voidMovement(movementId: string, reasonNote: string): Promise<string> {
    const orig = await db.getOptional<any>(
      `SELECT * FROM cash_movements WHERE id = ? AND shop_id = ?`,
      [movementId, device.shopId],
    )
    if (!orig) throw new Error('الحركة غير موجودة')
    if (orig.voids_movement_id) throw new Error('لا يمكن عكس حركة عكسية')
    const existingVoid = await db.getOptional<any>(
      `SELECT id FROM cash_movements WHERE voids_movement_id = ? AND shop_id = ?`,
      [movementId, device.shopId],
    )
    if (existingVoid) throw new Error('تم عكس هذه الحركة مسبقاً')

    const reverseDir: CashMovementDirection = orig.direction === 'in' ? 'out' : 'in'
    const id = await insert({
      shiftId: orig.shift_id, direction: reverseDir, category: orig.category,
      currency: orig.currency, amount: orig.amount, note: reasonNote ?? null,
      voidsMovementId: movementId,
    })
    await logCashMovementVoided(id, movementId, reasonNote ?? '')
    return id
  }
```

Change to:
```ts
  async function voidMovement(movementId: string, reasonNote: string): Promise<string> {
    const orig = await db.getOptional<any>(
      `SELECT * FROM cash_movements WHERE id = ? AND shop_id = ?`,
      [movementId, device.shopId],
    )
    if (!orig) throw new Error('الحركة غير موجودة')
    if (orig.voids_movement_id) throw new Error('لا يمكن عكس حركة عكسية')
    const existingVoid = await db.getOptional<any>(
      `SELECT id FROM cash_movements WHERE voids_movement_id = ? AND shop_id = ?`,
      [movementId, device.shopId],
    )
    if (existingVoid) throw new Error('تم عكس هذه الحركة مسبقاً')

    const reverseDir: CashMovementDirection = orig.direction === 'in' ? 'out' : 'in'
    return executeFinancialWrite(
      () => insert({
        shiftId: orig.shift_id, direction: reverseDir, category: orig.category,
        currency: orig.currency, amount: orig.amount, note: reasonNote ?? null,
        voidsMovementId: movementId,
      }),
      (id) => logCashMovementVoided(id, movementId, reasonNote ?? ''),
    )
  }
```

Note: the pre-write validation checks (shift status, amount checks, orig/void lookups) stay OUTSIDE `executeFinancialWrite` — they're read/validate steps, not the write itself, and throwing before `executeFinancialWrite` is called has identical behavior to throwing inside it (both reject the returned promise before any insert happens). No `requiredPermission` passed, matching the design doc.

- [ ] **Step 4: Run the existing test suite to verify no regression**

Run the same command as Step 1.
Expected: PASS, unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/features/shifts/composables/useCashMovements.ts
git commit -m "refactor(wafi-007): route cash movement record/void through executeFinancialWrite

Pure structural refactor of both record() and voidMovement() -- same
insert() calls, same logCashMovementRecorded/Voided calls. No behavior
change."
```

---

### Task 5: Retrofit `useInstallmentPlan.ts`'s three write paths

**Files:**
- Modify: `src/features/installments/composables/useInstallmentPlan.ts:43-178` (`createPlan()`, `recordDuePayment()`, `cancelPlan()`)
- Test: locate with `find src -iname "useInstallmentPlan.test.ts"` — run before and after, no new tests

**Interfaces:**
- Consumes: `executeFinancialWrite` from Task 1.
- Produces: no new exports.

- [ ] **Step 1: Run the existing test file first, for a baseline**

```bash
find src -iname "useInstallmentPlan.test.ts"
```
Run it, confirm PASS.

- [ ] **Step 2: Add the import**

At the top of `src/features/installments/composables/useInstallmentPlan.ts`, add:
```ts
import { executeFinancialWrite } from '@/composables/executeFinancialWrite'
```

- [ ] **Step 3: Wrap `createPlan()`'s write + audit call**

Current (lines 53-105) has this write-then-audit-then-return shape:
```ts
    await db.writeTransaction(async (tx) => {
      await tx.execute(
        `INSERT INTO installment_plans
           (id, shop_id, customer_id, sale_id, total_amount_usd, down_payment_usd,
            term_count, term_frequency, start_date, status, created_at, created_by, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, 'pending')`,
        [
          planId, device.shopId, input.customerId, input.saleId,
          input.totalAmountUsd, input.downPaymentUsd, input.termCount,
          input.termFrequency, input.startDate, now, createdBy,
        ],
      )

      for (const due of schedule) {
        await tx.execute(
          `INSERT INTO installment_dues
             (id, plan_id, shop_id, due_date, amount_due_usd, amount_paid_usd, status, sync_status)
           VALUES (?, ?, ?, ?, ?, 0, 'pending', 'pending')`,
          [uuidv4(), planId, device.shopId, due.dueDate, due.amountDueUsd],
        )
      }

      // Down payment posts as an immediate payment against the customer's ledger
      // balance, reusing the existing customer_payments table (Epic 4) so the
      // balance/statement/Z-report queries pick it up with no changes. due_id is
      // left null — the down payment isn't collected against any single
      // scheduled due, it's the plan's own initiation payment.
      if (input.downPaymentUsd > 0) {
        // WAFI-120: cash down payment enters the drawer → carries shift + device.
        const shiftStore = useShiftStore()
        await tx.execute(
          `INSERT INTO customer_payments
             (id, shop_id, customer_id, sale_id, due_id, amount_usd, currency, amount_raw,
              method, exchange_rate_at_payment, notes, paid_at, created_at, shift_id, device_id, sync_status)
           VALUES (?, ?, ?, ?, NULL, ?, 'USD', ?, 'cash', NULL, NULL, ?, ?, ?, ?, 'pending')`,
          [
            uuidv4(), device.shopId, input.customerId, input.saleId,
            input.downPaymentUsd, input.downPaymentUsd, today, now,
            shiftStore.activeShiftId, device.deviceId,
          ],
        )
      }
    })

    await logInstallmentPlanCreated(planId, input.customerId, input.totalAmountUsd, input.downPaymentUsd, input.termCount)

    return {
      planId, shopId: device.shopId, customerId: input.customerId, saleId: input.saleId,
      totalAmountUsd: input.totalAmountUsd, downPaymentUsd: input.downPaymentUsd,
      termCount: input.termCount, termFrequency: input.termFrequency, startDate: input.startDate,
      status: 'active', createdAt: now, createdBy,
    }
  }
```

Change to (fold the return-value construction into the `write` closure so `executeFinancialWrite` can return it directly; the transaction body itself is byte-for-byte identical to the original file):
```ts
    return executeFinancialWrite(
      async () => {
        await db.writeTransaction(async (tx) => {
          await tx.execute(
            `INSERT INTO installment_plans
               (id, shop_id, customer_id, sale_id, total_amount_usd, down_payment_usd,
                term_count, term_frequency, start_date, status, created_at, created_by, sync_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, 'pending')`,
            [
              planId, device.shopId, input.customerId, input.saleId,
              input.totalAmountUsd, input.downPaymentUsd, input.termCount,
              input.termFrequency, input.startDate, now, createdBy,
            ],
          )

          for (const due of schedule) {
            await tx.execute(
              `INSERT INTO installment_dues
                 (id, plan_id, shop_id, due_date, amount_due_usd, amount_paid_usd, status, sync_status)
               VALUES (?, ?, ?, ?, ?, 0, 'pending', 'pending')`,
              [uuidv4(), planId, device.shopId, due.dueDate, due.amountDueUsd],
            )
          }

          // Down payment posts as an immediate payment against the customer's ledger
          // balance, reusing the existing customer_payments table (Epic 4) so the
          // balance/statement/Z-report queries pick it up with no changes. due_id is
          // left null — the down payment isn't collected against any single
          // scheduled due, it's the plan's own initiation payment.
          if (input.downPaymentUsd > 0) {
            // WAFI-120: cash down payment enters the drawer → carries shift + device.
            const shiftStore = useShiftStore()
            await tx.execute(
              `INSERT INTO customer_payments
                 (id, shop_id, customer_id, sale_id, due_id, amount_usd, currency, amount_raw,
                  method, exchange_rate_at_payment, notes, paid_at, created_at, shift_id, device_id, sync_status)
               VALUES (?, ?, ?, ?, NULL, ?, 'USD', ?, 'cash', NULL, NULL, ?, ?, ?, ?, 'pending')`,
              [
                uuidv4(), device.shopId, input.customerId, input.saleId,
                input.downPaymentUsd, input.downPaymentUsd, today, now,
                shiftStore.activeShiftId, device.deviceId,
              ],
            )
          }
        })
        return {
          planId, shopId: device.shopId, customerId: input.customerId, saleId: input.saleId,
          totalAmountUsd: input.totalAmountUsd, downPaymentUsd: input.downPaymentUsd,
          termCount: input.termCount, termFrequency: input.termFrequency, startDate: input.startDate,
          status: 'active' as const, createdAt: now, createdBy,
        }
      },
      (plan) => logInstallmentPlanCreated(plan.planId, input.customerId, input.totalAmountUsd, input.downPaymentUsd, input.termCount),
    )
  }
```

- [ ] **Step 4: Wrap `recordDuePayment()`'s write + audit call**

Current (lines 132-163):
```ts
    await db.writeTransaction(async (tx) => {
      await tx.execute(
        `INSERT INTO customer_payments
           (id, shop_id, customer_id, sale_id, due_id, amount_usd, currency, amount_raw,
            method, exchange_rate_at_payment, notes, paid_at, created_at, shift_id, device_id, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, 'USD', ?, 'cash', NULL, NULL, ?, ?, ?, ?, 'pending')`,
        [uuidv4(), due.shop_id, due.customer_id, due.sale_id, dueId, amountUsd, amountUsd, today, now,
         shiftStore.activeShiftId, deviceStore.deviceId],
      )

      await tx.execute(
        `UPDATE installment_dues SET amount_paid_usd = ?, status = '${newStatus}' WHERE id = ?`,
        [newPaid, dueId],
      )

      if (newStatus === 'paid') {
        const remaining = await tx.execute(
          `SELECT COUNT(*) as count FROM installment_dues
           WHERE plan_id = ? AND id != ? AND status = 'pending'`,
          [due.plan_id, dueId],
        )
        const remainingCount = (remaining as any).rows?._array?.[0]?.count ?? 0
        if (remainingCount === 0) {
          await tx.execute(
            `UPDATE installment_plans SET status = 'completed' WHERE id = ?`,
            [due.plan_id],
          )
        }
      }
    })

    await logInstallmentPaymentRecorded(dueId, due.plan_id, amountUsd)
  }
```

Change to (transaction body byte-for-byte identical to the original file):
```ts
    await executeFinancialWrite(
      async () => {
        await db.writeTransaction(async (tx) => {
          await tx.execute(
            `INSERT INTO customer_payments
               (id, shop_id, customer_id, sale_id, due_id, amount_usd, currency, amount_raw,
                method, exchange_rate_at_payment, notes, paid_at, created_at, shift_id, device_id, sync_status)
             VALUES (?, ?, ?, ?, ?, ?, 'USD', ?, 'cash', NULL, NULL, ?, ?, ?, ?, 'pending')`,
            [uuidv4(), due.shop_id, due.customer_id, due.sale_id, dueId, amountUsd, amountUsd, today, now,
             shiftStore.activeShiftId, deviceStore.deviceId],
          )

          await tx.execute(
            `UPDATE installment_dues SET amount_paid_usd = ?, status = '${newStatus}' WHERE id = ?`,
            [newPaid, dueId],
          )

          if (newStatus === 'paid') {
            const remaining = await tx.execute(
              `SELECT COUNT(*) as count FROM installment_dues
               WHERE plan_id = ? AND id != ? AND status = 'pending'`,
              [due.plan_id, dueId],
            )
            const remainingCount = (remaining as any).rows?._array?.[0]?.count ?? 0
            if (remainingCount === 0) {
              await tx.execute(
                `UPDATE installment_plans SET status = 'completed' WHERE id = ?`,
                [due.plan_id],
              )
            }
          }
        })
      },
      () => logInstallmentPaymentRecorded(dueId, due.plan_id, amountUsd),
    )
  }
```

- [ ] **Step 5: Wrap `cancelPlan()`'s write + audit call**

Current (lines 166-178):
```ts
  async function cancelPlan(planId: string): Promise<void> {
    await db.writeTransaction(async (tx) => {
      await tx.execute(
        `UPDATE installment_dues SET status = 'voided' WHERE plan_id = ? AND status = 'pending'`,
        [planId],
      )
      await tx.execute(
        `UPDATE installment_plans SET status = 'cancelled' WHERE id = ?`,
        [planId],
      )
    })
    await logInstallmentPlanCancelled(planId)
  }
```

Change to:
```ts
  async function cancelPlan(planId: string): Promise<void> {
    await executeFinancialWrite(
      async () => {
        await db.writeTransaction(async (tx) => {
          await tx.execute(
            `UPDATE installment_dues SET status = 'voided' WHERE plan_id = ? AND status = 'pending'`,
            [planId],
          )
          await tx.execute(
            `UPDATE installment_plans SET status = 'cancelled' WHERE id = ?`,
            [planId],
          )
        })
      },
      () => logInstallmentPlanCancelled(planId),
    )
  }
```

No `requiredPermission` passed in any of the three, matching the design doc's rationale.

- [ ] **Step 6: Run the existing test suite to verify no regression**

Run the same command as Step 1.
Expected: PASS, unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/features/installments/composables/useInstallmentPlan.ts
git commit -m "refactor(wafi-007): route installment plan writes through executeFinancialWrite

Pure structural refactor of createPlan(), recordDuePayment(), and
cancelPlan() -- same writeTransaction contents, same log*() calls. No
behavior change."
```

---

### Task 6: Backfill `AuditLogPage.vue`'s event filter dropdown

**Files:**
- Modify: `src/features/audit/AuditLogPage.vue:46-77` (the `eventOptions` array)
- Test: locate with `find src -iname "AuditLogPage.test.ts"` — if one exists, extend it; if not, create `src/features/audit/__tests__/AuditLogPage.test.ts` per Step 2 below.

**Interfaces:**
- Consumes: `AuditEvent` type from `@/features/audit/audit.types` (the full 48-member union — already imported by this file).
- Produces: nothing new — this is additive to an existing local array literal.

- [ ] **Step 1: Write the failing test**

First check whether a test file already exists:
```bash
find src -iname "AuditLogPage.test.ts"
```

If it exists, add this test case to it (adjusting the `describe` block name to match the file's existing style). If it doesn't exist, create `src/features/audit/__tests__/AuditLogPage.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { AuditEvent } from '@/features/audit/audit.types'

// The full set of event types useAuditLog.ts can produce (audit.types.ts's
// AuditEvent union) -- copied here as a literal list so this test doesn't
// depend on TypeScript type-level reflection (not available at runtime).
// If this list and audit.types.ts's union ever diverge, update BOTH.
const ALL_AUDIT_EVENTS: AuditEvent[] = [
  'sale.completed', 'sale.deleted', 'return.processed',
  'product.created', 'product.updated', 'product.deleted', 'product.price_changed',
  'expense.created', 'expense.updated', 'expense.deleted',
  'customer.created', 'customer.updated', 'customer.deleted', 'customer.payment_recorded',
  'stock.adjusted', 'shift.opened', 'shift.closed', 'shift.force_closed',
  'exchange_rate.changed', 'settings.receipt_updated',
  'staff.created', 'staff.updated', 'staff.deactivated', 'staff.permissions_changed',
  'staff.pin_changed', 'staff.recovery_codes_generated', 'staff.recovery_code_used',
  'auth.login_failed', 'auth.locked_out',
  'supplier.created', 'supplier.updated', 'receiving.created',
  'operator.switched', 'cash_movement.recorded', 'cash_movement.voided',
  'stock_take.completed',
  'installment_plan.created', 'installment_payment.recorded', 'installment_plan.cancelled',
  'sync.dead_letter_discarded',
  'category.merged', 'category.deleted_with_reassign',
  'device.renamed', 'device.deactivated', 'device.reactivated',
  'staff_ledger.entry_created', 'staff_settlement.finalized', 'staff_settlement.paid',
]

describe('AuditLogPage event filter coverage', () => {
  it('lists every AuditEvent type as a filter option', async () => {
    // Import the module and reach into its script setup isn't possible for a
    // plain array constant without mounting the component; instead, read the
    // component's source and extract the eventOptions array's event values via
    // a lightweight regex -- avoids needing a full component mount just to
    // check a static list.
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = fs.readFileSync(
      path.resolve(__dirname, '../AuditLogPage.vue'),
      'utf-8',
    )
    const matches = [...src.matchAll(/value:\s*'([a-z_.]+)'/g)].map(m => m[1])

    const missing = ALL_AUDIT_EVENTS.filter(e => !matches.includes(e))
    expect(missing).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/audit/__tests__/AuditLogPage.test.ts`
Expected: FAIL — `missing` is non-empty (20 event types not yet in `eventOptions`).

- [ ] **Step 3: Implement — append the missing options**

In `src/features/audit/AuditLogPage.vue`, the current `eventOptions` array (lines 46-77) ends with:

```ts
  { value: 'receiving.created', label: 'تسجيل استلام بضاعة' },
]
```

Change the closing to add these 20 entries before the closing `]` (order doesn't matter functionally; grouping them roughly by domain for readability):

```ts
  { value: 'receiving.created', label: 'تسجيل استلام بضاعة' },
  { value: 'staff.updated', label: 'تعديل بيانات موظف' },
  { value: 'staff.pin_changed', label: 'تغيير رمز PIN' },
  { value: 'staff.recovery_codes_generated', label: 'توليد رموز استعادة' },
  { value: 'staff.recovery_code_used', label: 'استخدام رمز استعادة' },
  { value: 'auth.login_failed', label: 'فشل تسجيل الدخول' },
  { value: 'auth.locked_out', label: 'تجميد الحساب مؤقتاً' },
  { value: 'operator.switched', label: 'تبديل المشغّل' },
  { value: 'stock_take.completed', label: 'إتمام جرد المخزون' },
  { value: 'installment_plan.created', label: 'إنشاء خطة تقسيط' },
  { value: 'installment_payment.recorded', label: 'تسجيل دفعة تقسيط' },
  { value: 'installment_plan.cancelled', label: 'إلغاء خطة تقسيط' },
  { value: 'sync.dead_letter_discarded', label: 'إهمال عملية مزامنة فاشلة' },
  { value: 'category.merged', label: 'دمج تصنيف' },
  { value: 'category.deleted_with_reassign', label: 'حذف تصنيف مع إعادة تصنيف' },
  { value: 'device.renamed', label: 'إعادة تسمية جهاز' },
  { value: 'device.deactivated', label: 'تعطيل جهاز' },
  { value: 'device.reactivated', label: 'إعادة تفعيل جهاز' },
  { value: 'staff_ledger.entry_created', label: 'إضافة قيد لسجل الموظف' },
  { value: 'staff_settlement.finalized', label: 'إغلاق تسوية موظف' },
  { value: 'staff_settlement.paid', label: 'دفع تسوية موظف' },
]
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/audit/__tests__/AuditLogPage.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full test suite once**

Run: `npm test`
Expected: PASS (adds 1 new test file over the prior count — the pre-existing flaky `router-auth-guard.test.ts` timeout, if it recurs, is unrelated and already documented in this project's prior WAFI-00x work).

- [ ] **Step 6: Commit**

```bash
git add src/features/audit/AuditLogPage.vue src/features/audit/__tests__/AuditLogPage.test.ts
git commit -m "feat(wafi-007): backfill AuditLogPage filter dropdown with missing event types

eventOptions only listed 28 of 48 AuditEvent types -- newer events
(installment/device/staff_ledger/staff_settlement/category/auth/operator/
stock_take/sync) were logged and stored correctly but unfilterable in the
viewer. Adds a regression test asserting the dropdown covers every
AuditEvent type so this can't silently drift again."
```

---

### Task 7: Final verification pass

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS. Test file count should be prior-count + 1 (Task 6's new `AuditLogPage.test.ts`, assuming it didn't already exist) or unchanged (if Task 6 extended an existing file instead).

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: exit 0, no TypeScript errors referencing `executeFinancialWrite.ts`, `usePayment.ts`, `useReturnSheet.ts`, `useCashMovements.ts`, `useInstallmentPlan.ts`, `useStaffLedger.ts`, `useStaffSettlement.ts`, or `AuditLogPage.vue`.

- [ ] **Step 3: Confirm the old file path is fully gone**

Run: `grep -rn "features/staff-ledger/composables/executeFinancialWrite" src/`
Expected: no output — every import now points at `@/composables/executeFinancialWrite`.

- [ ] **Step 4: Confirm all 6 financial-write composables now import the shared helper**

Run: `grep -rl "from '@/composables/executeFinancialWrite'" src/features/`
Expected: 6 files — `usePayment.ts`, `useReturnSheet.ts`, `useCashMovements.ts`, `useInstallmentPlan.ts`, `useStaffLedger.ts`, `useStaffSettlement.ts`.

- [ ] **Step 5: No commit needed** — this task is verification only; if any check fails, return to the relevant earlier task and fix it there.
