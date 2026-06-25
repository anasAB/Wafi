export type Period = 'today' | 'week' | 'month'

function toDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function getDateRange(period: Period): { start: string; end: string } {
  const now = new Date()
  const today = toDateStr(now)

  if (period === 'today') {
    return { start: today, end: today }
  }

  if (period === 'week') {
    const d = new Date(now)
    // ISO week starts Monday. JS getDay(): 0=Sun, 1=Mon, ..., 6=Sat
    const day = d.getDay()
    const daysBack = day === 0 ? 6 : day - 1
    d.setDate(d.getDate() - daysBack)
    return { start: toDateStr(d), end: today }
  }

  // month: 1st of current month to today
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  return { start: toDateStr(start), end: today }
}

/**
 * Full calendar-month range (1st … last day) offset from the current month.
 * offset 0 = current month, -1 = previous month, +1 = next month. Used by the
 * expenses page to browse months so recurring costs (one row per month) are all
 * reachable, not just the current period.
 */
export function getMonthRange(offset: number): { start: string; end: string } {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)
  return { start: toDateStr(start), end: toDateStr(end) }
}

export type ReportPeriod = 'week' | 'month' | 'quarter' | 'custom'

// Reuses this file's existing toDateStr/getDateRange. Quarter = the last 3 calendar
// months: 1st of (current month − 2) through today. Custom echoes the inputs.
export function getReportRange(
  period: ReportPeriod,
  customStart?: string,
  customEnd?: string,
): { start: string; end: string } {
  if (period === 'custom') {
    return { start: customStart ?? '', end: customEnd ?? '' }
  }
  if (period === 'week' || period === 'month') {
    // Delegate to the existing day-of-week / 1st-of-month logic.
    return getDateRange(period)
  }
  // quarter
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - 2, 1)
  return { start: toDateStr(start), end: toDateStr(now) }
}

// Day buckets stay readable up to ~2 months; longer ranges (quarter, long custom)
// switch to monthly buckets so the chart doesn't render 90+ bars on a cheap phone.
export function bucketForRange(start: string, end: string): 'day' | 'month' {
  const [sy, sm, sd] = start.split('-').map(Number)
  const [ey, em, ed] = end.split('-').map(Number)
  const from = new Date(sy, (sm ?? 1) - 1, sd ?? 1)
  const to   = new Date(ey, (em ?? 1) - 1, ed ?? 1)
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000)
  return days > 62 ? 'month' : 'day'
}
