import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { usePayment } from '@/features/payment/usePayment'
import { useSaleStore } from '@/store/sale.store'
import { db } from '@/data/powersync/db'

// confirm() runs all its writes inside db.writeTransaction. This wires a tx.execute
// spy whose SELECTs return the given product row (cost + stock); returns the spy so
// tests can assert on the SQL/params passed to the transaction.
function setupTx(stockRow: { cost_price_usd: number; current_stock: number } = { cost_price_usd: 0, current_stock: 0 }) {
  const exec = vi.fn().mockImplementation(async (sql: unknown) => {
    if (typeof sql === 'string' && sql.trim().startsWith('SELECT')) {
      return { rows: { _array: [stockRow] } }
    }
    return { rows: { _array: [] } }
  })
  vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => { await fn({ execute: exec }) })
  return exec
}

describe('usePayment', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const store = useSaleStore()
    store.clear()
    store.addLine({ productId: 'p1', nameAr: 'منتج', quantity: 1, unitPriceUsd: 10, lineTotalUsd: 10, availableStock: 99 })
    store.setLockedRate(14500)
    vi.clearAllMocks()
  })

  it('starts at method-selection state', () => {
    const { state } = usePayment()
    expect(state.value).toBe('method-selection')
  })

  it('selectMethod transitions to amount-entry for cash payments', () => {
    const { state, selectMethod } = usePayment()
    selectMethod('cash_usd')
    expect(state.value).toBe('amount-entry')
  })

  it('selectMethod transitions to card-confirm state for card', () => {
    const { state, selectMethod } = usePayment()
    selectMethod('card')
    expect(state.value).toBe('card-confirm')
  })

  it('back() from amount-entry returns to method-selection and clears amount', () => {
    const { state, selectMethod, amountReceived, back } = usePayment()
    selectMethod('cash_usd')
    amountReceived.value = 20
    back()
    expect(state.value).toBe('method-selection')
    expect(amountReceived.value).toBeNull()
  })

  it('cancel() closes modal with sale intact', () => {
    const store = useSaleStore()
    const { cancel, isOpen } = usePayment()
    cancel()
    expect(isOpen.value).toBe(false)
    expect(store.lines).toHaveLength(1)
  })

  it('confirm() clears sale.store on success', async () => {
    const { selectMethod, confirm } = usePayment()
    selectMethod('card')
    await confirm()
    const store = useSaleStore()
    expect(store.lines).toHaveLength(0)
  })

  it('confirm() is idempotent — a double-tap writes exactly one sale and burns one sequence number (WAFI-003)', async () => {
    setupTx({ cost_price_usd: 0, current_stock: 10 })
    const store = useSaleStore()
    const seqBefore = store.deviceSequence

    const { selectMethod, confirm } = usePayment()
    selectMethod('card')

    // Rapid double-tap / held Enter: fire two confirms in the same tick, before the
    // first resolves. The second must be a no-op — not a duplicate sale + sequence burn.
    const first  = confirm()
    const second = confirm().catch(() => null)
    await Promise.allSettled([first, second])

    expect(db.writeTransaction).toHaveBeenCalledTimes(1)
    expect(store.deviceSequence).toBe(seqBefore + 1)
  })

  it('does not advance the receipt sequence when the sale write fails (WAFI-004)', async () => {
    const store = useSaleStore()
    const seqBefore = store.deviceSequence
    // The sale write blows up (e.g. disk/quota) — the sequence must NOT be burned,
    // so the next (successful) sale reuses the expected number.
    vi.mocked(db.writeTransaction).mockRejectedValueOnce(new Error('write failed'))

    const { selectMethod, confirm } = usePayment()
    selectMethod('card')
    await expect(confirm()).rejects.toThrow()

    expect(store.deviceSequence).toBe(seqBefore)
  })

  it('advances the receipt sequence exactly once on a successful sale (WAFI-004)', async () => {
    setupTx({ cost_price_usd: 0, current_stock: 10 })
    const store = useSaleStore()
    const seqBefore = store.deviceSequence

    const { selectMethod, confirm } = usePayment()
    selectMethod('card')
    await confirm()

    expect(store.deviceSequence).toBe(seqBefore + 1)
  })

  it('changeDue computed correctly for cash_usd overpay', () => {
    const { selectMethod, amountReceived, changeDue } = usePayment()
    selectMethod('cash_usd')
    amountReceived.value = 15
    expect(changeDue.value).toBeCloseTo(5, 2)
  })

  it('SYP total uses locked rate not current rate', () => {
    const { totalSyp } = usePayment()
    // lockedRate = 14500, totalUsd = 10
    expect(totalSyp.value).toBe(145000)
  })

  it('confirm() includes sale lines from store', async () => {
    const { selectMethod, confirm } = usePayment()
    selectMethod('card')
    const completed = await confirm()
    expect(completed.lines).toHaveLength(1)
    expect(completed.lines[0].nameAr).toBe('منتج')
    expect(completed.lines[0].quantity).toBe(1)
    expect(completed.lines[0].unitPriceUsd).toBe(10)
    expect(completed.lines[0].lineTotalUsd).toBe(10)
  })

  it('confirm deducts stock and writes stock_adjustments for each sale line', async () => {
    const tx = setupTx({ cost_price_usd: 0, current_stock: 10 })

    const { selectMethod, confirm } = usePayment()
    selectMethod('card')
    await confirm()

    const calls = tx.mock.calls.map(c => c[0] as string)
    expect(calls.some(sql => sql.includes('UPDATE products') && sql.includes('current_stock'))).toBe(true)
    expect(calls.some(sql => sql.includes('INSERT INTO stock_adjustments'))).toBe(true)

    // Verify the correct numeric values were passed
    const updateCall = tx.mock.calls.find(c => (c[0] as string).includes('UPDATE products') && (c[0] as string).includes('current_stock'))
    expect(updateCall?.[1]).toContain(9) // newStock = 10 - 1

    const insertCall = tx.mock.calls.find(c => (c[0] as string).includes('INSERT INTO stock_adjustments'))
    expect(insertCall?.[1]).toContain(10) // old_value
    expect(insertCall?.[1]).toContain(9)  // new_value
  })

  it('confirm clamps stock at 0 when a sale would oversell', async () => {
    const store = useSaleStore()
    store.clear()
    store.addLine({ productId: 'p1', nameAr: 'منتج', quantity: 5, unitPriceUsd: 10, lineTotalUsd: 50, availableStock: 99 })
    store.setLockedRate(14500)
    const tx = setupTx({ cost_price_usd: 0, current_stock: 3 })  // only 3 on hand, selling 5

    const { selectMethod, confirm } = usePayment()
    selectMethod('card')
    await confirm()

    const updateCall = tx.mock.calls.find(c => (c[0] as string).includes('UPDATE products') && (c[0] as string).includes('current_stock'))
    expect(updateCall?.[1][0]).toBe(0)  // clamped, not -2
  })

  it('confirm records the oversold quantity in the stock adjustment notes', async () => {
    const store = useSaleStore()
    store.clear()
    store.addLine({ productId: 'p1', nameAr: 'منتج', quantity: 5, unitPriceUsd: 10, lineTotalUsd: 50, availableStock: 99 })
    store.setLockedRate(14500)
    const tx = setupTx({ cost_price_usd: 0, current_stock: 3 })  // sold 5, only 3 on hand → oversold by 2

    const { selectMethod, confirm } = usePayment()
    selectMethod('card')
    await confirm()

    // stock_adjustments params: [id, shop_id, product_id, old_value, new_value, notes, created_at, device_id]
    const insertCall = tx.mock.calls.find(c => (c[0] as string).includes('INSERT INTO stock_adjustments'))
    expect(insertCall?.[1][5]).toBe('oversold:2')
  })

  it('confirm leaves adjustment notes null for a normal (non-oversell) sale', async () => {
    const tx = setupTx({ cost_price_usd: 0, current_stock: 10 })  // sold 1, 10 on hand → no oversell

    const { selectMethod, confirm } = usePayment()
    selectMethod('card')
    await confirm()

    const insertCall = tx.mock.calls.find(c => (c[0] as string).includes('INSERT INTO stock_adjustments'))
    expect(insertCall?.[1][5]).toBeNull()
  })

  it('confirm writes unit_cost_usd to sale_line_items from product cost', async () => {
    const tx = setupTx({ cost_price_usd: 7, current_stock: 10 })

    const { selectMethod, confirm } = usePayment()
    selectMethod('card')
    await confirm()

    const lineInsertCall = tx.mock.calls.find(c =>
      (c[0] as string).includes('INSERT INTO sale_line_items') &&
      (c[0] as string).includes('unit_cost_usd')
    )
    expect(lineInsertCall).toBeDefined()
    expect(lineInsertCall?.[1]).toContain(7) // unit_cost_usd = 7
  })

  it('confirm writes all sale writes inside a single transaction', async () => {
    const tx = setupTx({ cost_price_usd: 0, current_stock: 10 })
    const { selectMethod, confirm } = usePayment()
    selectMethod('card')
    await confirm()
    // All sale inserts/updates go through the transaction.
    expect(db.writeTransaction).toHaveBeenCalledTimes(1)
    const calls = tx.mock.calls.map(c => c[0] as string)
    expect(calls.some(sql => sql.includes('INSERT INTO sales'))).toBe(true)
    // Audit log is written outside transaction via db.execute (separate from main sale tx).
    expect(db.execute).toHaveBeenCalledTimes(1)
    const auditCall = (db.execute as any).mock.calls[0]
    expect(auditCall[0]).toContain('INSERT INTO audit_log')
  })

  it('attributes the sale to the active operator (staff_id) at confirm', async () => {
    const { useSessionStore } = await import('@/store/session.store')
    useSessionStore().setActiveStaff({ id: 'op-7', name: 'سامي', role: 'cashier', permissions: {} } as any)
    const tx = setupTx({ cost_price_usd: 0, current_stock: 10 })

    const { selectMethod, confirm } = usePayment()
    selectMethod('card')
    await confirm()

    const salesInsert = tx.mock.calls.find(c =>
      (c[0] as string).includes('INSERT INTO sales') && (c[0] as string).includes('staff_id')
    )
    expect(salesInsert).toBeDefined()
    // staff_id is the second-to-last column/param of the sales INSERT (sync_status is last).
    expect(salesInsert![1][salesInsert![1].length - 2]).toBe('op-7')
  })

  it('attributes the sale to the active shift (shift_id) at confirm (WAFI-064)', async () => {
    const { useShiftStore } = await import('@/features/shifts/shift.store')
    useShiftStore().openShift('shift-99', { id: 'op-1', name: 'سامي' } as any)
    const tx = setupTx({ cost_price_usd: 0, current_stock: 10 })

    const { selectMethod, confirm } = usePayment()
    selectMethod('card')
    await confirm()

    const salesInsert = tx.mock.calls.find(c =>
      (c[0] as string).includes('INSERT INTO sales') && (c[0] as string).includes('shift_id')
    )
    expect(salesInsert).toBeDefined()
    // shift_id is written (the param immediately before the trailing staff_id).
    expect(salesInsert![1]).toContain('shift-99')
  })

  it('attribution follows an operator switch — the completer is recorded (WAFI-064)', async () => {
    const { useShiftStore }   = await import('@/features/shifts/shift.store')
    const { useSessionStore } = await import('@/store/session.store')
    // Shift opened by one operator...
    useShiftStore().openShift('shift-1', { id: 'opener', name: 'محمد' } as any)
    // ...but a switch makes someone else the active operator who completes the sale.
    useSessionStore().setActiveStaff({ id: 'completer', name: 'أحمد', role: 'cashier', permissions: {} } as any)
    const tx = setupTx({ cost_price_usd: 0, current_stock: 10 })

    const { selectMethod, confirm } = usePayment()
    selectMethod('card')
    await confirm()

    const salesInsert = tx.mock.calls.find(c =>
      (c[0] as string).includes('INSERT INTO sales') && (c[0] as string).includes('staff_id')
    )
    expect(salesInsert).toBeDefined()
    // staff_id (second-to-last param; sync_status is last) is the COMPLETER, not the shift opener.
    expect(salesInsert![1][salesInsert![1].length - 2]).toBe('completer')
  })

  it('confirm writes customer_id and is_credit=1 for credit sales', async () => {
    const tx = setupTx({ cost_price_usd: 5, current_stock: 10 })

    const { selectMethod, confirm } = usePayment()
    selectMethod('credit')
    await confirm('customer-abc')

    const salesInsert = tx.mock.calls.find(c =>
      (c[0] as string).includes('INSERT INTO sales') &&
      (c[0] as string).includes('customer_id')
    )
    expect(salesInsert).toBeDefined()
    expect(salesInsert![1]).toContain('customer-abc')
    expect(salesInsert![1]).toContain(1) // is_credit = 1
  })

  it('credit sale records NO sale_payments row and zero amount_received', async () => {
    const tx = setupTx({ cost_price_usd: 0, current_stock: 10 })

    const { selectMethod, confirm } = usePayment()
    selectMethod('credit')
    await confirm('cust-1')

    const calls = tx.mock.calls.map(c => c[0] as string)
    expect(calls.some(sql => sql.includes('INSERT INTO sale_payments'))).toBe(false)

    const salesInsert = tx.mock.calls.find(c =>
      (c[0] as string).includes('INSERT INTO sales')
    )
    expect(salesInsert![1][10]).toBe(0) // amount_received column = 0 (unpaid)
  })

  describe('split payments', () => {
    beforeEach(() => {
      setActivePinia(createPinia())
      // Seed a large-enough sale so split legs aren't capped to zero by the remaining-owed guard.
      const store = useSaleStore()
      store.clear()
      store.addLine({ productId: 'p1', nameAr: 'منتج', quantity: 1, unitPriceUsd: 5000, lineTotalUsd: 5000, availableStock: 99 })
      store.setLockedRate(14500)
      vi.clearAllMocks()
      vi.mocked(db.getOptional).mockResolvedValue(null)
      vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
    })

    it('pendingPayments defaults to empty', () => {
      const { pendingPayments } = usePayment()
      expect(pendingPayments.value).toHaveLength(0)
    })

    it('addPayment appends an entry to pendingPayments', () => {
      const { addPayment, pendingPayments, selectMethod } = usePayment()
      selectMethod('cash_usd')
      addPayment('cash_usd', 30)
      expect(pendingPayments.value).toHaveLength(1)
      expect(pendingPayments.value[0].method).toBe('cash_usd')
      expect(pendingPayments.value[0].amountUsd).toBe(30)
      expect(pendingPayments.value[0].currency).toBe('USD')
    })

    it('addPayment sets SYP currency for cash_syp', () => {
      const { addPayment, pendingPayments } = usePayment()
      addPayment('cash_syp', 1_450_000)
      expect(pendingPayments.value[0].amountRaw).toBe(1_450_000)
      expect(pendingPayments.value[0].currency).toBe('SYP')
    })

    it('remainingUsd is non-negative', () => {
      const { addPayment, remainingUsd } = usePayment()
      addPayment('cash_usd', 30)
      expect(remainingUsd.value).toBeGreaterThanOrEqual(0)
    })

    it('removeLastPayment removes the last entry', () => {
      const { addPayment, removeLastPayment, pendingPayments } = usePayment()
      addPayment('cash_usd', 30)
      addPayment('cash_syp', 500_000)
      removeLastPayment()
      expect(pendingPayments.value).toHaveLength(1)
      expect(pendingPayments.value[0].method).toBe('cash_usd')
    })

    it('removeLastPayment is a no-op when list is empty', () => {
      const { removeLastPayment, pendingPayments } = usePayment()
      removeLastPayment()
      expect(pendingPayments.value).toHaveLength(0)
    })

    it('isReadyToConfirm is false when pendingPayments is empty', () => {
      const { isReadyToConfirm } = usePayment()
      expect(isReadyToConfirm.value).toBe(false)
    })

    it('allows a partial first leg below the total (split can start)', () => {
      const { selectMethod, amountReceived, canAddLeg, canConfirmSingle } = usePayment()
      selectMethod('cash_usd')
      amountReceived.value = 30          // total is 5000
      expect(canAddLeg.value).toBe(true)        // can add as a split leg
      expect(canConfirmSingle.value).toBe(false) // but not settle the whole sale
    })

    it('caps an overpaid cash leg and records the surplus as change', () => {
      const { addPayment, pendingPayments } = usePayment()
      addPayment('cash_usd', 6000)       // total is 5000
      expect(pendingPayments.value[0].amountUsd).toBe(5000) // applied, capped to remaining
      expect(pendingPayments.value[0].changeDue).toBe(1000) // surplus returned as change
    })

    it('split legs sum to the total with no phantom overage', async () => {
      const { addPayment, paidUsd, remainingUsd } = usePayment()
      addPayment('cash_usd', 2000)
      addPayment('card', 3000)
      expect(paidUsd.value).toBe(5000)
      expect(remainingUsd.value).toBe(0)
    })

    it('confirm with pendingPayments writes is_split=1 and inserts sale_payments rows', async () => {
      const tx = setupTx({ cost_price_usd: 0, current_stock: 10 })

      const { addPayment, confirm } = usePayment()
      addPayment('cash_usd', 30)
      addPayment('cash_syp', 500_000)
      await confirm()

      const salesInsert = tx.mock.calls.find(c =>
        (c[0] as string).includes('INSERT INTO sales') &&
        (c[0] as string).includes('is_split')
      )
      expect(salesInsert).toBeDefined()
      expect(salesInsert![1]).toContain(1) // is_split = 1

      const paymentInserts = tx.mock.calls.filter(c =>
        (c[0] as string).includes('INSERT INTO sale_payments')
      )
      expect(paymentInserts).toHaveLength(2)
    })

    it('confirm without pendingPayments (single path) writes is_split=0', async () => {
      const tx = setupTx({ cost_price_usd: 0, current_stock: 10 })

      const { selectMethod, confirm } = usePayment()
      selectMethod('card')
      await confirm()

      const salesInsert = tx.mock.calls.find(c =>
        (c[0] as string).includes('INSERT INTO sales') &&
        (c[0] as string).includes('is_split')
      )
      expect(salesInsert).toBeDefined()
      expect(salesInsert![1]).toContain(0) // is_split = 0

      const paymentInserts = tx.mock.calls.filter(c =>
        (c[0] as string).includes('INSERT INTO sale_payments')
      )
      expect(paymentInserts).toHaveLength(1)
    })
  })
})
