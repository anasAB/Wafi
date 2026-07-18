import { useSessionStore } from '@/store/session.store'
import { canUserDo } from '@/router/permissions'

/**
 * Every mutating function in the staff-ledger feature calls this instead of
 * writing + auditing separately, so a write can never ship without exactly
 * one audit entry (WAFI-138 Invariant 9), and permission is re-checked here
 * as defense in depth even though the route is already gated (WAFI-058
 * pattern: never trust the router alone).
 */
export async function executeFinancialWrite<T>(
  write: () => Promise<T>,
  audit: (result: T) => Promise<void>,
): Promise<T> {
  const session = useSessionStore()
  if (!canUserDo(session.activeStaff, 'can_view_expenses')) {
    throw new Error('permission denied: can_view_expenses required')
  }
  const result = await write()
  await audit(result)
  return result
}
