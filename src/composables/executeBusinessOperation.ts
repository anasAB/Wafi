import { useSessionStore } from '@/store/session.store'
import { canUserDo } from '@/router/permissions'
import type { StaffPermissions } from '@/features/staff/staff.types'
import type { DomainEvent } from '@/services/events/domainEvent.types'
import { publishEvent } from '@/services/events/publishEvent'

export interface BusinessOperationHooks<T> {
  /** Awaited — a financial write is not considered complete until its audit row exists. */
  audit: (result: T) => Promise<void>
  /** Optional and fire-and-forget. Omit entirely for writes with no event contract yet
   *  (e.g. installments, out of WAFI-152's scope) rather than inventing a fake mapping
   *  onto an unrelated DomainEventType just to satisfy this wrapper's shape.
   *
   *  @remarks At most ONE DomainEvent per write — this hook has no plural form. A write
   *  that can produce more than one meaningful fact (e.g. a product edit changing both
   *  price and cost) must pick one, or return `undefined` for "no event this write" — see
   *  WAFI-140 Sprint 2 design spec §5a for a call site working around this limitation.
   *  Multiple events per write remain unsupported until a future revision of this
   *  wrapper (e.g. a plural `toEvents` hook). */
  toEvent?: (result: T) => DomainEvent | undefined
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
  const event = hooks.toEvent?.(result)
  if (event) {
    // Fire-and-forget: publishing must never block the caller or turn a
    // publish/bus failure into a write failure.
    void publishEvent(event).catch(() => {})
  }
  return result
}
