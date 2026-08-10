import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/store/device.store', () => ({ useDeviceStore: () => ({ shopId: 'shop1' }) }))

import { db } from '@/data/powersync/db'
import { useProfitIntelligence } from '@/features/dashboard/composables/useProfitIntelligence'
import * as insightRangesModule from '@/features/dashboard/composables/insightRanges'

function mockRow(current: { total?: number; cogs?: number; count?: number }, previous: { total?: number; cogs?: number; count?: number }) {
  let call = 0
  vi.mocked(db.getOptional).mockImplementation(async () => {
    call++
    // useDashboardMetrics issues 10 getOptional calls per loadRange() invocation.
    // Calls 1-10: current period, 11-20: previous period.
    const isFirstPeriod = call <= 10
    const src = isFirstPeriod ? current : previous

    // Query order in useDashboardMetrics.run(): revenue, cogs, expenses, refunds, cogs_reversal, missing, count, costless, returns, discounts
    const queryIndex = ((call - 1) % 10)
    if (queryIndex === 0) {
      // Revenue
      return { total: src.total ?? 0 } as any
    } else if (queryIndex === 1) {
      // COGS
      return { cogs: src.cogs ?? 0 } as any
    } else if (queryIndex === 2) {
      // Expenses
      return { total: 0 } as any
    } else if (queryIndex === 3) {
      // Refunds
      return { total: 0 } as any
    } else if (queryIndex === 4) {
      // COGS reversal
      return { cogs: 0 } as any
    } else if (queryIndex === 9) {
      // Discounts
      return { total: src.total ?? 0 } as any
    } else {
      // Counts and missing (indices 5, 6, 7, 8)
      return { count: src.count ?? 0 } as any
    }
  })
}

describe('useProfitIntelligence', () => {
  beforeEach(() => vi.resetAllMocks())

  it('headline metric is profit USD, not margin percentage', async () => {
    mockRow({ total: 10000, cogs: 6000, count: 0 }, { total: 12000, cogs: 6500, count: 0 })
    const { data, load } = useProfitIntelligence()
    await load('week')
    // current profit = 10000 - 6000 = 4000; previous = 12000 - 6500 = 5500
    expect(data.value?.metric.currentUsd).toBe(4000)
    expect(data.value?.metric.previousUsd).toBe(5500)
    expect(data.value?.marginCurrentPct).toBeCloseTo(40)   // 4000/10000
    expect(data.value?.marginPreviousPct).toBeCloseTo(45.83, 1) // 5500/12000
    expect(data.value?.drivers?.map(d => d.key)).toEqual(['revenue', 'cogs', 'discounts'])
  })

  it('gates drivers null for incomplete day (isCurrentDayComplete: false), but metric and margins still populated', async () => {
    mockRow({ total: 8000, cogs: 5000, count: 0 }, { total: 9000, cogs: 5500, count: 0 })
    // Mock getInsightRanges to return isCurrentDayComplete: false for 'day' period
    vi.spyOn(insightRangesModule, 'getInsightRanges').mockReturnValue({
      current: { start: '2026-08-10', end: '2026-08-10' },
      comparison: { start: '2026-08-03', end: '2026-08-03' },
      isCurrentDayComplete: false,
    })
    const { data, load } = useProfitIntelligence()
    await load('day')
    // current profit = 8000 - 5000 = 3000; previous = 9000 - 5500 = 3500
    expect(data.value?.metric.currentUsd).toBe(3000)
    expect(data.value?.metric.previousUsd).toBe(3500)
    expect(data.value?.marginCurrentPct).toBeCloseTo(37.5)   // 3000/8000
    expect(data.value?.marginPreviousPct).toBeCloseTo(38.89, 1) // 3500/9000
    // But drivers must be null to avoid misleading comparison of partial vs full day
    expect(data.value?.drivers).toBeNull()
  })

  it('handles zero revenue without division by zero', async () => {
    mockRow({ total: 0, cogs: 0, count: 0 }, { total: 1000, cogs: 500, count: 0 })
    const { data, load } = useProfitIntelligence()
    await load('week')
    expect(data.value?.metric.currentUsd).toBe(0)
    expect(data.value?.metric.previousUsd).toBe(500)
    expect(data.value?.marginCurrentPct).toBeNull()   // null when current revenue is 0
    expect(data.value?.marginPreviousPct).toBe(50)    // 500/1000
    expect(data.value?.drivers).not.toBeNull()
  })
})
