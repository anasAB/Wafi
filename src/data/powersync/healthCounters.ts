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

// WAFI-148: "today" for local health counters, matching the same device-UTC
// convention already established in localTodayRevenueRebuild.ts's
// getShopLocalToday -- shops.timezone (migration 084) defaults to 'UTC' and
// nothing in this codebase sets it to anything else today, so device-UTC and
// shop-local are identical. useDeviceActivity.ts's shopLocalDateString takes a
// real IANA timezone and is used from a Vue composable with store access to
// shop.timezone; the four call sites here (ops/dead-letter/drainDeferredJobs/
// useSync/main) have no such access, so this is a deliberately separate,
// parameterless helper rather than a duplicate of that timezone-aware logic.
// If shops.timezone ever becomes client-configurable, this must move to
// shop-local day together with getShopLocalToday and useDeviceActivity's
// caller, per that function's own review note.
export function shopLocalToday(): string {
  return new Date().toISOString().slice(0, 10)
}
