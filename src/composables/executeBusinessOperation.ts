import { useSessionStore } from '@/store/session.store'
import { canUserDo } from '@/router/permissions'
import type { StaffPermissions } from '@/features/staff/staff.types'
import type { DomainEvent } from '@/services/events/domainEvent.types'
import { publishEvent } from '@/services/events/publishEvent'

export interface BusinessOperationHooks<T> {
  /** Awaited — a financial write is not considered complete until its audit row exists. */
  audit: (result: T) => Promise<void>
  /** Optional and fire-and-forget. Omit entirely for writes with no event contract yet
   *  (e.g. installments/returns, out of WAFI-152's scope) rather than inventing a fake
   *  mapping onto an unrelated DomainEventType just to satisfy this wrapper's shape. */
  toEvent?: (result: T) => DomainEvent
}

/**
 * Every financial-write service method calls this instead of writing, auditing,
 * and publishing separately, so a write can never ship without exactly one audit
 * call (WAFI-007's invariant, unchanged) and, where a contract exists, exactly one
 * domain event (WAFI-152). `hooks` is object-shaped rather than positional so a
 * future hook (metrics, cache invalidation, notifications) is a new object field,
 * not another positional parameter shifting every call site.
 */
export async function executeBusinessOperation<T>(
  write: () => Promise<T>,
  hooks: BusinessOperationHooks<T>,
  requiredPermission?: keyof StaffPermissions,
): Promise<T> {
  if (requiredPermission) {
    const session = useSessionStore()
    if (!canUserDo(session.activeStaff, requiredPermission)) {
      throw new Error(`permission denied: ${requiredPermission} required`)
    }
  }
  const result = await write()
  await hooks.audit(result)
  if (hooks.toEvent) {
    // Fire-and-forget: publishing must never block the caller or turn a
    // publish/bus failure into a write failure. Nothing consumes these events
    // yet, and no future consumer should be able to make checkout depend on
    // event-bus availability.
    void publishEvent(hooks.toEvent(result)).catch(() => {})
  }
  return result
}
