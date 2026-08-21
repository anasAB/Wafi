import { db } from '@/data/powersync/db'
import type { HealthMetricKey } from '@/features/health/health.types'

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

// Shared shop-local calendar-date formatter (WAFI-148 final-review fix).
// Every period_start the client writes must be a shop-local calendar date,
// per the design spec's "Period boundaries and timezone" rule -- never a UTC
// date. Single source of truth, reused by useDeviceActivity.ts instead of
// each keeping its own copy.
export function shopLocalDateString(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now) // en-CA -> YYYY-MM-DD
}

// Resolves "today" as a shop-local calendar date for the given shop, reading
// its timezone from the locally-synced `shops` table. Returns null when the
// shop row hasn't synced yet or its timezone is unset -- per the spec, health
// metrics don't compute until a timezone is configured, so a call site with
// no resolvable timezone must skip the write entirely rather than falling
// back to UTC (matching the server's own report_health_metrics behavior,
// which rejects writes for a shop with no timezone configured).
export async function getShopLocalToday(shopId: string): Promise<string | null> {
  const shop = await db.getOptional<{ timezone: string | null }>(
    `SELECT timezone FROM shops WHERE id = ?`,
    [shopId],
  )
  if (!shop?.timezone) return null
  return shopLocalDateString(shop.timezone)
}
