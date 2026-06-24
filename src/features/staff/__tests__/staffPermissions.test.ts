import { describe, it, expect } from 'vitest'
import {
  permissionsForRole,
  OWNER_PERMISSIONS,
  MANAGER_PERMISSIONS,
  DEFAULT_CASHIER_PERMISSIONS,
} from '../staff.types'

describe('permissionsForRole (WAFI-058 owner-only financials)', () => {
  it('owner always holds every permission, ignoring stored custom', () => {
    // Even a stored object that tried to strip a flag cannot demote the owner.
    expect(permissionsForRole('owner', { ...OWNER_PERMISSIONS, can_view_reports: false }))
      .toEqual(OWNER_PERMISSIONS)
  })

  it('a default manager (no stored grants) sees NO financials', () => {
    const perms = permissionsForRole('manager', {})
    expect(perms.can_view_reports).toBe(false)
    expect(perms.can_view_expenses).toBe(false)
    // Structural manager flags are fixed by role.
    expect(perms.can_manage_products).toBe(true)
    expect(perms.can_manage_customers).toBe(true)
    expect(perms.can_manage_settings).toBe(false)
  })

  it('MANAGER_PERMISSIONS is the default-off manager baseline', () => {
    expect(MANAGER_PERMISSIONS.can_view_reports).toBe(false)
    expect(MANAGER_PERMISSIONS.can_view_expenses).toBe(false)
    expect(MANAGER_PERMISSIONS.can_manage_products).toBe(true)
    expect(MANAGER_PERMISSIONS.can_manage_customers).toBe(true)
    expect(MANAGER_PERMISSIONS.can_manage_settings).toBe(false)
  })

  it('an owner-granted manager reads the two financial flags from stored permissions', () => {
    const perms = permissionsForRole('manager', {
      ...DEFAULT_CASHIER_PERMISSIONS,
      can_view_reports: true,
      can_view_expenses: true,
    })
    expect(perms.can_view_reports).toBe(true)
    expect(perms.can_view_expenses).toBe(true)
  })

  it('a manager can be granted ONE financial flag independently', () => {
    const perms = permissionsForRole('manager', { can_view_reports: true })
    expect(perms.can_view_reports).toBe(true)
    expect(perms.can_view_expenses).toBe(false)
  })

  it('a manager can NEVER gain can_manage_settings via stored permissions', () => {
    // Guarantees only the owner can grant — a manager cannot self-escalate even
    // if a stored row carries a stale can_manage_settings: true.
    const perms = permissionsForRole('manager', { can_manage_settings: true } as never)
    expect(perms.can_manage_settings).toBe(false)
  })

  it('a cashier carries its full stored custom permission set', () => {
    const custom = { ...DEFAULT_CASHIER_PERMISSIONS, can_view_expenses: true }
    expect(permissionsForRole('cashier', custom)).toEqual(custom)
  })
})
