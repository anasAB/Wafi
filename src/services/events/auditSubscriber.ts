import { db } from '@/data/powersync/db'
import { runDurableSubscriber } from './runDurableSubscriber'
import type { DurableEvent } from './runDurableSubscriber'
import type { DomainEvent, DomainEventType } from './domainEvent.types'

export interface AuditLogInsert {
  event: string
  entity_type: string
  entity_id: string | null
  staff_id: string
  staff_name: string
  meta: Record<string, unknown>
}

/**
 * Maps a domain event to its audit_log row, or null if this event type intentionally
 * produces no audit entry (WAFI-150 design spec, plus final-review findings C2/C3/I4
 * below). Where the mapped `event` string is a pre-existing legacy audit event (i.e.
 * this mapping retires a manual useAuditLog() call), `event`/`entity_type` and `meta`'s
 * keys MUST match exactly what that legacy event already means to
 * src/features/audit/audit.format.ts's eventLabel() and AuditLogPage.vue -- those files
 * predate this subscriber and switch on the exact legacy strings/keys, not on whatever
 * name/shape a new domain event happens to use. For genuinely new event types (no
 * legacy audit event of their own), the plain domain event type name IS the audit event
 * name, and `meta` is the verbatim payload -- no transform, enrichment, revalidation, or
 * reconstruction of state from a database read.
 */
export function mapEventToAuditEntry(event: DomainEvent): AuditLogInsert | null {
  const staffId = event.staffId
  const staffName = 'system' // WAFI-150: the durable subscriber has no session context
  // (unlike useAuditLog()'s _write, which reads useSessionStore().activeStaff?.name at
  // call time). Fixed for I1 (final review) at the READ side instead: useAuditLog.ts's
  // loadLog()/loadEntityHistory() resolve the real name from `staff_id` at render time
  // whenever staff_name === 'system' (see hydrateStaffNames there) -- the write path
  // stays free of a state-reconstructing DB read, per the design spec's prohibition.

  switch (event.type as DomainEventType) {
    // Final review I4: product.cost_updated is net-new audit coverage carrying
    // margin/cost data. audit_log's only RLS gate is `owner OR can_view_reports`
    // (061_audit_domain_rls.sql), coarser than events' per-type `can_view_reports`
    // gate for this same type (077_events_per_type_rls.sql) -- no regression there,
    // but also no widening intended by this ticket. Deferred (mapped to null) rather
    // than adding full UI support in this fix wave; revisit as its own deliberate
    // decision, not an accident of this subscriber's blanket coverage.
    case 'product.cost_updated':
      return null
    case 'product.price_changed': {
      // Legacy logProductPriceChanged wrote { name, old_price, new_price } (see
      // eventLabel's 'product.price_changed' case). ProductPriceChangedPayload does
      // not carry the product name -- eventLabel's str(m.name) renders '—' for it,
      // an accepted degradation (final review C3): the price change itself, the
      // number that matters for the audit trail, is preserved.
      const p = event.payload as { productId: string; oldPriceUsd: number; newPriceUsd: number }
      return { event: 'product.price_changed', entity_type: 'product', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: { productId: p.productId, old_price: p.oldPriceUsd, new_price: p.newPriceUsd } }
    }
    case 'product.created':
      return { event: 'product.created', entity_type: 'product', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: event.payload as Record<string, unknown> }
    case 'device.registered':
      // Genuinely new audit coverage, no legacy event to match -- verbatim payload.
      return { event: 'device.registered', entity_type: 'device', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: event.payload as Record<string, unknown> }
    case 'stock.taken': {
      // Legacy logStockTakeCompleted wrote { linesAdjusted, totalShrinkageUsd } under
      // event 'stock_take.completed' -- but eventLabel() has no case for
      // 'stock_take.completed' (falls through to `default: return entry.event`), so
      // no rendering currently depends on either the old or the new meta shape. Emit
      // the legacy event name (required for the AuditEvent union / eventOptions
      // filter / entity-history lookups to keep working) with the verbatim payload.
      return { event: 'stock_take.completed', entity_type: 'stock_take', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: event.payload as Record<string, unknown> }
    }
    // Final review C3: StockReceivedPayload ({ receivingId, supplierId, skuCount,
    // totalCost }) does not carry the supplier NAME or per-line detail
    // (product/qty/unit cost/costUpdated) that legacy logReceivingCreated's
    // 'receiving.created' meta and AuditLogPage.vue's expanded line-item view both
    // require, and useAuditLog.ts's hydrateReceivingMeta() fallback only fires when
    // the event string is 'receiving.created' -- so faking a matching meta shape
    // would silently show wrong/missing supplier and line data forever (audit rows
    // are append-only). Escape hatch used deliberately here: the manual
    // logReceivingCreated call in inventory.service.ts's receiveStock() was NOT
    // retired -- this mapping stays a no-op so the subscriber does not double-log.
    case 'stock.received':
      return null
    case 'cash.movement_recorded': {
      // Legacy logCashMovementRecorded wrote { direction, category, currency, amount }
      // under 'cash_movement.recorded' -- eventLabel reads m.amount (not amountUsd).
      const p = event.payload as { movementId: string; shiftId: string; direction: string; category: string; currency: string; amountUsd: number }
      return { event: 'cash_movement.recorded', entity_type: 'cash_movement', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: { movementId: p.movementId, shiftId: p.shiftId, direction: p.direction, category: p.category, currency: p.currency, amount: p.amountUsd } }
    }
    case 'sale.completed':
      return { event: 'sale.completed', entity_type: 'sale', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: event.payload as Record<string, unknown> }
    case 'sale.returned': {
      // Legacy logReturnProcessed wrote { saleId, refundUsd } under 'return.processed'
      // -- eventLabel reads m.refundUsd, ReturnedPayload has refundAmountUsd.
      const p = event.payload as { returnId: string; saleId: string; refundAmountUsd: number; restockedItemCount: number }
      return { event: 'return.processed', entity_type: 'return', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: { returnId: p.returnId, saleId: p.saleId, refundUsd: p.refundAmountUsd, restockedItemCount: p.restockedItemCount } }
    }
    case 'customer.debt_changed':
      // Genuinely new audit coverage, no legacy event to match -- verbatim payload.
      return { event: 'customer.debt_changed', entity_type: 'customer', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: event.payload as Record<string, unknown> }
    case 'installment.due_paid': {
      // Legacy logCustomerPaymentRecorded wrote { amountUsd } under
      // 'customer.payment_recorded' -- eventLabel reads m.amountUsd,
      // InstallmentDuePaidPayload has `amount`. (remainingBalance is carried through
      // verbatim but is not rendered by eventLabel; note customer.service.ts's own
      // TODO(WAFI-140) that this field is currently always 0, not the true balance --
      // pre-existing, not something this mapping can fix.)
      const p = event.payload as { customerId: string; amount: number; remainingBalance: number }
      return { event: 'customer.payment_recorded', entity_type: 'customer', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: { customerId: p.customerId, amountUsd: p.amount, remainingBalance: p.remainingBalance } }
    }
    // Final review C3: InventoryAdjustedPayload ({ productId, deltaQty, reason }) does
    // not carry the product name or the old/new quantities that legacy
    // logStockAdjusted's 'stock.adjusted' meta and eventLabel's rendering
    // (`${name}: ${old_qty} ← ${new_qty}`) both require -- deltaQty alone cannot
    // reconstruct old/new without a state read, which this subscriber must not do.
    // Escape hatch used deliberately: the manual logStockAdjusted call in
    // inventory.service.ts's adjustInventory() was NOT retired.
    case 'inventory.adjusted':
      return null
    case 'staff.ledger_entry_added': {
      // Legacy logStaffLedgerEntryCreated wrote { staffId, entryType, amountUsd } --
      // StaffLedgerEntryAddedPayload has `amount`. No eventLabel case exists for
      // 'staff_ledger.entry_created' today (falls to default), so this rename is not
      // display-visible yet, but keeps the meta key consistent with the legacy
      // convention for whenever a case is added.
      const p = event.payload as { staffId: string; entryType: string; amount: number }
      return { event: 'staff_ledger.entry_created', entity_type: 'staff_ledger', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: { staffId: p.staffId, entryType: p.entryType, amountUsd: p.amount } }
    }
    case 'settlement.paid': {
      // Legacy logStaffSettlementPaid wrote { staffId, paymentMethod }.
      // SettlementPaidPayload carries { staffId, amount, ledgerBalanceAfter } -- no
      // paymentMethod anywhere on the event, and nothing upstream of publishEvent()
      // captures it either, so it cannot be reconstructed without a DB read. Accepted
      // loss (final review C3): no eventLabel case exists for 'staff_settlement.paid'
      // today (falls to default, not rendered), so this is not a visible regression,
      // just documented as required.
      return { event: 'staff_settlement.paid', entity_type: 'staff_settlement', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: event.payload as Record<string, unknown> }
    }
    case 'expense.recorded':
      return { event: 'expense.created', entity_type: 'expense', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: event.payload as Record<string, unknown> }
    // Intentionally excluded (WAFI-150 design spec scope): shift.opened/shift.closed
    // are wired to the bus but their manual useAuditLog() calls (logShiftOpened/
    // logShiftClosed, both `_log(..., {})` with no meta) stay in place -- there is
    // nothing this subscriber would add over the existing call, so retiring them
    // is out of scope for this ticket.
    case 'shift.opened':
    case 'shift.closed':
      return null
    default:
      return null
  }
}

const AUDITED_EVENT_TYPES: DomainEventType[] = [
  'product.cost_updated', 'product.price_changed', 'product.created', 'device.registered',
  'stock.taken', 'stock.received', 'cash.movement_recorded', 'sale.completed', 'sale.returned',
  'customer.debt_changed', 'installment.due_paid', 'inventory.adjusted',
  'staff.ledger_entry_added', 'settlement.paid', 'expense.recorded',
]

// Exported (WAFI-150 Task 9) so App.vue can also register it directly with
// startProcessingRetrySweeper()'s handlers Map -- it is already exactly the shape
// that sweeper expects: (event: DomainEvent) => Promise<void>, since
// DurableEvent<T> extends DomainEvent<T>. Without this, a failed audit-subscriber
// delivery gets queued into local_event_processing_retries (Task 3/4) but nothing
// ever re-invokes the handler for it -- the same dormant-consumer bug class as
// startRetryQueueSweeper/startDailyEventCountsProjection above.
export async function handleAuditableEvent(event: DurableEvent<unknown>): Promise<void> {
  const entry = mapEventToAuditEntry(event)
  if (!entry) return // null mapping is success -- runDurableSubscriber still writes the ledger

  // Check-then-insert: safe on this single-threaded client (no concurrent execution
  // of this same handler to race against) -- see design spec for why ON CONFLICT
  // cannot run locally at all (PowerSync client tables are SQLite views over
  // CRUD-queue triggers). The real, database-enforced dedup backstop lives at
  // sync-upload time in ops.ts (Task 6), keyed on this same source_event_id.
  // event.eventId (NOT event.entityId) is the events.id row this audit entry
  // traces back to -- entityId is the business entity (e.g. the expense ID), which
  // is not unique per event and would corrupt the dedup key.
  const existing = await db.getOptional<{ id: string }>(
    `select id from audit_log where source_event_id = ?`,
    [event.eventId],
  )
  if (existing) return

  await db.execute(
    `insert into audit_log (id, shop_id, staff_id, staff_name, event, entity_type, entity_id, meta, created_at, source_event_id)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(), event.shopId, entry.staff_id, entry.staff_name,
      entry.event, entry.entity_type, entry.entity_id, JSON.stringify(entry.meta),
      new Date().toISOString(),
      event.eventId,
    ],
  )
}

/** One runDurableSubscriber per audited event type, all sharing the 'audit'
 *  subscriber_name (see runDurableSubscriber's docstring on why that name is
 *  effectively permanent once shipped). */
export function startAuditSubscribers(shopId: string): { stop: () => void } {
  const subscriptions = AUDITED_EVENT_TYPES.map((eventType) =>
    runDurableSubscriber({
      subscriberName: 'audit',
      eventType,
      shopId,
      handler: handleAuditableEvent,
    }),
  )
  return { stop: () => subscriptions.forEach((s) => s.stop()) }
}
