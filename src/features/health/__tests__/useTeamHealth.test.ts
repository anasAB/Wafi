import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpcMock = vi.fn()
vi.mock('@/data/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}))

// useTeamHealth.ts imports computeStaleDeviceCount/STALE_DEVICE_THRESHOLD_MS from
// useOwnerHealth.ts, which also imports the real PowerSync `db` singleton at module
// scope -- mock it so importing the module doesn't try to open a real
// PowerSync/WA-SQLite connection under Node/Vitest (same pattern as
// useOwnerHealth.test.ts / useDeviceActivity.test.ts).
vi.mock('@/data/powersync/db', () => ({ db: { getOptional: vi.fn(), getAll: vi.fn(), execute: vi.fn() } }))
vi.mock('@/store/device.store', () => ({ useDeviceStore: () => ({ shopId: 'test-shop' }) }))

import { useTeamHealth } from '@/features/health/composables/useTeamHealth'

function metricRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    shop_id: 's1', shop_name: 'Al Noor Pharmacy', device_id: 'd1',
    metric_key: 'drawer_mismatch_count', period_start: '2026-08-20', value: 0,
    ...overrides,
  }
}

function gaugeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    shop_id: 's1', shop_name: 'Al Noor Pharmacy', device_id: 'd1',
    gauge_key: null, gauge_value: null, observed_at: null,
    device_is_active: true, device_last_seen_at: new Date().toISOString(),
    ...overrides,
  }
}

describe('useTeamHealth: load & search', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls both admin RPCs with the current query on refresh()', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null })
    const team = useTeamHealth()
    await team.refresh()
    expect(rpcMock).toHaveBeenCalledWith('list_health_for_admin', { p_shop_query: '' })
    expect(rpcMock).toHaveBeenCalledWith('list_health_gauges_and_devices_for_admin', { p_shop_query: '' })
  })

  it('groups metric rows and gauge/device rows by shop, sorted by shop name', async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === 'list_health_for_admin') {
        return Promise.resolve({
          data: [
            metricRow({ shop_id: 's2', shop_name: 'Zeta Shop', metric_key: 'drawer_mismatch_count', value: 1 }),
            metricRow({ shop_id: 's1', shop_name: 'Al Noor Pharmacy', metric_key: 'drawer_mismatch_count', value: 3 }),
          ],
          error: null,
        })
      }
      return Promise.resolve({ data: [gaugeRow({ shop_id: 's1', shop_name: 'Al Noor Pharmacy' })], error: null })
    })

    const team = useTeamHealth()
    await team.refresh()

    expect(team.shops.value).toHaveLength(2)
    expect(team.shops.value[0].shopName).toBe('Al Noor Pharmacy')
    expect(team.shops.value[0].drawerMismatchCount.display).toBe('3')
    expect(team.shops.value[1].shopName).toBe('Zeta Shop')
    expect(team.shops.value[1].drawerMismatchCount.display).toBe('1')
  })

  it('computes syncFailureRate as a percentage from summed numerator/denominator metric rows', async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === 'list_health_for_admin') {
        return Promise.resolve({
          data: [
            metricRow({ metric_key: 'sync_failure_terminal', value: 5 }),
            metricRow({ metric_key: 'sync_terminal_total', value: 100 }),
          ],
          error: null,
        })
      }
      return Promise.resolve({ data: [], error: null })
    })

    const team = useTeamHealth()
    await team.refresh()

    expect(team.shops.value[0].syncFailureRate.display).toBe('5/100 · 5.0%')
    expect(team.shops.value[0].syncFailureRate.isNoData).toBe(false)
  })

  it('reports appErrorRate as no-data when active_device_day total is zero', async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === 'list_health_for_admin') {
        return Promise.resolve({ data: [metricRow({ metric_key: 'app_error_count', value: 3 })], error: null })
      }
      return Promise.resolve({ data: [], error: null })
    })

    const team = useTeamHealth()
    await team.refresh()

    expect(team.shops.value[0].appErrorRate.isNoData).toBe(true)
  })

  it('reads telemetry_periods_dropped as a diagnostic metric like any other metric_key', async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === 'list_health_for_admin') {
        return Promise.resolve({ data: [metricRow({ metric_key: 'telemetry_periods_dropped', value: 7 })], error: null })
      }
      return Promise.resolve({ data: [], error: null })
    })

    const team = useTeamHealth()
    await team.refresh()

    expect(team.shops.value[0].telemetryPeriodsDropped.display).toBe('7')
  })

  it('computes staleDeviceCount using computeStaleDeviceCount over the shop devices from the gauges/devices RPC', async () => {
    const staleTime = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() // > 2h threshold
    rpcMock.mockImplementation((fn: string) => {
      if (fn === 'list_health_for_admin') return Promise.resolve({ data: [], error: null })
      return Promise.resolve({
        data: [
          gaugeRow({ device_id: 'd1', device_is_active: true, device_last_seen_at: staleTime }),
          gaugeRow({ device_id: 'd2', device_is_active: true, device_last_seen_at: new Date().toISOString() }),
        ],
        error: null,
      })
    })

    const team = useTeamHealth()
    await team.refresh()

    expect(team.shops.value[0].staleDeviceCount).toBe(1)
    const d1 = team.shops.value[0].devices.find((d) => d.deviceId === 'd1')
    const d2 = team.shops.value[0].devices.find((d) => d.deviceId === 'd2')
    expect(d1?.isStale).toBe(true)
    expect(d2?.isStale).toBe(false)
  })

  it('computes deadLetterCount and freshness from the gauges/devices RPC dead_letter_count rows', async () => {
    const observedAt = new Date().toISOString()
    rpcMock.mockImplementation((fn: string) => {
      if (fn === 'list_health_for_admin') return Promise.resolve({ data: [], error: null })
      return Promise.resolve({
        data: [gaugeRow({ gauge_key: 'dead_letter_count', gauge_value: 4, observed_at: observedAt })],
        error: null,
      })
    })

    const team = useTeamHealth()
    await team.refresh()

    expect(team.shops.value[0].deadLetterCount.display).toBe('4')
    expect(team.shops.value[0].deadLetterFreshness?.isStale).toBe(false)
  })

  it('on RPC error, stops loading, sets an error message, and does not clear existing shops', async () => {
    rpcMock.mockResolvedValueOnce({ data: [metricRow()], error: null })
    rpcMock.mockResolvedValueOnce({ data: [gaugeRow()], error: null })
    const team = useTeamHealth()
    await team.refresh()
    expect(team.shops.value).toHaveLength(1)

    rpcMock.mockResolvedValueOnce({ data: null, error: new Error('boom') })
    rpcMock.mockResolvedValueOnce({ data: null, error: null })
    await team.refresh()

    expect(team.loading.value).toBe(false)
    expect(team.error.value).not.toBeNull()
    expect(team.shops.value).toHaveLength(1)
  })
})
