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
 * produces no audit entry (WAFI-150 design spec). `meta` is always the verbatim payload
 * -- no transform, enrichment, or revalidation, and no reconstruction of state from a
 * database read. Every mapped entry's `event`/`entity_type` values below mirror the
 * corresponding manual useAuditLog() helper's event-name convention they replace, so
 * the audit log page's existing rendering (which switches on `event`) keeps working
 * unchanged for these rows.
 */
export function mapEventToAuditEntry(event: DomainEvent): AuditLogInsert | null {
  const staffId = event.staffId
  const staffName = 'system' // WAFI-150: the durable subscriber has no session context
  // (unlike useAuditLog()'s _write, which reads useSessionStore().activeStaff?.name at
  // call time) -- staff_name is a display convenience only; staff_id is the actual
  // audit key and is always populated from the event. Revisit if a future reporting
  // view needs the name without a join back to `staff`.

  switch (event.type as DomainEventType) {
    case 'product.cost_updated':
      return { event: 'product.cost_updated', entity_type: 'product', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: event.payload as Record<string, unknown> }
    case 'product.price_changed':
      return { event: 'product.price_changed', entity_type: 'product', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: event.payload as Record<string, unknown> }
    case 'product.created':
      return { event: 'product.created', entity_type: 'product', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: event.payload as Record<string, unknown> }
    case 'device.registered':
      return { event: 'device.registered', entity_type: 'device', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: event.payload as Record<string, unknown> }
    case 'stock.taken':
      return { event: 'stock.taken', entity_type: 'stock_take', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: event.payload as Record<string, unknown> }
    case 'stock.received':
      return { event: 'stock.received', entity_type: 'receiving', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: event.payload as Record<string, unknown> }
    case 'cash.movement_recorded':
      return { event: 'cash.movement_recorded', entity_type: 'cash_movement', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: event.payload as Record<string, unknown> }
    case 'sale.completed':
      return { event: 'sale.completed', entity_type: 'sale', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: event.payload as Record<string, unknown> }
    case 'sale.returned':
      return { event: 'sale.returned', entity_type: 'return', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: event.payload as Record<string, unknown> }
    case 'customer.debt_changed':
      return { event: 'customer.debt_changed', entity_type: 'customer', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: event.payload as Record<string, unknown> }
    case 'installment.due_paid':
      return { event: 'installment.due_paid', entity_type: 'installment_plan', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: event.payload as Record<string, unknown> }
    case 'inventory.adjusted':
      return { event: 'inventory.adjusted', entity_type: 'product', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: event.payload as Record<string, unknown> }
    case 'staff.ledger_entry_added':
      return { event: 'staff_ledger.entry_created', entity_type: 'staff_ledger', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: event.payload as Record<string, unknown> }
    case 'settlement.paid':
      return { event: 'staff_settlement.paid', entity_type: 'staff_settlement', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: event.payload as Record<string, unknown> }
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

async function handleAuditableEvent(event: DurableEvent<unknown>): Promise<void> {
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
