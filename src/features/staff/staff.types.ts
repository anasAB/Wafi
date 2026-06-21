export type StaffRole = 'owner' | 'cashier'

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
