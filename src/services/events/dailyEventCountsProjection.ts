import { db } from '@/data/powersync/db'
import { useEventSubscription, type EventRow } from '@/services/events/useEventSubscription'
import { SalesEventType, type SaleCompletedPayload } from '@/services/events/domainEvent.types'

/**
 * Reference read-model (design spec §7): events -> subscriber -> materialized
 * projection. Future dashboard/report consumers (WAFI-143/144/145/146) should
 * follow this same shape, not treat it as disposable.
 *
 * At-least-once delivery (design spec §3) means this can double-count on
 * duplicate handler execution -- accepted as a known Sprint 1 limitation.
 * Idempotent dedup (tracking which events.id rows are already folded in) is
 * Sprint 2 scope.
 */
export function startDailyEventCountsProjection(shopId: string): { stop: () => void } {
  return useEventSubscription<SaleCompletedPayload>(
    SalesEventType.Completed,
    async (row: EventRow<SaleCompletedPayload>) => {
      const day = row.occurred_at.slice(0, 10)
      await db.execute(
        `INSERT INTO daily_event_counts (shop_id, event_type, day, count)
         VALUES (?, ?, ?, 1)
         ON CONFLICT (shop_id, event_type, day) DO UPDATE SET count = daily_event_counts.count + 1`,
        [shopId, SalesEventType.Completed, day],
      )
    },
    { shopId },
  )
}
