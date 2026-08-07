// Overnight-aware business-hours check (WAFI-145 design spec, "Business hours &
// overnight semantics"). Timestamps are compared using UTC hours/minutes -- this
// codebase stores occurredAt as ISO UTC and shops.open_time/close_time as naive
// 'HH:MM' with no timezone; both are treated as the same wall-clock frame, matching
// how every other time-of-day comparison in this app already works.

export interface ShopHours {
  open_time: string | null   // 'HH:MM'
  close_time: string | null  // 'HH:MM'
  is_24_7: number | null     // 0/1
}

function minutesSinceMidnight(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export function isWithinBusinessHours(shop: ShopHours, isoTimestamp: string): boolean {
  if (shop.is_24_7) return true
  if (!shop.open_time || !shop.close_time) return true // checks disabled for this shop

  const d = new Date(isoTimestamp)
  const t = d.getUTCHours() * 60 + d.getUTCMinutes()
  const open  = minutesSinceMidnight(shop.open_time)
  const close = minutesSinceMidnight(shop.close_time)

  if (open < close) {
    // Normal day: within hours iff open <= t < close.
    return t >= open && t < close
  }
  // Overnight window (open > close, e.g. 08:00-02:00): the window crosses
  // midnight, so "within hours" means t is in [open, 24:00) OR [00:00, close).
  return t >= open || t < close
}
