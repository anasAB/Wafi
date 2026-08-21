import { db } from '@/data/powersync/db'
import { shopLocalDateString } from '@/data/powersync/healthCounters'

// The qualifying-event contract (per the design spec): this must be called
// ONLY from a genuine foreground user-interaction boundary -- a real
// navigation, a real business operation -- never from a background timer,
// the health-reporting tick itself, a connectivity callback, or a server
// response. Idempotent: repeated calls on the same shop-local day are a
// no-op overwrite of the same value, never an increment.
export async function markDeviceActiveForDay(shopTimezone: string, now: Date = new Date()): Promise<void> {
  const periodStart = shopLocalDateString(shopTimezone, now)
  const updatedAt = now.toISOString()

  // Read-then-insert-or-update, NOT an upsert: PowerSync client tables are
  // SQLite views backed by CRUD-queue triggers, and SQLite rejects
  // ON CONFLICT against a view (the uniqueness this relies on exists only in
  // the server-side health_metrics table from a different migration, so
  // there is no local conflict target). Same pattern as
  // dailyEventCountsProjection.ts / profitCacheProjection.ts.
  const existing = await db.getOptional<{ id: string }>(
    `SELECT id FROM local_health_metrics WHERE metric_key = ? AND period_start = ?`,
    ['active_device_day', periodStart],
  )

  if (existing) {
    // value is always 1 -- idempotent overwrite, never an increment.
    await db.execute(
      `UPDATE local_health_metrics SET value = 1, updated_at = ? WHERE id = ?`,
      [updatedAt, existing.id],
    )
  } else {
    await db.execute(
      `INSERT INTO local_health_metrics (id, metric_key, period_start, value, updated_at) VALUES (?, ?, ?, 1, ?)`,
      [crypto.randomUUID(), 'active_device_day', periodStart, updatedAt],
    )
  }
}
