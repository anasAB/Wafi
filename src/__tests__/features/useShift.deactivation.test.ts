import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

vi.mock('@/data/supabase/client', () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    auth: {
      refreshSession: vi.fn().mockResolvedValue({ data: {}, error: null }),
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'h.eyJzZXNzaW9uX2lkIjoic2Vzc2lvbi14In0.s' } },
        error: null,
      }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}))

import { useShift } from '@/features/shifts/composables/useShift'
import { db } from '@/data/powersync/db'
import type { Staff } from '@/features/staff/staff.types'

const staff = { id: 'st-1', name: 'خالد', role: 'cashier' } as Staff

// WAFI-130: a deactivated device may not open NEW shifts (write-layer guard,
// not just UI). Resume of an existing open shift stays allowed (checked before
// the device flag) so an in-flight shift can close cleanly.
describe('useShift.openShift — WAFI-130 deactivation enforcement', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([])
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
  })

  it('blocks a NEW shift on a deactivated device', async () => {
    vi.mocked(db.getOptional).mockImplementation(async (sql: string) => {
      if (/FROM devices/.test(sql)) return { is_active: 0 } as any
      return null // no existing open shift
    })

    const { openShift } = useShift()
    const result = await openShift(staff, 10, 100000, '1234')

    expect(result.status).toBe('device-deactivated')
    const insert = vi.mocked(db.execute).mock.calls.find(([sql]) => /INSERT INTO cashier_shifts/.test(sql as string))
    expect(insert).toBeUndefined() // no shift row written
  })

  it('missing device row / null flag = active (legacy, offline first-run) — shift opens', async () => {
    vi.mocked(db.getOptional).mockImplementation(async (sql: string) => {
      if (/FROM devices/.test(sql)) return null
      return null
    })

    const { openShift } = useShift()
    const result = await openShift(staff, 10, 100000, '1234')

    expect(result.status).toBe('opened')
    const insert = vi.mocked(db.execute).mock.calls.find(([sql]) => /INSERT INTO cashier_shifts/.test(sql as string))
    expect(insert).toBeDefined()
  })
})
