import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

interface OwnerHealthInput {
  shopTimezone: string | null
  metrics: Array<{ metric_key: string; period_start: string; value: number }>
  gauges: Array<{ gauge_key: string; value: number; observed_at: string }>
}

interface OwnerHealthResult {
  status: 'issue' | 'attention' | 'healthy' | 'no-data' | 'timezone-not-configured'
  messages: string[]
}

// Presentation-policy thresholds (v1 candidate values) -- NOT part of any
// metric's mathematical definition (spec: "Presentation thresholds ... are
// policy, kept explicitly outside the metric's mathematical definition").
const SYNC_UPLOAD_FAILURE_RATE_WARNING = 0.05       // metric 1: > 5%
const OFFLINE_DURATION_WARNING_SECONDS = 2 * 60 * 60 // metric 2: > 2h
const DEFERRED_JOB_FAILURE_RATE_WARNING = 0.05       // metric 5: > 5%
// metric 6: a single isolated error shouldn't surface to the owner (spec:
// "App-error owner policy is a threshold decision, not count > 0") -- more
// than 1 error per active device-day, on average, is the v1 cutoff.
const APP_ERROR_RATE_WARNING = 1.0

export function computeOwnerHealthStatus(input: OwnerHealthInput): OwnerHealthResult {
  if (!input.shopTimezone) {
    return { status: 'timezone-not-configured', messages: [] }
  }

  const messages: string[] = []
  let hasCritical = false
  let hasWarning = false
  let hasAnyData = false

  // Metric 8 (S, critical policy) -- Never-Closed Shift Count.
  const neverClosedShifts = input.metrics.find((m) => m.metric_key === 'never_closed_shift_count')
  if (neverClosedShifts) {
    hasAnyData = true
    if (neverClosedShifts.value > 0) {
      hasCritical = true
      messages.push('One shift required automatic closing yesterday.')
    }
  }

  // Metric 4 (S, warning policy) -- Drawer Mismatch Count. The >15 variance
  // threshold that produces this count is owned by the existing drawer/
  // reconciliation rule (WAFI-148 does not redefine it) -- any count > 0 here
  // is already a meaningful event, so no additional rate threshold applies.
  const drawerMismatch = input.metrics.find((m) => m.metric_key === 'drawer_mismatch_count')
  if (drawerMismatch) {
    hasAnyData = true
    if (drawerMismatch.value > 0) {
      hasWarning = true
      messages.push('One or more cash drawers did not balance yesterday.')
    }
  }

  // Metric 1 (C, warning policy) -- Sync Upload Failure Rate.
  const syncFailures = input.metrics.find((m) => m.metric_key === 'sync_failure_terminal')
  const syncTotal = input.metrics.find((m) => m.metric_key === 'sync_terminal_total')
  if (syncFailures && syncTotal) {
    hasAnyData = true
    // Zero vs. no-data: denominator = 0 means no operations occurred, never "0%
    // failure" -- must not contribute a false-healthy signal either way.
    if (syncTotal.value > 0) {
      const rate = syncFailures.value / syncTotal.value
      if (rate > SYNC_UPLOAD_FAILURE_RATE_WARNING) {
        hasWarning = true
        messages.push('Wafi is having trouble syncing data on one of your devices.')
      }
    }
  }

  // Metric 2 (C, warning policy) -- Offline Duration.
  const offlineDuration = input.metrics.find((m) => m.metric_key === 'offline_duration_seconds')
  if (offlineDuration) {
    hasAnyData = true
    if (offlineDuration.value > OFFLINE_DURATION_WARNING_SECONDS) {
      hasWarning = true
      const hours = Math.round(offlineDuration.value / 3600)
      messages.push(`Your device was offline for ${hours} hours yesterday.`)
    }
  }

  // Metric 5 (C, warning policy) -- Deferred Job Failure Rate.
  const deferredFailures = input.metrics.find((m) => m.metric_key === 'deferred_job_failure_terminal')
  const deferredTotal = input.metrics.find((m) => m.metric_key === 'deferred_job_terminal_total')
  if (deferredFailures && deferredTotal) {
    hasAnyData = true
    if (deferredTotal.value > 0) {
      const rate = deferredFailures.value / deferredTotal.value
      if (rate > DEFERRED_JOB_FAILURE_RATE_WARNING) {
        hasWarning = true
        messages.push('Some background tasks are failing on one of your devices.')
      }
    }
  }

  // Metric 6 (C, warning policy) -- Unhandled App Errors. Aggregate the rate
  // from summed raw totals, never by averaging child rates (cross-cutting
  // metric-contract rule) -- there is only one shop-level pair of counters
  // here, but the sum-then-divide shape is preserved for consistency/reuse.
  const appErrors = input.metrics.find((m) => m.metric_key === 'app_error_count')
  const activeDeviceDays = input.metrics.find((m) => m.metric_key === 'active_device_day')
  if (appErrors && activeDeviceDays) {
    hasAnyData = true
    if (activeDeviceDays.value > 0) {
      const rate = appErrors.value / activeDeviceDays.value
      if (rate > APP_ERROR_RATE_WARNING) {
        hasWarning = true
        messages.push('Wafi had some application errors yesterday.')
      }
    }
  }

  // Metric 3 (G, warning policy) -- Dead-Letter Count (current-state gauge).
  const deadLetterGauge = input.gauges.find((g) => g.gauge_key === 'dead_letter_count')
  if (deadLetterGauge) {
    hasAnyData = true
    if (deadLetterGauge.value > 0) {
      hasWarning = true
      messages.push('Wafi has some unresolved sync issues.')
    }
  }

  // telemetry_periods_dropped is diagnostic-only, team-view-only -- it must
  // never be read here, and it never is (deliberately absent from this list).

  if (!hasAnyData) {
    return { status: 'no-data', messages: [] }
  }

  if (hasCritical) return { status: 'issue', messages }
  if (hasWarning) return { status: 'attention', messages }
  return { status: 'healthy', messages: ['Everything is working normally.'] }
}

// Metric 7 (S, current-state query, NOT event-sourced) -- Stale Device Count.
// No stored value, no rebuild function; scoped to devices.is_active = true so
// a retired/revoked device can never permanently render a shop "unhealthy."
export const STALE_DEVICE_THRESHOLD_MS = 2 * 60 * 60 * 1000 // v1 policy value, not part of the metric formula

export function computeStaleDeviceCount(
  devices: Array<{ is_active: boolean; last_seen_at: string | null }>,
  thresholdMs: number = STALE_DEVICE_THRESHOLD_MS,
  now: Date = new Date(),
): number {
  return devices.filter((d) => {
    if (!d.is_active) return false // retired/revoked devices never count, per the spec
    if (!d.last_seen_at) return true // never seen at all counts as stale
    return now.getTime() - new Date(d.last_seen_at).getTime() > thresholdMs
  }).length
}

/**
 * Folds metric 7's live stale-device reading into computeOwnerHealthStatus's
 * output, preserving issue > attention > healthy > no-data precedence.
 *
 * `hasRegisteredDevices` is whether there's at least one device row to query
 * in the first place -- a shop with zero registered devices has nothing for
 * metric 7 to report on, so it must not manufacture a "healthy" reading out
 * of nothing (that would be the same false-healthy mistake the base
 * function's no-data rule exists to prevent).
 *
 * A non-stale reading (`staleCount === 0`, with at least one registered
 * device) IS itself usable, non-unhealthy data for metric 7 -- per the
 * spec's precedence rule ("at least one applicable metric has usable data
 * and none are unhealthy -> Healthy"), this alone must be able to resolve a
 * base `no-data` status into `healthy`, not merely upgrade toward Attention.
 */
export function mergeStaleDeviceStatus(
  base: OwnerHealthResult,
  staleCount: number,
  hasRegisteredDevices: boolean,
): OwnerHealthResult {
  const messages = [...base.messages]
  let status = base.status

  if (staleCount > 0) {
    // Multi-device shops: contextualize around affected device count, never
    // phrased as if the whole shop is unhealthy.
    messages.push(
      staleCount === 1
        ? 'One of your devices is currently unreachable.'
        : `${staleCount} of your devices are currently unreachable.`,
    )
    // Stale devices never downgrade an existing Issue/Attention status, and
    // never get overridden by the no-data fallthrough -- they always push
    // the status to at least Attention.
    if (status === 'no-data' || status === 'healthy') {
      status = 'attention'
    }
  } else if (hasRegisteredDevices && status === 'no-data') {
    // A quiet/new shop with no historical health_metrics rows yet, but at
    // least one connected, non-stale device -- metric 7 has a real, current,
    // healthy reading, so the shop is Healthy, not stuck at "No recent
    // health data" forever.
    status = 'healthy'
    if (messages.length === 0) {
      messages.push('Everything is working normally.')
    }
  }

  return { status, messages }
}

function shopLocalDateString(timezone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now) // en-CA -> YYYY-MM-DD
}

/** null/1 = active; only an explicit 0 deactivates (legacy rows have null) -- same
 * convention as useDevices.ts's rowIsActive. */
function rowIsActive(v: number | null | undefined): boolean {
  return v !== 0
}

interface OwnerHealthState {
  status: OwnerHealthResult['status']
  messages: string[]
  loading: boolean
}

/**
 * OwnerHealthPage.vue's data-loading composable (mirrors the ProductsPage /
 * useProducts split). Reads the shop's most-recently-completed shop-local day
 * of synced health_metrics/health_gauges, folds in the live metric-7 stale-
 * device query, and exposes a single status + plain-language message list.
 */
export function useOwnerHealth() {
  const state = ref<OwnerHealthState>({ status: 'no-data', messages: [], loading: true })

  async function load(): Promise<void> {
    state.value = { ...state.value, loading: true }
    const device = useDeviceStore()

    // shops.timezone is NEVER null (NOT NULL DEFAULT 'UTC' server-side, since
    // migration 084) -- timezone_confirmed_at IS NOT NULL is the sole
    // readiness predicate, everywhere, client and server.
    const shop = await db.getOptional<{ timezone: string | null; timezone_confirmed_at: string | null }>(
      'SELECT timezone, timezone_confirmed_at FROM shops WHERE id = ?',
      [device.shopId],
    )
    const shopTimezone = shop?.timezone ?? null

    if (!shop?.timezone_confirmed_at || !shopTimezone) {
      state.value = { status: 'timezone-not-configured', messages: [], loading: false }
      return
    }

    // Historical metrics (1, 2, 4, 5, 6, 8) evaluate the most recently
    // completed shop-local calendar day ("yesterday") -- never today's
    // still-open partial data.
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const periodStart = shopLocalDateString(shopTimezone, yesterday)

    const metrics = await db.getAll<{ metric_key: string; period_start: string; value: number }>(
      `SELECT metric_key, period_start, SUM(value) as value FROM health_metrics
       WHERE shop_id = ? AND period_start = ?
       GROUP BY metric_key, period_start`,
      [device.shopId, periodStart],
    )

    // Current-state gauges (3) always evaluate live/latest-reported state --
    // the most recent observed_at per gauge_key across this shop's devices.
    const gauges = await db.getAll<{ gauge_key: string; value: number; observed_at: string }>(
      `SELECT gauge_key, value, MAX(observed_at) as observed_at FROM health_gauges
       WHERE shop_id = ?
       GROUP BY gauge_key`,
      [device.shopId],
    )

    const base = computeOwnerHealthStatus({ shopTimezone, metrics, gauges })

    // Metric 7 -- live device query, folded in with the same
    // issue > attention > healthy > no-data precedence as every other metric,
    // never as a separate/competing indicator.
    const deviceRows = await db.getAll<{ is_active: number | null; last_seen_at: string | null }>(
      'SELECT is_active, last_seen_at FROM devices WHERE shop_id = ?',
      [device.shopId],
    )
    const devices = deviceRows.map((d) => ({ is_active: rowIsActive(d.is_active), last_seen_at: d.last_seen_at }))
    const staleCount = computeStaleDeviceCount(devices)
    const hasRegisteredDevices = devices.some((d) => d.is_active)

    const merged = mergeStaleDeviceStatus(base, staleCount, hasRegisteredDevices)

    state.value = { status: merged.status, messages: merged.messages, loading: false }
  }

  return { state, load }
}
