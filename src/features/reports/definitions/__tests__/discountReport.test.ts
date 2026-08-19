import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetAll = vi.fn()
vi.mock('@/data/powersync/db', () => ({ db: { getAll: (...a: unknown[]) => mockGetAll(...a) } }))

vi.mock('../../primitives/readProfitCache', () => ({
  readProfitCache: vi.fn().mockResolvedValue({
    revenueUsd: 500, revenueSyp: 0, cogsUsd: 200, cogsReversalUsd: 0, expensesUsd: 50,
    refundsUsd: 0, discountUsd: 50, invoiceCount: 8, returnCount: 0, costlessSaleCount: 0,
    netRevenueUsd: 500, netCogsUsd: 200, profitUsd: 250,
  }),
}))

vi.mock('../../primitives/getStaffMetrics', () => ({
  getStaffMetrics: vi.fn().mockResolvedValue([
    { staffId: 's1', name: 'Ali', revenueUsd: 500, cogsUsd: 200, marginUsd: 300, marginPct: 100, salesCount: 8, avgTicketUsd: 62.5, discountUsd: 40, discountRate: 2, returnRevenueUsd: 0, returnCount: 0 },
    { staffId: 's2', name: 'Sara', revenueUsd: 0, cogsUsd: 0, marginUsd: 0, marginPct: 0, salesCount: 0, avgTicketUsd: 0, discountUsd: 10, discountRate: 0, returnRevenueUsd: 0, returnCount: 0 },
  ]),
}))

import { computeDiscountReport } from '../discountReport'

describe('computeDiscountReport', () => {
  beforeEach(() => vi.clearAllMocks())

  it('builds total discount summary plus by-staff, by-product, and below-cost detail sections', async () => {
    mockGetAll
      .mockResolvedValueOnce([
        { productId: 'p1', nameAr: 'قلم', discountUsd: 30 },
        { productId: 'p2', nameAr: 'دفتر', discountUsd: 20 },
      ]) // by product
      .mockResolvedValueOnce([
        { saleId: 's1', productId: 'p3', nameAr: 'مقص', unitPriceUsd: 50, unitCostUsd: 60 },
      ]) // below-cost

    const report = await computeDiscountReport('shop1', { from: '2026-08-18', to: '2026-08-18' })

    expect(report.id).toBe('discount-report')
    expect(report.sections).toHaveLength(4)

    // Total discounts summary
    expect(report.sections[0].type).toBe('summary')
    if (report.sections[0].type === 'summary') {
      expect(report.sections[0].title).toBe('Total Discounts')
      expect(report.sections[0].metrics.find((m) => m.label === 'Total discount given')?.value).toBe(50)
    }

    // By staff detail
    expect(report.sections[1].type).toBe('detail')
    if (report.sections[1].type === 'detail') {
      expect(report.sections[1].title).toBe('By Staff')
      expect(report.sections[1].rows[0].name).toBe('Ali') // sorted by discountUsd desc
    }

    // By product detail
    expect(report.sections[2].type).toBe('detail')
    if (report.sections[2].type === 'detail') {
      expect(report.sections[2].title).toBe('By Product')
      expect(report.sections[2].rows.length).toBe(2)
    }

    // Below-cost sales detail
    expect(report.sections[3].type).toBe('detail')
    if (report.sections[3].type === 'detail') {
      expect(report.sections[3].title).toBe('Below-Cost Sales')
      expect(report.sections[3].rows.length).toBe(1)
    }
  })
})
