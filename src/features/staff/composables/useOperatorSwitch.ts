import { useSessionStore } from '@/store/session.store'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'
import type { Staff } from '@/features/staff/staff.types'

/**
 * Switch the active operator without touching the cash shift.
 *
 * Switching is identity-only: it re-points the single active-operator source
 * (`sessionStore`, WAFI-011) so route guards and nav re-scope immediately, and
 * records an `operator.switched` audit row. It deliberately never opens or
 * closes a shift — the drawer is counted once per working session, not per
 * operator (see switch-operator design, decision 1).
 */
export function useOperatorSwitch() {
  const session = useSessionStore()
  const { logOperatorSwitched } = useAuditLog()

  async function switchTo(staff: Staff): Promise<void> {
    const from = session.activeStaff
    if (from?.id === staff.id) return // no-op: same operator, nothing to record

    session.setActiveStaff(staff) // shift state is intentionally untouched
    await logOperatorSwitched(from?.id ?? null, from?.name ?? null, staff.id, staff.name)
  }

  return { switchTo }
}
