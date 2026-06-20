import type { Staff, StaffPermissions } from '@/features/staff/staff.types'

/**
 * Whether the active staff may enter a route requiring `required` permission.
 * - No required permission → always allowed.
 * - No active staff (not yet PIN-logged-in) → allowed; app-level login gating
 *   handles that case, and we must not lock the app out before a shift opens.
 * - Owner → allowed (owners hold every permission).
 * - Otherwise → only if the staff's permission flag is set.
 */
export function isRouteAllowed(
  required: keyof StaffPermissions | undefined,
  staff: Staff | null,
): boolean {
  if (!required) return true
  if (!staff || staff.role === 'owner') return true
  return Boolean(staff.permissions?.[required])
}
