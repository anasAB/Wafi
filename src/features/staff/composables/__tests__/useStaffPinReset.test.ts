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
import { usePinLockout, MAX_PIN_ATTEMPTS } from '../usePinLockout'
import { db } from '@/data/powersync/db'
import type { Staff, StaffRole } from '../../staff.types'
import { OWNER_PERMISSIONS, MANAGER_PERMISSIONS, DEFAULT_CASHIER_PERMISSIONS } from '../../staff.types'

function staff(role: StaffRole, id = role): Staff {
  return {
    id,
    shopId: 'shop-1',
    name: id,
    pinHash: 'x',
    pinSalt: 'salt',
    role,
    permissions:
      role === 'owner' ? OWNER_PERMISSIONS : role === 'manager' ? MANAGER_PERMISSIONS : DEFAULT_CASHIER_PERMISSIONS,
    isActive: true,
    createdAt: '2026-06-24T00:00:00.000Z',
  }
}

function auditCall() {
  return vi.mocked(db.execute).mock.calls.find(
    c => typeof c[0] === 'string' && c[0].includes('INSERT INTO audit_log'),
  )
}

describe('useStaff.resetStaffPin (WAFI-056)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
    vi.mocked(db.getOptional).mockResolvedValue({ name: 'cashier' } as any)
  })

  it('(a) manager→cashier reset succeeds, sets a new hash, and clears the lockout', async () => {
    const lockout = usePinLockout()
    const target = staff('cashier')
    // Lock the target out first.
    for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) lockout.recordFailure(target.id)
    expect(lockout.isLockedOut(target.id)).toBe(true)

    const { resetStaffPin } = useStaff()
    await resetStaffPin(staff('manager'), target, '4321')

    // PIN hash rewritten…
    const updateCall = vi.mocked(db.execute).mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('UPDATE staff SET pin_hash'),
    )
    expect(updateCall).toBeTruthy()
    // …and the lockout cleared so the new PIN works immediately.
    expect(lockout.isLockedOut(target.id)).toBe(false)
  })

  it('(b) manager→manager and manager→owner resets are rejected and write nothing', async () => {
    const { resetStaffPin } = useStaff()
    await expect(resetStaffPin(staff('manager', 'm2'), staff('manager', 'm1'), '4321')).rejects.toThrow()
    await expect(resetStaffPin(staff('manager'), staff('owner'), '4321')).rejects.toThrow()

    const wroteHash = vi.mocked(db.execute).mock.calls.some(
      c => typeof c[0] === 'string' && c[0].includes('UPDATE staff SET pin_hash'),
    )
    expect(wroteHash).toBe(false)
  })

  it('(d) audit row carries both the actor and the target', async () => {
    const { resetStaffPin } = useStaff()
    const actor = staff('manager')
    const target = staff('cashier')
    await resetStaffPin(actor, target, '4321')

    const call = auditCall()
    expect(call).toBeTruthy()
    // entity_id (4th param) is the target; meta (8th param) carries the actor.
    expect(call![1]).toEqual(expect.arrayContaining(['staff.pin_changed', 'staff', target.id]))
    const meta = JSON.parse(call![1]![7] as string)
    expect(meta.actor_id).toBe(actor.id)
    expect(meta.actor_name).toBe(actor.name)
  })
})

describe('useStaff.updateStaffPin also clears the lockout (WAFI-056 gap #2)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
    vi.mocked(db.getOptional).mockResolvedValue({ name: 'cashier' } as any)
  })

  it('a fresh PIN clears a standing lockout for that staff member', async () => {
    const lockout = usePinLockout()
    for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) lockout.recordFailure('staff-2')
    expect(lockout.isLockedOut('staff-2')).toBe(true)

    const { updateStaffPin } = useStaff()
    await updateStaffPin('staff-2', '4321')

    expect(lockout.isLockedOut('staff-2')).toBe(false)
  })
})
