import { db } from '@/data/powersync/db'
import { useEventSubscription, type EventRow } from '@/services/events/useEventSubscription'
import { SalesEventType, type SaleCompletedPayload } from '@/services/events/domainEvent.types'
import { processProjectionAtMostOnce, SubscriberId } from '@/services/events/processProjectionAtMostOnce'

/**
 * Lightweight/best-effort (design spec, "Dashboard consumer"): folds sale.completed's
 * totalUsd/totalSyp into a disposable per-day revenue projection. Losing one event
 * under-counts today's revenue by one sale until the next full resync -- acceptable,
 * because this table is never treated as a source of truth for anything financial.
 * If it's ever visibly wrong, the fix is "rebuild from source" (re-run this subscriber
 * against sales directly), not "audit for a missing event."
 */
// WAFI-157: exported so the consumer-completeness check can read this subscriber's
// fixed subscription list as data instead of duplicating it.
export const DASHBOARD_PROJECTION_EVENT_TYPES = [SalesEventType.Completed]

export function startDashboardRevenueProjection(shopId: string): { stop: () => void } {
  return useEventSubscription<SaleCompletedPayload>(
    SalesEventType.Completed,
    async (row: EventRow<SaleCompletedPayload>) => {
      await processProjectionAtMostOnce(SubscriberId.TodayRevenueProjection, row.id, async () => {
        const date = row.occurred_at.slice(0, 10)
        // Read-then-insert-or-update, NOT an upsert -- same reason as
        // dailyEventCountsProjection.ts: PowerSync client tables are SQLite views over
        // CRUD-queue triggers, and SQLite rejects ON CONFLICT against a view.
        const existing = await db.getOptional<{ id: string; revenue_usd: number; revenue_syp: number }>(
          `SELECT id, revenue_usd, revenue_syp FROM local_today_revenue_projection WHERE shop_id = ? AND date = ?`,
          [shopId, date],
        )
        if (existing) {
          await db.execute(
            `UPDATE local_today_revenue_projection SET revenue_usd = ?, revenue_syp = ?, updated_at = ? WHERE id = ?`,
            [existing.revenue_usd + row.payload.totalUsd, existing.revenue_syp + row.payload.totalSyp, new Date().toISOString(), existing.id],
          )
        } else {
          await db.execute(
            `INSERT INTO local_today_revenue_projection (id, shop_id, date, revenue_usd, revenue_syp, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
            [crypto.randomUUID(), shopId, date, row.payload.totalUsd, row.payload.totalSyp, new Date().toISOString()],
          )
        }
      })
    },
    { shopId },
  )
}
