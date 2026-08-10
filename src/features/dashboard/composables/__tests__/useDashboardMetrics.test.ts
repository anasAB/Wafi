import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/store/device.store', () => ({
  useDeviceStore: () => ({ shopId: 'shop1' }),
}))

import { db } from '@/data/powersync/db'
import { useDashboardMetrics } from '@/features/dashboard/composables/useDashboardMetrics'

describe('useDashboardMetrics — returnCount and discountUsd', () => {
  beforeEach(() => vi.resetAllMocks())

  it('exposes returnCount from a COUNT(*) query against returns, separate from refundsUsd', async () => {
    vi.mocked(db.getOptional).mockImplementation(async (sql: unknown) => {
      // Normalize whitespace/line-wrapping before matching, so this test
      // asserts on query intent (which table/aggregate is queried) rather
      // than on how the SQL template literal happens to be wrapped across
      // physical lines in the source.
      const s = (sql as string).replace(/\s+/g, ' ')
      if (/COUNT\(\*\) as count FROM returns/.test(s)) return { count: 7 } as any
      if (/SUM\(r\.refund_amount_usd\)/.test(s)) return { total: 340 } as any
      return { total: 0, count: 0 } as any
    })
    const metrics = useDashboardMetrics()
    await metrics.loadRange('2026-08-01', '2026-08-10')
    expect(metrics.returnCount.value).toBe(7)
    expect(metrics.refundsUsd.value).toBe(340)
  })

  it('exposes discountUsd from SUM(sale_discount_amount_usd) FROM sales', async () => {
    vi.mocked(db.getOptional).mockImplementation(async (sql: unknown) => {
      const s = (sql as string).replace(/\s+/g, ' ')
      if (/SUM\(sale_discount_amount_usd\)/.test(s)) return { total: 120.5 } as any
      return { total: 0, count: 0 } as any
    })
    const metrics = useDashboardMetrics()
    await metrics.loadRange('2026-08-01', '2026-08-10')
    expect(metrics.discountUsd.value).toBe(120.5)
  })
})
