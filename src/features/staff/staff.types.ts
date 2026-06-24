export type StaffRole = 'owner' | 'cashier' | 'manager'

/** Plain-language Arabic label for a role — single source for every role badge. */
export function roleLabel(role: StaffRole): string {
  if (role === 'owner')   return 'مالك'
  if (role === 'manager') return 'مدير'
  return 'كاشير'
}

export interface StaffPermissions {
  can_view_reports:     boolean
  can_manage_products:  boolean
  can_manage_customers: boolean
  can_view_expenses:    boolean
  can_manage_settings:  boolean
}

export const DEFAULT_CASHIER_PERMISSIONS: StaffPermissions = {
  can_view_reports:     false,
  can_manage_products:  false,
  can_manage_customers: false,
  can_view_expenses:    false,
  can_manage_settings:  false,
}

export const OWNER_PERMISSIONS: StaffPermissions = {
  can_view_reports:     true,
  can_manage_products:  true,
  can_manage_customers: true,
  can_view_expenses:    true,
  can_manage_settings:  true,
}

// A manager runs the floor: products + customers, open/close shifts, ring sales.
// WAFI-058: financials (reports/expenses) are Owner-only by DEFAULT and become
// owner-grantable per staff member, so the two financial flags default OFF here.
// The structural flags below are fixed by role (see permissionsForRole), and
// can_manage_settings stays false so a manager can never grant access to anyone.
export const MANAGER_PERMISSIONS: StaffPermissions = {
  can_view_reports:     false,
  can_manage_products:  true,
  can_manage_customers: true,
  can_view_expenses:    false,
  can_manage_settings:  false,
}

/**
 * Effective permissions for a staff member. Single source of truth for both
 * reads (rowToStaff) and writes (createStaff/updateStaff), so the role default
 * and an owner-granted override can never drift apart.
 *
 * - Owner: every permission, not grantable away.
 * - Manager: structural flags fixed by role (products/customers true,
 *   settings false). The two FINANCIAL flags — can_view_reports and
 *   can_view_expenses — are read from the member's stored permissions and
 *   default to false (WAFI-058). Keeping can_manage_settings role-fixed at false
 *   is what guarantees only the owner can grant financial access.
 * - Cashier: carries its full stored per-staff custom set (unchanged).
 */
export function permissionsForRole(
  role: StaffRole,
  custom: Partial<StaffPermissions>,
): StaffPermissions {
  if (role === 'owner') return OWNER_PERMISSIONS
  if (role === 'manager') {
    return {
      can_manage_products:  true,
      can_manage_customers: true,
      can_manage_settings:  false,
      can_view_reports:     Boolean(custom?.can_view_reports),
      can_view_expenses:    Boolean(custom?.can_view_expenses),
    }
  }
  return { ...DEFAULT_CASHIER_PERMISSIONS, ...custom }
}

export interface Staff {
  id:          string
  shopId:      string
  name:        string
  pinHash:     string
  pinSalt:     string | null   // per-staff PIN salt; null = legacy unsalted hash
  role:        StaffRole
  permissions: StaffPermissions
  isActive:    boolean
  createdAt:   string
}

export interface NewStaff {
  name:        string
  pin:         string          // raw 4-digit string, hashed before DB write
  role:        StaffRole
  permissions: StaffPermissions
}
