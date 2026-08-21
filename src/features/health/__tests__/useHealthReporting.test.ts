import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runHealthReportingTick } from '../composables/useHealthReporting'

// vi.mock factories are hoisted above all imports/top-level statements, so
// the mocks they reference must be created via vi.hoisted rather than plain
// top-level consts (the brief's original draft used plain consts here, which
// throws "Cannot access 'mockDb' before initialization" -- fixed during
// self-review for this task).
const { mockDb, mockCountDeadLetter, mockRpc } = vi.hoisted(() => ({
  mockDb: {
    getAll: vi.fn(),
    getOptional: vi.fn(async () => null), // used internally by incrementLocalHealthCounter
                                            // (Task 10) for the telemetry_periods_dropped path
    execute: vi.fn(async () => {}),
  },
  mockCountDeadLetter: vi.fn(async () => 3),
  mockRpc: vi.fn(async () => ({
    data: {
      accepted_counters: [{ metric_key: 'app_error_count', period_start: '2026-08-19' }],
      accepted_gauges: [{ gauge_key: 'dead_letter_count', period_start: null }],
    },
    error: null,
  })),
}))

vi.mock('@/data/powersync/db', () => ({ db: mockDb }))
vi.mock('@/data/powersync/dead-letter', () => ({ countDeadLetter: mockCountDeadLetter }))
vi.mock('@/data/supabase/client', () => ({ supabase: { rpc: mockRpc } }))

describe('WAFI-148 runHealthReportingTick', () => {
  beforeEach(() => {
    mockDb.getAll.mockReset()
    mockDb.execute.mockClear()
    mockRpc.mockClear()
  })

  it('sends all open counters and the dead-letter gauge, then deletes only closed+accepted rows', async () => {
    mockDb.getAll
      .mockResolvedValueOnce([
        { metric_key: 'app_error_count', period_start: '2026-08-19', value: 5 }, // closed day
        { metric_key: 'app_error_count', period_start: '2026-08-21', value: 2 }, // today, open
      ])

    await runHealthReportingTick({ shopId: 'shop-1', deviceId: 'dev-1', today: '2026-08-21' })

    expect(mockRpc).toHaveBeenCalledWith('report_health_metrics', expect.objectContaining({
      p_device_id: 'dev-1',
    }))

    // Only the closed, accepted period (2026-08-19) is deleted locally --
    // the open period (2026-08-21) must survive.
    const deleteCalls = mockDb.execute.mock.calls.filter(([sql]) => sql.includes('DELETE'))
    expect(deleteCalls).toHaveLength(1)
    expect(deleteCalls[0][1]).toContain('2026-08-19')
  })

  it('reports the dead-letter gauge with a fresh observed_at every tick', async () => {
    mockDb.getAll.mockResolvedValueOnce([])
    await runHealthReportingTick({ shopId: 'shop-1', deviceId: 'dev-1', today: '2026-08-21' })

    const [, args] = mockRpc.mock.calls[0]
    expect(args.p_gauges[0].gauge_key).toBe('dead_letter_count')
    expect(args.p_gauges[0].value).toBe(3)
  })
})
