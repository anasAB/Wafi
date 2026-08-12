import { db } from '@/data/powersync/db'
import { useEventSubscription, type EventRow } from '@/services/events/useEventSubscription'
import {
  SalesEventType, ReturnsEventType, ExpenseEventType,
  type SaleCompletedPayload, type ReturnedPayload, type ExpenseRecordedPayload,
} from '@/services/events/domainEvent.types'
import { processProjectionAtMostOnce, SubscriberId } from '@/services/events/processProjectionAtMostOnce'

/**
 * WAFI-153. Lightweight local marker writer for profit_cache, following
 * dailyEventCountsProjection.ts's exact shape: subscribes to the three
 * source events, and on each one does a read-then-insert-or-update against
 * the local (shop_id, day) row -- but writes ONLY source_event_id, never a
 * metric column. All financial/count mutation happens exclusively in
 * apply_profit_cache() server-side (see ops.ts's special case for how the
 * upload of this write is routed there).
 */
export function startProfitCacheProjection(shopId: string): { stop: () => void } {
  const stops: Array<() => void> = []

  async function writeMarker(day: string, eventId: string): Promise<void> {
    const existing = await db.getOptional<{ id: string }>(
      `SELECT id FROM profit_cache WHERE shop_id = ? AND day = ?`,
      [shopId, day],
    )
    if (existing) {
      await db.execute(`UPDATE profit_cache SET source_event_id = ? WHERE id = ?`, [eventId, existing.id])
    } else {
      await db.execute(
        `INSERT INTO profit_cache (id, shop_id, day, source_event_id) VALUES (?, ?, ?, ?)`,
        [crypto.randomUUID(), shopId, day, eventId],
      )
    }
  }

  stops.push(useEventSubscription<SaleCompletedPayload>(
    SalesEventType.Completed,
    async (row: EventRow<SaleCompletedPayload>) => {
      await processProjectionAtMostOnce(SubscriberId.ProfitCache, row.id, async () => {
        await writeMarker(row.occurred_at.slice(0, 10), row.id)
      })
    },
    { shopId },
  ).stop)

  stops.push(useEventSubscription<ReturnedPayload>(
    ReturnsEventType.Returned,
    async (row: EventRow<ReturnedPayload>) => {
      await processProjectionAtMostOnce(SubscriberId.ProfitCache, row.id, async () => {
        // Marks the return's OWN day only -- the cross-day costless decrement
        // is a server-side-only concern (apply_profit_cache reads the original
        // sale's projection day from the payload); the local marker carries no
        // metric value, so it never needs to know about it.
        await writeMarker(row.occurred_at.slice(0, 10), row.id)
      })
    },
    { shopId },
  ).stop)

  stops.push(useEventSubscription<ExpenseRecordedPayload>(
    ExpenseEventType.Recorded,
    async (row: EventRow<ExpenseRecordedPayload>) => {
      await processProjectionAtMostOnce(SubscriberId.ProfitCache, row.id, async () => {
        await writeMarker(row.occurred_at.slice(0, 10), row.id)
      })
    },
    { shopId },
  ).stop)

  return { stop: () => stops.forEach(s => s()) }
}
