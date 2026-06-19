import { describe, it, expect } from 'vitest'
import { isRouteAllowed } from '@/router/permissions'
import type { Staff } from '@/features/staff/staff.types'
import { OWNER_PERMISSIONS, DEFAULT_CASHIER_PERMISSIONS } from '@/features/staff/staff.types'

function staff(role: Staff['role'], perms = DEFAULT_CASHIER_PERMISSIONS): Staff {
  return {
    id: 'x', shopId: 's', name: 'n', pinHash: 'h',
    role, permissions: perms, isActive: true, createdAt: '2026-01-01',
  }
}

describe('isRouteAllowed', () => {
  it('allows any route with no required permission', () => {
    expect(isRouteAllowed(undefined, staff('cashier'))).toBe(true)
  })

  it('allows the owner everywhere', () => {
    expect(isRouteAllowed('can_manage_settings', staff('owner', OWNER_PERMISSIONS))).toBe(true)
  })

  it('blocks a cashier lacking the permission', () => {
    expect(isRouteAllowed('can_manage_settings', staff('cashier'))).toBe(false)
  })

  it('allows a cashier holding the permission', () => {
    expect(isRouteAllowed('can_manage_settings', staff('cashier', { ...DEFAULT_CASHIER_PERMISSIONS, can_manage_settings: true }))).toBe(true)
  })

  it('allows when no staff is logged in (app-level gating handles it)', () => {
    expect(isRouteAllowed('can_manage_settings', null)).toBe(true)
  })
})
