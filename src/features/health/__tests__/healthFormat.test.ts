import { describe, it, expect } from 'vitest'
import { formatRate, formatCount, formatGaugeFreshness } from '../format/healthFormat'

describe('WAFI-148 shared health formatting', () => {
  it('renders a rate with numerator/denominator and the computed percentage', () => {
    const result = formatRate(2, 1010, 'percentage')
    expect(result.display).toBe('2/1010 · 0.2%')
    expect(result.isNoData).toBe(false)
  })

  it('treats a zero denominator as no-data, never 0%', () => {
    const result = formatRate(0, 0, 'percentage')
    expect(result.isNoData).toBe(true)
    expect(result.display).not.toContain('0%')
  })

  it('renders a per-device-day rate without forcing a percentage', () => {
    const result = formatRate(12, 3, 'per-device-day')
    expect(result.display).toBe('12 errors · 4.0 per active device-day')
    expect(result.isNoData).toBe(false)
  })

  it('renders a count of 0 as a legitimate healthy zero, not no-data', () => {
    const result = formatCount(0)
    expect(result.isZeroHealthy).toBe(true)
  })

  it('flags a gauge as stale once its observation exceeds the freshness window', () => {
    const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString()
    const result = formatGaugeFreshness(eightHoursAgo, 4 * 60 * 60 * 1000)
    expect(result.isStale).toBe(true)
  })

  it('does not flag a gauge as stale within the freshness window', () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const result = formatGaugeFreshness(tenMinutesAgo, 4 * 60 * 60 * 1000)
    expect(result.isStale).toBe(false)
  })
})
