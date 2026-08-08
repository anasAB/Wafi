import { db } from '@/data/powersync/db'
import { getNotificationSettings } from '@/services/notifications/notificationSettings'
import type { DurableEvent } from '@/services/events/runDurableSubscriber'
import type { ShiftClosedPayload } from '@/services/events/domainEvent.types'

interface ShopHoursRow { close_time: string | null; is_24_7: number | null }

/** Registered (Task 15) as an independent `runDurableSubscriber` on `shift.closed`,
 *  alongside `handleDrawerVarianceEvent` -- two separate subscriptions on the same
 *  event type so each retries independently. Compares against the event's own
 *  `occurredAt` (authoritative), never a client-local `Date.now()`. */
export async function handleShiftLateCloseEvent(event: DurableEvent<ShiftClosedPayload>): Promise<void> {
  const settings = await getNotificationSettings(event.shopId, 'shift.late_close')
  if (!settings.enabled) return

  const shop = await db.getOptional<ShopHoursRow>(
    `select close_time, is_24_7 from shops where id = ?`,
    [event.shopId],
  )
  // No operating hours configured (or 24/7) -- nothing to be "late" against.
  if (!shop || shop.is_24_7 || !shop.close_time) return

  const closedAt = new Date(event.occurredAt)
  const [closeH, closeM] = shop.close_time.split(':').map(Number)
  const expectedClose = new Date(closedAt)
  expectedClose.setUTCHours(closeH, closeM, 0, 0)
  const minutesLate = (closedAt.getTime() - expectedClose.getTime()) / 60_000
  if (minutesLate <= settings.graceMinutes) return

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
      'shift.late_close', 'إغلاق متأخر للوردية',
      `تم إغلاق الوردية متأخراً بـ ${Math.round(minutesLate)} دقيقة`,
      'shift', event.payload.shiftId, 'WARNING', event.eventId, new Date().toISOString(),
    ],
  )
}
