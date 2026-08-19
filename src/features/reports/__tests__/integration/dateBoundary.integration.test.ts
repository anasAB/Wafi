import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createReportsTestDb } from '../helpers/reportsSqliteDb'

let conn: ReturnType<typeof createReportsTestDb>
vi.mock('@/data/powersync/db', () => ({
  db: { getAll: async (sql: string, params: unknown[]) => conn.prepare(sql).all(...(params as any[])) },
}))

import { getStaffMetrics } from '../../primitives/getStaffMetrics'

describe('date-boundary semantics integration', () => {
  beforeEach(() => { conn = createReportsTestDb() })

  it('a sale timestamped just after UTC midnight, on the local calendar day, is still included', async () => {
    // 2026-08-18T00:30:00Z with SQLite's 'localtime' modifier interprets against the
    // TEST RUNNER's local timezone, not a fixed offset -- this test's purpose is only
    // to prove the query includes rows exactly at the boundary it claims to use, per
    // its own semantics, not to assert a specific timezone's behavior.
    conn.exec(`
      INSERT INTO staff (id, shop_id, name) VALUES ('st1', 'shop1', 'Ali');
      INSERT INTO sales (id, shop_id, staff_id, total_usd, created_at) VALUES ('s1', 'shop1', 'st1', 50, '2026-08-18T00:30:00Z');
    `)
    const rows = await getStaffMetrics('shop1', { from: '2026-08-18', to: '2026-08-18' })
    expect(rows.find((r) => r.staffId === 'st1')?.revenueUsd).toBe(50)
  })
})
