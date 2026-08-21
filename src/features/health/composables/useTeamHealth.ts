import { ref, computed } from 'vue'
import { supabase } from '@/data/supabase/client'
import { computeStaleDeviceCount, STALE_DEVICE_THRESHOLD_MS } from './useOwnerHealth'
import { formatRate, formatCount, formatGaugeFreshness } from '../format/healthFormat'

interface HealthForAdminRpcRow {
  shop_id: string
  shop_name: string
  device_id: string | null
  metric_key: string
  period_start: string
  value: number
}

interface HealthGaugesAndDevicesRpcRow {
  shop_id: string
  shop_name: string
  device_id: string
  gauge_key: string | null
  gauge_value: number | null
  observed_at: string | null
  device_is_active: boolean
  device_last_seen_at: string | null
}

export interface TeamDeviceRow {
  deviceId: string
  isActive: boolean
  lastSeenAt: string | null
  isStale: boolean
}

export interface TeamShopHealth {
  shopId: string
  shopName: string
  neverClosedShiftCount: ReturnType<typeof formatCount>
  drawerMismatchCount: ReturnType<typeof formatCount>
  syncFailureRate: ReturnType<typeof formatRate>
  offlineDurationSeconds: ReturnType<typeof formatCount>
  deferredJobFailureRate: ReturnType<typeof formatRate>
  appErrorRate: ReturnType<typeof formatRate>
  deadLetterCount: ReturnType<typeof formatCount>
  deadLetterFreshness: ReturnType<typeof formatGaugeFreshness> | null
  telemetryPeriodsDropped: ReturnType<typeof formatCount>
  staleDeviceCount: number
  devices: TeamDeviceRow[]
}

// Same v1 policy window used for owner-facing offline duration presentation
// (useOwnerHealth.ts) -- reused here purely as the "how stale is this
// dead-letter reading" freshness window, not as a redefinition of the metric.
const DEAD_LETTER_FRESHNESS_WINDOW_MS = 2 * 60 * 60 * 1000

function sum(rows: HealthForAdminRpcRow[], metricKey: string): number {
  return rows.filter((r) => r.metric_key === metricKey).reduce((acc, r) => acc + Number(r.value), 0)
}

function buildShopHealth(
  shopId: string,
  shopName: string,
  metricRows: HealthForAdminRpcRow[],
  gaugeRows: HealthGaugesAndDevicesRpcRow[],
): TeamShopHealth {
  const syncFailures = sum(metricRows, 'sync_failure_terminal')
  const syncTotal = sum(metricRows, 'sync_terminal_total')
  const deferredFailures = sum(metricRows, 'deferred_job_failure_terminal')
  const deferredTotal = sum(metricRows, 'deferred_job_terminal_total')
  const appErrors = sum(metricRows, 'app_error_count')
  const activeDeviceDays = sum(metricRows, 'active_device_day')

  // One dead_letter_count gauge row per device -- team view reports the
  // shop-wide total plus the freshness of the most-recently-observed reading.
  const deadLetterGauges = gaugeRows.filter((g) => g.gauge_key === 'dead_letter_count' && g.gauge_value !== null)
  const deadLetterTotal = deadLetterGauges.reduce((acc, g) => acc + Number(g.gauge_value), 0)
  const latestDeadLetterObservedAt = deadLetterGauges
    .map((g) => g.observed_at)
    .filter((v): v is string => v !== null)
    .sort()
    .at(-1)

  const deviceRowsById = new Map<string, HealthGaugesAndDevicesRpcRow>()
  for (const g of gaugeRows) {
    if (!deviceRowsById.has(g.device_id)) deviceRowsById.set(g.device_id, g)
  }
  const rawDevices = Array.from(deviceRowsById.values()).map((g) => ({
    is_active: g.device_is_active,
    last_seen_at: g.device_last_seen_at,
  }))
  const staleDeviceCount = computeStaleDeviceCount(rawDevices, STALE_DEVICE_THRESHOLD_MS)
  const devices: TeamDeviceRow[] = Array.from(deviceRowsById.values()).map((g) => ({
    deviceId: g.device_id,
    isActive: g.device_is_active,
    lastSeenAt: g.device_last_seen_at,
    isStale: computeStaleDeviceCount(
      [{ is_active: g.device_is_active, last_seen_at: g.device_last_seen_at }],
      STALE_DEVICE_THRESHOLD_MS,
    ) > 0,
  }))

  return {
    shopId,
    shopName,
    neverClosedShiftCount: formatCount(sum(metricRows, 'never_closed_shift_count')),
    drawerMismatchCount: formatCount(sum(metricRows, 'drawer_mismatch_count')),
    syncFailureRate: formatRate(syncFailures, syncTotal, 'percentage'),
    offlineDurationSeconds: formatCount(sum(metricRows, 'offline_duration_seconds')),
    deferredJobFailureRate: formatRate(deferredFailures, deferredTotal, 'percentage'),
    appErrorRate: formatRate(appErrors, activeDeviceDays, 'per-device-day'),
    deadLetterCount: formatCount(deadLetterTotal),
    deadLetterFreshness: latestDeadLetterObservedAt
      ? formatGaugeFreshness(latestDeadLetterObservedAt, DEAD_LETTER_FRESHNESS_WINDOW_MS)
      : null,
    telemetryPeriodsDropped: formatCount(sum(metricRows, 'telemetry_periods_dropped')),
    staleDeviceCount,
    devices,
  }
}

interface TeamHealthState {
  shops: TeamShopHealth[]
  loading: boolean
  error: string | null
}

/**
 * Drives the internal-only /team-health screen. Founder cross-shop
 * operational view, structurally separate from the owner's per-shop
 * can_view_health_metrics gate -- data is read via two platform_admins-gated
 * RPCs (list_health_for_admin, list_health_gauges_and_devices_for_admin),
 * called directly (not PowerSync-synced), mirroring useRolloutAdmin.ts's
 * direct-RPC pattern for the same reason: this is cross-shop, privileged
 * data that must never land in a shop-scoped local sync stream.
 */
export function useTeamHealth() {
  const state = ref<TeamHealthState>({ shops: [], loading: true, error: null })
  const query = ref('')

  async function refresh(): Promise<void> {
    state.value = { ...state.value, loading: true, error: null }
    try {
      const [metricsResult, gaugesResult] = await Promise.all([
        supabase.rpc('list_health_for_admin', { p_shop_query: query.value }),
        supabase.rpc('list_health_gauges_and_devices_for_admin', { p_shop_query: query.value }),
      ])

      if (metricsResult.error || gaugesResult.error) {
        state.value = { ...state.value, loading: false, error: 'تعذر تحميل بيانات الصحة.' }
        return
      }

      const metricRows: HealthForAdminRpcRow[] = metricsResult.data ?? []
      const gaugeRows: HealthGaugesAndDevicesRpcRow[] = gaugesResult.data ?? []

      const shopIds = new Set<string>()
      const shopNames = new Map<string, string>()
      for (const r of metricRows) { shopIds.add(r.shop_id); shopNames.set(r.shop_id, r.shop_name) }
      for (const r of gaugeRows) { shopIds.add(r.shop_id); shopNames.set(r.shop_id, r.shop_name) }

      const shops = Array.from(shopIds)
        .map((shopId) =>
          buildShopHealth(
            shopId,
            shopNames.get(shopId) ?? '',
            metricRows.filter((r) => r.shop_id === shopId),
            gaugeRows.filter((r) => r.shop_id === shopId),
          ),
        )
        .sort((a, b) => a.shopName.localeCompare(b.shopName))

      state.value = { shops, loading: false, error: null }
    } catch {
      state.value = { ...state.value, loading: false, error: 'تعذر تحميل بيانات الصحة.' }
    }
  }

  const shops = computed(() => state.value.shops)
  const loading = computed(() => state.value.loading)
  const error = computed(() => state.value.error)

  return { query, shops, loading, error, refresh }
}
