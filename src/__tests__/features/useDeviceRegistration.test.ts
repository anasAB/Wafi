import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { useDeviceRegistration } from '@/features/devices/composables/useDeviceRegistration'

describe('useDeviceRegistration', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('registers a permanent code when the allocator succeeds', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({ code: 'B' } as any)

    const { registerDevice } = useDeviceRegistration()
    const result = await registerDevice('shop1')

    expect(result).toEqual({ code: 'B', isTemporary: false })
    const insertCall = vi.mocked(db.execute).mock.calls.find(([sql]) => /INSERT INTO devices/.test(sql))
    expect(insertCall![1]).toEqual(expect.arrayContaining(['shop1', 'B', 0]))
  })

  it('falls back to a temporary code when the allocator is unreachable (offline)', async () => {
    vi.mocked(db.getOptional).mockRejectedValueOnce(new Error('offline'))

    const { registerDevice } = useDeviceRegistration()
    const result = await registerDevice('shop1')

    expect(result.isTemporary).toBe(true)
    expect(result.code).toMatch(/^T-/)
    const insertCall = vi.mocked(db.execute).mock.calls.find(([sql]) => /INSERT INTO devices/.test(sql))
    expect(insertCall![1]).toEqual(expect.arrayContaining(['shop1', result.code, 1]))
  })
})
