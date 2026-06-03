import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { usePayment } from '@/features/payment/usePayment'
import { useSaleStore } from '@/store/sale.store'
import { db } from '@/data/powersync/db'

describe('usePayment', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const store = useSaleStore()
    store.clear()
    store.addLine({ productId: 'p1', nameAr: 'منتج', quantity: 1, unitPriceUsd: 10, lineTotalUsd: 10 })
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
    // Mock all db.execute calls in order:
    // 1. INSERT INTO sales
    // 2. INSERT INTO sale_payments (single entry, non-split path)
    // 3. INSERT INTO sale_line_items (for the one line in beforeEach)
    // Note: SELECT is now getOptional, not execute
    // 4. UPDATE products (stock deduction)
    // 5. INSERT INTO stock_adjustments
    vi.mocked(db.execute)
      .mockResolvedValueOnce({ rows: { _array: [] } } as any) // INSERT sales
      .mockResolvedValueOnce({ rows: { _array: [] } } as any) // INSERT sale_payments
      .mockResolvedValueOnce({ rows: { _array: [] } } as any) // INSERT sale_line_items
      // Note: SELECT is now getOptional, not execute
      .mockResolvedValueOnce({ rows: { _array: [] } } as any) // UPDATE products
      .mockResolvedValueOnce({ rows: { _array: [] } } as any) // INSERT stock_adjustments

    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ cost_price_usd: 0 } as any)   // cost lookup (new)
      .mockResolvedValueOnce({ current_stock: 10 } as any)   // stock lookup (existing)

    const { selectMethod, confirm } = usePayment()
    selectMethod('card')
    await confirm()

    const calls = vi.mocked(db.execute).mock.calls.map(c => c[0] as string)
    expect(calls.some(sql => sql.includes('UPDATE products') && sql.includes('current_stock'))).toBe(true)
    expect(calls.some(sql => sql.includes('INSERT INTO stock_adjustments'))).toBe(true)

    // Verify the correct numeric values were passed
    const updateCall = vi.mocked(db.execute).mock.calls.find(c => (c[0] as string).includes('UPDATE products') && (c[0] as string).includes('current_stock'))
    expect(updateCall?.[1]).toContain(9) // newStock = 10 - 1

    const insertCall = vi.mocked(db.execute).mock.calls.find(c => (c[0] as string).includes('INSERT INTO stock_adjustments'))
    expect(insertCall?.[1]).toContain(10) // old_value
    expect(insertCall?.[1]).toContain(9)  // new_value
  })

  it('confirm writes unit_cost_usd to sale_line_items from product cost', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ cost_price_usd: 7 } as any)   // cost lookup for p1
      .mockResolvedValueOnce({ current_stock: 10 } as any)   // stock lookup for p1
    vi.mocked(db.execute)
      .mockResolvedValueOnce({ rows: { _array: [] } } as any) // INSERT sales
      .mockResolvedValueOnce({ rows: { _array: [] } } as any) // INSERT sale_payments
      .mockResolvedValueOnce({ rows: { _array: [] } } as any) // INSERT sale_line_items
      .mockResolvedValueOnce({ rows: { _array: [] } } as any) // UPDATE products stock
      .mockResolvedValueOnce({ rows: { _array: [] } } as any) // INSERT stock_adjustments

    const { selectMethod, confirm } = usePayment()
    selectMethod('card')
    await confirm()

    const lineInsertCall = vi.mocked(db.execute).mock.calls.find(c =>
      (c[0] as string).includes('INSERT INTO sale_line_items') &&
      (c[0] as string).includes('unit_cost_usd')
    )
    expect(lineInsertCall).toBeDefined()
    expect(lineInsertCall?.[1]).toContain(7) // unit_cost_usd = 7
  })

  it('confirm writes customer_id and is_credit=1 for credit sales', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ cost_price_usd: 5 } as any)
      .mockResolvedValueOnce({ current_stock: 10 } as any)
    vi.mocked(db.execute)
      .mockResolvedValueOnce({ rows: { _array: [] } } as any) // INSERT sales
      .mockResolvedValueOnce({ rows: { _array: [] } } as any) // INSERT sale_payments
      .mockResolvedValueOnce({ rows: { _array: [] } } as any) // INSERT sale_line_items
      .mockResolvedValueOnce({ rows: { _array: [] } } as any) // UPDATE products
      .mockResolvedValueOnce({ rows: { _array: [] } } as any) // INSERT stock_adjustments

    const { selectMethod, confirm } = usePayment()
    selectMethod('credit')
    await confirm('customer-abc')

    const salesInsert = vi.mocked(db.execute).mock.calls.find(c =>
      (c[0] as string).includes('INSERT INTO sales') &&
      (c[0] as string).includes('customer_id')
    )
    expect(salesInsert).toBeDefined()
    expect(salesInsert![1]).toContain('customer-abc')
    expect(salesInsert![1]).toContain(1) // is_credit = 1
  })

  describe('split payments', () => {
    beforeEach(() => {
      setActivePinia(createPinia())
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

    it('confirm with pendingPayments writes is_split=1 and inserts sale_payments rows', async () => {
      vi.mocked(db.getOptional)
        .mockResolvedValueOnce({ cost_price_usd: 0 } as any)
        .mockResolvedValueOnce({ current_stock: 10 } as any)
      vi.mocked(db.execute)
        .mockResolvedValue({ rows: { _array: [] } } as any)

      const { addPayment, confirm } = usePayment()
      addPayment('cash_usd', 30)
      addPayment('cash_syp', 500_000)
      await confirm()

      const salesInsert = vi.mocked(db.execute).mock.calls.find(c =>
        (c[0] as string).includes('INSERT INTO sales') &&
        (c[0] as string).includes('is_split')
      )
      expect(salesInsert).toBeDefined()
      expect(salesInsert![1]).toContain(1) // is_split = 1

      const paymentInserts = vi.mocked(db.execute).mock.calls.filter(c =>
        (c[0] as string).includes('INSERT INTO sale_payments')
      )
      expect(paymentInserts).toHaveLength(2)
    })

    it('confirm without pendingPayments (single path) writes is_split=0', async () => {
      vi.mocked(db.getOptional)
        .mockResolvedValueOnce({ cost_price_usd: 0 } as any)
        .mockResolvedValueOnce({ current_stock: 10 } as any)
      vi.mocked(db.execute)
        .mockResolvedValue({ rows: { _array: [] } } as any)

      const { selectMethod, confirm } = usePayment()
      selectMethod('card')
      await confirm()

      const salesInsert = vi.mocked(db.execute).mock.calls.find(c =>
        (c[0] as string).includes('INSERT INTO sales') &&
        (c[0] as string).includes('is_split')
      )
      expect(salesInsert).toBeDefined()
      expect(salesInsert![1]).toContain(0) // is_split = 0

      const paymentInserts = vi.mocked(db.execute).mock.calls.filter(c =>
        (c[0] as string).includes('INSERT INTO sale_payments')
      )
      expect(paymentInserts).toHaveLength(1)
    })
  })
})
