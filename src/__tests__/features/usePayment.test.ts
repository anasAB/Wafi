import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { usePayment } from '@/features/payment/usePayment'
import { useSaleStore } from '@/store/sale.store'

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

  it('selectMethod transitions directly to confirming for card', () => {
    const { state, selectMethod } = usePayment()
    selectMethod('card')
    expect(state.value).toBe('confirming')
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
})
