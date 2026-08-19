import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createReportsTestDb } from '../helpers/reportsSqliteDb'

let conn: ReturnType<typeof createReportsTestDb>
vi.mock('@/data/powersync/db', () => ({
  db: { getAll: async (sql: string, params: unknown[]) => conn.prepare(sql).all(...(params as any[])) },
}))

import { readProfitCache } from '../../primitives/readProfitCache'
import { getStaffMetrics } from '../../primitives/getStaffMetrics'

describe('money-units integration', () => {
  beforeEach(() => { conn = createReportsTestDb() })

  it('readProfitCache divides profit_cache\'s bigint-cents columns by 100', async () => {
    conn.exec(`INSERT INTO profit_cache (shop_id, day, revenue_usd, revenue_syp, cogs_usd, cogs_reversal_usd, expenses_usd, refunds_usd, discount_usd, invoice_count, return_count, costless_sale_count)
      VALUES ('shop1', '2026-08-18', 10000, 0, 4000, 0, 0, 0, 0, 1, 0, 0)`) // 10000 cents
    const result = await readProfitCache('shop1', { from: '2026-08-18', to: '2026-08-18' })
    expect(result.revenueUsd).toBe(100) // $100.00, not $10,000 and not $1.00
  })

  it('getStaffMetrics sums sales.total_usd as a plain dollar NUMERIC column -- no /100 division', async () => {
    conn.exec(`
      INSERT INTO staff (id, shop_id, name) VALUES ('st1', 'shop1', 'Ali');
      INSERT INTO sales (id, shop_id, staff_id, total_usd, created_at) VALUES ('s1', 'shop1', 'st1', 100.50, '2026-08-18T10:00:00');
    `)
    const rows = await getStaffMetrics('shop1', { from: '2026-08-18', to: '2026-08-18' })
    expect(rows.find((r) => r.staffId === 'st1')?.revenueUsd).toBe(100.5) // NOT 1.005 or 10050
  })
})
