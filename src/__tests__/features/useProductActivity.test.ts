import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useProductActivity } from '@/features/products/composables/useProductActivity'
import { db } from '@/data/powersync/db'

describe('useProductActivity', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([])
  })

  it('starts empty', () => {
    const { entries, totalQty, totalRevenueUsd } = useProductActivity()
    expect(entries.value).toHaveLength(0)
    expect(totalQty.value).toBe(0)
    expect(totalRevenueUsd.value).toBe(0)
  })

  it('aggregates totals and groups distinct sale prices', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { sale_id: 's1', display_sale_number: '#101', created_at: '2026-06-02T10:00:00Z', quantity: 3, unit_price_usd: 25, line_total_usd: 75 },
      { sale_id: 's2', display_sale_number: '#140', created_at: '2026-06-05T10:00:00Z', quantity: 2, unit_price_usd: 30, line_total_usd: 60 },
      { sale_id: 's3', display_sale_number: '#155', created_at: '2026-06-06T10:00:00Z', quantity: 1, unit_price_usd: 25, line_total_usd: 25 },
    ])

    const { entries, load, totalQty, totalRevenueUsd, byPrice } = useProductActivity()
    await load('p1')

    expect(entries.value).toHaveLength(3)
    expect(totalQty.value).toBe(6)
    expect(totalRevenueUsd.value).toBe(160)
    // Two distinct prices: $30 (qty 2) and $25 (qty 4), sorted high→low.
    expect(byPrice.value).toEqual([
      { price: 30, qty: 2 },
      { price: 25, qty: 4 },
    ])
  })

  it('queries sale_line_items joined to sales by product', async () => {
    const { load } = useProductActivity()
    await load('p9')
    expect(db.getAll).toHaveBeenCalledWith(
      expect.stringContaining('FROM sale_line_items'),
      ['p9']
    )
  })
})
