import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetAll = vi.fn()
vi.mock('@/data/powersync/db', () => ({
  db: { getAll: (...a: unknown[]) => mockGetAll(...a) },
}))

import { computeTopCustomersReport } from '../topCustomers'

describe('computeTopCustomersReport', () => {
  beforeEach(() => vi.clearAllMocks())

  it('builds Top 20 by Revenue, Top 20 by Visits, At-Risk Customers, and New Customers sections', async () => {
    mockGetAll
      .mockResolvedValueOnce([
        { customerId: 'c1', customerName: 'Customer 1', revenueUsd: 500, visitCount: 10 },
        { customerId: 'c2', customerName: 'Customer 2', revenueUsd: 300, visitCount: 5 },
      ])
      .mockResolvedValueOnce([
        { customerId: 'c2', customerName: 'Customer 2', revenueUsd: 300, visitCount: 15 },
        { customerId: 'c1', customerName: 'Customer 1', revenueUsd: 500, visitCount: 10 },
      ])
      .mockResolvedValueOnce([
        { customerId: 'c3', customerName: 'Customer 3', lastVisit: '2026-07-01' },
      ])
      .mockResolvedValueOnce([
        { customerId: 'c4', customerName: 'New Customer', createdAt: '2026-08-15', revenueUsd: 50 },
      ])

    const report = await computeTopCustomersReport('shop1', { from: '2026-08-01', to: '2026-08-31' })

    expect(report.id).toBe('top-customers')
    expect(report.name).toBe('Top Customers Report')

    // Section structure
    const types = report.sections.map((s) => s.type)
    expect(types).toEqual(['detail', 'detail', 'detail', 'detail'])

    // Top 20 by Revenue
    const byRevenue = report.sections[0]
    expect(byRevenue.type).toBe('detail')
    if (byRevenue.type === 'detail') {
      expect(byRevenue.title).toBe('Top 20 by Revenue')
      expect(byRevenue.rows.length).toBe(2)
    }

    // Top 20 by Visits
    const byVisits = report.sections[1]
    expect(byVisits.type).toBe('detail')
    if (byVisits.type === 'detail') {
      expect(byVisits.title).toBe('Top 20 by Visits')
      expect(byVisits.rows.length).toBe(2)
    }

    // At-Risk Customers
    const atRisk = report.sections[2]
    expect(atRisk.type).toBe('detail')
    if (atRisk.type === 'detail') {
      expect(atRisk.title).toContain('At-Risk Customers')
      expect(atRisk.rows.length).toBe(1)
    }

    // New Customers
    const newCustomers = report.sections[3]
    expect(newCustomers.type).toBe('detail')
    if (newCustomers.type === 'detail') {
      expect(newCustomers.title).toBe('New Customers This Period')
      expect(newCustomers.rows.length).toBe(1)
    }
  })

  it('I10: caps At-Risk Customers and New Customers at 500 rows and marks the section truncated when more existed', async () => {
    const atRiskOverCap = Array.from({ length: 501 }, (_, i) => ({ customerId: `c${i}`, customerName: `Customer ${i}`, lastVisit: '2026-07-01' }))
    const newCustomersOverCap = Array.from({ length: 501 }, (_, i) => ({ customerId: `n${i}`, customerName: `New ${i}`, createdAt: '2026-08-15', revenueUsd: 10 }))
    mockGetAll
      .mockResolvedValueOnce([]) // by revenue
      .mockResolvedValueOnce([]) // by visits
      .mockResolvedValueOnce(atRiskOverCap)
      .mockResolvedValueOnce(newCustomersOverCap)

    const report = await computeTopCustomersReport('shop1', { from: '2026-08-01', to: '2026-08-31' })

    const atRisk = report.sections[2]
    const newCustomers = report.sections[3]
    expect(atRisk.type).toBe('detail')
    expect(newCustomers.type).toBe('detail')
    if (atRisk.type === 'detail' && newCustomers.type === 'detail') {
      expect(atRisk.rows.length).toBe(500)
      expect(atRisk.truncated).toBe(true)
      expect(newCustomers.rows.length).toBe(500)
      expect(newCustomers.truncated).toBe(true)
    }

    // Both queries request cap+1 rows via a bound LIMIT parameter.
    expect(mockGetAll.mock.calls[2][1]).toContain(501)
    expect(mockGetAll.mock.calls[3][1]).toContain(501)
  })

  it('I10: does not mark At-Risk/New Customers truncated when the row count is at or under the cap', async () => {
    mockGetAll
      .mockResolvedValueOnce([]) // by revenue
      .mockResolvedValueOnce([]) // by visits
      .mockResolvedValueOnce([{ customerId: 'c1', customerName: 'Customer 1', lastVisit: '2026-07-01' }])
      .mockResolvedValueOnce([{ customerId: 'n1', customerName: 'New 1', createdAt: '2026-08-15', revenueUsd: 10 }])

    const report = await computeTopCustomersReport('shop1', { from: '2026-08-01', to: '2026-08-31' })
    const atRisk = report.sections[2]
    const newCustomers = report.sections[3]
    if (atRisk.type === 'detail' && newCustomers.type === 'detail') {
      expect(atRisk.truncated).toBe(false)
      expect(newCustomers.truncated).toBe(false)
    }
  })
})
