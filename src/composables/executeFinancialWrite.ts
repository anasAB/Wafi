import { useSessionStore } from '@/store/session.store'
import { canUserDo } from '@/router/permissions'
import type { StaffPermissions } from '@/features/staff/staff.types'

/**
 * Every financial-write composable calls this instead of writing + auditing
 * separately, so a write can never ship without exactly one audit-log call
 * (originally WAFI-138 Invariant 9 for staff-ledger only; generalized in
 * WAFI-007 to every financial-write composable). This guarantees the audit
 * CALL happens after a successful write -- it does not change useAuditLog's
 * own best-effort failure semantics (a failed audit write inside `audit()`
 * is useAuditLog's `_log`/`_logSensitive` distinction to handle, not this
 * wrapper's).
 *
 * `requiredPermission` is optional: pass it when this call site needs its
 * own defense-in-depth permission re-check (WAFI-058 pattern: never trust
 * the router alone); omit it when the caller is already gated elsewhere and
 * doesn't have an equivalent single-permission requirement to duplicate.
 */
export async function executeFinancialWrite<T>(
  write: () => Promise<T>,
  audit: (result: T) => Promise<void>,
  requiredPermission?: keyof StaffPermissions,
): Promise<T> {
  if (requiredPermission) {
    const session = useSessionStore()
    if (!canUserDo(session.activeStaff, requiredPermission)) {
      throw new Error(`permission denied: ${requiredPermission} required`)
    }
  }
  const result = await write()
  await audit(result)
  return result
}
