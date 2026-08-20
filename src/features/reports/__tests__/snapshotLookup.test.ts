import { describe, it, expect } from 'vitest'
import { expectedPeriodUtc } from '../snapshotLookup'

describe('expectedPeriodUtc', () => {
  it('daily: previous UTC calendar day', () => {
    const { periodStart, periodEnd } = expectedPeriodUtc('cash-flow', new Date('2026-08-20T00:00:00Z'))
    expect(periodStart.toISOString()).toBe('2026-08-19T00:00:00.000Z')
    expect(periodEnd.toISOString()).toBe('2026-08-20T00:00:00.000Z')
  })

  it('weekly: preceding completed Mon-Sun week, not the trigger day\'s own week', () => {
    const { periodStart, periodEnd } = expectedPeriodUtc('weekly-summary', new Date('2026-08-23T09:00:00Z'))
    expect(periodStart.toISOString()).toBe('2026-08-10T00:00:00.000Z')
    expect(periodEnd.toISOString()).toBe('2026-08-17T00:00:00.000Z')
  })

  it('monthly: previous full calendar month', () => {
    const { periodStart, periodEnd } = expectedPeriodUtc('monthly-health', new Date('2026-09-01T09:00:00Z'))
    expect(periodStart.toISOString()).toBe('2026-08-01T00:00:00.000Z')
    expect(periodEnd.toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })

  it('throws for employee-summary (no wall-clock cadence)', () => {
    expect(() => expectedPeriodUtc('employee-summary', new Date('2026-08-20T00:00:00Z'))).toThrow()
  })
})
