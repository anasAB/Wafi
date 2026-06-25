import { computed, type ComputedRef } from 'vue'
import { useSessionStore } from '@/store/session.store'
import { canUserDo } from '@/router/permissions'
import type { StaffPermissions } from '@/features/staff/staff.types'

/**
 * Component-facing permission accessor (WAFI-063). Wraps `canUserDo` against the
 * active operator (session store — the single active-operator source, WAFI-011) so
 * no component reads `session.activeStaff.permissions.<flag>` inline. Reactive: it
 * re-scopes automatically when the operator switches.
 *
 * Usage: `const { can } = useCan(); const canViewMoney = can('can_view_reports')`.
 */
export function useCan() {
  const session = useSessionStore()

  function can(action: keyof StaffPermissions): ComputedRef<boolean> {
    return computed(() => canUserDo(session.activeStaff, action))
  }

  return { can }
}
