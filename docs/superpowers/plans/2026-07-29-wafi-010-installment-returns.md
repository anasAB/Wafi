# WAFI-010: Installment Plans + Returns Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a return fully exhausts every line item of a sale that has an active installment plan, automatically cancel that plan (voiding its pending dues) and audit-log both events together; for every other case where an outstanding plan exists on the sale, leave the plan untouched and surface a manual-review warning instead of silently ignoring it.

**Architecture:** All logic lives inside `useReturnSheet.confirm()`'s existing `db.writeTransaction` — no new tables, no new composables. A small helper (`cancelPlanWithinTx`) is extracted from `useInstallmentPlan.cancelPlan()` so both the manual-cancel path and the return path share identical cancellation SQL. `confirm()`'s return type changes from `Promise<void>` to `Promise<ConfirmResult>` so the caller (`ReturnSheet.vue`) can react to an unadjusted-plan warning without the return being blocked.

**Tech Stack:** Vue 3 + TypeScript, PowerSync (`@powersync/web`) for the local SQLite layer, Vitest for tests.

## Global Constraints

- Paid `installment_dues` rows are never mutated by this ticket — only `status = 'pending'` dues are voided (spec §4, §7).
- `installment_plans.status = 'defaulted'` is **never** auto-cancelled by a return, at the SQL-guard level, not just by caller discipline (spec §4).
- Any plan status other than `active`/`completed`/`cancelled` (including any future status) must fall into the manual-review warning branch by default — never into the silent no-op branch (spec §3 normative rule).
- Use `UPDATE ... RETURNING id` + inspect `rows._array.length`, not `rowsAffected`, to detect whether a conditional `UPDATE` actually changed a row — `@powersync/common`'s `QueryResult.rowsAffected` is documented as unreliable for this (spec §4).
- The full-sale-return check must be recomputed from a fresh in-transaction database read every time `confirm()` runs — never from the `lines.value` snapshot taken when the sheet was opened (spec §1, §8).
- Scope is Phase 1 only: full-sale returns and the decision table in spec §3. Partial-return proration (Phase 2) is explicitly out of scope — do not implement it.

---

### Task 1: `logInstallmentPlanCancelled` accepts an optional reason

**Files:**
- Modify: `src/features/audit/composables/useAuditLog.ts:486-487`
- Test: `src/__tests__/features/useAuditLog.test.ts` (existing test at line 261 must still pass unchanged)

**Interfaces:**
- Produces: `logInstallmentPlanCancelled(planId: string, opts?: { reason?: 'manual' | 'sale_returned'; returnId?: string }): Promise<void>` — used by Task 2 (unchanged call site) and Task 4 (new call site passing `opts`).

- [ ] **Step 1: Write the failing test**

Add to `src/__tests__/features/useAuditLog.test.ts`, right after the existing `logInstallmentPlanCancelled` test (after line 268's closing `})`, still inside the same outer `describe` block):

```ts
  it('logInstallmentPlanCancelled records reason and returnId in meta when provided', async () => {
    const { logInstallmentPlanCancelled } = useAuditLog()
    await logInstallmentPlanCancelled('plan-1', { reason: 'sale_returned', returnId: 'return-1' })
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.arrayContaining([
        'installment_plan.cancelled', 'installment_plan', 'plan-1',
        JSON.stringify({ reason: 'sale_returned', returnId: 'return-1' }),
      ]),
    )
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/useAuditLog.test.ts -t "records reason and returnId"`
Expected: FAIL — `logInstallmentPlanCancelled` currently takes only `planId` and always logs `meta: {}`, so the `JSON.stringify({...})` argument won't match.

- [ ] **Step 3: Update `logInstallmentPlanCancelled`**

In `src/features/audit/composables/useAuditLog.ts`, replace lines 486-487:

```ts
  const logInstallmentPlanCancelled = (planId: string) =>
    _log('installment_plan.cancelled', 'installment_plan', planId, {})
```

with:

```ts
  const logInstallmentPlanCancelled = (
    planId: string, opts: { reason?: 'manual' | 'sale_returned'; returnId?: string } = {},
  ) => _log('installment_plan.cancelled', 'installment_plan', planId, opts)
```

- [ ] **Step 4: Run both tests to verify they pass**

Run: `npx vitest run src/__tests__/features/useAuditLog.test.ts -t "InstallmentPlanCancelled"`
Expected: PASS (both the pre-existing no-args test and the new reason/returnId test)

- [ ] **Step 5: Commit**

```bash
git add src/features/audit/composables/useAuditLog.ts src/__tests__/features/useAuditLog.test.ts
git commit -m "feat(WAFI-010): logInstallmentPlanCancelled accepts an optional reason/returnId"
```

---

### Task 2: Extract and harden `cancelPlanWithinTx`

**Files:**
- Modify: `src/features/installments/composables/useInstallmentPlan.ts:172-188`
- Test: `src/__tests__/features/useInstallmentPlan.test.ts:160-190` (existing `cancelPlan` tests — must be updated, see Step 1)

**Interfaces:**
- Consumes: `logInstallmentPlanCancelled(planId, opts)` from Task 1.
- Produces: `cancelPlanWithinTx(tx, planId: string): Promise<boolean>` (exported from `useInstallmentPlan.ts`, module-level function — not part of the composable's returned object) — used by Task 4.

**Why this task exists:** `cancelPlan()`'s current implementation has two problems the spec requires fixed: (1) it has no guard against cancelling an already-terminal or `defaulted` plan, so calling it twice or from an unexpected caller silently double-processes; (2) once Task 4 needs to share this exact cancellation SQL from inside `useReturnSheet`'s own transaction, the logic must exist as a plain function taking a `tx`, not trapped inside `cancelPlan`'s own `db.writeTransaction` call.

- [ ] **Step 1: Update the existing `cancelPlan` tests for the new `RETURNING id` mock shape**

The existing mocks in `src/__tests__/features/useInstallmentPlan.test.ts` return `{ rows: { _array: [] } }` for every `tx.execute` call, including what will become the `UPDATE ... RETURNING id` call. Since the new implementation checks `rows._array.length > 0` to decide whether to audit-log, an empty array would wrongly signal "did not cancel." Replace the `describe('useInstallmentPlan.cancelPlan', ...)` block (lines 160-190) with:

```ts
describe('useInstallmentPlan.cancelPlan', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  function mockTxExecute() {
    return vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('UPDATE installment_plans') && sql.includes('RETURNING id')) {
        return { rows: { _array: [{ id: 'plan-1' }] } }
      }
      return { rows: { _array: [] } }
    })
  }

  it('voids every still-pending due and cancels the plan', async () => {
    const txExecute = mockTxExecute()
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => { await fn({ execute: txExecute }) })

    const { cancelPlan } = useInstallmentPlan()
    await cancelPlan('plan-1')

    const calls = txExecute.mock.calls.map((c: any[]) => c[0] as string)
    expect(calls.some(sql => sql.includes('UPDATE installment_dues') && sql.includes(`'voided'`))).toBe(true)
    expect(calls.some(sql => sql.includes('UPDATE installment_plans') && sql.includes(`'cancelled'`))).toBe(true)
  })

  it('writes an installment_plan.cancelled audit row with reason "manual" by default', async () => {
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => { await fn({ execute: mockTxExecute() }) })
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)

    const { cancelPlan } = useInstallmentPlan()
    await cancelPlan('plan-1')

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.arrayContaining(['installment_plan.cancelled', 'installment_plan', 'plan-1', JSON.stringify({ reason: 'manual' })]),
    )
  })

  it('does not cancel dues or audit-log when the plan is not active (e.g. already cancelled/defaulted)', async () => {
    // The plan UPDATE's WHERE clause matches zero rows -> RETURNING yields no rows.
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => { await fn({ execute: txExecute }) })
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)

    const { cancelPlan } = useInstallmentPlan()
    await cancelPlan('plan-1')

    expect(db.execute).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.anything(),
    )
  })
})
```

- [ ] **Step 2: Run tests to verify the new/changed ones fail**

Run: `npx vitest run src/__tests__/features/useInstallmentPlan.test.ts -t "cancelPlan"`
Expected: FAIL — `cancelPlan` doesn't yet use `RETURNING id`, doesn't pass `reason`, and always audit-logs regardless of whether anything was cancelled.

- [ ] **Step 3: Implement `cancelPlanWithinTx` and rewrite `cancelPlan`**

In `src/features/installments/composables/useInstallmentPlan.ts`, replace lines 172-188:

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

with:

```ts
  async function cancelPlan(planId: string): Promise<void> {
    await executeFinancialWrite(
      async () => {
        let cancelled = false
        await db.writeTransaction(async (tx) => {
          cancelled = await cancelPlanWithinTx(tx, planId)
        })
        return cancelled
      },
      (cancelled) => cancelled
        ? logInstallmentPlanCancelled(planId, { reason: 'manual' })
        : Promise.resolve(),
    )
  }
```

Then, above `export function useInstallmentPlan()` (i.e. as a standalone module-level export, not inside the composable), add:

```ts
/**
 * Voids every still-pending due on the plan and marks the plan cancelled, but
 * ONLY if the plan is currently 'active' — a `defaulted` plan is never
 * auto-cancelled by this helper, regardless of caller (WAFI-010). Returns
 * whether a cancellation actually happened, so callers know whether to
 * audit-log. Uses RETURNING + rows._array.length rather than rowsAffected,
 * since PowerSync's rowsAffected is documented as unreliable for conditional
 * UPDATEs under its client-side JSON-view storage layer.
 */
export async function cancelPlanWithinTx(tx: any, planId: string): Promise<boolean> {
  await tx.execute(
    `UPDATE installment_dues SET status = 'voided' WHERE plan_id = ? AND status = 'pending'`,
    [planId],
  )
  const planResult = await tx.execute(
    `UPDATE installment_plans SET status = 'cancelled' WHERE id = ? AND status = 'active' RETURNING id`,
    [planId],
  )
  return (planResult.rows?._array?.length ?? 0) > 0
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/features/useInstallmentPlan.test.ts -t "cancelPlan"`
Expected: PASS (all three tests)

- [ ] **Step 5: Run the full installment test file to check for regressions**

Run: `npx vitest run src/__tests__/features/useInstallmentPlan.test.ts`
Expected: PASS (all describe blocks, including `createPlan`/`recordDuePayment`/`loadActivePlanForCustomer` unaffected by this change)

- [ ] **Step 6: Commit**

```bash
git add src/features/installments/composables/useInstallmentPlan.ts src/__tests__/features/useInstallmentPlan.test.ts
git commit -m "feat(WAFI-010): extract cancelPlanWithinTx, guard against non-active plans"
```

---

### Task 3: Add the `ConfirmResult` warning type

**Files:**
- Modify: `src/features/returns/returns.types.ts`

**Interfaces:**
- Produces: `ConfirmResult` type — used by Task 4 (`confirm()`'s return type) and Task 6 (`ReturnSheet.vue`'s handling).

**Note:** No test for this task — it's a pure type addition with no runtime behavior of its own; it's exercised by Task 4/6's tests.

- [ ] **Step 1: Add the type**

In `src/features/returns/returns.types.ts`, add at the end of the file:

```ts
/**
 * WAFI-010: confirm() no longer just succeeds or throws — when the sale being
 * returned has an installment plan that this return did NOT adjust (a partial
 * return, a defaulted plan, or any future plan status other than active-full),
 * confirm() still succeeds (the refund itself is never blocked) but reports
 * that the plan needs manual review.
 */
export interface ConfirmResult {
  warning?: {
    type: 'plan_requires_manual_review'
    planStatus: string
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/returns/returns.types.ts
git commit -m "feat(WAFI-010): add ConfirmResult type for return-time plan warnings"
```

---

### Task 4: Full-sale-return detection + plan decision table in `useReturnSheet.confirm()`

**Files:**
- Modify: `src/features/returns/composables/useReturnSheet.ts:1-10` (imports), `:132-215` (`confirm()`)
- Test: `src/features/returns/composables/__tests__/useReturnSheet.test.ts`

**Interfaces:**
- Consumes: `cancelPlanWithinTx(tx, planId)` from Task 2, `logInstallmentPlanCancelled(planId, opts)` from Task 1, `ConfirmResult` from Task 3.
- Produces: `confirm(): Promise<ConfirmResult>` (was `Promise<void>`) — used by Task 6.

This is the core task. Read it in full before starting — it changes `confirm()`'s return type, which Task 6 depends on.

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block at the end of `src/features/returns/composables/__tests__/useReturnSheet.test.ts` (after the existing WAFI-011 block's closing `})`):

```ts
describe('useReturnSheet — WAFI-010 installment plan integration', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  /**
   * `db.execute` mock covers: sale header lookup, exchange rate lookup, and
   * (new) the in-transaction plan lookup — but the plan lookup in confirm()
   * runs via `tx.execute`, not `db.execute`, so it's configured through
   * `txExecuteImpl` instead. `db.getAll` covers sale_line_items /
   * return_line_items reads used by `load()`.
   */
  function mockLoad(lineRows: any[], alreadyReturnedRows: any[] = []) {
    vi.mocked(db.execute).mockImplementation(async (sql: unknown) => {
      const s = sql as string
      if (s.includes('FROM sales s')) {
        return { rows: { _array: [{ id: 'sale-1', display_sale_number: '1', customer_id: null, customer_name: null, sale_discount_amount_usd: 0 }] } } as any
      }
      if (s.includes('FROM exchange_rates')) return { rows: { _array: [{ rate: 1 }] } } as any
      return { rows: { _array: [] } } as any
    })
    vi.mocked(db.getAll).mockImplementation(async (sql: unknown) => {
      const s = sql as string
      if (s.includes('FROM sale_line_items')) return lineRows as any
      if (s.includes('FROM return_line_items')) return alreadyReturnedRows as any
      return [] as any
    })
  }

  /**
   * Builds the `tx.execute` mock used inside confirm()'s transaction. `plan`
   * is the row returned by the plan lookup (or undefined for "no plan").
   * `saleLineRows`/`returnedRows` back the in-transaction full-sale-return
   * recomputation (independent of mockLoad's sheet-open-time snapshot).
   */
  function mockTx(opts: {
    plan?: { id: string; status: string }
    saleLineRows: { product_id: string; quantity: number }[]
    returnedRows: { product_id: string; returned_qty: number }[]
    planCancelSucceeds?: boolean
  }) {
    return vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('FROM sale_line_items') && sql.includes('WHERE sale_id')) {
        return { rows: { _array: opts.saleLineRows } }
      }
      if (sql.includes('FROM return_line_items') && sql.includes('JOIN returns')) {
        return { rows: { _array: opts.returnedRows } }
      }
      if (sql.includes('FROM installment_plans') && sql.includes('WHERE sale_id')) {
        return { rows: { _array: opts.plan ? [opts.plan] : [] } }
      }
      if (sql.includes('UPDATE installment_plans') && sql.includes('RETURNING id')) {
        return { rows: { _array: (opts.planCancelSucceeds ?? true) ? [{ id: opts.plan?.id }] : [] } }
      }
      return { rows: { _array: [] } }
    })
  }

  it('cancels an active plan and logs both audit events when the return exhausts the whole sale', async () => {
    mockLoad([{ product_id: 'p1', product_name: 'قلم', quantity: 1, unit_price_usd: 10 }])
    const txExecute = mockTx({
      plan: { id: 'plan-1', status: 'active' },
      saleLineRows: [{ product_id: 'p1', quantity: 1 }],
      returnedRows: [{ product_id: 'p1', returned_qty: 1 }], // this return covers the only unit
    })
    vi.mocked(db.writeTransaction).mockImplementation(async (fn: any) => { await fn({ execute: txExecute }) })

    const sheet = useReturnSheet('sale-1')
    await sheet.load()
    sheet.lines.value[0].selected = true
    sheet.refundMethod.value = 'cash_usd'

    const result = await sheet.confirm()

    expect(result.warning).toBeUndefined()
    const calls = txExecute.mock.calls.map((c: any[]) => c[0] as string)
    expect(calls.some(sql => sql.includes('UPDATE installment_dues') && sql.includes(`'voided'`))).toBe(true)
    expect(calls.some(sql => sql.includes('UPDATE installment_plans') && sql.includes(`'cancelled'`))).toBe(true)
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.arrayContaining(['return.processed', 'return']),
    )
    // returnId is a freshly-generated uuid inside confirm(), so match the meta
    // JSON loosely (nested asymmetric matcher inside arrayContaining) rather
    // than asserting its exact string form.
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.arrayContaining([
        'installment_plan.cancelled', 'installment_plan', 'plan-1',
        expect.stringContaining('"reason":"sale_returned"'),
      ]),
    )
  })

  it('leaves a completed/cancelled plan (or no plan) untouched, no warning', async () => {
    mockLoad([{ product_id: 'p1', product_name: 'قلم', quantity: 1, unit_price_usd: 10 }])
    const txExecute = mockTx({
      plan: undefined,
      saleLineRows: [{ product_id: 'p1', quantity: 1 }],
      returnedRows: [{ product_id: 'p1', returned_qty: 1 }],
    })
    vi.mocked(db.writeTransaction).mockImplementation(async (fn: any) => { await fn({ execute: txExecute }) })

    const sheet = useReturnSheet('sale-1')
    await sheet.load()
    sheet.lines.value[0].selected = true
    sheet.refundMethod.value = 'cash_usd'

    const result = await sheet.confirm()
    expect(result.warning).toBeUndefined()
    const calls = txExecute.mock.calls.map((c: any[]) => c[0] as string)
    expect(calls.some(sql => sql.includes('UPDATE installment_plans'))).toBe(false)
  })

  it('warns without mutating an active plan on a partial return', async () => {
    mockLoad([{ product_id: 'p1', product_name: 'قلم', quantity: 2, unit_price_usd: 10 }])
    const txExecute = mockTx({
      plan: { id: 'plan-1', status: 'active' },
      saleLineRows: [{ product_id: 'p1', quantity: 2 }],
      returnedRows: [{ product_id: 'p1', returned_qty: 1 }], // 1 of 2 returned -> not full
    })
    vi.mocked(db.writeTransaction).mockImplementation(async (fn: any) => { await fn({ execute: txExecute }) })

    const sheet = useReturnSheet('sale-1')
    await sheet.load()
    sheet.lines.value[0].selected = true
    sheet.lines.value[0].qtyToReturn = 1
    sheet.refundMethod.value = 'cash_usd'

    const result = await sheet.confirm()
    expect(result.warning).toEqual({ type: 'plan_requires_manual_review', planStatus: 'active' })
    const calls = txExecute.mock.calls.map((c: any[]) => c[0] as string)
    expect(calls.some(sql => sql.includes('UPDATE installment_plans'))).toBe(false)
  })

  it('warns without mutating a defaulted plan even on a full-sale return', async () => {
    mockLoad([{ product_id: 'p1', product_name: 'قلم', quantity: 1, unit_price_usd: 10 }])
    const txExecute = mockTx({
      plan: { id: 'plan-1', status: 'defaulted' },
      saleLineRows: [{ product_id: 'p1', quantity: 1 }],
      returnedRows: [{ product_id: 'p1', returned_qty: 1 }],
    })
    vi.mocked(db.writeTransaction).mockImplementation(async (fn: any) => { await fn({ execute: txExecute }) })

    const sheet = useReturnSheet('sale-1')
    await sheet.load()
    sheet.lines.value[0].selected = true
    sheet.refundMethod.value = 'cash_usd'

    const result = await sheet.confirm()
    expect(result.warning).toEqual({ type: 'plan_requires_manual_review', planStatus: 'defaulted' })
    const calls = txExecute.mock.calls.map((c: any[]) => c[0] as string)
    expect(calls.some(sql => sql.includes('UPDATE installment_plans'))).toBe(false)
  })

  it('warns (does not silently no-op) for an unrecognized future plan status', async () => {
    mockLoad([{ product_id: 'p1', product_name: 'قلم', quantity: 1, unit_price_usd: 10 }])
    const txExecute = mockTx({
      plan: { id: 'plan-1', status: 'paused' },
      saleLineRows: [{ product_id: 'p1', quantity: 1 }],
      returnedRows: [{ product_id: 'p1', returned_qty: 1 }],
    })
    vi.mocked(db.writeTransaction).mockImplementation(async (fn: any) => { await fn({ execute: txExecute }) })

    const sheet = useReturnSheet('sale-1')
    await sheet.load()
    sheet.lines.value[0].selected = true
    sheet.refundMethod.value = 'cash_usd'

    const result = await sheet.confirm()
    expect(result.warning).toEqual({ type: 'plan_requires_manual_review', planStatus: 'paused' })
  })

  it('detects a cumulative full-sale return across two sequential return transactions', async () => {
    // Sale has two products, A and B. This confirm() call returns only B, but a
    // PRIOR return (already committed, reflected in returnedRows) already covered
    // A. lines.value only knows about A/B from sheet-load time -- the in-transaction
    // re-read is what must catch that the sale is now fully returned.
    mockLoad(
      [{ product_id: 'a', product_name: 'A', quantity: 1, unit_price_usd: 5 },
       { product_id: 'b', product_name: 'B', quantity: 1, unit_price_usd: 5 }],
      [{ product_id: 'a', already_returned: 1 }], // A already fully returned before this sheet's confirm()
    )
    const txExecute = mockTx({
      plan: { id: 'plan-1', status: 'active' },
      saleLineRows: [
        { product_id: 'a', quantity: 1 },
        { product_id: 'b', quantity: 1 },
      ],
      // Reflects BOTH the prior return of A and this return's insert of B.
      returnedRows: [
        { product_id: 'a', returned_qty: 1 },
        { product_id: 'b', returned_qty: 1 },
      ],
    })
    vi.mocked(db.writeTransaction).mockImplementation(async (fn: any) => { await fn({ execute: txExecute }) })

    const sheet = useReturnSheet('sale-1')
    await sheet.load()
    // Only B is selectable/selected -- A was filtered out of lines.value by load()
    // because it's already fully returned (existing behavior, unchanged).
    expect(sheet.lines.value.find(l => l.productId === 'a')).toBeUndefined()
    sheet.lines.value.find(l => l.productId === 'b')!.selected = true
    sheet.refundMethod.value = 'cash_usd'

    const result = await sheet.confirm()

    expect(result.warning).toBeUndefined()
    const calls = txExecute.mock.calls.map((c: any[]) => c[0] as string)
    expect(calls.some(sql => sql.includes('UPDATE installment_plans') && sql.includes(`'cancelled'`))).toBe(true)
  })

  it('does not re-cancel or re-audit-log a plan that a concurrent transaction already cancelled', async () => {
    mockLoad([{ product_id: 'p1', product_name: 'قلم', quantity: 1, unit_price_usd: 10 }])
    const txExecute = mockTx({
      plan: { id: 'plan-1', status: 'active' }, // lookup still sees 'active' snapshot pre-race
      saleLineRows: [{ product_id: 'p1', quantity: 1 }],
      returnedRows: [{ product_id: 'p1', returned_qty: 1 }],
      planCancelSucceeds: false, // but the guarded UPDATE matches zero rows (already cancelled)
    })
    vi.mocked(db.writeTransaction).mockImplementation(async (fn: any) => { await fn({ execute: txExecute }) })
    vi.mocked(db.execute).mockImplementation(async (sql: unknown) => {
      const s = sql as string
      if (s.includes('FROM sales s')) return { rows: { _array: [{ id: 'sale-1', display_sale_number: '1', customer_id: null, customer_name: null, sale_discount_amount_usd: 0 }] } } as any
      if (s.includes('FROM exchange_rates')) return { rows: { _array: [{ rate: 1 }] } } as any
      return { rows: { _array: [] } } as any
    })

    const sheet = useReturnSheet('sale-1')
    await sheet.load()
    sheet.lines.value[0].selected = true
    sheet.refundMethod.value = 'cash_usd'
    await sheet.confirm()

    expect(db.execute).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.arrayContaining(['installment_plan.cancelled']),
    )
  })

  it('propagates a mid-transaction failure without logging any audit event (atomicity)', async () => {
    mockLoad([{ product_id: 'p1', product_name: 'قلم', quantity: 1, unit_price_usd: 10 }])
    const txExecute = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO return_line_items')) throw new Error('simulated failure')
      return { rows: { _array: [] } }
    })
    vi.mocked(db.writeTransaction).mockImplementation(async (fn: any) => { await fn({ execute: txExecute }) })

    const sheet = useReturnSheet('sale-1')
    await sheet.load()
    sheet.lines.value[0].selected = true
    sheet.refundMethod.value = 'cash_usd'

    await expect(sheet.confirm()).rejects.toThrow('simulated failure')
    expect(db.execute).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.anything(),
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/returns/composables/__tests__/useReturnSheet.test.ts -t "WAFI-010"`
Expected: FAIL — `confirm()` doesn't yet look up plans, compute `isFullSaleReturn` in-transaction, or return `{ warning }`.

- [ ] **Step 3: Update imports in `useReturnSheet.ts`**

In `src/features/returns/composables/useReturnSheet.ts`, change the top of the file (lines 1-9) from:

```ts
import { ref, computed } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { useShiftStore } from '@/features/shifts/shift.store'
import { v4 as uuidv4 } from 'uuid'
import type { ReturnLine, RefundMethod } from '../returns.types'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'
import { executeFinancialWrite } from '@/composables/executeFinancialWrite'
```

to:

```ts
import { ref, computed } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { useShiftStore } from '@/features/shifts/shift.store'
import { v4 as uuidv4 } from 'uuid'
import type { ReturnLine, RefundMethod, ConfirmResult } from '../returns.types'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'
import { executeFinancialWrite } from '@/composables/executeFinancialWrite'
import { cancelPlanWithinTx } from '@/features/installments/composables/useInstallmentPlan'
```

- [ ] **Step 4: Rewrite `confirm()`**

Replace the entire `confirm()` function (lines 132-215) with:

```ts
  async function confirm(): Promise<ConfirmResult> {
    if (!refundMethod.value || !lines.value.some(l => l.selected)) {
      throw new Error('confirm() called without valid state')
    }

    const { shopId, deviceId } = useDeviceStore()
    const shiftStore = useShiftStore()

    // Get current exchange rate (outside transaction — read-only lookup)
    const rateResult = await db.execute(
      `SELECT rate FROM exchange_rates WHERE shop_id = ? ORDER BY set_at DESC LIMIT 1`,
      [shopId],
    )
    const exchangeRate: number = (rateResult as any).rows._array[0]?.rate ?? 1

    const selectedLines = lines.value.filter(l => l.selected)

    // Data-layer guard: never refund/restock more than what is still returnable.
    // The UI clamps too, but the write path must not depend on the UI being correct.
    for (const line of selectedLines) {
      const remaining = line.originalQty - line.alreadyReturnedQty
      if (line.qtyToReturn < 1 || line.qtyToReturn > remaining) {
        throw new Error(
          `Cannot return more than remaining for ${line.productName}: ` +
          `requested ${line.qtyToReturn}, remaining ${remaining}`,
        )
      }
    }

    const refundAmountUsd = selectedLines.reduce((sum, l) => sum + l.qtyToReturn * netUnitRefund(l), 0)
    const refundAmountSyp = Math.round(refundAmountUsd * exchangeRate)

    const returnId  = uuidv4()
    const now       = new Date().toISOString()

    const { cancelledPlanId, warning } = await executeFinancialWrite(
      async () => {
        let cancelledPlanId: string | null = null
        let warning: ConfirmResult['warning']

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

          // WAFI-010: recompute whether this return, taken together with every return
          // already committed for this sale (INCLUDING the one just inserted above),
          // exhausts every original line item. Deliberately re-read from the database
          // here rather than trusting `lines.value` (populated at sheet-load time) —
          // a second, concurrent return sheet on the same sale would otherwise miss
          // that the combined effect of both returns is a full-sale return.
          const originalRows = await tx.execute(
            `SELECT product_id, quantity FROM sale_line_items WHERE sale_id = ?`,
            [saleId],
          )
          const returnedRows = await tx.execute(
            `SELECT rli.product_id, SUM(rli.qty_returned) AS returned_qty
             FROM return_line_items rli
             JOIN returns r ON r.id = rli.return_id
             WHERE r.original_sale_id = ?
             GROUP BY rli.product_id`,
            [saleId],
          )
          const returnedMap = new Map<string, number>(
            ((returnedRows as any).rows?._array ?? []).map((r: any) => [r.product_id, r.returned_qty]),
          )
          const isFullSaleReturn = ((originalRows as any).rows?._array ?? []).every(
            (row: any) => (returnedMap.get(row.product_id) ?? 0) >= row.quantity,
          )

          // WAFI-010: plan lookup, deliberately unfiltered by status — see
          // useReturnSheet's design spec §2 for why filtering in SQL would risk
          // silently absorbing a future plan status into the wrong branch.
          const planRows = await tx.execute(
            `SELECT id, status FROM installment_plans WHERE sale_id = ?`,
            [saleId],
          )
          const plan = (planRows as any).rows?._array?.[0] as { id: string; status: string } | undefined

          if (plan) {
            if (plan.status === 'active' && isFullSaleReturn) {
              const cancelled = await cancelPlanWithinTx(tx, plan.id)
              if (cancelled) cancelledPlanId = plan.id
            } else if (plan.status !== 'completed' && plan.status !== 'cancelled') {
              // Covers 'active'+partial, 'defaulted' (any completeness), and any
              // unrecognized future status — normative per the design spec's
              // decision table: only completed/cancelled ever suppress the warning.
              warning = { type: 'plan_requires_manual_review', planStatus: plan.status }
            }
          }
        })

        return { cancelledPlanId, warning }
      },
      ({ cancelledPlanId, warning }) => {
        logReturnProcessed(returnId, saleId, refundAmountUsd)
        return cancelledPlanId
          ? logInstallmentPlanCancelled(cancelledPlanId, { reason: 'sale_returned', returnId })
          : Promise.resolve()
      },
    )

    return { warning }
  }
```

- [ ] **Step 5: Update `useAuditLog` destructuring**

Near the top of `useReturnSheet`, the existing line:

```ts
  const { logReturnProcessed } = useAuditLog()
```

must become:

```ts
  const { logReturnProcessed, logInstallmentPlanCancelled } = useAuditLog()
```

- [ ] **Step 6: Update the return statement's type**

The composable's final `return { ... }` statement (was line 217) is unchanged in content, but `confirm` now resolves to `Promise<ConfirmResult>` per Step 4 — no further edit needed here since it's just re-exporting the function reference.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/features/returns/composables/__tests__/useReturnSheet.test.ts`
Expected: PASS — all WAFI-010 tests plus every pre-existing WAFI-100/WAFI-011 test in the same file (regression check).

- [ ] **Step 8: Type-check**

Run: `npx vue-tsc --noEmit`
Expected: no new errors. (`ReturnSheet.vue`'s call site will show an error until Task 6 updates it — if so, note it and continue; Task 6 fixes it.)

- [ ] **Step 9: Commit**

```bash
git add src/features/returns/composables/useReturnSheet.ts src/features/returns/composables/__tests__/useReturnSheet.test.ts
git commit -m "feat(WAFI-010): detect full-sale returns in-transaction, cancel/warn on installment plans"
```

---

### Task 5: Wire `ReturnSheet.vue` to surface the manual-review warning

**Files:**
- Modify: `src/features/returns/components/ReturnSheet.vue`
- Test: `src/features/returns/components/__tests__/ReturnSheet.test.ts` (create if it doesn't exist — check first)

**Interfaces:**
- Consumes: `confirm(): Promise<ConfirmResult>` from Task 4.

**Behavior:** unchanged when `confirm()` resolves with no warning — refund completes, sheet closes, exactly as today. When a warning is present, the sheet does **not** auto-close: it shows a persistent (non-auto-dismissing) info toast explaining the plan needs manual review, and the cashier must explicitly close it.

- [ ] **Step 1: Check for an existing component test file**

Run: `ls src/features/returns/components/__tests__/ 2>/dev/null || echo "none"`

If a `ReturnSheet.test.ts` already exists, read it fully before proceeding and match its existing mounting/mocking conventions instead of the scaffold in Step 2. If none exists, proceed with Step 2 as written.

- [ ] **Step 2: Write the failing test**

Create `src/features/returns/components/__tests__/ReturnSheet.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

// AuditHistory.vue (rendered by ReturnSheet.vue) imports useAuditLog, which
// imports the real PowerSync db module at module-load time — mock it so no
// real IndexedDB/OPFS setup happens in the test environment, matching the
// convention in OwnerSetupScreen.test.ts.
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('../../composables/useReturnSheet', () => ({
  useReturnSheet: vi.fn(),
}))
vi.mock('../../composables/useReturnReasons', () => ({
  useReturnReasons: () => ({ reasons: { value: [] }, loadReasons: vi.fn() }),
}))

import ReturnSheet from '../ReturnSheet.vue'
import { useReturnSheet } from '../../composables/useReturnSheet'

function stubSheet(confirmImpl: () => Promise<{ warning?: any }>) {
  return {
    lines: { value: [{ productId: 'p1', productName: 'قلم', originalQty: 1, alreadyReturnedQty: 0, unitPriceUsd: 10, saleDiscountShareUsd: 0, selected: true, qtyToReturn: 1, restock: true }] },
    refundMethod: { value: 'cash_usd' },
    reason: { value: '' },
    notes: { value: '' },
    hasCustomer: { value: false },
    customerName: { value: null },
    refundTotalUsd: { value: 10 },
    refundTotalSyp: { value: 10 },
    saleDiscountAppliedUsd: { value: 0 },
    canConfirm: { value: true },
    load: vi.fn().mockResolvedValue(undefined),
    confirm: confirmImpl,
  }
}

describe('ReturnSheet — WAFI-010 plan-warning handling', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('closes normally when confirm() reports no warning', async () => {
    vi.mocked(useReturnSheet).mockReturnValue(stubSheet(async () => ({})) as any)
    const wrapper = mount(ReturnSheet, { props: { saleId: 'sale-1', saleNumber: '1' } })
    await wrapper.vm.$nextTick()

    await wrapper.find('.btn-confirm').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('confirmed')).toBeTruthy()
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('does not auto-close and shows a persistent warning when confirm() reports one', async () => {
    vi.mocked(useReturnSheet).mockReturnValue(
      stubSheet(async () => ({ warning: { type: 'plan_requires_manual_review', planStatus: 'active' } })) as any,
    )
    const wrapper = mount(ReturnSheet, { props: { saleId: 'sale-1', saleNumber: '1' } })
    await wrapper.vm.$nextTick()

    await wrapper.find('.btn-confirm').trigger('click')
    await wrapper.vm.$nextTick()

    // AppToast is a plain <script setup> component with no explicit `name`
    // option, so findComponent({ name: ... }) can't locate it in this
    // codebase (see SalePanel.test.ts's comment on the same limitation) —
    // assert via the rendered DOM instead.
    expect(wrapper.emitted('confirmed')).toBeTruthy()
    expect(wrapper.emitted('close')).toBeFalsy()
    const toastEl = wrapper.find('.toast--info')
    expect(toastEl.exists()).toBe(true)
    expect(toastEl.text()).toContain('خطة تقسيط')

    // Dismissing the persistent warning toast is the cashier's explicit
    // "close" action — confirms toastAutoDismiss's @dismiss wiring emits
    // 'close' only now, not automatically when the warning toast first appears.
    await wrapper.find('.toast-close').trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/features/returns/components/__tests__/ReturnSheet.test.ts`
Expected: FAIL — `handleConfirm()` doesn't yet inspect `confirm()`'s return value, and always emits `close`.

- [ ] **Step 4: Update `ReturnSheet.vue`'s `handleConfirm`**

Replace the existing `handleConfirm` function:

```ts
async function handleConfirm() {
  if (!canConfirm.value) return
  loading.value = true
  try {
    await confirm()
    emit('confirmed')
    emit('close')
  } catch (e) {
    toastType.value = 'error'
    toast.value     = e instanceof Error ? e.message : 'حدث خطأ'
  } finally {
    loading.value = false
  }
}
```

with:

```ts
async function handleConfirm() {
  if (!canConfirm.value) return
  loading.value = true
  try {
    const result = await confirm()
    emit('confirmed')
    if (result.warning) {
      // WAFI-010: the refund succeeded, but the sale's installment plan needs
      // manual review — keep the sheet open (don't emit 'close') so the
      // warning stays visible until the cashier explicitly dismisses it.
      toastType.value    = 'info'
      toastAutoDismiss.value = false
      toast.value = `تم تنفيذ المرتجع، لكن هذه الفاتورة لديها خطة تقسيط (${result.warning.planStatus === 'defaulted' ? 'متعثرة' : result.warning.planStatus}) لم يتم تعديلها — يرجى المراجعة اليدوية.`
    } else {
      emit('close')
    }
  } catch (e) {
    toastType.value = 'error'
    toastAutoDismiss.value = true
    toast.value     = e instanceof Error ? e.message : 'حدث خطأ'
  } finally {
    loading.value = false
  }
}
```

Add the new ref alongside the existing `toast`/`toastType` refs:

```ts
const toastAutoDismiss = ref(true)
```

And update the `AppToast` usage at the bottom of the template from:

```html
  <AppToast v-if="toast" :message="toast" :type="toastType" @dismiss="toast = null" />
```

to:

```html
  <AppToast
    v-if="toast"
    :message="toast"
    :type="toastType"
    :auto-dismiss="toastAutoDismiss"
    @dismiss="toast = null; if (!toastAutoDismiss) emit('close')"
  />
```

(Dismissing the persistent warning toast is how the cashier explicitly closes the sheet — matching the spec's "cashier must explicitly close it" requirement without adding a second button.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/features/returns/components/__tests__/ReturnSheet.test.ts`
Expected: PASS

- [ ] **Step 6: Type-check the whole project**

Run: `npx vue-tsc --noEmit`
Expected: clean — this resolves the `confirm()` return-type mismatch flagged (if any) at the end of Task 4.

- [ ] **Step 7: Run the full test suite for a final regression check**

Run: `npx vitest run`
Expected: PASS, no regressions anywhere in the suite.

- [ ] **Step 8: Commit**

```bash
git add src/features/returns/components/ReturnSheet.vue src/features/returns/components/__tests__/ReturnSheet.test.ts
git commit -m "feat(WAFI-010): surface installment-plan manual-review warning in ReturnSheet"
```

---

## Explicitly out of scope (do not implement in this plan)

- Phase 2 proration (reducing `total_amount_usd` and regenerating pending dues for partial returns) — a distinct future ticket per the design spec.
- Any UI/flow for an owner to manually cancel a `defaulted` plan — `cancelPlanWithinTx`'s guard intentionally does not support this; if wanted later, it needs its own explicit design.
- Persisting an `'overdue'` due status — the spec's §7 invariant depends on this NOT existing; if a future ticket introduces it, `cancelPlanWithinTx`'s `WHERE status = 'pending'` clause must be revisited then, not now.
