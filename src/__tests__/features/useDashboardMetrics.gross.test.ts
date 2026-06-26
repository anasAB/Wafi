import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useDashboardMetrics } from '@/features/dashboard/composables/useDashboardMetrics'
import { db } from '@/data/powersync/db'

describe('useDashboardMetrics gross income breakdown', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('exposes gross income and preserves net-profit math with refunds', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ total: 1000 } as any) // gross sales
      .mockResolvedValueOnce({ cogs: 300 } as any)   // cogs
      .mockResolvedValueOnce({ total: 100 } as any)  // expenses
      .mockResolvedValueOnce({ total: 150 } as any)  // refunds
      .mockResolvedValueOnce({ cogs: 0 } as any)     // cogs reversal
      .mockResolvedValueOnce({ count: 0 } as any)    // missing-cost active products
      .mockResolvedValueOnce({ count: 12 } as any)   // invoice count
      .mockResolvedValueOnce({ count: 0 } as any)    // costless sales in period

    const m = useDashboardMetrics()
    await m.load('today')

    expect(m.grossIncomeUsd.value).toBe(1000)
    expect(m.refundsUsd.value).toBe(150)
    expect(m.revenueUsd.value).toBe(850)
    expect(m.profitUsd.value).toBe(450)
  })
})
