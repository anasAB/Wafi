import { describe, it, expect } from 'vitest'
import { getReportRange, bucketForRange } from '../periodUtils'

describe('getReportRange', () => {
  it('quarter spans the last 3 calendar months through today', () => {
    const { start, end } = getReportRange('quarter')
    // start is the 1st of (current month - 2); end is today. Both YYYY-MM-DD.
    expect(start).toMatch(/^\d{4}-\d{2}-01$/)
    expect(end).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(start < end).toBe(true)
  })

  it('custom returns the provided range verbatim', () => {
    const { start, end } = getReportRange('custom', '2026-01-01', '2026-03-31')
    expect(start).toBe('2026-01-01')
    expect(end).toBe('2026-03-31')
  })

  it('week and month resolve to a valid start<=end range', () => {
    for (const p of ['week', 'month'] as const) {
      const { start, end } = getReportRange(p)
      expect(start <= end).toBe(true)
    }
  })
})

describe('bucketForRange', () => {
  it('uses day buckets for short ranges (<= 62 days)', () => {
    expect(bucketForRange('2026-06-01', '2026-06-30')).toBe('day')
  })
  it('uses month buckets for long ranges (> 62 days)', () => {
    expect(bucketForRange('2026-01-01', '2026-06-30')).toBe('month')
  })
})
