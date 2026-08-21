import { db } from '@/data/powersync/db'

function shopLocalDateString(timezone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now) // en-CA -> YYYY-MM-DD
}

// The qualifying-event contract (per the design spec): this must be called
// ONLY from a genuine foreground user-interaction boundary -- a real
// navigation, a real business operation -- never from a background timer,
// the health-reporting tick itself, a connectivity callback, or a server
// response. Idempotent: repeated calls on the same shop-local day are a
// no-op overwrite of the same value, never an increment.
export async function markDeviceActiveForDay(shopTimezone: string, now: Date = new Date()): Promise<void> {
  const periodStart = shopLocalDateString(shopTimezone, now)

  await db.execute(
    `INSERT INTO local_health_metrics (metric_key, period_start, value, updated_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT (metric_key, period_start) DO UPDATE SET updated_at = excluded.updated_at`,
    ['active_device_day', periodStart, now.toISOString()],
  )
}
