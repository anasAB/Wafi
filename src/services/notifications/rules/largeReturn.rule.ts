import { db } from '@/data/powersync/db'
import { getNotificationSettings } from '@/services/notifications/notificationSettings'
import type { DurableEvent } from '@/services/events/runDurableSubscriber'
import type { ReturnedPayload } from '@/services/events/domainEvent.types'

/** Registered (Task 15) as an independent `runDurableSubscriber` on `sale.returned`. */
export async function handleLargeReturnEvent(event: DurableEvent<ReturnedPayload>): Promise<void> {
  const settings = await getNotificationSettings(event.shopId, 'sale.large_return')
  if (!settings.enabled) return
  if (event.payload.refundAmountUsd <= settings.refundUsdCap) return

  // Check-then-insert, same reasoning as notificationSubscriber.ts's handleDiscountEvent
  // and afterHoursExpense.rule.ts: guards the partial UNIQUE index on source_event_id
  // against at-least-once redelivery from runDurableSubscriber.
  const existing = await db.getOptional<{ id: string }>(
    `select id from notifications where source_event_id = ?`,
    [event.eventId],
  )
  if (existing) return

  await db.execute(
    `insert into notifications (id, shop_id, recipient_staff_id, recipient_role, type, title, message, entity_type, entity_id, severity, source_event_id, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(), event.shopId, null, 'owner',
      'sale.large_return', 'إرجاع كبير',
      `تم إرجاع مبلغ $${event.payload.refundAmountUsd.toFixed(2)}`,
      'return', event.payload.returnId, 'WARNING', event.eventId, new Date().toISOString(),
    ],
  )
}
