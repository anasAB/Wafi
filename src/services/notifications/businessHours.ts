// Overnight-aware business-hours check (WAFI-145 design spec, "Business hours &
// overnight semantics"). shops.open_time/close_time are entered by the owner via a
// plain <input type="time">, which is unambiguously LOCAL wall-clock time (a Syria
// shop owner typing "09:00" means 9am Damascus time, not UTC). Timestamps are
// therefore compared using the JS Date object's LOCAL hours/minutes (getHours/
// getMinutes), matching how every other time-of-day comparison in this app already
// works (periodUtils.ts, usePeriodToggle.ts, useDailyDigest.ts all use device-local
// getHours()/getFullYear()/getMonth()/getDate(), never UTC).

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
  const t = d.getHours() * 60 + d.getMinutes()
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
