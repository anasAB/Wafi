import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetAll = vi.fn()
vi.mock('@/data/powersync/db', () => ({ db: { getAll: (...a: unknown[]) => mockGetAll(...a) } }))

vi.mock('../../primitives/readProfitCache', () => ({
  readProfitCache: vi.fn().mockResolvedValue({
    revenueUsd: 500, revenueSyp: 0, cogsUsd: 200, cogsReversalUsd: 0, expensesUsd: 50,
    refundsUsd: 100, discountUsd: 10, invoiceCount: 8, returnCount: 2, costlessSaleCount: 0,
    netRevenueUsd: 500, netCogsUsd: 200, profitUsd: 250,
  }),
}))

vi.mock('../../primitives/getStaffMetrics', () => ({
  getStaffMetrics: vi.fn().mockResolvedValue([
    { staffId: 's1', name: 'Ali', revenueUsd: 500, cogsUsd: 200, marginUsd: 300, marginPct: 100, salesCount: 8, avgTicketUsd: 62.5, discountUsd: 10, discountRate: 2, returnRevenueUsd: 80, returnCount: 1 },
    { staffId: 's2', name: 'Sara', revenueUsd: 0, cogsUsd: 0, marginUsd: 0, marginPct: 0, salesCount: 0, avgTicketUsd: 0, discountUsd: 0, discountRate: 0, returnRevenueUsd: 20, returnCount: 1 },
    { staffId: 's3', name: 'Ahmed', revenueUsd: 300, cogsUsd: 100, marginUsd: 200, marginPct: 100, salesCount: 5, avgTicketUsd: 60, discountUsd: 5, discountRate: 1, returnRevenueUsd: 0, returnCount: 0 },
  ]),
}))

import { computeReturnsReport } from '../returnsReport'

describe('computeReturnsReport', () => {
  beforeEach(() => vi.clearAllMocks())

  it('builds total returns summary, by-staff/by-product/by-reason detail sections, with By Staff containing ReturnByStaffRow objects (4 fields, not full StaffMetricsRow)', async () => {
    mockGetAll
      .mockResolvedValueOnce([
        { productId: 'p1', nameAr: 'قلم', returnCount: 1, refundUsd: 50 },
        { productId: 'p2', nameAr: 'دفتر', returnCount: 1, refundUsd: 50 },
      ]) // by product
      .mockResolvedValueOnce([
        { reason: 'defective', count: 1 },
        { reason: 'unspecified', count: 1 },
      ]) // by reason

    const report = await computeReturnsReport('shop1', { from: '2026-08-18', to: '2026-08-18' })

    expect(report.id).toBe('returns-report')
    expect(report.sections).toHaveLength(4)

    // Total returns summary
    expect(report.sections[0].type).toBe('summary')
    if (report.sections[0].type === 'summary') {
      expect(report.sections[0].title).toBe('Total Returns')
      expect(report.sections[0].metrics.find((m) => m.label === 'Return count')?.value).toBe(2)
      expect(report.sections[0].metrics.find((m) => m.label === 'Return value')?.value).toBe(100)
    }

    // By staff detail - verify rows are ReturnByStaffRow objects (4 fields)
    expect(report.sections[1].type).toBe('detail')
    if (report.sections[1].type === 'detail') {
      expect(report.sections[1].title).toBe('By Staff')
      // Only Ali and Sara have returnCount > 0
      expect(report.sections[1].rows).toHaveLength(2)
      // Verify each row has only the 4 fields (staffId, name, returnCount, returnRevenueUsd)
      const row0 = report.sections[1].rows[0]
      expect(row0).toHaveProperty('staffId')
      expect(row0).toHaveProperty('name')
      expect(row0).toHaveProperty('returnCount')
      expect(row0).toHaveProperty('returnRevenueUsd')
      // Verify it's NOT a full StaffMetricsRow (which has salesCount, revenueUsd, etc.)
      expect(Object.keys(row0).sort()).toEqual(['name', 'returnCount', 'returnRevenueUsd', 'staffId'].sort())
    }

    // By product detail
    expect(report.sections[2].type).toBe('detail')
    if (report.sections[2].type === 'detail') {
      expect(report.sections[2].title).toBe('By Product')
      expect(report.sections[2].rows).toHaveLength(2)
    }

    // By reason detail
    expect(report.sections[3].type).toBe('detail')
    if (report.sections[3].type === 'detail') {
      expect(report.sections[3].title).toBe('Return Reasons')
      expect(report.sections[3].rows).toHaveLength(2)
    }
  })
})
