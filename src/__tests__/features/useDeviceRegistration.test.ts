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

  it('registers a permanent code when the allocator succeeds', async () => {
    rpcMock.mockResolvedValueOnce({ data: 'B', error: null })

    const { registerDevice } = useDeviceRegistration()
    const result = await registerDevice('shop1')

    expect(rpcMock).toHaveBeenCalledWith('allocate_device_code', { p_shop_id: 'shop1' })
    expect(result).toEqual({ code: 'B', isTemporary: false })
    const insertCall = vi.mocked(db.execute).mock.calls.find(([sql]) => /INSERT INTO devices/.test(sql))
    expect(insertCall![1]).toEqual(expect.arrayContaining(['shop1', 'B', 0]))
  })

  it('falls back to a temporary code when the allocator is unreachable (offline)', async () => {
    rpcMock.mockRejectedValueOnce(new Error('offline'))

    const { registerDevice } = useDeviceRegistration()
    const result = await registerDevice('shop1')

    expect(result.isTemporary).toBe(true)
    expect(result.code).toMatch(/^T-/)
    const insertCall = vi.mocked(db.execute).mock.calls.find(([sql]) => /INSERT INTO devices/.test(sql))
    expect(insertCall![1]).toEqual(expect.arrayContaining(['shop1', result.code, 1]))
  })

  it('propagates an error when the permanent-code INSERT fails after a successful allocation, without falling back to a temp code', async () => {
    rpcMock.mockResolvedValueOnce({ data: 'B', error: null })
    vi.mocked(db.execute).mockRejectedValueOnce(new Error('insert failed'))

    const { registerDevice } = useDeviceRegistration()

    await expect(registerDevice('shop1')).rejects.toThrow('insert failed')
    // Only the one (failed) INSERT attempt — no second temp-code fallback insert.
    const insertCalls = vi.mocked(db.execute).mock.calls.filter(([sql]) => /INSERT INTO devices/.test(sql))
    expect(insertCalls).toHaveLength(1)
  })
})
