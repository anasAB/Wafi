import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createReportsTestDb } from '../helpers/reportsSqliteDb'

let conn: ReturnType<typeof createReportsTestDb>

vi.mock('@/data/powersync/db', () => ({
  db: {
    getAll: async (sql: string, params: unknown[]) => conn.prepare(sql.replace(/\?/g, () => '?')).all(...(params as any[])),
    getOptional: async (sql: string, params: unknown[]) => {
      const rows = conn.prepare(sql).all(...(params as any[]))
      return rows[0] ?? null
    },
  },
}))

import { getCustomerAgingSnapshot } from '../../primitives/getCustomerAgingSnapshot'

describe('getCustomerAgingSnapshot integration', () => {
  beforeEach(() => { conn = createReportsTestDb() })

  it('a payment made AFTER asOfDate must not reduce the as-of-date balance', async () => {
    conn.exec(`
      INSERT INTO customers (id, shop_id, name) VALUES ('c1', 'shop1', 'Sara');
      INSERT INTO sales (id, shop_id, customer_id, total_usd, created_at, is_credit) VALUES ('s1', 'shop1', 'c1', 100, '2026-08-01T10:00:00Z', 1);
      INSERT INTO customer_payments (id, shop_id, customer_id, sale_id, amount_usd, paid_at) VALUES ('p1', 'shop1', 'c1', 's1', 60, '2026-08-15');
    `)

    const asOfAug9 = await getCustomerAgingSnapshot('shop1', '2026-08-09')
    expect(asOfAug9.find((r) => r.customerId === 'c1')?.balanceUsd).toBe(100) // payment on Aug 15 doesn't count yet

    const asOfAug20 = await getCustomerAgingSnapshot('shop1', '2026-08-20')
    expect(asOfAug20.find((r) => r.customerId === 'c1')?.balanceUsd).toBe(40) // payment now counted
  })
})
