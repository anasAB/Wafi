import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/store/device.store', () => ({ useDeviceStore: () => ({ shopId: 'shop1' }) }))

import { db } from '@/data/powersync/db'
import { useInventoryIntelligence } from '@/features/dashboard/composables/useInventoryIntelligence'

describe('useInventoryIntelligence', () => {
  beforeEach(() => vi.resetAllMocks())

  it('uses the 60-day threshold and surfaces frozen capital + top offenders', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { id: 'p1', name_ar: 'منتج أ', current_stock: 10, cost_price_usd: 50, created_at: '2026-01-01', last_sold_at: null },
      { id: 'p2', name_ar: 'منتج ب', current_stock: 2, cost_price_usd: 5, created_at: '2026-01-01', last_sold_at: null },
    ] as any)
    const { data, load } = useInventoryIntelligence()
    await load()
    expect(data.value?.productCount).toBe(2)
    expect(data.value?.totalFrozenCapitalUsd).toBe(510) // 10*50 + 2*5
    expect(data.value?.topOffenders[0].productId).toBe('p1')
  })
})
