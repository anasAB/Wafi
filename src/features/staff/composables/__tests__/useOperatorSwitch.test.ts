import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// Audit log writes to PowerSync; stub the db so switchTo is testable in isolation.
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

// A minimal unsigned JWT carrying a `session_id` claim in its payload segment,
// matching what a real Supabase access token looks like (header.payload.sig).
// We only need the payload to decode; header/signature content is irrelevant.
function fakeAccessToken(sessionId: string | null): string {
  const payload = sessionId === null ? {} : { session_id: sessionId }
  const b64url = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64url({ alg: 'HS256' })}.${b64url(payload)}.sig`
}

const rpcMock = vi.fn().mockResolvedValue({ data: true, error: null })
const refreshSessionMock = vi.fn().mockResolvedValue({ data: {}, error: null })
const getSessionMock = vi.fn().mockResolvedValue({
  data: { session: { access_token: fakeAccessToken('session-abc') } },
  error: null,
})

vi.mock('@/data/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    auth: {
      refreshSession: (...args: unknown[]) => refreshSessionMock(...args),
      getSession: (...args: unknown[]) => getSessionMock(...args),
      // useDeviceStore wires up onAuthStateChange at store-creation time;
      // it's unrelated to what this file is testing, so a no-op subscription
      // stub is enough to let the store construct.
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}))

describe('useOperatorSwitch', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    rpcMock.mockResolvedValue({ data: true, error: null })
    refreshSessionMock.mockResolvedValue({ data: {}, error: null })
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: fakeAccessToken('session-abc') } },
      error: null,
    })
  })

  it('sets the new active operator and does NOT touch the shift', async () => {
    const { useSessionStore }   = await import('@/store/session.store')
    const { useShiftStore }     = await import('@/features/shifts/shift.store')
    const { useOperatorSwitch } = await import('@/features/staff/composables/useOperatorSwitch')

    const shift    = useShiftStore()
    const closeSpy = vi.spyOn(shift, 'closeShift')
    const openSpy  = vi.spyOn(shift, 'openShift')
    const owner    = { id: 'o1', name: 'Owner', role: 'owner', permissions: {} } as any

    await useOperatorSwitch().switchTo(owner, '1234')

    expect(useSessionStore().activeStaff?.id).toBe('o1')
    expect(closeSpy).not.toHaveBeenCalled()
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('writes an operator.switched audit row naming the previous and new operator', async () => {
    const { useSessionStore }   = await import('@/store/session.store')
    const { useOperatorSwitch } = await import('@/features/staff/composables/useOperatorSwitch')
    const { db }                = await import('@/data/powersync/db')

    const session = useSessionStore()
    session.setActiveStaff({ id: 's1', name: 'سامي', role: 'cashier', permissions: {} } as any)

    await useOperatorSwitch().switchTo({ id: 's2', name: 'أحمد', role: 'owner', permissions: {} } as any, '1234')

    const insertCall = vi.mocked(db.execute).mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('INSERT INTO audit_log'),
    )
    expect(insertCall).toBeTruthy()
    expect(insertCall![1]).toEqual(expect.arrayContaining(['operator.switched', 'staff', 's2']))
    const meta = JSON.parse(
      (insertCall![1] as unknown[]).find(
        v => typeof v === 'string' && v.includes('to_staff_id'),
      ) as string,
    )
    expect(meta).toMatchObject({ from_staff_id: 's1', from_name: 'سامي', to_staff_id: 's2', to_name: 'أحمد' })
  })

  describe('switch_active_operator RPC + forced session refresh (WAFI-122)', () => {
    const cashier = { id: 'staff-1', name: 'Ahmed', role: 'cashier', permissions: {} } as any

    it('calls switch_active_operator with device_id/session_id/staff_id/pin, then refreshSession, then sets the active staff', async () => {
      const { useSessionStore }   = await import('@/store/session.store')
      const { useDeviceStore }    = await import('@/store/device.store')
      const { useOperatorSwitch } = await import('@/features/staff/composables/useOperatorSwitch')

      useDeviceStore().deviceId = 'device-1'

      const { switchTo } = useOperatorSwitch()
      await switchTo(cashier, '1234')

      expect(getSessionMock).toHaveBeenCalledOnce()
      expect(rpcMock).toHaveBeenCalledWith('switch_active_operator', {
        p_device_id: 'device-1',
        p_session_id: 'session-abc',
        p_staff_id: 'staff-1',
        p_pin: '1234',
      })
      expect(refreshSessionMock).toHaveBeenCalledOnce()
      expect(useSessionStore().activeStaff?.id).toBe('staff-1')
    })

    it('does not set the active staff or refresh the session if the RPC returns false (server-side PIN mismatch)', async () => {
      rpcMock.mockResolvedValueOnce({ data: false, error: null })
      const { useSessionStore }   = await import('@/store/session.store')
      const { useOperatorSwitch } = await import('@/features/staff/composables/useOperatorSwitch')

      const { switchTo } = useOperatorSwitch()
      await expect(switchTo(cashier, '9999')).rejects.toThrow(/pin/i)

      expect(refreshSessionMock).not.toHaveBeenCalled()
      expect(useSessionStore().activeStaff).toBeNull()
    })

    it('does not block the switch on offline RPC failure — proceeds with client-side state only', async () => {
      rpcMock.mockRejectedValueOnce(new Error('network error'))
      const { useSessionStore }   = await import('@/store/session.store')
      const { useOperatorSwitch } = await import('@/features/staff/composables/useOperatorSwitch')

      const { switchTo } = useOperatorSwitch()
      await switchTo(cashier, '1234')

      expect(useSessionStore().activeStaff?.id).toBe('staff-1')
      expect(refreshSessionMock).not.toHaveBeenCalled()
    })

    it('does not call the RPC (and does not refresh the session) when session_id decode fails, but still sets the active staff locally', async () => {
      getSessionMock.mockResolvedValueOnce({
        data: { session: { access_token: fakeAccessToken(null) } },
        error: null,
      })
      const { useSessionStore }   = await import('@/store/session.store')
      const { useOperatorSwitch } = await import('@/features/staff/composables/useOperatorSwitch')

      const { switchTo } = useOperatorSwitch()
      await switchTo(cashier, '1234')

      expect(rpcMock).not.toHaveBeenCalled()
      expect(refreshSessionMock).not.toHaveBeenCalled()
      expect(useSessionStore().activeStaff?.id).toBe('staff-1')
    })

    it('does not block the switch when supabase.rpc resolves an error object instead of throwing', async () => {
      rpcMock.mockResolvedValueOnce({ data: null, error: new Error('offline') })
      const { useSessionStore }   = await import('@/store/session.store')
      const { useOperatorSwitch } = await import('@/features/staff/composables/useOperatorSwitch')

      const { switchTo } = useOperatorSwitch()
      await switchTo(cashier, '1234')

      expect(useSessionStore().activeStaff?.id).toBe('staff-1')
      expect(refreshSessionMock).not.toHaveBeenCalled()
    })
  })
})
