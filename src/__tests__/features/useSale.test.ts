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
      rows: { _array: [{ id: 'p1', name_ar: 'منتج', price_usd: 10, current_stock: 5 }] },
    } as any)
    const store = useSaleStore()
    const { addLine } = useSale(14500)
    await addLine('p1')
    expect(store.lockedExchangeRate).toBe(14500)
  })

  it('addLine does not change locked rate when already set', async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce({ rows: { _array: [{ id: 'p1', name_ar: 'أ', price_usd: 10, current_stock: 5 }] } } as any)
      .mockResolvedValueOnce({ rows: { _array: [{ id: 'p2', name_ar: 'ب', price_usd: 5, current_stock: 5 }] } } as any)
    const store = useSaleStore()
    const { addLine } = useSale(14500)
    await addLine('p1')
    const { addLine: addLine2 } = useSale(15000)
    await addLine2('p2')
    expect(store.lockedExchangeRate).toBe(14500)
  })

  it('totalSyp uses locked rate, not current rate', async () => {
    vi.mocked(db.execute).mockResolvedValueOnce({
      rows: { _array: [{ id: 'p1', name_ar: 'منتج', price_usd: 10, current_stock: 5 }] },
    } as any)
    const { addLine, totalSyp } = useSale(14500)
    await addLine('p1')
    expect(totalSyp.value).toBe(Math.round(10 * 14500))
  })

  it('addLine throws and adds nothing when the product is out of stock', async () => {
    vi.mocked(db.execute).mockResolvedValueOnce({
      rows: { _array: [{ id: 'p1', name_ar: 'منتج', price_usd: 10, current_stock: 0 }] },
    } as any)
    const store = useSaleStore()
    const { addLine } = useSale(14500)
    await expect(addLine('p1')).rejects.toThrow('نفد المخزون')
    expect(store.lines).toHaveLength(0)
  })

  it('addLine throws when cart quantity already equals available stock', async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce({ rows: { _array: [{ id: 'p1', name_ar: 'منتج', price_usd: 10, current_stock: 2 }] } } as any)
      .mockResolvedValueOnce({ rows: { _array: [{ id: 'p1', name_ar: 'منتج', price_usd: 10, current_stock: 2 }] } } as any)
      .mockResolvedValueOnce({ rows: { _array: [{ id: 'p1', name_ar: 'منتج', price_usd: 10, current_stock: 2 }] } } as any)
    const store = useSaleStore()
    const { addLine } = useSale(14500)
    await addLine('p1')
    await addLine('p1')
    await expect(addLine('p1')).rejects.toThrow('الكمية المتوفرة فقط 2')
    expect(store.lines[0].quantity).toBe(2)
  })

  it('addLine throws when currentRate is null', async () => {
    const { addLine } = useSale(null)
    await expect(addLine('p1')).rejects.toThrow('Exchange rate not set')
  })

  it('hasRateChangeNotice is true when rate changes mid-sale', async () => {
    vi.mocked(db.execute).mockResolvedValueOnce({
      rows: { _array: [{ id: 'p1', name_ar: 'منتج', price_usd: 10, current_stock: 5 }] },
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

  it('a mid-cart rate change does not re-price the cart: locked rate and SYP total stay fixed (WAFI-002)', async () => {
    vi.mocked(db.execute).mockResolvedValueOnce({
      rows: { _array: [{ id: 'p1', name_ar: 'منتج', price_usd: 10, current_stock: 5 }] },
    } as any)
    const { addLine, totalSyp } = useSale(14500)
    await addLine('p1')                 // locks 14500, total $10
    const store = useSaleStore()
    expect(totalSyp.value).toBe(145000)

    useSale(20000).checkRateChanged()   // owner edits the rate to 20000 mid-cart
    expect(store.lockedExchangeRate).toBe(14500)  // unchanged — sale keeps its rate
    expect(totalSyp.value).toBe(145000)           // still priced at the locked rate
  })

  it('checkRateChanged clears the notice when the rate returns to the locked value (WAFI-002)', async () => {
    vi.mocked(db.execute).mockResolvedValueOnce({
      rows: { _array: [{ id: 'p1', name_ar: 'منتج', price_usd: 10, current_stock: 5 }] },
    } as any)
    const { addLine } = useSale(14500)
    await addLine('p1')                 // locks 14500
    const store = useSaleStore()

    useSale(15000).checkRateChanged()
    expect(store.hasRateChangeNotice).toBe(true)   // rate moved away → notice on

    useSale(14500).checkRateChanged()
    expect(store.hasRateChangeNotice).toBe(false)  // rate back to locked → notice off
  })

  describe('addOpenItem (WAFI-101)', () => {
    it('creates a hidden synthetic product (is_active=0, created_via=open_item) and adds it to the cart', async () => {
      vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
      const store = useSaleStore()
      const { addOpenItem } = useSale(14500)
      await addOpenItem('توصيل', 5)

      const insertCall = vi.mocked(db.execute).mock.calls.find(c => /INSERT INTO products/.test(c[0] as string))
      expect(insertCall).toBeDefined()
      const sql = insertCall![0] as string
      const params = insertCall![1] as unknown[]
      expect(sql).toMatch(/created_via/)
      expect(sql).toMatch(/'open_item'/)
      expect(params).toContain(5) // priceUsd bound

      expect(store.lines).toHaveLength(1)
      expect(store.lines[0].isOpenItem).toBe(true)
      expect(store.lines[0].unitCostUsd).toBe(0)
      expect(store.lines[0].nameAr).toBe('توصيل')
      expect(store.lockedExchangeRate).toBe(14500)
    })

    it('rejects a zero or negative price — a free item must go through the discount/PIN path, not a silent $0 open item', async () => {
      const { addOpenItem } = useSale(14500)
      await expect(addOpenItem('هدية', 0)).rejects.toThrow()
      await expect(addOpenItem('هدية', -1)).rejects.toThrow()
    })

    it('throws ExchangeRateNotSetError when no rate is configured', async () => {
      const { addOpenItem } = useSale(null)
      await expect(addOpenItem('توصيل', 5)).rejects.toThrow('Exchange rate not set')
    })
  })
})
