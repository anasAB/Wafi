import { describe, it, expect } from 'vitest'
import { getPreviousReportRange } from '../periodUtils'

describe('getPreviousReportRange', () => {
  it('clamps previous month-to-date to the same elapsed day-span', () => {
    const prev = getPreviousReportRange('month', '2026-06-01', '2026-06-12')
    expect(prev).toEqual({ start: '2026-05-20', end: '2026-05-31' })
  })

  it('returns the immediately previous window for full custom ranges', () => {
    const prev = getPreviousReportRange('custom', '2026-04-01', '2026-06-30')
    expect(prev).toEqual({ start: '2025-12-31', end: '2026-03-31' })
  })

  it('returns the 3 calendar months before the current quarter window', () => {
    const prev = getPreviousReportRange('quarter', '2026-04-01', '2026-06-26')
    expect(prev).toEqual({ start: '2026-01-01', end: '2026-03-31' })
  })

  it('returns null for invalid windows', () => {
    expect(getPreviousReportRange('week', '', '2026-06-12')).toBeNull()
    expect(getPreviousReportRange('week', '2026-06-12', '2026-06-01')).toBeNull()
  })
})
