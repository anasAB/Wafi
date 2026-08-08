import { db } from '@/data/powersync/db'
import { runDurableSubscriber } from './runDurableSubscriber'
import type { DurableEvent } from './runDurableSubscriber'
import type { DomainEvent, DomainEventType, SaleDiscountedPayload } from './domainEvent.types'
import { getNotificationSettings } from '@/services/notifications/notificationSettings'
import { handleDrawerVarianceEvent } from '@/services/notifications/rules/drawerVariance.rule'
import { handleShiftLateCloseEvent } from '@/services/notifications/rules/shiftLateClose.rule'
import { handleCustomerDebtThresholdEvent } from '@/services/notifications/rules/customerDebtThreshold.rule'
import { handleAfterHoursExpenseEvent } from '@/services/notifications/rules/afterHoursExpense.rule'
import { handleLargeReturnEvent } from '@/services/notifications/rules/largeReturn.rule'
import { handleCashierLockoutEvent } from '@/services/notifications/rules/cashierLockout.rule'
import { handleNewDeviceEvent } from '@/services/notifications/rules/newDevice.rule'
import { handleSettlementPaidEvent } from '@/services/notifications/rules/settlementPaid.rule'

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
 * notify threshold. Severity is CRITICAL for belowCost, WARNING for pinApproval OR a
 * discount percentage exceeding the shop's configurable discountPercentCap (WAFI-145 --
 * generalizes the original hardcoded belowCost || pinApproval check from WAFI-143).
 * If the rule is disabled in notification_settings, returns null regardless of
 * belowCost/pinApproval/percentage. Only sale.discounted produces a notification today;
 * every other event type returns null (protects the mapping boundary -- see the
 * "unrelated event type" test).
 */
export async function mapEventToNotification(event: DomainEvent): Promise<NotificationInsert | null> {
  if ((event.type as DomainEventType) !== 'sale.discounted') return null
  const { belowCost, pinApproval, discountType, discountValue, discountPercentage, finalPriceUsd } =
    event.payload as SaleDiscountedPayload

  const settings = await getNotificationSettings(event.shopId, 'discount.large_applied')
  if (!settings.enabled) return null

  const overCap = discountPercentage !== undefined && discountPercentage > settings.discountPercentCap
  if (!belowCost && !pinApproval && !overCap) return null

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
  const entry = await mapEventToNotification(event)
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
  // One runDurableSubscriber per (source event, rule) pair -- independently
  // retryable even when two rules share a source event (drawer variance + late
  // close both react to shift.closed), per the design spec's architecture note.
  // NOTE: the discount subscriber is registered LAST in this array. It's functionally
  // order-independent in production (each is its own useEventSubscription watch loop),
  // but notificationSubscriber.test.ts's mock of useEventSubscription captures a single
  // `capturedHandler` variable that gets overwritten on every registration call -- so
  // whichever subscriber registers last is the one the existing (unchanged) tests
  // exercise. Keep this one last so those tests keep testing the discount handler.
  const subs = [
    runDurableSubscriber({ subscriberName: 'notifications-drawer-variance', eventType: 'shift.closed',        shopId, handler: handleDrawerVarianceEvent }),
    runDurableSubscriber({ subscriberName: 'notifications-shift-late-close', eventType: 'shift.closed',       shopId, handler: handleShiftLateCloseEvent }),
    runDurableSubscriber({ subscriberName: 'notifications-customer-debt',  eventType: 'customer.debt_changed', shopId, handler: handleCustomerDebtThresholdEvent }),
    runDurableSubscriber({ subscriberName: 'notifications-after-hours-expense', eventType: 'expense.recorded', shopId, handler: handleAfterHoursExpenseEvent }),
    runDurableSubscriber({ subscriberName: 'notifications-large-return',   eventType: 'sale.returned',        shopId, handler: handleLargeReturnEvent }),
    runDurableSubscriber({ subscriberName: 'notifications-cashier-lockout', eventType: 'staff.pin_locked_out', shopId, handler: handleCashierLockoutEvent }),
    runDurableSubscriber({ subscriberName: 'notifications-new-device',     eventType: 'device.registered',    shopId, handler: handleNewDeviceEvent }),
    runDurableSubscriber({ subscriberName: 'notifications-settlement-paid', eventType: 'settlement.paid',     shopId, handler: handleSettlementPaidEvent }),
    runDurableSubscriber({ subscriberName: 'notifications-discount',      eventType: 'sale.discounted',      shopId, handler: handleDiscountEvent }),
  ]
  return { stop: () => subs.forEach(s => s.stop()) }
}
