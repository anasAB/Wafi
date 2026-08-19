import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createReportsTestDb } from '../helpers/reportsSqliteDb'

let conn: ReturnType<typeof createReportsTestDb>
vi.mock('@/data/powersync/db', () => ({
  db: { getAll: async (sql: string, params: unknown[]) => conn.prepare(sql).all(...(params as any[])) },
}))

import { readShiftCashReconciliation } from '../../primitives/readShiftCashReconciliation'

describe('readShiftCashReconciliation integration', () => {
  beforeEach(() => { conn = createReportsTestDb() })

  it('extracts and sums ZReportMetrics fields out of z_report_data JSON across multiple closed shifts', async () => {
    conn.exec(`
      INSERT INTO cashier_shifts (id, shop_id, status, closed_at, z_report_data) VALUES
        ('sh1', 'shop1', 'closed', '2026-08-18T14:00:00', '${JSON.stringify({ expectedUsd: 100, actualUsd: 98, varianceUsd: -2, cashUsdSales: 80, cashExpensesUsd: 10, cashRefundsUsd: 0, cashCreditPaymentsUsd: 20, cashPayInsUsd: 0, cashPayOutsUsd: 12 })}'),
        ('sh2', 'shop1', 'closed', '2026-08-18T20:00:00', '${JSON.stringify({ expectedUsd: 50, actualUsd: 50, varianceUsd: 0, cashUsdSales: 40, cashExpensesUsd: 0, cashRefundsUsd: 5, cashCreditPaymentsUsd: 0, cashPayInsUsd: 10, cashPayOutsUsd: 0 })}')
    `)
    const result = await readShiftCashReconciliation('shop1', { from: '2026-08-18', to: '2026-08-18' })
    expect(result.expectedUsd).toBe(150)
    expect(result.varianceUsd).toBe(-2)
    expect(result.cashCreditPaymentsUsd).toBe(20)
  })

  it('an open (not-yet-closed) shift is excluded even if its z_report_data column happens to be non-null', async () => {
    conn.exec(`INSERT INTO cashier_shifts (id, shop_id, status, closed_at, z_report_data) VALUES
      ('sh3', 'shop1', 'open', NULL, NULL)`)
    const result = await readShiftCashReconciliation('shop1', { from: '2026-08-18', to: '2026-08-18' })
    expect(result.expectedUsd).toBe(0)
  })

  it('a closed shift with malformed z_report_data throws against a real query result, not just a mocked one (Task 0 P0 finding 12)', async () => {
    conn.exec(`INSERT INTO cashier_shifts (id, shop_id, status, closed_at, z_report_data) VALUES
      ('sh4', 'shop1', 'closed', '2026-08-18T12:00:00', 'not json at all')`)
    await expect(readShiftCashReconciliation('shop1', { from: '2026-08-18', to: '2026-08-18' })).rejects.toThrow(/sh4/)
  })
})
