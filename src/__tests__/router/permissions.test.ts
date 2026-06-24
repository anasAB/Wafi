import { describe, it, expect } from 'vitest'
import { isRouteAllowed, resolveLanding } from '@/router/permissions'
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

// WAFI-058 supersedes the "manager always sees reports" half of WAFI-013:
// financials are Owner-only by default and owner-grantable per manager.
describe('isRouteAllowed — manager role (WAFI-058 default-off financials)', () => {
  const defaultManager = staff('manager', MANAGER_PERMISSIONS)

  it('allows a manager to manage products (structural, role-fixed)', () => {
    expect(isRouteAllowed('can_manage_products', defaultManager)).toBe(true)
  })

  it('DENIES a default manager from viewing reports', () => {
    expect(isRouteAllowed('can_view_reports', defaultManager)).toBe(false)
  })

  it('DENIES a default manager from viewing expenses', () => {
    expect(isRouteAllowed('can_view_expenses', defaultManager)).toBe(false)
  })

  it('blocks a manager from managing settings / staff', () => {
    expect(isRouteAllowed('can_manage_settings', defaultManager)).toBe(false)
  })

  it('allows an owner-granted manager to view the granted financial surface', () => {
    const granted = staff('manager', { ...MANAGER_PERMISSIONS, can_view_reports: true })
    expect(isRouteAllowed('can_view_reports', granted)).toBe(true)
    // A grant of reports does NOT leak expenses access.
    expect(isRouteAllowed('can_view_expenses', granted)).toBe(false)
  })

  it('default manager matrix is financials-off, structural-on', () => {
    expect(MANAGER_PERMISSIONS.can_manage_settings).toBe(false)
    expect(MANAGER_PERMISSIONS.can_view_reports).toBe(false)
    expect(MANAGER_PERMISSIONS.can_view_expenses).toBe(false)
    expect(MANAGER_PERMISSIONS.can_manage_products).toBe(true)
    expect(MANAGER_PERMISSIONS.can_manage_customers).toBe(true)
  })
})

// WAFI-058: where a staff member lands after unlocking. The dashboard is a
// financial roll-up (can_view_reports); staff without it land on the POS so they
// never momentarily render the dashboard then get bounced.
describe('resolveLanding (WAFI-058 default landing)', () => {
  it('sends the owner to the dashboard', () => {
    expect(resolveLanding(staff('owner', OWNER_PERMISSIONS))).toBe('/')
  })

  it('sends a reports-granted manager to the dashboard', () => {
    expect(resolveLanding(staff('manager', { ...MANAGER_PERMISSIONS, can_view_reports: true }))).toBe('/')
  })

  it('sends a default (ungranted) manager to the POS', () => {
    expect(resolveLanding(staff('manager', MANAGER_PERMISSIONS))).toBe('/pos')
  })

  it('sends a cashier to the POS', () => {
    expect(resolveLanding(staff('cashier'))).toBe('/pos')
  })

  it('sends nobody (no active operator) to the POS, never the dashboard', () => {
    expect(resolveLanding(null)).toBe('/pos')
  })
})
