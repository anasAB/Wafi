import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetAll = vi.fn()
vi.mock('@/data/powersync/db', () => ({ db: { getAll: (...a: unknown[]) => mockGetAll(...a) } }))

vi.mock('../../primitives/readProfitCache', () => ({
  readProfitCache: vi.fn()
    .mockResolvedValueOnce({ revenueUsd: 1000, revenueSyp: 0, cogsUsd: 400, cogsReversalUsd: 0, expensesUsd: 100, refundsUsd: 0, discountUsd: 20, invoiceCount: 20, returnCount: 0, costlessSaleCount: 0, netRevenueUsd: 1000, netCogsUsd: 400, profitUsd: 500 }) // current
    .mockResolvedValueOnce({ revenueUsd: 800, revenueSyp: 0, cogsUsd: 320, cogsReversalUsd: 0, expensesUsd: 80, refundsUsd: 0, discountUsd: 16, invoiceCount: 16, returnCount: 0, costlessSaleCount: 0, netRevenueUsd: 800, netCogsUsd: 320, profitUsd: 400 }), // prior
}))

vi.mock('../../primitives/getStaffMetrics', () => ({
  getStaffMetrics: vi.fn().mockResolvedValue([
    { staffId: 's1', name: 'Ali', revenueUsd: 600, cogsUsd: 240, marginUsd: 360, marginPct: 100, salesCount: 12, avgTicketUsd: 50, discountUsd: 12, discountRate: 2 },
    { staffId: 's2', name: 'Sara', revenueUsd: 400, cogsUsd: 160, marginUsd: 240, marginPct: 100, salesCount: 8, avgTicketUsd: 50, discountUsd: 8, discountRate: 2 },
  ]),
}))

vi.mock('../../primitives/getCustomerAgingSnapshot', () => ({
  getCustomerAgingSnapshot: vi.fn()
    .mockResolvedValueOnce([
      { customerId: 'c1', nameAr: 'محمد', balanceUsd: 100 },
      { customerId: 'c2', nameAr: 'فاطمة', balanceUsd: 50 },
    ]) // current (range.to)
    .mockResolvedValueOnce([
      { customerId: 'c1', nameAr: 'محمد', balanceUsd: 80 },
      { customerId: 'c2', nameAr: 'فاطمة', balanceUsd: 40 },
    ]), // prior (prior.to)
}))

import { computeWeeklySummaryReport } from '../weeklySummary'
import { readProfitCache } from '../../primitives/readProfitCache'
import { getCustomerAgingSnapshot } from '../../primitives/getCustomerAgingSnapshot'

describe('computeWeeklySummaryReport', () => {
  beforeEach(() => vi.clearAllMocks())

  it('builds week-over-week metrics, staff ranking, inventory changes, daily performance, and customer debt trend', async () => {
    mockGetAll
      .mockResolvedValueOnce([
        { productId: 'p1', nameAr: 'قلم', adjustmentCount: 5, netQuantityDelta: -10 },
      ]) // inventory changes
      .mockResolvedValueOnce([
        { day: '2026-08-18', revenue_usd: 200 },
        { day: '2026-08-17', revenue_usd: 180 },
      ]) // daily rows

    const report = await computeWeeklySummaryReport('shop1', { from: '2026-08-18', to: '2026-08-24' })

    expect(report.id).toBe('weekly-summary')
    expect(report.sections).toHaveLength(5)

    // Check section types and titles
    expect(report.sections[0].type).toBe('summary')
    if (report.sections[0].type === 'summary') {
      expect(report.sections[0].title).toBe('Week over Week')
      expect(report.sections[0].metrics.find((m) => m.label === 'Revenue')?.value).toBe(1000)
      expect(report.sections[0].metrics.find((m) => m.label === 'Revenue vs. last week')?.value).toBe(200) // 1000 - 800
    }

    // Check staff ranking
    expect(report.sections[1].type).toBe('detail')
    if (report.sections[1].type === 'detail') {
      expect(report.sections[1].title).toBe('Staff Ranking')
      expect(report.sections[1].rows[0].name).toBe('Ali') // sorted by revenue desc
    }

    // Check inventory changes
    expect(report.sections[2].type).toBe('detail')
    if (report.sections[2].type === 'detail') {
      expect(report.sections[2].title).toBe('Inventory Changes')
    }

    // Check customer debt trend
    expect(report.sections[4].type).toBe('summary')
    if (report.sections[4].type === 'summary') {
      expect(report.sections[4].title).toBe('Customer Debt Trend')
      expect(report.sections[4].metrics.find((m) => m.label === 'Outstanding debt')?.value).toBe(150) // 100 + 50
      expect(report.sections[4].metrics.find((m) => m.label === 'Change vs. last week')?.value).toBe(30) // 150 - 120
    }
  })

  it('I4: shifts the prior-period comparison back by the ACTUAL selected range length, not a hardcoded 7 days', async () => {
    // Self-contained: readProfitCache/getCustomerAgingSnapshot's module-level
    // mockResolvedValueOnce queues (above) are shared across this file's tests
    // and consumed by the previous test -- reset + re-queue fresh values here
    // so this test doesn't depend on run order.
    const minimalProfit = { revenueUsd: 0, revenueSyp: 0, cogsUsd: 0, cogsReversalUsd: 0, expensesUsd: 0, refundsUsd: 0, discountUsd: 0, invoiceCount: 0, returnCount: 0, costlessSaleCount: 0, netRevenueUsd: 0, netCogsUsd: 0, profitUsd: 0 }
    vi.mocked(readProfitCache).mockReset().mockResolvedValue(minimalProfit)
    vi.mocked(getCustomerAgingSnapshot).mockReset().mockResolvedValue([])
    mockGetAll.mockResolvedValueOnce([]).mockResolvedValueOnce([])

    // A 30-day range (Aug 1 - Aug 30 inclusive): the prior period must be the
    // same 30-day length immediately before it, i.e. Jul 2 - Jul 31 -- NOT
    // Jul 25 - Aug 23 (a hardcoded -7 day shift).
    await computeWeeklySummaryReport('shop1', { from: '2026-08-01', to: '2026-08-30' })

    const priorRangeCall = vi.mocked(readProfitCache).mock.calls[1]
    expect(priorRangeCall[1]).toEqual({ from: '2026-07-02', to: '2026-07-31' })
  })
})
