import { getCurrentInstance, onUnmounted } from 'vue'
import { db } from '@/data/powersync/db'
import type { DomainEventType } from './domainEvent.types'

export interface EventRow<T = unknown> {
  id: string
  type: DomainEventType
  entity_id: string
  payload: T
  payload_version: number
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

  // PowerSync's db.watch() re-emits the ENTIRE current result set on every change
  // to the watched table, not just the new rows. Without a watermark the handler
  // would re-run for all history on every insert (quadratic). Track the highest
  // occurred_at already forwarded and only forward strictly-newer rows on later
  // emissions. In-memory only: a restart re-processes from scratch, and a re-
  // delivered row inside a batch that also contains newer rows can still be
  // re-forwarded -- the accepted at-least-once limitation (design spec §3).
  let lastSeenOccurredAt: string | null = null

  ;(async () => {
    const iterable = db.watch(sql, params, { signal: controller.signal })
    for await (const result of iterable) {
      const rows = (result as any).rows?._array ?? []
      const watermark: string | null = lastSeenOccurredAt
      let batchMax: string | null = watermark
      for (const row of rows) {
        const occurredAt: string | undefined = row.occurred_at
        if (watermark !== null && occurredAt !== undefined && occurredAt <= watermark) continue
        if (occurredAt !== undefined && (batchMax === null || occurredAt > batchMax)) batchMax = occurredAt
        const parsed: EventRow<T> = {
          ...row,
          payload: JSON.parse(row.payload),
          payload_version: row.payload_version,
        }
        await handler(parsed)
      }
      lastSeenOccurredAt = batchMax
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
