import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useSale } from '@/features/pos/useSale'
import { useSaleStore } from '@/store/sale.store'
import { db } from '@/data/powersync/db'

describe('useSale', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('addLine locks exchange rate on first item', async () => {
    vi.mocked(db.execute).mockResolvedValueOnce({
      rows: { _array: [{ id: 'p1', name_ar: 'منتج', price_usd: 10 }] },
    } as any)
    const store = useSaleStore()
    const { addLine } = useSale(14500)
    await addLine('p1')
    expect(store.lockedExchangeRate).toBe(14500)
  })

  it('addLine does not change locked rate when already set', async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce({ rows: { _array: [{ id: 'p1', name_ar: 'أ', price_usd: 10 }] } } as any)
      .mockResolvedValueOnce({ rows: { _array: [{ id: 'p2', name_ar: 'ب', price_usd: 5 }] } } as any)
    const store = useSaleStore()
    const { addLine } = useSale(14500)
    await addLine('p1')
    const { addLine: addLine2 } = useSale(15000)
    await addLine2('p2')
    expect(store.lockedExchangeRate).toBe(14500)
  })

  it('totalSyp uses locked rate, not current rate', async () => {
    vi.mocked(db.execute).mockResolvedValueOnce({
      rows: { _array: [{ id: 'p1', name_ar: 'منتج', price_usd: 10 }] },
    } as any)
    const { addLine, totalSyp } = useSale(14500)
    await addLine('p1')
    expect(totalSyp.value).toBe(Math.round(10 * 14500))
  })

  it('addLine throws when currentRate is null', async () => {
    const { addLine } = useSale(null)
    await expect(addLine('p1')).rejects.toThrow('Exchange rate not set')
  })

  it('hasRateChangeNotice is true when rate changes mid-sale', async () => {
    vi.mocked(db.execute).mockResolvedValueOnce({
      rows: { _array: [{ id: 'p1', name_ar: 'منتج', price_usd: 10 }] },
    } as any)
    const { addLine } = useSale(14500)
    await addLine('p1')
    // Simulate rate change — create new useSale instance with different rate
    const { checkRateChanged } = useSale(15000)
    checkRateChanged()
    // hasRateChangeNotice is shared via sale.store
    const store = useSaleStore()
    expect(store.hasRateChangeNotice).toBe(true)
  })
})
