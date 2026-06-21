import type { Staff, StaffPermissions } from '@/features/staff/staff.types'

/**
 * Whether the active staff may enter a route requiring `required` permission.
 * - No required permission → always allowed (public route).
 * - No active operator on a permission-gated route → denied (fail closed). The
 *   active operator is the single source of truth (WAFI-011); a gated route must
 *   never open for nobody.
 * - Owner → allowed (owners hold every permission).
 * - Otherwise (cashier/manager) → only if the staff's permission flag is set.
 */
export function isRouteAllowed(
  required: keyof StaffPermissions | undefined,
  staff: Staff | null,
): boolean {
  if (!required) return true
  if (!staff) return false
  if (staff.role === 'owner') return true
  return Boolean(staff.permissions?.[required])
}
