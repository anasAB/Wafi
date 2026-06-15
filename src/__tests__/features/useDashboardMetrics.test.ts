import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useDashboardMetrics } from '@/features/dashboard/composables/useDashboardMetrics'
import { db } from '@/data/powersync/db'

describe('useDashboardMetrics', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getOptional).mockResolvedValue(null)
  })

  it('revenue defaults to 0', async () => {
    const { revenueUsd, load } = useDashboardMetrics()
    await load('today')
    expect(revenueUsd.value).toBe(0)
  })

  // Query order in load(): revenue, cogs, expenses, refunds, cogsReversal, missingCost, count
  it('load queries revenue from sales with date range', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ total: 450 } as any)  // revenue
      .mockResolvedValueOnce({ cogs: 210 } as any)   // cogs
      .mockResolvedValueOnce({ total: 80 } as any)   // expenses
      .mockResolvedValueOnce({ total: 0 } as any)    // refunds
      .mockResolvedValueOnce({ cogs: 0 } as any)     // cogs reversal
      .mockResolvedValueOnce({ count: 2 } as any)    // missing cost
    const { revenueUsd, load } = useDashboardMetrics()
    await load('today')
    expect(revenueUsd.value).toBe(450)
    expect(db.getOptional).toHaveBeenCalledWith(
      expect.stringContaining('SUM(total_usd)'),
      expect.any(Array)
    )
  })

  it('profitUsd is revenue - cogs - expenses (computed)', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ total: 450 } as any)
      .mockResolvedValueOnce({ cogs: 210 } as any)
      .mockResolvedValueOnce({ total: 80 } as any)
      .mockResolvedValueOnce({ total: 0 } as any)
      .mockResolvedValueOnce({ cogs: 0 } as any)
    const { profitUsd, load } = useDashboardMetrics()
    await load('today')
    expect(profitUsd.value).toBeCloseTo(160, 5)
  })

  it('profitUsd is negative when expenses exceed revenue', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ total: 50 } as any)
      .mockResolvedValueOnce({ cogs: 0 } as any)
      .mockResolvedValueOnce({ total: 100 } as any)
      .mockResolvedValueOnce({ total: 0 } as any)
      .mockResolvedValueOnce({ cogs: 0 } as any)
    const { profitUsd, load } = useDashboardMetrics()
    await load('today')
    expect(profitUsd.value).toBe(-50)
  })

  it('returns reduce revenue and reverse restocked COGS', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ total: 450 } as any)  // gross revenue
      .mockResolvedValueOnce({ cogs: 210 } as any)   // gross cogs
      .mockResolvedValueOnce({ total: 0 } as any)    // expenses
      .mockResolvedValueOnce({ total: 100 } as any)  // refunds
      .mockResolvedValueOnce({ cogs: 60 } as any)    // cogs reversal (restocked)
    const { revenueUsd, cogsUsd, refundsUsd, profitUsd, load } = useDashboardMetrics()
    await load('today')
    expect(refundsUsd.value).toBe(100)
    expect(revenueUsd.value).toBe(350) // 450 - 100
    expect(cogsUsd.value).toBe(150)    // 210 - 60
    expect(profitUsd.value).toBe(200)  // 350 - 150 - 0
  })

  it('missingCostCount reflects products with missing cost price', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ total: 0 } as any)
      .mockResolvedValueOnce({ cogs: 0 } as any)
      .mockResolvedValueOnce({ total: 0 } as any)
      .mockResolvedValueOnce({ total: 0 } as any)
      .mockResolvedValueOnce({ cogs: 0 } as any)
      .mockResolvedValueOnce({ count: 5 } as any)
    const { missingCostCount, load } = useDashboardMetrics()
    await load('today')
    expect(missingCostCount.value).toBe(5)
  })
})
