// src/features/reports/primitives/__tests__/readShiftCashReconciliation.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetAll = vi.fn()
vi.mock('@/data/powersync/db', () => ({ db: { getAll: (...a: unknown[]) => mockGetAll(...a) } }))

import { readShiftCashReconciliation } from '../readShiftCashReconciliation'

describe('readShiftCashReconciliation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sums the ZReportMetrics fields out of every closed shift\'s z_report_data in range', async () => {
    mockGetAll.mockResolvedValue([
      { id: 'sh1', z_report_data: JSON.stringify({ expectedUsd: 100, actualUsd: 98, varianceUsd: -2, cashUsdSales: 80, cashExpensesUsd: 10, cashRefundsUsd: 5, cashCreditPaymentsUsd: 20, cashPayInsUsd: 0, cashPayOutsUsd: 15 }) },
      { id: 'sh2', z_report_data: JSON.stringify({ expectedUsd: 50, actualUsd: 50, varianceUsd: 0, cashUsdSales: 40, cashExpensesUsd: 0, cashRefundsUsd: 0, cashCreditPaymentsUsd: 10, cashPayInsUsd: 5, cashPayOutsUsd: 0 }) },
    ])

    const result = await readShiftCashReconciliation('shop1', { from: '2026-08-18', to: '2026-08-18' })

    expect(mockGetAll).toHaveBeenCalledWith(
      expect.stringContaining("status = 'closed'"),
      ['shop1', '2026-08-18', '2026-08-18'],
    )
    expect(result.expectedUsd).toBe(150)
    expect(result.actualUsd).toBe(148)
    expect(result.varianceUsd).toBe(-2)
    expect(result.cashCreditPaymentsUsd).toBe(30)
    expect(result.cashPayOutsUsd).toBe(15)
  })

  it('treats a shift with no z_report_data (legacy/pre-WAFI-060 row) as all-zero, not a throw', async () => {
    mockGetAll.mockResolvedValue([{ id: 'sh-legacy', z_report_data: null }])
    const result = await readShiftCashReconciliation('shop1', { from: '2026-08-01', to: '2026-08-01' })
    expect(result.expectedUsd).toBe(0)
  })

  it('throws, naming the shift, on unparseable JSON -- never silently treats it as zero (Task 0 P0 finding 12)', async () => {
    mockGetAll.mockResolvedValue([{ id: 'sh-broken', z_report_data: '{not valid json' }])
    await expect(readShiftCashReconciliation('shop1', { from: '2026-08-01', to: '2026-08-01' }))
      .rejects.toThrow(/sh-broken/)
  })

  it('throws, naming the field, when a required numeric field is missing or NaN -- never silently treats it as zero', async () => {
    mockGetAll.mockResolvedValue([{ id: 'sh-incomplete', z_report_data: JSON.stringify({ expectedUsd: 100, actualUsd: 100, varianceUsd: 0, cashUsdSales: 80, cashExpensesUsd: 0, cashRefundsUsd: 0, cashCreditPaymentsUsd: 0, cashPayInsUsd: 0 /* cashPayOutsUsd missing */ }) }])
    await expect(readShiftCashReconciliation('shop1', { from: '2026-08-01', to: '2026-08-01' }))
      .rejects.toThrow(/sh-incomplete.*cashPayOutsUsd/)
  })
})
