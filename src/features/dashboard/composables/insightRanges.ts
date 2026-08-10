export type InsightPeriod = 'day' | 'week' | 'month'

export interface InsightRange {
  start: string
  end: string
}

export interface InsightRangePair {
  current: InsightRange
  comparison: InsightRange
  /**
   * Only meaningful for period 'day'. True once the current day has fully
   * elapsed. In practice this is always false for the only caller today
   * (Home always evaluates 'day' as the live "today"), because a day that is
   * still being observed is by definition not yet complete — see the
   * "Data-layer constraint" note in the WAFI-144 design spec
   * (docs/superpowers/specs/2026-08-10-wafi-144-automatic-insights-design.md).
   * It's kept as a real, testable computation (not hardcoded to false) so a
   * future caller requesting a specific past day works without touching this
   * function. 'week'/'month' are always reported complete: their comparison
   * only needs whole-day granularity, which the existing date-bounded
   * queries already provide with no truncation.
   */
  isCurrentDayComplete: boolean
}

function toDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d)
  copy.setDate(copy.getDate() + days)
  return copy
}

function getDayRanges(now: Date): InsightRangePair {
  const today = toDateStr(now)
  const comparisonDate = toDateStr(addDays(now, -7))
  return {
    current: { start: today, end: today },
    comparison: { start: comparisonDate, end: comparisonDate },
    isCurrentDayComplete:
      now.getHours() === 0 && now.getMinutes() === 0 &&
      now.getSeconds() === 0 && now.getMilliseconds() === 0,
  }
}

function getWeekRanges(now: Date): InsightRangePair {
  // ISO week starts Monday. JS getDay(): 0=Sun, 1=Mon, ..., 6=Sat
  const day = now.getDay()
  const daysBackToMonday = day === 0 ? 6 : day - 1
  const mondayThisWeek = addDays(now, -daysBackToMonday)
  const mondayLastWeek = addDays(mondayThisWeek, -7)
  const comparisonEnd = addDays(mondayLastWeek, daysBackToMonday)
  return {
    current: { start: toDateStr(mondayThisWeek), end: toDateStr(now) },
    comparison: { start: toDateStr(mondayLastWeek), end: toDateStr(comparisonEnd) },
    isCurrentDayComplete: true,
  }
}

function daysInMonth(year: number, monthIndex: number): number {
  // Day 0 of the *next* month is the last day of `monthIndex`.
  return new Date(year, monthIndex + 1, 0).getDate()
}

function getMonthRanges(now: Date): InsightRangePair {
  const firstThisMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const firstPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const prevMonthLength = daysInMonth(firstPrevMonth.getFullYear(), firstPrevMonth.getMonth())
  const comparisonDay = Math.min(now.getDate(), prevMonthLength)
  const comparisonEnd = new Date(firstPrevMonth.getFullYear(), firstPrevMonth.getMonth(), comparisonDay)
  return {
    current: { start: toDateStr(firstThisMonth), end: toDateStr(now) },
    comparison: { start: toDateStr(firstPrevMonth), end: toDateStr(comparisonEnd) },
    isCurrentDayComplete: true,
  }
}

export function getInsightRanges(period: InsightPeriod, now: Date = new Date()): InsightRangePair {
  if (period === 'day') return getDayRanges(now)
  if (period === 'week') return getWeekRanges(now)
  return getMonthRanges(now)
}

/**
 * The comparison date's timestamp at the same local wall-clock time as `now`.
 * Used only for the 'day' period's comparison-day revenue truncation (see
 * Task 3) — the moment on `comparisonDateStr` that corresponds to "right
 * now" on the current day.
 */
export function getComparisonCutoffIso(comparisonDateStr: string, now: Date): string {
  const [y, m, d] = comparisonDateStr.split('-').map(Number)
  const cutoff = new Date(
    y, m - 1, d,
    now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds(),
  )
  return cutoff.toISOString()
}
