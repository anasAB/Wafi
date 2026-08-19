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
})
