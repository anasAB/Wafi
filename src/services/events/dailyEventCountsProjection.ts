import { db } from '@/data/powersync/db'
import { useEventSubscription, type EventRow } from '@/services/events/useEventSubscription'
import { SalesEventType, type SaleCompletedPayload } from '@/services/events/domainEvent.types'
import { processProjectionAtMostOnce, SubscriberId } from '@/services/events/processProjectionAtMostOnce'

/**
 * Reference read-model (Sprint 1 design spec §7): events -> subscriber -> materialized
 * projection. Future dashboard/report consumers (WAFI-143/144/145/146) should
 * follow this same shape, not treat it as disposable.
 *
 * WAFI-140 Sprint 2 closes the documented double-count limitation: each row is now
 * guarded through the processed-event ledger (`processProjectionAtMostOnce`) before
 * being folded into daily_event_counts, so at-least-once delivery no longer means
 * at-least-once counting.
 */
export function startDailyEventCountsProjection(shopId: string): { stop: () => void } {
  return useEventSubscription<SaleCompletedPayload>(
    SalesEventType.Completed,
    async (row: EventRow<SaleCompletedPayload>) => {
      await processProjectionAtMostOnce(SubscriberId.DailyEventCounts, row.id, async () => {
        const day = row.occurred_at.slice(0, 10)
        // Read-then-insert-or-update, NOT an upsert: PowerSync client tables are
        // SQLite views backed by CRUD-queue triggers, and SQLite rejects
        // ON CONFLICT against a view (the migration's UNIQUE constraint exists
        // server-side only, so there is no local conflict target either).
        const existing = await db.getOptional<{ id: string; count: number }>(
          `SELECT id, count FROM daily_event_counts WHERE shop_id = ? AND event_type = ? AND day = ?`,
          [shopId, SalesEventType.Completed, day],
        )
        if (existing) {
          await db.execute(
            `UPDATE daily_event_counts SET count = ? WHERE id = ?`,
            [existing.count + 1, existing.id],
          )
        } else {
          await db.execute(
            `INSERT INTO daily_event_counts (id, shop_id, event_type, day, count) VALUES (?, ?, ?, ?, 1)`,
            [crypto.randomUUID(), shopId, SalesEventType.Completed, day],
          )
        }
      })
    },
    { shopId },
  )
}
