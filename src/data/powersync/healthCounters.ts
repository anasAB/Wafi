import { db } from '@/data/powersync/db'
import { shopLocalDateString } from '@/data/powersync/shopTimezone'
import type { HealthMetricKey } from '@/features/health/health.types'

// Re-exported for existing importers (e.g. useDeviceActivity.ts) -- the
// formatter itself now lives in shopTimezone.ts, shared with the unrelated
// revenue-projection pipeline, which needs the identical shop-local-date
// formatting logic but must NOT gate on timezone_confirmed_at the way
// getShopLocalToday below does (see shopTimezone.ts's getShopCurrentDay).
export { shopLocalDateString }

// Additive terminal-outcome counter, distinct from markDeviceActiveForDay's
// idempotent set-to-1. Used only for the 6 additive counters:
// sync_failure_terminal, sync_terminal_total, offline_duration_seconds
// (added as a duration, not +1), deferred_job_failure_terminal,
// deferred_job_terminal_total, app_error_count.
//
// Read-then-insert-or-update, NOT an upsert: local_health_metrics is a
// PowerSync localOnly table (a SQLite view backed by CRUD-queue triggers) --
// ON CONFLICT against it fails at runtime, since there's no local unique-index
// conflict target. Same established pattern as
// dailyEventCountsProjection.ts/profitCacheProjection.ts.
export async function incrementLocalHealthCounter(
  metricKey: HealthMetricKey,
  periodStart: string,
  amount = 1,
): Promise<void> {
  const existing = await db.getOptional<{ id: string; value: number }>(
    `SELECT id, value FROM local_health_metrics WHERE metric_key = ? AND period_start = ?`,
    [metricKey, periodStart],
  )

  if (existing) {
    await db.execute(
      `UPDATE local_health_metrics SET value = ?, updated_at = ? WHERE id = ?`,
      [existing.value + amount, new Date().toISOString(), existing.id],
    )
  } else {
    await db.execute(
      `INSERT INTO local_health_metrics (id, metric_key, period_start, value, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), metricKey, periodStart, amount, new Date().toISOString()],
    )
  }
}

// Resolves "today" as a shop-local calendar date for the given shop, reading
// its timezone from the locally-synced `shops` table. Returns null when the
// shop row hasn't synced yet or its timezone isn't confirmed -- shops.timezone
// itself is NEVER null (NOT NULL DEFAULT 'UTC' server-side, since migration
// 084), so it cannot be used as the readiness signal; timezone_confirmed_at
// IS NOT NULL is the sole canonical predicate for "ready to compute health
// metrics," everywhere, client and server. A call site with no confirmed
// timezone must skip the write entirely rather than falling back to the
// (possibly wrong, unconfirmed) 'UTC' default -- matching the server's own
// report_health_metrics behavior, which rejects writes for an unconfirmed shop.
export async function getShopLocalToday(shopId: string): Promise<string | null> {
  const shop = await db.getOptional<{ timezone: string | null; timezone_confirmed_at: string | null }>(
    `SELECT timezone, timezone_confirmed_at FROM shops WHERE id = ?`,
    [shopId],
  )
  if (!shop?.timezone_confirmed_at) return null
  return shopLocalDateString(shop.timezone)
}
