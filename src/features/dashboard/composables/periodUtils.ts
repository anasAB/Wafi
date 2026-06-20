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
