import { db } from '@/data/powersync/db'
import { getNotificationSettings } from '@/services/notifications/notificationSettings'
import type { DurableEvent } from '@/services/events/runDurableSubscriber'
import type { ShiftClosedPayload } from '@/services/events/domainEvent.types'

/** Registered (Task 15) as an independent `runDurableSubscriber` on `shift.closed`,
 *  alongside `handleShiftLateCloseEvent` -- two separate subscriptions on the same
 *  event type so each retries independently. */
export async function handleDrawerVarianceEvent(event: DurableEvent<ShiftClosedPayload>): Promise<void> {
  const settings = await getNotificationSettings(event.shopId, 'drawer.variance')
  if (!settings.enabled) return

  const { variance, shiftId } = event.payload
  if (Math.abs(variance) <= settings.varianceUsdCap) return

  // Check-then-insert, same reasoning as notificationSubscriber.ts's handleDiscountEvent:
  // safe on this single-threaded client; the database-enforced dedup backstop lives at
  // sync-upload time, keyed on this same source_event_id.
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
      'drawer.variance', 'فرق في الصندوق',
      `تم رصد فرق ${Math.abs(variance).toFixed(2)}$ في الوردية`,
      'shift', shiftId, 'CRITICAL', event.eventId, new Date().toISOString(),
    ],
  )
}
