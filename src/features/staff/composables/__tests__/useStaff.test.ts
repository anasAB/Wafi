import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/data/supabase/client', () => ({
  supabase: {
    from: () => ({}),
    auth: {
      onAuthStateChange: vi.fn(),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
  },
}))

import { useStaff } from '../useStaff'
import { db } from '@/data/powersync/db'

describe('useStaff.updateStaffPin (WAFI-014)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
    vi.mocked(db.getOptional).mockResolvedValue({ name: 'أحمد' } as any)
  })

  it('writes a staff.pin_changed audit row when a PIN is changed', async () => {
    const { updateStaffPin } = useStaff()
    await updateStaffPin('staff-2', '4321')

    const auditCall = vi.mocked(db.execute).mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('INSERT INTO audit_log'),
    )
    expect(auditCall).toBeTruthy()
    expect(auditCall![1]).toEqual(expect.arrayContaining(['staff.pin_changed', 'staff', 'staff-2']))
  })

  it('still updates the pin_hash for the staff member', async () => {
    const { updateStaffPin } = useStaff()
    await updateStaffPin('staff-2', '4321')

    const updateCall = vi.mocked(db.execute).mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('UPDATE staff SET pin_hash'),
    )
    expect(updateCall).toBeTruthy()
  })
})
