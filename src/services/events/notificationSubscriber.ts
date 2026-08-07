import { db } from '@/data/powersync/db'
import { runDurableSubscriber } from './runDurableSubscriber'
import type { DurableEvent } from './runDurableSubscriber'
import type { DomainEvent, DomainEventType, SaleDiscountedPayload } from './domainEvent.types'

export interface NotificationInsert {
  type: string
  title: string
  message: string
  entity_type: string
  entity_id: string | null
  severity: 'INFO' | 'WARNING' | 'CRITICAL'
  recipient_staff_id: string | null
  recipient_role: string | null
}

/**
 * Maps a domain event to its notifications row, or null if this event doesn't cross the
 * notify threshold (design spec: reuse useAuditLog's existing belowCost || pinApproval
 * significance criterion -- no new numeric threshold). Only sale.discounted produces a
 * notification today; every other event type returns null (protects the mapping boundary
 * -- see the "unrelated event type" test).
 */
export function mapEventToNotification(event: DomainEvent): NotificationInsert | null {
  if ((event.type as DomainEventType) !== 'sale.discounted') return null
  const { belowCost, pinApproval, discountType, discountValue, finalPriceUsd } = event.payload as SaleDiscountedPayload
  if (!belowCost && !pinApproval) return null

  return {
    type: 'discount.large_applied',
    title: 'خصم كبير مُطبَّق',
    message: `تم تطبيق خصم ${discountType === 'percent' ? `${discountValue}%` : `$${discountValue}`} على عملية بيع، السعر النهائي $${finalPriceUsd}`,
    entity_type: 'sale',
    entity_id: event.entityId,
    severity: belowCost ? 'CRITICAL' : 'WARNING',
    recipient_role: 'owner',
    recipient_staff_id: null,
  }
}

export async function handleDiscountEvent(event: DurableEvent<unknown>): Promise<void> {
  const entry = mapEventToNotification(event)
  if (!entry) return // null mapping is success -- runDurableSubscriber still writes the ledger

  // Check-then-insert, same reasoning as auditSubscriber.ts: safe on this single-
  // threaded client (no concurrent execution of this handler to race against); the real
  // database-enforced dedup backstop lives at sync-upload time in ops.ts (Task 8),
  // keyed on this same source_event_id.
  const existing = await db.getOptional<{ id: string }>(
    `select id from notifications where source_event_id = ?`,
    [event.eventId],
  )
  if (existing) return

  await db.execute(
    `insert into notifications (id, shop_id, recipient_staff_id, recipient_role, type, title, message, entity_type, entity_id, severity, source_event_id, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(), event.shopId, entry.recipient_staff_id, entry.recipient_role,
      entry.type, entry.title, entry.message, entry.entity_type, entry.entity_id,
      entry.severity, event.eventId, new Date().toISOString(),
    ],
  )
}

export function startNotificationSubscribers(shopId: string): { stop: () => void } {
  const subscription = runDurableSubscriber({
    subscriberName: 'notifications',
    eventType: 'sale.discounted',
    shopId,
    handler: handleDiscountEvent,
  })
  return { stop: () => subscription.stop() }
}
