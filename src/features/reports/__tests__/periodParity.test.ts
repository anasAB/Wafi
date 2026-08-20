// WAFI-147B. These 3 cases MUST match supabase/tests/wafi147b_period_semantics.test.sql's
// 3 assertions exactly (same input, same expected output) -- that is what
// "cross-runtime period parity" means in practice, since PL/pgSQL and
// TypeScript cannot literally share one function. If you change an expected
// value here, change it in the pgTAP file too, and vice versa.
import { describe, it, expect } from 'vitest'
import { expectedPeriodUtc } from '../snapshotLookup'

describe('cross-runtime period parity (must match wafi147b_period_semantics.test.sql)', () => {
  it('daily 2026-08-20 00:00 UTC -> [2026-08-19, 2026-08-20)', () => {
    const r = expectedPeriodUtc('cash-flow', new Date('2026-08-20T00:00:00Z'))
    expect(r.periodStart.toISOString()).toBe('2026-08-19T00:00:00.000Z')
    expect(r.periodEnd.toISOString()).toBe('2026-08-20T00:00:00.000Z')
  })

  it('weekly 2026-08-23 09:00 UTC -> [2026-08-10, 2026-08-17)', () => {
    const r = expectedPeriodUtc('weekly-summary', new Date('2026-08-23T09:00:00Z'))
    expect(r.periodStart.toISOString()).toBe('2026-08-10T00:00:00.000Z')
    expect(r.periodEnd.toISOString()).toBe('2026-08-17T00:00:00.000Z')
  })

  it('monthly 2026-09-01 09:00 UTC -> [2026-08-01, 2026-09-01)', () => {
    const r = expectedPeriodUtc('monthly-health', new Date('2026-09-01T09:00:00Z'))
    expect(r.periodStart.toISOString()).toBe('2026-08-01T00:00:00.000Z')
    expect(r.periodEnd.toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })
})
