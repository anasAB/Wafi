import { db } from '@/data/powersync/db'
import { supabase } from '@/data/supabase/client'
import { countDeadLetter } from '@/data/powersync/dead-letter'
import { incrementLocalHealthCounter } from '@/data/powersync/healthCounters'
import type { HealthCounterReport, HealthGaugeReport } from '@/features/health/health.types'

const RETENTION_DAYS = 7
const TICK_INTERVAL_MS = 30 * 60 * 1000

interface TickContext {
  shopId: string
  deviceId: string
  today: string // shop-local ISO date, injected for testability
}

function isClosedPeriod(periodStart: string, today: string): boolean {
  return periodStart < today
}

export async function runHealthReportingTick(ctx: TickContext): Promise<void> {
  const localRows = await db.getAll<{ metric_key: string; period_start: string; value: number }>(
    `SELECT metric_key, period_start, value FROM local_health_metrics`,
  )

  const counters: HealthCounterReport[] = localRows.map((row) => ({
    metric_key: row.metric_key as HealthCounterReport['metric_key'],
    period_start: row.period_start,
    value: row.value,
  }))

  // countDeadLetter takes the PowerSync db handle explicitly (see
  // src/data/powersync/dead-letter.ts and useSync.ts's own call site) --
  // it is not a no-arg singleton reader.
  const deadLetterCount = await countDeadLetter(db)
  const gauges: HealthGaugeReport[] = [
    { gauge_key: 'dead_letter_count', value: deadLetterCount, observed_at: new Date().toISOString() },
  ]

  const { data, error } = await supabase.rpc('report_health_metrics', {
    p_device_id: ctx.deviceId,
    p_counters: counters,
    p_gauges: gauges,
  })

  // Fire-and-forget-safe: an RPC error just means we retry next tick; the
  // local accumulator is untouched and nothing here can block the POS.
  if (error || !data) return

  // Only delete a local row for a CLOSED period the server explicitly
  // accepted -- an open/current period's row is never deleted, and a
  // closed period the server didn't (yet) confirm stays for the next retry.
  const acceptedClosedKeys = new Set(
    (data.accepted_counters as Array<{ metric_key: string; period_start: string }>)
      .filter((c) => isClosedPeriod(c.period_start, ctx.today))
      .map((c) => `${c.metric_key}|${c.period_start}`),
  )

  for (const row of localRows) {
    if (acceptedClosedKeys.has(`${row.metric_key}|${row.period_start}`)) {
      await db.execute(
        `DELETE FROM local_health_metrics WHERE metric_key = ? AND period_start = ?`,
        [row.metric_key, row.period_start],
      )
    }
  }

  // Retention cap: drop any still-unacknowledged row outside the 7-day
  // window, counting the drop as diagnostic-only metadata (never shown to
  // the owner, never part of health status).
  const windowStart = new Date(ctx.today)
  windowStart.setDate(windowStart.getDate() - (RETENTION_DAYS - 1))
  const windowStartStr = windowStart.toISOString().slice(0, 10)

  const staleRows = localRows.filter((row) => row.period_start < windowStartStr)
  if (staleRows.length > 0) {
    await db.execute(`DELETE FROM local_health_metrics WHERE period_start < ?`, [windowStartStr])
    // Read-then-insert-or-update, NOT an upsert -- same PowerSync localOnly-table
    // constraint as incrementLocalHealthCounter (Task 10); reuse it directly
    // rather than duplicating the pattern here.
    await incrementLocalHealthCounter('telemetry_periods_dropped', ctx.today, staleRows.length)
  }
}

let tickHandle: ReturnType<typeof setInterval> | undefined

// Idempotent -- safe to call once at app boot. Uses a 30-minute periodic
// tick plus an immediate call on the app's existing connectivity-reconnect
// signal (wired by the caller in main.ts alongside the existing useSync.ts
// listener), never a new detector.
export function startHealthReporting(getContext: () => TickContext | null): void {
  if (tickHandle) return

  const tick = async () => {
    const ctx = getContext()
    if (ctx) await runHealthReportingTick(ctx)
  }

  tickHandle = setInterval(tick, TICK_INTERVAL_MS)
  void tick()
}
