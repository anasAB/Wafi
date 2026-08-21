import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'

// WAFI-148: spy on the shared health counter helper so the offline-duration
// cycle can be asserted without a real local_health_metrics table.
const incrementLocalHealthCounter = vi.fn(async () => {})
vi.mock('@/data/powersync/healthCounters', () => ({
  incrementLocalHealthCounter: (...a: any[]) => incrementLocalHealthCounter(...a),
  shopLocalToday: () => '2026-08-21',
}))

// Capture the statusChanged listener bindPowerSync() registers so tests can
// drive connect/disconnect transitions directly, mirroring how useSync itself
// only ever learns about connectivity via this listener (not navigator.onLine).
let statusListener: ((status: any) => void) | undefined
const registerListener = vi.fn((handlers: { statusChanged: (status: any) => void }) => {
  statusListener = handlers.statusChanged
  return () => { statusListener = undefined }
})

vi.mock('@/data/powersync/db', () => ({
  db: {
    getAll: vi.fn().mockResolvedValue([{ n: 0 }]),
    registerListener: (...args: any[]) => registerListener(...(args as [any])),
    currentStatus: { connected: false },
    connect: vi.fn(),
  },
}))
vi.mock('@/data/powersync/dead-letter', () => ({
  countDeadLetter: vi.fn().mockResolvedValue(0),
  listDeadLetter: vi.fn().mockResolvedValue([]),
  retryDeadLetterOp: vi.fn(),
  discardDeadLetterOp: vi.fn(),
}))
vi.mock('@/data/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      // useDeviceStore wires this up at store-creation time; unrelated to what
      // this file tests, so a no-op subscription stub is enough to construct.
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}))
vi.mock('@/features/audit/composables/useAuditLog', () => ({
  useAuditLog: () => ({ logDeadLetterDiscarded: vi.fn() }),
}))

import { useSync } from '@/features/sync/useSync'

function mountUseSync() {
  let api: ReturnType<typeof useSync>
  const wrapper = mount(defineComponent({
    setup() {
      api = useSync()
      return () => h('div')
    },
  }))
  return { wrapper, api: api! }
}

describe('useSync offline-duration cycle tracking (WAFI-148)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    incrementLocalHealthCounter.mockClear()
    statusListener = undefined
  })

  it('counts offline_duration_seconds on reconnect after a disconnect', async () => {
    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValue(1_000_000)
    const { wrapper } = mountUseSync()

    statusListener!({ connected: false, dataFlowStatus: {} }) // disconnect
    nowSpy.mockReturnValue(1_000_000 + 30_000) // 30s later
    statusListener!({ connected: true, dataFlowStatus: {} }) // reconnect

    expect(incrementLocalHealthCounter).toHaveBeenCalledExactlyOnceWith('offline_duration_seconds', '2026-08-21', 30)
    nowSpy.mockRestore()
    wrapper.unmount()
  })

  it('does not double-count a second reconnect notification for the same offline period', async () => {
    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValue(1_000_000)
    const { wrapper } = mountUseSync()

    statusListener!({ connected: false, dataFlowStatus: {} })
    nowSpy.mockReturnValue(1_000_000 + 10_000)
    statusListener!({ connected: true, dataFlowStatus: {} })
    statusListener!({ connected: true, dataFlowStatus: {} }) // double-fire

    expect(incrementLocalHealthCounter).toHaveBeenCalledTimes(1)
    nowSpy.mockRestore()
    wrapper.unmount()
  })

  it('does not count anything while still connected (no disconnect ever observed)', async () => {
    const { wrapper } = mountUseSync()
    statusListener!({ connected: true, dataFlowStatus: {} })
    expect(incrementLocalHealthCounter).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
