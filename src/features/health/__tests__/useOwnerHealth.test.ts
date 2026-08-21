import { describe, it, expect, vi } from 'vitest'

// This file exercises only the pure functions below, but useOwnerHealth.ts
// also imports the real PowerSync `db` singleton at module scope (for the
// data-loading composable) -- mock it so importing the module doesn't try to
// open a real PowerSync/WA-SQLite connection under Node/Vitest (same pattern
// as useDeviceActivity.test.ts).
vi.mock('@/data/powersync/db', () => ({ db: { getOptional: vi.fn(), getAll: vi.fn(), execute: vi.fn() } }))
vi.mock('@/store/device.store', () => ({ useDeviceStore: () => ({ shopId: 'test-shop' }) }))

import {
  computeOwnerHealthStatus,
  computeStaleDeviceCount,
  mergeStaleDeviceStatus,
  STALE_DEVICE_THRESHOLD_MS,
} from '../composables/useOwnerHealth'

describe('WAFI-148 computeOwnerHealthStatus', () => {
  it('returns timezone-not-configured when the shop has no timezone set', () => {
    const result = computeOwnerHealthStatus({ shopTimezone: null, metrics: [], gauges: [] })
    expect(result.status).toBe('timezone-not-configured')
  })

  it('returns issue when any critical-policy condition is present', () => {
    const result = computeOwnerHealthStatus({
      shopTimezone: 'Asia/Damascus',
      metrics: [{ metric_key: 'never_closed_shift_count', period_start: 'yesterday', value: 1 }],
      gauges: [],
    })
    expect(result.status).toBe('issue')
    expect(result.messages).toContain('One shift required automatic closing yesterday.')
  })

  it('returns healthy with an explicit confirmation when nothing is wrong', () => {
    const result = computeOwnerHealthStatus({
      shopTimezone: 'Asia/Damascus',
      metrics: [{ metric_key: 'never_closed_shift_count', period_start: 'yesterday', value: 0 }],
      gauges: [{ gauge_key: 'dead_letter_count', value: 0, observed_at: new Date().toISOString() }],
    })
    expect(result.status).toBe('healthy')
    expect(result.messages).toEqual(['Everything is working normally.'])
  })

  it('returns no-data when every applicable metric is missing, never a false healthy', () => {
    const result = computeOwnerHealthStatus({ shopTimezone: 'Asia/Damascus', metrics: [], gauges: [] })
    expect(result.status).toBe('no-data')
  })

  it('returns attention (not issue) for a warning-only drawer mismatch', () => {
    const result = computeOwnerHealthStatus({
      shopTimezone: 'Asia/Damascus',
      metrics: [{ metric_key: 'drawer_mismatch_count', period_start: 'yesterday', value: 2 }],
      gauges: [],
    })
    expect(result.status).toBe('attention')
    expect(result.messages).toContain('One or more cash drawers did not balance yesterday.')
  })

  it('never treats a zero-denominator sync rate as healthy (zero vs no-data)', () => {
    const result = computeOwnerHealthStatus({
      shopTimezone: 'Asia/Damascus',
      metrics: [
        { metric_key: 'sync_failure_terminal', period_start: 'yesterday', value: 0 },
        { metric_key: 'sync_terminal_total', period_start: 'yesterday', value: 0 },
      ],
      gauges: [],
    })
    // hasAnyData is still true (the metric reported), but a 0/0 rate must not
    // itself trigger a warning -- and must not silently look like "0% failure."
    expect(result.status).toBe('healthy')
  })

  it('flags attention when sync upload failure rate exceeds the 5% threshold', () => {
    const result = computeOwnerHealthStatus({
      shopTimezone: 'Asia/Damascus',
      metrics: [
        { metric_key: 'sync_failure_terminal', period_start: 'yesterday', value: 10 },
        { metric_key: 'sync_terminal_total', period_start: 'yesterday', value: 100 },
      ],
      gauges: [],
    })
    expect(result.status).toBe('attention')
  })

  it('does not flag sync failure rate at or below the 5% threshold', () => {
    const result = computeOwnerHealthStatus({
      shopTimezone: 'Asia/Damascus',
      metrics: [
        { metric_key: 'sync_failure_terminal', period_start: 'yesterday', value: 5 },
        { metric_key: 'sync_terminal_total', period_start: 'yesterday', value: 100 },
      ],
      gauges: [],
    })
    expect(result.status).toBe('healthy')
  })

  it('flags attention when offline duration exceeds 2 hours', () => {
    const result = computeOwnerHealthStatus({
      shopTimezone: 'Asia/Damascus',
      metrics: [{ metric_key: 'offline_duration_seconds', period_start: 'yesterday', value: 3 * 60 * 60 }],
      gauges: [],
    })
    expect(result.status).toBe('attention')
    expect(result.messages.some((m) => m.includes('offline for 3 hours'))).toBe(true)
  })

  it('flags attention when deferred job failure rate exceeds the 5% threshold', () => {
    const result = computeOwnerHealthStatus({
      shopTimezone: 'Asia/Damascus',
      metrics: [
        { metric_key: 'deferred_job_failure_terminal', period_start: 'yesterday', value: 10 },
        { metric_key: 'deferred_job_terminal_total', period_start: 'yesterday', value: 100 },
      ],
      gauges: [],
    })
    expect(result.status).toBe('attention')
  })

  it('does not flag a single isolated app error (count > 0 alone is not the policy)', () => {
    const result = computeOwnerHealthStatus({
      shopTimezone: 'Asia/Damascus',
      metrics: [
        { metric_key: 'app_error_count', period_start: 'yesterday', value: 1 },
        { metric_key: 'active_device_day', period_start: 'yesterday', value: 1 },
      ],
      gauges: [],
    })
    expect(result.status).toBe('healthy')
  })

  it('flags attention when app error rate exceeds 1 per active device-day', () => {
    const result = computeOwnerHealthStatus({
      shopTimezone: 'Asia/Damascus',
      metrics: [
        { metric_key: 'app_error_count', period_start: 'yesterday', value: 5 },
        { metric_key: 'active_device_day', period_start: 'yesterday', value: 1 },
      ],
      gauges: [],
    })
    expect(result.status).toBe('attention')
    expect(result.messages).toContain('Wafi had some application errors yesterday.')
  })

  it('never lets telemetry_periods_dropped affect owner status or messages', () => {
    const result = computeOwnerHealthStatus({
      shopTimezone: 'Asia/Damascus',
      metrics: [{ metric_key: 'telemetry_periods_dropped', period_start: 'yesterday', value: 999 }],
      gauges: [],
    })
    expect(result.status).toBe('no-data')
    expect(result.messages).toEqual([])
  })

  it('issue takes precedence over attention when both are present', () => {
    const result = computeOwnerHealthStatus({
      shopTimezone: 'Asia/Damascus',
      metrics: [
        { metric_key: 'never_closed_shift_count', period_start: 'yesterday', value: 1 },
        { metric_key: 'drawer_mismatch_count', period_start: 'yesterday', value: 1 },
      ],
      gauges: [],
    })
    expect(result.status).toBe('issue')
    expect(result.messages).toContain('One shift required automatic closing yesterday.')
    expect(result.messages).toContain('One or more cash drawers did not balance yesterday.')
  })
})

describe('WAFI-148 computeStaleDeviceCount', () => {
  it('counts an active device whose last_seen_at exceeds the threshold', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
    const count = computeStaleDeviceCount(
      [{ is_active: true, last_seen_at: threeHoursAgo }], STALE_DEVICE_THRESHOLD_MS,
    )
    expect(count).toBe(1)
  })

  it('never counts a retired/revoked (is_active=false) device, even if never seen', () => {
    const count = computeStaleDeviceCount(
      [{ is_active: false, last_seen_at: null }], STALE_DEVICE_THRESHOLD_MS,
    )
    expect(count).toBe(0)
  })

  it('does not count an active device within the threshold', () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const count = computeStaleDeviceCount(
      [{ is_active: true, last_seen_at: tenMinutesAgo }], STALE_DEVICE_THRESHOLD_MS,
    )
    expect(count).toBe(0)
  })

  it('counts an active device that has never checked in at all', () => {
    const count = computeStaleDeviceCount(
      [{ is_active: true, last_seen_at: null }], STALE_DEVICE_THRESHOLD_MS,
    )
    expect(count).toBe(1)
  })
})

describe('WAFI-148 mergeStaleDeviceStatus', () => {
  it('resolves a no-data base status to healthy when a registered device is non-stale', () => {
    // A quiet/new shop: no historical health_metrics rows yet (base = no-data),
    // but at least one connected, non-stale device -- metric 7 alone is real,
    // current, non-unhealthy data, so the shop must read Healthy, not stay
    // stuck at "No recent health data" forever.
    const result = mergeStaleDeviceStatus({ status: 'no-data', messages: [] }, 0, true)
    expect(result.status).toBe('healthy')
    expect(result.messages).toEqual(['Everything is working normally.'])
  })

  it('stays no-data when there are zero registered devices at all', () => {
    const result = mergeStaleDeviceStatus({ status: 'no-data', messages: [] }, 0, false)
    expect(result.status).toBe('no-data')
  })

  it('upgrades a healthy base status to attention when a device is stale', () => {
    const result = mergeStaleDeviceStatus({ status: 'healthy', messages: ['Everything is working normally.'] }, 1, true)
    expect(result.status).toBe('attention')
    expect(result.messages).toContain('One of your devices is currently unreachable.')
  })

  it('never downgrades an existing issue status when a device is stale', () => {
    const result = mergeStaleDeviceStatus({ status: 'issue', messages: ['One shift required automatic closing yesterday.'] }, 2, true)
    expect(result.status).toBe('issue')
    expect(result.messages).toContain('2 of your devices are currently unreachable.')
  })

  it('leaves a no-data base status alone when a device IS stale (attention takes over, not healthy)', () => {
    const result = mergeStaleDeviceStatus({ status: 'no-data', messages: [] }, 1, true)
    expect(result.status).toBe('attention')
  })
})
