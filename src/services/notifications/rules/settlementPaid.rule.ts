import { db } from '@/data/powersync/db'
import { getNotificationSettings } from '@/services/notifications/notificationSettings'
import type { DurableEvent } from '@/services/events/runDurableSubscriber'
import type { SettlementPaidPayload } from '@/services/events/domainEvent.types'

/** Registered (Task 15) as an independent `runDurableSubscriber` on `settlement.paid`. */
export async function handleSettlementPaidEvent(event: DurableEvent<SettlementPaidPayload>): Promise<void> {
  const settings = await getNotificationSettings(event.shopId, 'settlement.paid')
  if (!settings.enabled) return

  // Check-then-insert, same reasoning as notificationSubscriber.ts's handleDiscountEvent.
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
      'settlement.paid', 'تسوية موظف',
      `تم دفع تسوية للموظف بمبلغ $${event.payload.amount.toFixed(2)}`,
      'staff', event.payload.staffId, 'INFO', event.eventId, new Date().toISOString(),
    ],
  )
}
