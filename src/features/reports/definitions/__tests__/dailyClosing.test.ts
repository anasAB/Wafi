import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetAll = vi.fn()
const mockGetOptional = vi.fn()
vi.mock('@/data/powersync/db', () => ({ db: { getAll: (...a: unknown[]) => mockGetAll(...a), getOptional: (...a: unknown[]) => mockGetOptional(...a) } }))

vi.mock('../../primitives/readProfitCache', () => ({
  readProfitCache: vi.fn().mockResolvedValue({
    revenueUsd: 500, revenueSyp: 0, cogsUsd: 200, cogsReversalUsd: 0, expensesUsd: 50,
    refundsUsd: 0, discountUsd: 10, invoiceCount: 8, returnCount: 0, costlessSaleCount: 0,
    netRevenueUsd: 500, netCogsUsd: 200, profitUsd: 250,
  }),
}))
vi.mock('../../primitives/getStaffMetrics', () => ({
  getStaffMetrics: vi.fn().mockResolvedValue([
    { staffId: 's1', name: 'Ali', revenueUsd: 500, cogsUsd: 200, marginUsd: 300, marginPct: 100, salesCount: 8, avgTicketUsd: 62.5, discountUsd: 10, discountRate: 2 },
  ]),
}))
vi.mock('../../primitives/readShiftCashReconciliation', () => ({
  readShiftCashReconciliation: vi.fn().mockResolvedValue({
    expectedUsd: 145, actualUsd: 150, varianceUsd: 5, cashSalesUsd: 400, cashExpensesUsd: 50,
    cashRefundsUsd: 0, cashCreditPaymentsUsd: 0, cashPayInsUsd: 0, cashPayOutsUsd: 0,
  }),
}))

import { computeDailyClosingReport } from '../dailyClosing'

describe('computeDailyClosingReport', () => {
  beforeEach(() => vi.clearAllMocks())

  it('builds sales/cash/expenses summaries plus top-products/staff detail sections, reading cash reconciliation from readShiftCashReconciliation (never recomputing it)', async () => {
    mockGetAll
      .mockResolvedValueOnce([{ productId: 'p1', nameAr: 'قلم', quantitySold: 10, revenueUsd: 100 }]) // top 5
    mockGetOptional
      .mockResolvedValueOnce({ total: 300 }) // customer payments received

    const report = await computeDailyClosingReport('shop1', { from: '2026-08-18', to: '2026-08-18' })

    expect(report.id).toBe('daily-closing')
    const types = report.sections.map((s) => s.type)
    expect(types).toEqual(['summary', 'summary', 'summary', 'detail', 'detail'])
    const cashSection = report.sections[1]
    expect(cashSection.type).toBe('summary')
    if (cashSection.type === 'summary') {
      expect(cashSection.metrics.find((m) => m.label === 'Expected cash')?.value).toBe(145)
      expect(cashSection.metrics.find((m) => m.label === 'Variance')?.value).toBe(5)
    }
    const salesSummary = report.sections[0]
    expect(salesSummary.type).toBe('summary')
    if (salesSummary.type === 'summary') {
      expect(salesSummary.metrics.find((m) => m.label === 'Average basket')?.value).toBeCloseTo(500 / 8)
    }
  })
})
