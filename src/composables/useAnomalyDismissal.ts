// Date-scoped by construction: today's key never matches yesterday's, so a
// dismissal naturally expires without any cleanup job. Per-device (localStorage),
// not per-user — see spec §7's documented v1 limitation.
function dismissalKey(shopId: string, periodKey: string, code: string): string {
  // Use local wall-clock date, not UTC. This ensures dismissals expire at local
  // midnight, matching the rest of the codebase's DATE(created_at, 'localtime') SQL convention.
  const d = new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const today = `${year}-${month}-${day}` // YYYY-MM-DD, local wall-clock date
  return `wafi:anomaly-dismissed:${shopId}:${today}:${periodKey}:${code}`
}

export function isDismissed(shopId: string, periodKey: string, code: string): boolean {
  return localStorage.getItem(dismissalKey(shopId, periodKey, code)) === '1'
}

export function dismiss(shopId: string, periodKey: string, code: string): void {
  localStorage.setItem(dismissalKey(shopId, periodKey, code), '1')
}
