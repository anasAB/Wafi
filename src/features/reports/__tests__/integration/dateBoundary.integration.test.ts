import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createReportsTestDb } from '../helpers/reportsSqliteDb'

let conn: ReturnType<typeof createReportsTestDb>
vi.mock('@/data/powersync/db', () => ({
  db: { getAll: async (sql: string, params: unknown[]) => conn.prepare(sql).all(...(params as any[])) },
}))

import { getStaffMetrics } from '../../primitives/getStaffMetrics'

// This test must have the power to fail if the 'localtime' modifier is ever
// stripped from getStaffMetrics's query. A timestamp like '2026-08-18T00:30:00Z'
// does NOT have that power: whether it's evaluated in the test runner's real
// local timezone or against a fixed UTC+2 assumption, it can still land on
// the same calendar day both ways, so the assertion passes whether or not
// 'localtime' is applied.
//
// Two further complications had to be resolved to make this genuinely work:
//
// 1. src/__tests__/setup.ts pins `process.env.TZ = 'UTC'` globally for the
//    whole suite (for WAFI-145's business-hours determinism). Under a UTC
//    runner, 'localtime' and raw UTC truncation produce IDENTICAL results
//    for every timestamp -- so no fixture computed against the ambient
//    runner timezone can distinguish them. This test therefore overrides
//    process.env.TZ to a fixed non-UTC zone (Europe/Amsterdam, UTC+2 in
//    August) for its own duration, and restores the original value
//    afterward so it doesn't leak into other test files.
// 2. Node's built-in node:sqlite reads process.env.TZ dynamically (verified
//    manually), so setting it before constructing the SQLite connection and
//    before calling the primitive under test is sufficient -- no need to
//    respawn the process.
//
// With TZ pinned to Europe/Amsterdam, a sale at 2026-08-17T22:30:00Z is
// 2026-08-18T00:30 local time: a genuine UTC/local calendar-day mismatch.
// Only DATE(created_at, 'localtime') buckets it into the 2026-08-18 range;
// DATE(created_at) alone buckets it into 2026-08-17 and the row is dropped.
const LOCAL_DATE = '2026-08-18'
const BOUNDARY_TIMESTAMP_UTC = '2026-08-17T22:30:00Z' // = 2026-08-18T00:30 in Europe/Amsterdam (UTC+2)

describe('date-boundary semantics integration', () => {
  const originalTz = process.env.TZ

  beforeEach(() => {
    process.env.TZ = 'Europe/Amsterdam'
    conn = createReportsTestDb()
  })

  afterEach(() => {
    process.env.TZ = originalTz
  })

  it('a sale whose UTC calendar day differs from its local calendar day is bucketed by LOCAL day', async () => {
    conn.exec(`
      INSERT INTO staff (id, shop_id, name) VALUES ('st1', 'shop1', 'Ali');
      INSERT INTO sales (id, shop_id, staff_id, total_usd, created_at) VALUES ('s1', 'shop1', 'st1', 50, '${BOUNDARY_TIMESTAMP_UTC}');
    `)
    const rows = await getStaffMetrics('shop1', { from: LOCAL_DATE, to: LOCAL_DATE })
    // If the code truncated by raw UTC day instead of 'localtime', this row
    // would fall on 2026-08-17 (the adjacent UTC day) and be excluded --
    // revenueUsd would be undefined (no row for st1) rather than 50.
    expect(rows.find((r) => r.staffId === 'st1')?.revenueUsd).toBe(50)
  })
})
