// WAFI-147A: the ONE place local-calendar-date formatting/arithmetic lives
// for this feature -- matches useProfitCache.ts's toDateStr() convention.
// NEVER toISOString() (UTC, wrong day near local midnight).

export function formatLocalDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function addCalendarDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return formatLocalDate(new Date(y, m - 1, d + days))
}
