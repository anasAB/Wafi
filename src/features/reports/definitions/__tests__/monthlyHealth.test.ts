import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetAll = vi.fn()
const mockGetOptional = vi.fn()
vi.mock('@/data/powersync/db', () => ({
  db: {
    getAll: (...a: unknown[]) => mockGetAll(...a),
    getOptional: (...a: unknown[]) => mockGetOptional(...a),
  },
}))

vi.mock('../../primitives/readProfitCache', () => ({
  readProfitCache: vi.fn().mockResolvedValue({
    revenueUsd: 1000, revenueSyp: 0, netRevenueUsd: 1000, netCogsUsd: 400, expensesUsd: 200, profitUsd: 400,
  }),
}))

vi.mock('../../primitives/getStaffMetrics', () => ({
  getStaffMetrics: vi.fn().mockResolvedValue([
    { staffId: 's1', name: 'Ali', marginUsd: 300 },
  ]),
}))

import { computeMonthlyHealthReport } from '../monthlyHealth'

describe('computeMonthlyHealthReport', () => {
  beforeEach(() => vi.clearAllMocks())

  it('builds P&L Summary, Inventory Valuation, Top Products, Top Customers, and Staff Performance sections', async () => {
    mockGetAll
      .mockResolvedValueOnce([
        { productId: 'p1', nameAr: 'منتج 1', value: 500 },
      ])
      .mockResolvedValueOnce([
        { customerId: 'c1', customerName: 'Customer 1', revenueUsd: 300, visitCount: 5 },
      ])

    mockGetOptional.mockResolvedValueOnce({ total: 1500 })

    const report = await computeMonthlyHealthReport('shop1', { from: '2026-08-01', to: '2026-08-31' })

    expect(report.id).toBe('monthly-health')
    expect(report.name).toBe('Monthly Business Health')

    // Section structure
    const types = report.sections.map((s) => s.type)
    expect(types).toEqual(['summary', 'summary', 'detail', 'detail', 'detail'])

    // P&L Summary
    const plSummary = report.sections[0]
    expect(plSummary.type).toBe('summary')
    if (plSummary.type === 'summary') {
      expect(plSummary.title).toBe('P&L Summary')
      expect(plSummary.metrics.find((m) => m.label === 'Revenue')?.value).toBe(1000)
      expect(plSummary.metrics.find((m) => m.label === 'Net profit')?.value).toBe(400)
    }

    // Inventory Valuation summary
    const inventorySummary = report.sections[1]
    expect(inventorySummary.type).toBe('summary')
    if (inventorySummary.type === 'summary') {
      expect(inventorySummary.title).toContain('Inventory Valuation')
    }

    // Top 10 Products
    const topProducts = report.sections[2]
    expect(topProducts.type).toBe('detail')
    if (topProducts.type === 'detail') {
      expect(topProducts.title).toBe('Top 10 Products')
      expect(topProducts.rows.length).toBe(1)
    }

    // Top 10 Customers
    const topCustomers = report.sections[3]
    expect(topCustomers.type).toBe('detail')
    if (topCustomers.type === 'detail') {
      expect(topCustomers.title).toBe('Top 10 Customers')
      expect(topCustomers.rows.length).toBe(1)
    }

    // Staff Performance
    const staffSection = report.sections[4]
    expect(staffSection.type).toBe('detail')
    if (staffSection.type === 'detail') {
      expect(staffSection.title).toBe('Staff Performance Review')
      expect(staffSection.rows.length).toBe(1)
    }
  })
})
