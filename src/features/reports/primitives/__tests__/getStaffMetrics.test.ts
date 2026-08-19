// src/features/reports/primitives/__tests__/getStaffMetrics.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetAll = vi.fn()
vi.mock('@/data/powersync/db', () => ({ db: { getAll: (...args: unknown[]) => mockGetAll(...args) } }))

import { getStaffMetrics } from '../getStaffMetrics'

describe('getStaffMetrics', () => {
  beforeEach(() => vi.clearAllMocks())

  it('computes revenue/cogs/margin net of returns, attributed the same way as useStaffPerformanceMetrics.ts, and surfaces raw return figures separately', async () => {
    mockGetAll
      .mockResolvedValueOnce([{ staffId: 's1', name: 'Ali', salesCount: 2, grossUsd: 100 }]) // sales
      .mockResolvedValueOnce([{ staffId: 's1', cogs: 40 }]) // cogs
      .mockResolvedValueOnce([{ staffId: 's1', total: 10, returnCount: 2 }]) // return revenue + count
      .mockResolvedValueOnce([{ staffId: 's1', cogs: 4 }]) // return cogs
      .mockResolvedValueOnce([{ staffId: 's1', discountUsd: 5 }]) // discounts

    const rows = await getStaffMetrics('shop1', { from: '2026-08-01', to: '2026-08-07' })

    expect(rows).toHaveLength(1)
    expect(rows[0].revenueUsd).toBe(90) // 100 - 10
    expect(rows[0].cogsUsd).toBe(36) // 40 - 4
    expect(rows[0].marginUsd).toBe(54)
    expect(rows[0].marginPct).toBe(100) // only staff member, 100% of shop-period margin
    expect(rows[0].avgTicketUsd).toBe(50) // gross 100 / 2 sales, unaffected by return attribution
    expect(rows[0].discountRate).toBeCloseTo((5 / 90) * 100)
    expect(rows[0].returnRevenueUsd).toBe(10)
    expect(rows[0].returnCount).toBe(2)
  })

  it('avgTicketUsd and discountRate are null (not 0) when there is no data to divide by', async () => {
    mockGetAll
      .mockResolvedValueOnce([{ staffId: 's1', name: 'Ali', salesCount: 0, grossUsd: 0 }])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    const rows = await getStaffMetrics('shop1', { from: '2026-08-01', to: '2026-08-01' })
    expect(rows[0].avgTicketUsd).toBeNull()
    expect(rows[0].discountRate).toBeNull()
  })
})
