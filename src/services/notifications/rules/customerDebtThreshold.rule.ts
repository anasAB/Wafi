import { db } from '@/data/powersync/db'
import { getNotificationSettings } from '@/services/notifications/notificationSettings'
import type { DurableEvent } from '@/services/events/runDurableSubscriber'
import type { DebtChangedPayload } from '@/services/events/domainEvent.types'

/** Replay-safe by construction: `runDurableSubscriber` gives at-least-once delivery,
 *  so this handler MUST NOT track "today's cumulative debt" as an in-memory or
 *  incrementing counter -- a redelivered event would double-count it and corrupt the
 *  crossing decision. Instead `after` is recomputed from an authoritative aggregate
 *  query over already-committed sales every single time the handler runs (including
 *  on redelivery of the same event), so `before`/`after` are always identical for a
 *  given event, making the crossing decision itself idempotent (design spec:
 *  "Customer Debt: persistence and replay-safety strategy"). */
export async function handleCustomerDebtThresholdEvent(event: DurableEvent<DebtChangedPayload>): Promise<void> {
  const { reason, deltaUsd } = event.payload
  if (reason !== 'credit_sale' || deltaUsd <= 0) return

  const settings = await getNotificationSettings(event.shopId, 'customer.debt_threshold')
  if (!settings.enabled) return

  const today = event.occurredAt.slice(0, 10) // 'YYYY-MM-DD' -- same day-extraction used for the dedup check below

  // Shop-wide (NOT per-customer) authoritative aggregate over already-persisted
  // sales -- NOT an in-memory accumulator. Design spec: "Customer Debt in this
  // ticket measures new credit-sale debt issued today (shop-wide, resets daily)".
  // Recomputing this on every invocation (including redelivery of the same event)
  // yields the same before/after every time, since the underlying sales data is
  // immutable once committed.
  const totalRow = await db.getOptional<{ total: number }>(
    `select coalesce(sum(total_usd), 0) as total from sales
     where shop_id = ? and is_credit = 1 and substr(created_at, 1, 10) = ?`,
    [event.shopId, today],
  )
  const after = totalRow?.total ?? 0
  const before = after - deltaUsd

  if (before > settings.dailyDebtUsdCap || after <= settings.dailyDebtUsdCap) return

  // Dedup by "already notified today" rather than source_event_id (this rule's
  // trigger condition is accumulated state, not a single event's own payload) --
  // this is what actually prevents a duplicate insert on redelivery or on a later
  // same-day credit sale that doesn't re-cross.
  const existing = await db.getOptional<{ id: string }>(
    `select id from notifications where shop_id = ? and type = 'customer.debt_threshold'
     and substr(created_at, 1, 10) = ?`,
    [event.shopId, today],
  )
  if (existing) return

  // entity_id/entity_type: even though the cap itself is shop-wide, we still deep-link
  // to the triggering customer -- "here's the credit sale that pushed the shop over
  // today's cap" is a more actionable click-through than the shop itself (which has no
  // dedicated screen to land on). entity_type stays 'customer' per the design spec's
  // deep-link table.
  await db.execute(
    `insert into notifications (id, shop_id, recipient_role, type, title, message, entity_type, entity_id, severity, source_event_id, created_at)
     values (?, ?, 'owner', 'customer.debt_threshold', ?, ?, 'customer', ?, 'CRITICAL', ?, ?)`,
    [
      crypto.randomUUID(), event.shopId,
      'دين جديد كبير اليوم',
      `تجاوز الدين الجديد اليوم $${after.toFixed(2)}`,
      event.payload.customerId, event.eventId, new Date().toISOString(),
    ],
  )
}
