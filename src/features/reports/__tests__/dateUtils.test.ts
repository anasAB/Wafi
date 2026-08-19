import { describe, it, expect } from 'vitest'
import { formatLocalDate, addCalendarDays } from '../dateUtils'

describe('formatLocalDate', () => {
  it('formats local date parts as YYYY-MM-DD, zero-padded', () => {
    expect(formatLocalDate(new Date(2026, 0, 5))).toBe('2026-01-05') // month is 0-indexed in the Date constructor
  })
})

describe('addCalendarDays', () => {
  it('shifts forward and backward across a month boundary', () => {
    expect(addCalendarDays('2026-08-01', -7)).toBe('2026-07-25')
    expect(addCalendarDays('2026-08-29', 7)).toBe('2026-09-05')
  })
  it('is a no-op for 0 days', () => {
    expect(addCalendarDays('2026-08-18', 0)).toBe('2026-08-18')
  })
})
