import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/store/device.store', () => ({ useDeviceStore: () => ({ shopId: 'shop1' }) }))

import { db } from '@/data/powersync/db'
import { useRevenueIntelligence } from '@/features/dashboard/composables/useRevenueIntelligence'

function mockRow(current: { total?: number; count?: number }, previous: { total?: number; count?: number }) {
  let call = 0
  vi.mocked(db.getOptional).mockImplementation(async () => {
    call++
    // useDashboardMetrics issues 10 getOptional calls per loadRange() invocation.
    // Calls 1-10: current period, 11-20: previous period.
    const isFirstPeriod = call <= 10
    const src = isFirstPeriod ? current : previous

    // Query order in useDashboardMetrics.run(): revenue, cogs, expenses, refunds, cogs_reversal, missing, count, costless, returns, discounts
    // Distribute values: revenue gets src.total, refunds/expenses/discounts get 0, cogs gets 0, counts get src.count
    const queryIndex = ((call - 1) % 10)
    if (queryIndex === 0) {
      // Revenue
      return { total: src.total ?? 0 } as any
    } else if (queryIndex === 1 || queryIndex === 4) {
      // COGS and COGS reversal
      return { cogs: 0 } as any
    } else if (queryIndex === 2) {
      // Expenses
      return { total: 0 } as any
    } else if (queryIndex === 3) {
      // Refunds
      return { total: 0 } as any
    } else if (queryIndex === 9) {
      // Discounts
      return { total: 0 } as any
    } else {
      // Counts (indices 5, 6, 7, 8)
      return { count: src.count ?? 0 } as any
    }
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
})
