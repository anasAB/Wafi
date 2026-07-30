// Date-scoped by construction: today's key never matches yesterday's, so a
// dismissal naturally expires without any cleanup job. Per-device (localStorage),
// not per-user — see spec §7's documented v1 limitation.
function dismissalKey(shopId: string, periodKey: string, code: string): string {
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD, local wall-clock date
  return `wafi:anomaly-dismissed:${shopId}:${today}:${periodKey}:${code}`
}

export function isDismissed(shopId: string, periodKey: string, code: string): boolean {
  return localStorage.getItem(dismissalKey(shopId, periodKey, code)) === '1'
}

export function dismiss(shopId: string, periodKey: string, code: string): void {
  localStorage.setItem(dismissalKey(shopId, periodKey, code), '1')
}
