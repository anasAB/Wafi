import { db } from '@/data/powersync/db'
import { getNotificationSettings } from '@/services/notifications/notificationSettings'
import { isWithinBusinessHours, type ShopHours } from '@/services/notifications/businessHours'
import type { DurableEvent } from '@/services/events/runDurableSubscriber'
import type { ExpenseRecordedPayload } from '@/services/events/domainEvent.types'

/** Registered (Task 15) as an independent `runDurableSubscriber` on `expense.recorded`. */
export async function handleAfterHoursExpenseEvent(event: DurableEvent<ExpenseRecordedPayload>): Promise<void> {
  const settings = await getNotificationSettings(event.shopId, 'expense.after_hours')
  if (!settings.enabled) return

  const shop = await db.getOptional<ShopHours>(
    `select open_time, close_time, is_24_7 from shops where id = ?`,
    [event.shopId],
  )
  if (!shop || isWithinBusinessHours(shop, event.occurredAt)) return

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
      'expense.after_hours', 'مصروف خارج ساعات العمل',
      `تم تسجيل مصروف $${event.payload.amountUsd.toFixed(2)} خارج ساعات العمل`,
      'expense', event.payload.expenseId, 'WARNING', event.eventId, new Date().toISOString(),
    ],
  )
}
