import { getCurrentInstance, onUnmounted } from 'vue'
import { db } from '@/data/powersync/db'
import type { DomainEventType } from './domainEvent.types'

export interface EventRow<T = unknown> {
  id: string
  type: DomainEventType
  entity_id: string
  payload: T
  staff_id: string
  shop_id: string
  occurred_at: string
  created_at: string
}

export interface UseEventSubscriptionOptions {
  shopId: string
  /** Optional occurred_at lower bound -- keeps the watch query cheap as `events`
   *  grows (design spec §7: "should add an occurred_at bound whenever the full
   *  history isn't needed"). Omit to watch the full shop-scoped history. */
  sinceIso?: string
}

/**
 * Watches `events` for rows of one `type`, scoped to `shopId` -- both columns
 * covered by `events_shop_type_idx`, per the indexed-predicate rule in the
 * design spec (§7). At-least-once, no ordering guarantee (design spec §3):
 * `handler` may be invoked more than once for the same row, and concurrently
 * emitted events are not guaranteed to arrive in occurred_at order.
 *
 * Disposal: call the returned `stop()` explicitly, or rely on the automatic
 * `onUnmounted` registration when called during a component's setup() (this
 * composable owns that registration; callers outside a component -- e.g. a
 * store-level subscriber started once at app init -- MUST call `stop()`
 * themselves when they no longer need it).
 */
export function useEventSubscription<T = unknown>(
  type: DomainEventType,
  handler: (row: EventRow<T>) => void | Promise<void>,
  options: UseEventSubscriptionOptions,
): { stop: () => void } {
  const controller = new AbortController()

  const conditions = ['shop_id = ?', 'type = ?']
  const params: unknown[] = [options.shopId, type]
  if (options.sinceIso) {
    conditions.push('occurred_at >= ?')
    params.push(options.sinceIso)
  }

  const sql = `SELECT * FROM events WHERE ${conditions.join(' AND ')} ORDER BY occurred_at DESC`

  ;(async () => {
    const iterable = db.watch(sql, params, { signal: controller.signal })
    for await (const result of iterable) {
      const rows = (result as any).rows?._array ?? []
      for (const row of rows) {
        const parsed: EventRow<T> = { ...row, payload: JSON.parse(row.payload) }
        await handler(parsed)
      }
    }
  })().catch((err) => {
    if (!controller.signal.aborted) console.error('[useEventSubscription] watch loop failed', type, err)
  })

  const stop = () => controller.abort()

  if (getCurrentInstance()) {
    onUnmounted(stop)
  }

  return { stop }
}
