import { db } from '@/data/powersync/db'

// Shared shop-local calendar-date formatter (WAFI-148 final-review fix,
// relocated here so it has one home shared by both the health-metrics
// pipeline, which gates on explicit timezone confirmation, and the
// unrelated revenue-projection pipeline below, which doesn't). Every
// period_start/date key derived from "today" must be a shop-local calendar
// date, never a UTC one.
export function shopLocalDateString(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now) // en-CA -> YYYY-MM-DD
}

// Resolves "today" as a shop-local calendar date using the shop's CURRENT
// `shops.timezone` value, unconditionally -- unlike health-metrics'
// getShopLocalToday() (healthCounters.ts), this does NOT gate on
// timezone_confirmed_at.
//
// Why the difference is deliberate: events.event_projection_day (migration
// 084) -- the value dashboardRevenueProjection.ts/localTodayRevenueRebuild.ts/
// HomePage.vue all need to agree on -- has itself always been computed from
// whatever shops.timezone currently is (defaulting 'UTC'), with no
// confirmation gate of its own; it was never blocked on "is this shop's
// timezone actually configured." Gating this helper on confirmation would
// make it disagree with event_projection_day the moment a shop confirms a
// non-UTC zone (event_projection_day already reflects the new zone; this
// helper would still refuse to compute anything until some separate
// confirmation flag flips), producing exactly the kind of key mismatch this
// fix exists to close. This also matches the revenue-projection pipeline's
// own documented character (dashboardRevenueProjection.ts: "best-effort...
// never treated as a source of truth for anything financial") -- unlike
// health metrics, there's no correctness reason to withhold computation
// before an explicit owner action.
export async function getShopCurrentDay(shopId: string): Promise<string> {
  const shop = await db.getOptional<{ timezone: string | null }>(
    `SELECT timezone FROM shops WHERE id = ?`,
    [shopId],
  )
  return shopLocalDateString(shop?.timezone ?? 'UTC')
}
