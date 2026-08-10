import { describe, it, expect } from 'vitest'
import { getInsightRanges, getComparisonCutoffIso } from '../insightRanges'

describe('getInsightRanges', () => {
  it('day: compares today against the same weekday last week', () => {
    // Wednesday 2026-08-12
    const now = new Date(2026, 7, 12, 14, 30, 0)
    const { current, comparison, isCurrentDayComplete } = getInsightRanges('day', now)
    expect(current).toEqual({ start: '2026-08-12', end: '2026-08-12' })
    expect(comparison).toEqual({ start: '2026-08-05', end: '2026-08-05' })
    expect(isCurrentDayComplete).toBe(false)
  })

  it('day: isCurrentDayComplete is only true at exact local midnight', () => {
    const midnight = new Date(2026, 7, 12, 0, 0, 0, 0)
    expect(getInsightRanges('day', midnight).isCurrentDayComplete).toBe(true)
  })

  it('week: current is Monday-of-this-week through today; comparison is the same weekday offset in the prior week', () => {
    // Wednesday 2026-08-12 -> this week's Monday is 2026-08-10
    const now = new Date(2026, 7, 12, 9, 0, 0)
    const { current, comparison } = getInsightRanges('week', now)
    expect(current).toEqual({ start: '2026-08-10', end: '2026-08-12' })
    expect(comparison).toEqual({ start: '2026-08-03', end: '2026-08-05' })
  })

  it('week: Monday itself compares a single day against last Monday', () => {
    const monday = new Date(2026, 7, 10, 9, 0, 0)
    const { current, comparison } = getInsightRanges('week', monday)
    expect(current).toEqual({ start: '2026-08-10', end: '2026-08-10' })
    expect(comparison).toEqual({ start: '2026-08-03', end: '2026-08-03' })
  })

  it('month: current is 1st-of-month through today; comparison is 1st of prior month through the same day-of-month', () => {
    // 2026-08-12 -> prior month is July (31 days), day 12 exists there
    const now = new Date(2026, 7, 12, 9, 0, 0)
    const { current, comparison } = getInsightRanges('month', now)
    expect(current).toEqual({ start: '2026-08-01', end: '2026-08-12' })
    expect(comparison).toEqual({ start: '2026-07-01', end: '2026-07-12' })
  })

  it('month: clamps the comparison day-of-month to the prior month\'s length (no rollover)', () => {
    // 2026-03-31 -> prior month is February 2026 (28 days, not a leap year)
    const now = new Date(2026, 2, 31, 9, 0, 0)
    const { comparison } = getInsightRanges('month', now)
    expect(comparison).toEqual({ start: '2026-02-01', end: '2026-02-28' })
  })

  it('week and month always report the day as complete (whole-day granularity, no intraday truncation needed)', () => {
    const now = new Date(2026, 7, 12, 9, 0, 0)
    expect(getInsightRanges('week', now).isCurrentDayComplete).toBe(true)
    expect(getInsightRanges('month', now).isCurrentDayComplete).toBe(true)
  })
})

describe('getComparisonCutoffIso', () => {
  it('builds a timestamp on the comparison date at the same local wall-clock time as `now`', () => {
    const now = new Date(2026, 7, 12, 14, 30, 45)
    const cutoff = new Date(getComparisonCutoffIso('2026-08-05', now))
    expect(cutoff.getFullYear()).toBe(2026)
    expect(cutoff.getMonth()).toBe(7)
    expect(cutoff.getDate()).toBe(5)
    expect(cutoff.getHours()).toBe(14)
    expect(cutoff.getMinutes()).toBe(30)
    expect(cutoff.getSeconds()).toBe(45)
  })
})
