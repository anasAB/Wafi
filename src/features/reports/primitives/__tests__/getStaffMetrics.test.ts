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

  it('I5: includes a staff member who processed returns but rang up zero sales in the range, fetching their name from staff directly', async () => {
    mockGetAll
      .mockResolvedValueOnce([{ staffId: 's1', name: 'Ali', salesCount: 2, grossUsd: 100 }]) // sales -- s2 absent
      .mockResolvedValueOnce([{ staffId: 's1', cogs: 40 }]) // cogs
      .mockResolvedValueOnce([{ staffId: 's1', total: 10, returnCount: 2 }, { staffId: 's2', total: 30, returnCount: 1 }]) // return revenue + count
      .mockResolvedValueOnce([{ staffId: 's1', cogs: 4 }, { staffId: 's2', cogs: 12 }]) // return cogs
      .mockResolvedValueOnce([{ staffId: 's1', discountUsd: 5 }]) // discounts
      .mockResolvedValueOnce([{ id: 's2', name: 'Sara' }]) // staff-name lookup for return-only ids

    const rows = await getStaffMetrics('shop1', { from: '2026-08-01', to: '2026-08-07' })

    expect(rows).toHaveLength(2)
    const sara = rows.find((r) => r.staffId === 's2')
    expect(sara).toBeDefined()
    expect(sara?.name).toBe('Sara')
    expect(sara?.salesCount).toBe(0)
    expect(sara?.avgTicketUsd).toBeNull()
    expect(sara?.returnRevenueUsd).toBe(30)
    expect(sara?.returnCount).toBe(1)
    expect(sara?.revenueUsd).toBe(-30) // 0 gross - 30 returns
    expect(sara?.cogsUsd).toBe(-12) // 0 cogs - 12 return cogs
  })
})
