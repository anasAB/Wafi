import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetCustomerAgingSnapshot = vi.fn()
vi.mock('../../primitives/getCustomerAgingSnapshot', () => ({
  getCustomerAgingSnapshot: (...args: unknown[]) => mockGetCustomerAgingSnapshot(...args),
}))

import { computeCreditReport } from '../creditReport'

describe('computeCreditReport', () => {
  beforeEach(() => vi.clearAllMocks())

  it('builds Outstanding Credit summary plus Overdue Accounts and Risk Distribution detail sections from customer aging snapshot', async () => {
    mockGetCustomerAgingSnapshot
      .mockResolvedValueOnce([
        // Current snapshot
        { customerId: 'c1', customerName: 'Customer 1', balanceUsd: 100, daysOutstanding: 45 },
        { customerId: 'c2', customerName: 'Customer 2', balanceUsd: 200, daysOutstanding: 25 },
        { customerId: 'c3', customerName: 'Customer 3', balanceUsd: 150, daysOutstanding: 75 },
      ])
      .mockResolvedValueOnce([
        // Prior snapshot
        { customerId: 'c1', customerName: 'Customer 1', balanceUsd: 80, daysOutstanding: 15 },
        { customerId: 'c3', customerName: 'Customer 3', balanceUsd: 120, daysOutstanding: 45 },
      ])

    const report = await computeCreditReport('shop1', { from: '2026-08-01', to: '2026-08-31' })

    expect(report.id).toBe('credit-report')
    expect(report.name).toBe('Credit Report')

    // Section structure
    const types = report.sections.map((s) => s.type)
    expect(types).toEqual(['summary', 'detail', 'detail'])

    // Outstanding Credit summary
    const summarySection = report.sections[0]
    expect(summarySection.type).toBe('summary')
    if (summarySection.type === 'summary') {
      expect(summarySection.metrics.find((m) => m.label === 'Total outstanding')?.value).toBe(450) // 100+200+150
      expect(summarySection.metrics.find((m) => m.label === 'New debt this period')?.value).toBe(200) // c2 is new (not in prior)
    }

    // Overdue Accounts detail
    const overdueSection = report.sections[1]
    expect(overdueSection.type).toBe('detail')
    if (overdueSection.type === 'detail') {
      expect(overdueSection.title).toBe('Overdue Accounts')
      expect(overdueSection.rows.length).toBe(2) // c1 (45 days), c3 (75 days) -- c2 is 25 days, not overdue
    }

    // Risk Distribution detail
    const riskSection = report.sections[2]
    expect(riskSection.type).toBe('detail')
    if (riskSection.type === 'detail') {
      expect(riskSection.title).toBe('Risk Distribution')
      expect(riskSection.rows.length).toBe(3) // 0-30 (c2), 31-60 (c1), 61-90 (c3)
    }
  })
})
