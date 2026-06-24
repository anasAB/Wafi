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

/**
 * Whether `actor` may reset `target`'s PIN (WAFI-056). Single source of truth
 * for both the recovery UI and the `resetStaffPin` action (defence in depth).
 *
 * Rule: allowed iff actor is the owner, OR actor is a manager resetting a
 * cashier. A manager may never reset another manager's or the owner's PIN.
 * Expressed as a role rule — deliberately NOT a new permission flag — so it
 * does not widen `can_manage_settings`.
 *
 * Nobody may authorise their own reset: a forgotten PIN cannot self-authenticate,
 * so the actor and target must be different people. (An owner who forgot their
 * own PIN recovers via the account-password path, not this rule.)
 */
export function canResetPin(actor: Staff | null, target: Staff | null): boolean {
  if (!actor || !target) return false
  if (actor.id === target.id) return false
  if (actor.role === 'owner') return true
  return actor.role === 'manager' && target.role === 'cashier'
}
