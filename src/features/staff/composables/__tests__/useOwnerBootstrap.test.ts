import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

const callBootstrapMock = vi.fn()
vi.mock('@/data/supabase/bootstrap', async () => {
  const actual = await vi.importActual<typeof import('@/data/supabase/bootstrap')>('@/data/supabase/bootstrap')
  return { ...actual, callBootstrapOwnerIdentity: (...args: unknown[]) => callBootstrapMock(...args) }
})

// Builds a decodable (unsigned) fake JWT carrying a `session_id` claim, same
// shape decodeSessionIdClaim() expects — see device.store.test.ts for the
// same helper pattern.
const b64url = (obj: unknown) =>
  btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fakeAccessToken = (sessionId: string) =>
  `${b64url({ alg: 'HS256' })}.${b64url({ session_id: sessionId })}.sig`

const refreshSessionMock = vi.fn().mockResolvedValue({ data: {}, error: null })
const getSessionMock = vi.fn().mockResolvedValue({
  data: { session: { access_token: fakeAccessToken('session-xyz') } },
  error: null,
})
const rpcMock = vi.fn().mockResolvedValue({ data: null, error: null })
const devicesMaybeSingleMock = vi.fn().mockResolvedValue({ data: { code: 'A' }, error: null })
const devicesEqMock = vi.fn().mockReturnValue({ maybeSingle: devicesMaybeSingleMock })
const devicesSelectMock = vi.fn().mockReturnValue({ eq: devicesEqMock })
const fromMock = vi.fn().mockReturnValue({ select: devicesSelectMock })
vi.mock('@/data/supabase/client', () => ({
  supabase: {
    auth: {
      refreshSession: (...args: unknown[]) => refreshSessionMock(...args),
      // useDeviceStore wires up onAuthStateChange at store-creation time;
      // it's unrelated to what this file is testing, so a no-op subscription
      // stub is enough to let the store construct (see useOperatorSwitch.test.ts).
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      getSession: (...args: unknown[]) => getSessionMock(...args),
    },
    from: (...args: unknown[]) => fromMock(...args),
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}))

describe('useOwnerBootstrap', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    refreshSessionMock.mockResolvedValue({ data: {}, error: null })
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: fakeAccessToken('session-xyz') } },
      error: null,
    })
    rpcMock.mockResolvedValue({ data: null, error: null })
    devicesMaybeSingleMock.mockResolvedValue({ data: { code: 'A' }, error: null })
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

  // Found live (2026-07-29): ensureDeviceRegistered() (device.store.ts) races
  // in on SIGNED_IN with its OWN generated deviceId, tries a plain client-side
  // devices insert that fails RLS (not yet an owner), and — critically —
  // bootstrapOwner() never told the device store about the deviceId the RPC
  // actually succeeded with. Every later switch_active_operator call then
  // looked up a device that was never created server-side, and failed exactly
  // like a wrong PIN would. This asserts the fix: bootstrap must be the
  // authority on this device's identity once it succeeds, regardless of
  // whatever ensureDeviceRegistered() left behind first.
  it('bootstrapOwner: syncs deviceStore.deviceId/deviceCode to the RPC-confirmed device on success', async () => {
    callBootstrapMock.mockResolvedValue('success')
    const { db } = await import('@/data/powersync/db')
    vi.mocked(db.getOptional).mockResolvedValue({ id: 'staff-1' } as any)
    devicesMaybeSingleMock.mockResolvedValue({ data: { code: 'B' }, error: null })

    const { useDeviceStore } = await import('@/store/device.store')
    // Simulate the race: ensureDeviceRegistered() already left a different,
    // never-actually-created deviceId/deviceCode on this device.
    useDeviceStore().deviceId = 'race-loser-device-id'
    useDeviceStore().deviceCode = ''

    const { useOwnerBootstrap } = await import('@/features/staff/composables/useOwnerBootstrap')
    await useOwnerBootstrap().bootstrapOwner('Owner', '1234')

    const rpcDeviceId = callBootstrapMock.mock.calls[0][0].deviceId
    expect(rpcDeviceId).not.toBe('race-loser-device-id')
    expect(useDeviceStore().deviceId).toBe(rpcDeviceId)
    expect(useDeviceStore().deviceCode).toBe('B')
    expect(fromMock).toHaveBeenCalledWith('devices')
    expect(devicesSelectMock).toHaveBeenCalledWith('code')
    expect(devicesEqMock).toHaveBeenCalledWith('id', rpcDeviceId)
  })

  it('resumePendingBootstrap: also syncs deviceStore.deviceId/deviceCode to the persisted pending deviceId when the device row exists server-side', async () => {
    const { useBootstrapStore } = await import('@/features/staff/bootstrap.store')
    useBootstrapStore().start('device-from-pending', 'staff-1')
    callBootstrapMock.mockResolvedValue('already_bootstrapped')
    const { db } = await import('@/data/powersync/db')
    vi.mocked(db.getOptional).mockResolvedValue({ id: 'staff-1' } as any)
    devicesMaybeSingleMock.mockResolvedValue({ data: { code: 'C' }, error: null })

    const { useDeviceStore } = await import('@/store/device.store')
    useDeviceStore().deviceId = 'stale-id'

    const { useOwnerBootstrap } = await import('@/features/staff/composables/useOwnerBootstrap')
    await useOwnerBootstrap().resumePendingBootstrap()

    expect(useDeviceStore().deviceId).toBe('device-from-pending')
    expect(useDeviceStore().deviceCode).toBe('C')
    expect(devicesEqMock).toHaveBeenCalledWith('id', 'device-from-pending')
  })

  // Critical fix, found in final whole-branch review: the RPC returns
  // 'already_bootstrapped' BEFORE it inserts into public.devices (migration
  // 069), so a fresh deviceId minted client-side for this call may have NO
  // corresponding devices row server-side. Previously, deviceStore.deviceId
  // got clobbered with this never-created id regardless, so every subsequent
  // switch_active_operator lookup failed indistinguishably from a wrong PIN.
  it('resumePendingBootstrap: does NOT adopt the pending deviceId into deviceStore when no devices row exists server-side for it (already_bootstrapped path)', async () => {
    const { useBootstrapStore } = await import('@/features/staff/bootstrap.store')
    useBootstrapStore().start('device-from-pending', 'staff-1')
    callBootstrapMock.mockResolvedValue('already_bootstrapped')
    const { db } = await import('@/data/powersync/db')
    vi.mocked(db.getOptional).mockResolvedValue(undefined)
    // Simulates the real 'already_bootstrapped' scenario: the RPC returned
    // before this deviceId's devices row was ever inserted, so the lookup
    // finds nothing.
    devicesMaybeSingleMock.mockResolvedValue({ data: null, error: null })

    const { useDeviceStore } = await import('@/store/device.store')
    useDeviceStore().deviceId = 'stale-id'
    useDeviceStore().deviceCode = 'stale-code'

    const { useOwnerBootstrap } = await import('@/features/staff/composables/useOwnerBootstrap')
    const result = await useOwnerBootstrap().resumePendingBootstrap({ pollIntervalMs: 1, pollTimeoutMs: 5 })

    // deviceStore must be left untouched -- adopting the unconfirmed id would
    // be worse than staying stale, since it would break every future
    // switch_active_operator call.
    expect(useDeviceStore().deviceId).toBe('stale-id')
    expect(useDeviceStore().deviceCode).toBe('stale-code')
    expect(result).toEqual({ status: 'timeout' })
  })

  // Updated in final whole-branch review fix wave: a network failure on the
  // devices-table lookup means we could NOT confirm the device row exists
  // server-side, so deviceId must NOT be adopted (same reasoning as the
  // 'already_bootstrapped'-with-no-row case above) -- an unconfirmed id is
  // exactly as dangerous to adopt as a confirmed-absent one. Bootstrap still
  // reports 'done' since the local staff row did arrive.
  it('bootstrapOwner: a failure fetching the device code does not fail bootstrap, but also does not adopt the unconfirmed deviceId', async () => {
    callBootstrapMock.mockResolvedValue('success')
    const { db } = await import('@/data/powersync/db')
    vi.mocked(db.getOptional).mockResolvedValue({ id: 'staff-1' } as any)
    devicesMaybeSingleMock.mockRejectedValueOnce(new Error('offline'))

    const { useDeviceStore } = await import('@/store/device.store')
    useDeviceStore().deviceId = 'stale-id'
    const { useOwnerBootstrap } = await import('@/features/staff/composables/useOwnerBootstrap')
    const result = await useOwnerBootstrap().bootstrapOwner('Owner', '1234')

    expect(result).toEqual({ status: 'done' })
    expect(useDeviceStore().deviceId).toBe('stale-id')
  })

  // Found live (2026-07-29): the custom access-token hook resolves the JWT's
  // active_role claim by looking up device_sessions BY session_id, but
  // bootstrap_owner_identity's INSERT never sets session_id on the row it
  // creates. Every owner-gated write (devices, denomination_configs,
  // exchange_rates, audit_log) kept failing RLS long after a "successful"
  // bootstrap, with correct device identity and a correct PIN, because the
  // session token never actually carried active_role: 'owner'.
  it('bootstrapOwner: stamps this session_id onto the bootstrap-created device BEFORE refreshing the session', async () => {
    callBootstrapMock.mockResolvedValue('success')
    const { db } = await import('@/data/powersync/db')
    vi.mocked(db.getOptional).mockResolvedValue({ id: 'staff-1' } as any)

    const { useOwnerBootstrap } = await import('@/features/staff/composables/useOwnerBootstrap')
    await useOwnerBootstrap().bootstrapOwner('Owner', '1234')

    const rpcDeviceId = callBootstrapMock.mock.calls[0][0].deviceId
    expect(rpcMock).toHaveBeenCalledWith('record_device_session_id', {
      p_device_id: rpcDeviceId,
      p_session_id: 'session-xyz',
    })

    const stampOrder   = rpcMock.mock.invocationCallOrder[0]
    const refreshOrder = refreshSessionMock.mock.invocationCallOrder[0]
    expect(stampOrder).toBeLessThan(refreshOrder)
  })

  it('bootstrapOwner: a failure stamping session_id does not fail bootstrap — falls through to refreshSession as before', async () => {
    callBootstrapMock.mockResolvedValue('success')
    const { db } = await import('@/data/powersync/db')
    vi.mocked(db.getOptional).mockResolvedValue({ id: 'staff-1' } as any)
    rpcMock.mockRejectedValueOnce(new Error('offline'))

    const { useOwnerBootstrap } = await import('@/features/staff/composables/useOwnerBootstrap')
    const result = await useOwnerBootstrap().bootstrapOwner('Owner', '1234')

    expect(result).toEqual({ status: 'done' })
    expect(refreshSessionMock).toHaveBeenCalled()
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

  // Newly-live boot-time path: resumeBootstrapIfPending() now runs from
  // main.ts alongside db.ts's own module-level db.connect() and
  // device.store.ts's SIGNED_IN handler. Confirms resumePendingBootstrap()
  // doesn't throw/hang when db.connect() is already in-flight/racing/rejected
  // from a concurrent caller -- it should fall through to the normal
  // poll-and-timeout path, same as the existing bootstrapOwner reconnect-
  // failure test above.
  it('resumePendingBootstrap: a PowerSync reconnect failure (racing with a concurrent db.connect caller) does not throw — falls through to the normal poll/timeout path', async () => {
    const { useBootstrapStore } = await import('@/features/staff/bootstrap.store')
    useBootstrapStore().start('device-1', 'staff-1')
    callBootstrapMock.mockResolvedValue('success')
    const { db } = await import('@/data/powersync/db')
    vi.mocked(db.connect).mockRejectedValueOnce(new Error('already connecting'))
    vi.mocked(db.getOptional).mockResolvedValue({ id: 'staff-1' } as any)

    const { useOwnerBootstrap } = await import('@/features/staff/composables/useOwnerBootstrap')
    const result = await useOwnerBootstrap().resumePendingBootstrap()

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
