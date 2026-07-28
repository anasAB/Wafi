import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

const callBootstrapMock = vi.fn()
vi.mock('@/data/supabase/bootstrap', async () => {
  const actual = await vi.importActual<typeof import('@/data/supabase/bootstrap')>('@/data/supabase/bootstrap')
  return { ...actual, callBootstrapOwnerIdentity: (...args: unknown[]) => callBootstrapMock(...args) }
})

const refreshSessionMock = vi.fn().mockResolvedValue({ data: {}, error: null })
vi.mock('@/data/supabase/client', () => ({
  supabase: {
    auth: {
      refreshSession: (...args: unknown[]) => refreshSessionMock(...args),
      // useDeviceStore wires up onAuthStateChange at store-creation time;
      // it's unrelated to what this file is testing, so a no-op subscription
      // stub is enough to let the store construct (see useOperatorSwitch.test.ts).
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
    },
  },
}))

describe('useOwnerBootstrap', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    refreshSessionMock.mockResolvedValue({ data: {}, error: null })
  })

  it('bootstrapOwner: on success, refreshes the session, polls until the local staff row appears, sets lastConfirmedOperatorId, and clears the pending record', async () => {
    callBootstrapMock.mockResolvedValue('success')
    const { db } = await import('@/data/powersync/db')
    vi.mocked(db.getOptional).mockResolvedValue({ id: 'staff-1' } as any)

    const { useDeviceStore } = await import('@/store/device.store')
    const { useBootstrapStore } = await import('@/features/staff/bootstrap.store')
    const { useOwnerBootstrap } = await import('@/features/staff/composables/useOwnerBootstrap')

    const result = await useOwnerBootstrap().bootstrapOwner('Owner', '1234')

    expect(result).toEqual({ status: 'done' })
    expect(refreshSessionMock).toHaveBeenCalled()
    expect(useDeviceStore().lastConfirmedOperatorId).toBeTruthy()
    expect(useBootstrapStore().pending).toBeNull()
  })

  // A brand-new device's first-ever sync (or any stale connection) can't be
  // relied on to notice a refreshed session on its own — found live in
  // production (2026-07-28): the RPC fully succeeded server-side (staff/
  // devices/device_sessions rows all existed), but the client sat on
  // "still syncing" past the poll window because nothing told PowerSync to
  // re-fetch credentials with the new token. Reconnecting explicitly closes
  // that gap.
  it('bootstrapOwner: reconnects PowerSync (fetching fresh credentials) after refreshing the session, before polling', async () => {
    callBootstrapMock.mockResolvedValue('success')
    const { db } = await import('@/data/powersync/db')
    vi.mocked(db.getOptional).mockResolvedValue({ id: 'staff-1' } as any)

    const { useOwnerBootstrap } = await import('@/features/staff/composables/useOwnerBootstrap')
    await useOwnerBootstrap().bootstrapOwner('Owner', '1234')

    expect(db.connect).toHaveBeenCalled()
    const refreshOrder = refreshSessionMock.mock.invocationCallOrder[0]
    const connectOrder = vi.mocked(db.connect).mock.invocationCallOrder[0]
    expect(connectOrder).toBeGreaterThan(refreshOrder)
  })

  it('bootstrapOwner: a PowerSync reconnect failure does not throw — falls through to the normal poll/timeout path', async () => {
    callBootstrapMock.mockResolvedValue('success')
    const { db } = await import('@/data/powersync/db')
    vi.mocked(db.connect).mockRejectedValueOnce(new Error('offline'))
    vi.mocked(db.getOptional).mockResolvedValue({ id: 'staff-1' } as any)

    const { useOwnerBootstrap } = await import('@/features/staff/composables/useOwnerBootstrap')
    const result = await useOwnerBootstrap().bootstrapOwner('Owner', '1234')

    expect(result).toEqual({ status: 'done' })
  })

  it('bootstrapOwner: treats already_bootstrapped exactly like success', async () => {
    callBootstrapMock.mockResolvedValue('already_bootstrapped')
    const { db } = await import('@/data/powersync/db')
    vi.mocked(db.getOptional).mockResolvedValue({ id: 'staff-1' } as any)

    const { useOwnerBootstrap } = await import('@/features/staff/composables/useOwnerBootstrap')
    const result = await useOwnerBootstrap().bootstrapOwner('Owner', '1234')

    expect(result).toEqual({ status: 'done' })
  })

  it('bootstrapOwner: returns needs-connectivity when the RPC call throws', async () => {
    callBootstrapMock.mockRejectedValue(new Error('network error'))

    const { useOwnerBootstrap } = await import('@/features/staff/composables/useOwnerBootstrap')
    const result = await useOwnerBootstrap().bootstrapOwner('Owner', '1234')

    expect(result).toEqual({ status: 'needs-connectivity' })
  })

  it('bootstrapOwner: returns timeout if the local staff row never appears within the poll window, and leaves the pending record in place', async () => {
    callBootstrapMock.mockResolvedValue('success')
    const { db } = await import('@/data/powersync/db')
    vi.mocked(db.getOptional).mockResolvedValue(undefined)

    const { useBootstrapStore } = await import('@/features/staff/bootstrap.store')
    const { useOwnerBootstrap } = await import('@/features/staff/composables/useOwnerBootstrap')

    const result = await useOwnerBootstrap().bootstrapOwner('Owner', '1234', { pollIntervalMs: 1, pollTimeoutMs: 5 })

    expect(result).toEqual({ status: 'timeout' })
    expect(useBootstrapStore().pending).not.toBeNull()
  })

  it('resumePendingBootstrap: reports nothing-pending when there is no pending record', async () => {
    const { useOwnerBootstrap } = await import('@/features/staff/composables/useOwnerBootstrap')
    const result = await useOwnerBootstrap().resumePendingBootstrap()
    expect(result).toEqual({ status: 'nothing-pending' })
    expect(callBootstrapMock).not.toHaveBeenCalled()
  })

  it('resumePendingBootstrap: clears the pending record when the RPC returns invalid_state (unlike the timeout case, which keeps it)', async () => {
    const { useBootstrapStore } = await import('@/features/staff/bootstrap.store')
    useBootstrapStore().start('device-1', 'staff-1')
    callBootstrapMock.mockResolvedValue('invalid_state')

    const { useOwnerBootstrap } = await import('@/features/staff/composables/useOwnerBootstrap')
    const result = await useOwnerBootstrap().resumePendingBootstrap()

    expect(result).toEqual({ status: 'needs-connectivity' })
    expect(useBootstrapStore().pending).toBeNull()
  })

  it('resumePendingBootstrap: re-runs the RPC with the persisted ids and no PIN, without re-prompting', async () => {
    const { useBootstrapStore } = await import('@/features/staff/bootstrap.store')
    useBootstrapStore().start('device-1', 'staff-1')
    callBootstrapMock.mockResolvedValue('already_bootstrapped')
    const { db } = await import('@/data/powersync/db')
    vi.mocked(db.getOptional).mockResolvedValue({ id: 'staff-1' } as any)

    const { useOwnerBootstrap } = await import('@/features/staff/composables/useOwnerBootstrap')
    const result = await useOwnerBootstrap().resumePendingBootstrap()

    expect(result).toEqual({ status: 'done' })
    expect(callBootstrapMock).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'device-1', staffId: 'staff-1', pin: '' })
    )
  })
})
