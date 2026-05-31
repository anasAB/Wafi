import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useBestSellers } from '@/features/dashboard/composables/useBestSellers'
import { db } from '@/data/powersync/db'

describe('useBestSellers', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([])
  })

  it('items is empty by default', () => {
    const { items } = useBestSellers()
    expect(items.value).toHaveLength(0)
  })

  it('load queries sale_line_items joined to sales and products', async () => {
    const { load } = useBestSellers()
    await load('today')
    expect(db.getAll).toHaveBeenCalledWith(
      expect.stringContaining('sale_line_items'),
      expect.any(Array)
    )
  })

  it('load maps rows to BestSeller objects', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { name_ar: 'شاشة سامسونج', units_sold: 5, revenue_usd: 225 },
      { name_ar: 'كابل HDMI', units_sold: 12, revenue_usd: 48 },
    ])
    const { items, load } = useBestSellers()
    await load('today')
    expect(items.value).toHaveLength(2)
    expect(items.value[0].nameAr).toBe('شاشة سامسونج')
    expect(items.value[0].unitsSold).toBe(5)
    expect(items.value[1].revenueUsd).toBe(48)
  })

  it('load returns empty array when no sales in period', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([])
    const { items, load } = useBestSellers()
    await load('week')
    expect(items.value).toHaveLength(0)
  })
})
