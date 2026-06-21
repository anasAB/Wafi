import { describe, it, expect } from 'vitest'
import { isRouteAllowed } from '@/router/permissions'
import type { Staff } from '@/features/staff/staff.types'
import { OWNER_PERMISSIONS, DEFAULT_CASHIER_PERMISSIONS, MANAGER_PERMISSIONS } from '@/features/staff/staff.types'

function staff(role: Staff['role'], perms = DEFAULT_CASHIER_PERMISSIONS): Staff {
  return {
    id: 'x', shopId: 's', name: 'n', pinHash: 'h', pinSalt: null,
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

  it('denies a permission-gated route when no operator is logged in (fail closed)', () => {
    expect(isRouteAllowed('can_manage_settings', null)).toBe(false)
  })

  it('still allows a public (no-permission) route when no operator is logged in', () => {
    expect(isRouteAllowed(undefined, null)).toBe(true)
  })
})

describe('isRouteAllowed — manager role (WAFI-013)', () => {
  const manager = staff('manager', MANAGER_PERMISSIONS)

  it('allows a manager to manage products', () => {
    expect(isRouteAllowed('can_manage_products', manager)).toBe(true)
  })

  it('allows a manager to view reports', () => {
    expect(isRouteAllowed('can_view_reports', manager)).toBe(true)
  })

  it('blocks a manager from managing settings / staff', () => {
    expect(isRouteAllowed('can_manage_settings', manager)).toBe(false)
  })

  it('manager permission matrix grants everything except settings management', () => {
    expect(MANAGER_PERMISSIONS.can_manage_settings).toBe(false)
    expect(MANAGER_PERMISSIONS.can_view_reports).toBe(true)
    expect(MANAGER_PERMISSIONS.can_manage_products).toBe(true)
  })
})
