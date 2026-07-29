import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

const rpcMock = vi.fn()
vi.mock('@/data/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}))

import { db } from '@/data/powersync/db'
import { useDeviceRegistration } from '@/features/devices/composables/useDeviceRegistration'

describe('useDeviceRegistration', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('registers a permanent code via the register_device RPC without a local INSERT', async () => {
    rpcMock.mockResolvedValueOnce({ data: 'B', error: null })

    const { registerDevice } = useDeviceRegistration()
    const result = await registerDevice('shop1')

    expect(rpcMock).toHaveBeenCalledWith('register_device', { p_device_id: result.id })
    expect(result).toEqual({ id: result.id, code: 'B', isTemporary: false })
    // register_device is SECURITY DEFINER and creates the row directly
    // server-side — a client-side INSERT here would be redundant and, since
    // devices INSERT is owner-only RLS, can fail for a non-owner session
    // (the exact bug this RPC exists to avoid).
    const insertCall = vi.mocked(db.execute).mock.calls.find(([sql]) => /INSERT INTO devices/.test(sql))
    expect(insertCall).toBeUndefined()
  })

  it('falls back to a temporary code when the RPC is unreachable (offline)', async () => {
    rpcMock.mockRejectedValueOnce(new Error('offline'))

    const { registerDevice } = useDeviceRegistration()
    const result = await registerDevice('shop1')

    expect(result.isTemporary).toBe(true)
    expect(result.code).toMatch(/^T-/)
    const insertCall = vi.mocked(db.execute).mock.calls.find(([sql]) => /INSERT INTO devices/.test(sql))
    expect(insertCall![1]).toEqual(expect.arrayContaining([result.id, 'shop1', result.code, 1]))
  })

  it('falls back to a temporary code when the RPC returns an error', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })

    const { registerDevice } = useDeviceRegistration()
    const result = await registerDevice('shop1')

    expect(result.isTemporary).toBe(true)
    expect(result.code).toMatch(/^T-/)
  })

  it('falls back to a temporary code when the RPC returns null (auth_shop_id unresolved server-side)', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null })

    const { registerDevice } = useDeviceRegistration()
    const result = await registerDevice('shop1')

    expect(result.isTemporary).toBe(true)
    expect(result.code).toMatch(/^T-/)
  })

  it('returns the same id it registered, for the caller to adopt', async () => {
    rpcMock.mockResolvedValueOnce({ data: 'B', error: null })

    const { registerDevice } = useDeviceRegistration()
    const result = await registerDevice('shop1')

    expect(rpcMock).toHaveBeenCalledWith('register_device', { p_device_id: result.id })
    expect(result.id).toBeTruthy()
  })
})
