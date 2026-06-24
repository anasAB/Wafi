import { describe, it, expect } from 'vitest'
import { canResetPin } from '../permissions'
import type { Staff, StaffRole } from '@/features/staff/staff.types'
import { OWNER_PERMISSIONS, MANAGER_PERMISSIONS, DEFAULT_CASHIER_PERMISSIONS } from '@/features/staff/staff.types'

function staff(role: StaffRole, id = role): Staff {
  return {
    id,
    shopId: 'shop-1',
    name: id,
    pinHash: 'x',
    pinSalt: null,
    role,
    permissions:
      role === 'owner' ? OWNER_PERMISSIONS : role === 'manager' ? MANAGER_PERMISSIONS : DEFAULT_CASHIER_PERMISSIONS,
    isActive: true,
    createdAt: '2026-06-24T00:00:00.000Z',
  }
}

describe('canResetPin (WAFI-056 role rule)', () => {
  it('owner may reset any role', () => {
    expect(canResetPin(staff('owner'), staff('cashier'))).toBe(true)
    expect(canResetPin(staff('owner'), staff('manager'))).toBe(true)
    expect(canResetPin(staff('owner', 'o2'), staff('owner', 'o1'))).toBe(true)
  })

  it('manager may reset a cashier', () => {
    expect(canResetPin(staff('manager'), staff('cashier'))).toBe(true)
  })

  it('manager may NOT reset another manager or the owner', () => {
    expect(canResetPin(staff('manager', 'm2'), staff('manager', 'm1'))).toBe(false)
    expect(canResetPin(staff('manager'), staff('owner'))).toBe(false)
  })

  it('cashier may never reset anyone', () => {
    expect(canResetPin(staff('cashier'), staff('cashier', 'c2'))).toBe(false)
    expect(canResetPin(staff('cashier'), staff('manager'))).toBe(false)
    expect(canResetPin(staff('cashier'), staff('owner'))).toBe(false)
  })

  it('nobody can authorise their own reset (a forgotten PIN cannot self-authenticate)', () => {
    expect(canResetPin(staff('owner', 'same'), staff('owner', 'same'))).toBe(false)
    expect(canResetPin(staff('manager', 'same'), staff('manager', 'same'))).toBe(false)
  })

  it('returns false when either party is missing', () => {
    expect(canResetPin(null, staff('cashier'))).toBe(false)
    expect(canResetPin(staff('owner'), null)).toBe(false)
  })
})
