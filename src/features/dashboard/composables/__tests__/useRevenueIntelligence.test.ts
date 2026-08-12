import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/store/device.store', () => ({ useDeviceStore: () => ({ shopId: 'shop1' }) }))

import { db } from '@/data/powersync/db'
import { useRevenueIntelligence } from '@/features/dashboard/composables/useRevenueIntelligence'
import * as insightRangesModule from '@/features/dashboard/composables/insightRanges'

// useProfitCache reads ONE row-set from `profit_cache` (SUM'd in cents) per
// loadRange() call, unlike the old useDashboardMetrics which issued 10
// fine-grained getOptional() queries. Route on call order: 1st loadRange call
// is the current period, 2nd is the comparison period (matches useRevenueIntelligence's
// Promise.all([currentMetrics.loadRange, previousMetrics.loadRange]) instantiation order).
function mockRow(current: { total?: number; count?: number }, previous: { total?: number; count?: number }) {
  let call = 0
  vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
    if (!/FROM profit_cache/.test(sql)) return [] as any
    call++
    const src = call === 1 ? current : previous
    return [{
      revenue_usd: (src.total ?? 0) * 100, revenue_syp: 0, cogs_usd: 0, cogs_reversal_usd: 0,
      expenses_usd: 0, refunds_usd: 0, discount_usd: 0,
      invoice_count: src.count ?? 0, return_count: 0, costless_sale_count: 0,
    }] as any
  })
}

describe('useRevenueIntelligence', () => {
  beforeEach(() => vi.resetAllMocks())

  it('computes metric + drivers for a completed week period (no day-gating)', async () => {
    mockRow({ total: 900, count: 45 }, { total: 1000, count: 55 })
    const { data, load } = useRevenueIntelligence()
    await load('week')
    expect(data.value?.metric.currentUsd).toBe(900)
    expect(data.value?.metric.previousUsd).toBe(1000)
    expect(data.value?.metric.direction).toBe('down')
    expect(data.value?.drivers).not.toBeNull()
    expect(data.value?.drivers?.find(d => d.key === 'transactionCount')).toEqual(
      expect.objectContaining({ current: 45, previous: 55 })
    )
  })

  it('returns changePct null and drivers unaffected when previousUsd is 0', async () => {
    mockRow({ total: 500, count: 10 }, { total: 0, count: 0 })
    const { data, load } = useRevenueIntelligence()
    await load('week')
    expect(data.value?.metric.changePct).toBeNull()
    expect(data.value?.metric.direction).toBe('up')
  })

  it('gates drivers null for incomplete day (isCurrentDayComplete: false), but metric still populated', async () => {
    mockRow({ total: 700, count: 35 }, { total: 800, count: 40 })
    // Mock getInsightRanges to return isCurrentDayComplete: false for 'day' period
    vi.spyOn(insightRangesModule, 'getInsightRanges').mockReturnValue({
      current: { start: '2026-08-10', end: '2026-08-10' },
      comparison: { start: '2026-08-03', end: '2026-08-03' },
      isCurrentDayComplete: false,
    })
    const { data, load } = useRevenueIntelligence()
    await load('day')
    // Metric headline must be visible even on incomplete day
    expect(data.value?.metric.currentUsd).toBe(700)
    expect(data.value?.metric.previousUsd).toBe(800)
    expect(data.value?.metric.direction).toBe('down')
    // But drivers must be null to avoid misleading comparison of partial vs full day
    expect(data.value?.drivers).toBeNull()
  })
})
