import { db } from '@/data/powersync/db'
import { getNotificationSettings } from '@/services/notifications/notificationSettings'
import type { DurableEvent } from '@/services/events/runDurableSubscriber'
import type { PinLockedOutPayload } from '@/services/events/domainEvent.types'

/** Registered (Task 15) as an independent `runDurableSubscriber` on `staff.pin_locked_out`. */
export async function handleCashierLockoutEvent(event: DurableEvent<PinLockedOutPayload>): Promise<void> {
  const settings = await getNotificationSettings(event.shopId, 'staff.pin_locked_out')
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
      'staff.pin_locked_out', 'تم قفل حساب موظف',
      `تم قفل حساب الموظف بعد محاولات خاطئة متكررة لمدة ${event.payload.lockoutMinutes} دقائق`,
      'staff', event.payload.staffId, 'CRITICAL', event.eventId, new Date().toISOString(),
    ],
  )
}
