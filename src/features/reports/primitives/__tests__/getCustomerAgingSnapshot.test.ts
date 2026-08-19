// src/features/reports/primitives/__tests__/getCustomerAgingSnapshot.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetAll = vi.fn()
const mockGetOptional = vi.fn()
vi.mock('@/data/powersync/db', () => ({
  db: { getAll: (...a: unknown[]) => mockGetAll(...a), getOptional: (...a: unknown[]) => mockGetOptional(...a) },
}))

import { getCustomerAgingSnapshot } from '../getCustomerAgingSnapshot'

describe('getCustomerAgingSnapshot', () => {
  beforeEach(() => vi.clearAllMocks())

  it('filters the balance formula by asOfDate, not the live current balance', async () => {
    mockGetAll.mockResolvedValue([{ id: 'c1', name: 'Sara', balance_usd: 50 }])
    mockGetOptional
      .mockResolvedValueOnce({ oldest: '2026-08-01T00:00:00.000Z' })
      .mockResolvedValueOnce({ paid_at: '2026-08-05' })

    const rows = await getCustomerAgingSnapshot('shop1', '2026-08-09')

    // the balance query must include the as-of-date bound in every subquery
    const [sql, params] = mockGetAll.mock.calls[0]
    expect(sql).toContain('<= ?')
    expect(params).toContain('2026-08-09')
    expect(rows[0]).toMatchObject({ customerId: 'c1', customerName: 'Sara', balanceUsd: 50, lastPaymentDate: '2026-08-05' })
  })

  it('excludes customers with a balance effectively at zero', async () => {
    mockGetAll.mockResolvedValue([{ id: 'c1', name: 'Sara', balance_usd: 0.0001 }])
    const rows = await getCustomerAgingSnapshot('shop1', '2026-08-09')
    expect(rows).toHaveLength(0)
  })

  it('I12: treats asOfDate as END of that calendar day, matching creditDebtors.ts\'s full-timestamp convention (no ~1-day under-count)', async () => {
    mockGetAll.mockResolvedValue([{ id: 'c1', name: 'Sara', balance_usd: 50 }])
    mockGetOptional
      .mockResolvedValueOnce({ oldest: '2026-08-01T00:00:00.000Z' })
      .mockResolvedValueOnce({ paid_at: null })

    const rows = await getCustomerAgingSnapshot('shop1', '2026-08-09')

    // 2026-08-01T00:00:00Z to end-of-day 2026-08-09 (23:59:59.999) is 8 full
    // days elapsed plus the fractional remainder of day 9 -- floors to 8, one
    // more than the naive midnight-to-midnight comparison would give (7).
    expect(rows[0].daysOutstanding).toBe(8)
  })
})
