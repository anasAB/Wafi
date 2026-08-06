import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { mapEventToAuditEntry, startAuditSubscribers } from '@/services/events/auditSubscriber'
import type { DomainEvent } from '@/services/events/domainEvent.types'

const baseEvent = {
  entityId: 'p1', payloadVersion: 1, staffId: 's1', shopId: 'shop1',
  occurredAt: '2026-08-05T00:00:00.000Z',
}

describe('mapEventToAuditEntry', () => {
  it('maps device.registered (genuinely new, no legacy event) to an audit_log insert with the verbatim payload as meta', () => {
    const event: DomainEvent = { ...baseEvent, type: 'device.registered', payload: { deviceId: 'd1', deviceCode: 'D-001', isTemporary: false } }
    const entry = mapEventToAuditEntry(event)
    expect(entry).not.toBeNull()
    expect(entry!.event).toBe('device.registered')
    expect(entry!.entity_type).toBe('device')
    expect(entry!.entity_id).toBe('p1')
    expect(entry!.staff_id).toBe('s1')
    expect(entry!.meta).toEqual(event.payload) // verbatim, no transform
  })

  it('returns null for an event type intentionally excluded from audit', () => {
    const event: DomainEvent = { ...baseEvent, type: 'shift.opened', payload: { shiftId: 'sh1', staffId: 's1', openingCash: 0 } }
    expect(mapEventToAuditEntry(event)).toBeNull()
  })

  // Final review I4: product.cost_updated's audit coverage is deferred (not a
  // regression -- it never had a manual audit call before this ticket). audit_log's
  // RLS gate is coarser than events' per-type gate for this type; mapping to null
  // avoids widening cost/margin visibility as a side effect of this subscriber.
  it('returns null for product.cost_updated (final review I4: deferred, RLS gate mismatch)', () => {
    const event: DomainEvent = { ...baseEvent, type: 'product.cost_updated', payload: { productId: 'p1', oldCostUsd: 5, newCostUsd: 6 } }
    expect(mapEventToAuditEntry(event)).toBeNull()
  })

  // Final review C3: these two retirements were reverted -- the domain event payload
  // cannot carry enough information to reproduce the legacy audit_log meta shape
  // (supplier name/line detail; old/new quantities + product name), so the manual
  // useAuditLog() call in inventory.service.ts stays in place and the subscriber is a
  // deliberate no-op for these two types (must not double-log).
  it('returns null for stock.received (final review C3: manual logReceivingCreated call kept)', () => {
    const event: DomainEvent = { ...baseEvent, type: 'stock.received', payload: { receivingId: 'r1', supplierId: 'sup1', skuCount: 1, totalCost: 100 } }
    expect(mapEventToAuditEntry(event)).toBeNull()
  })

  it('returns null for inventory.adjusted (final review C3: manual logStockAdjusted call kept)', () => {
    const event: DomainEvent = { ...baseEvent, type: 'inventory.adjusted', payload: { productId: 'p1', deltaQty: -4, reason: 'stocktake' } }
    expect(mapEventToAuditEntry(event)).toBeNull()
  })

  // Final review C2/C3: these mappings must write the LEGACY audit event string and
  // remap the payload's keys into the shape audit.format.ts's eventLabel() already
  // reads -- not the raw domain event name/payload -- so the existing Arabic audit
  // log UI keeps working for rows the subscriber now generates.
  it('maps sale.returned to legacy return.processed with refundUsd remapped from refundAmountUsd', () => {
    const event: DomainEvent = { ...baseEvent, type: 'sale.returned', payload: { returnId: 'ret1', saleId: 'sale1', refundAmountUsd: 42, restockedItemCount: 2 } }
    const entry = mapEventToAuditEntry(event)
    expect(entry!.event).toBe('return.processed')
    expect(entry!.meta.refundUsd).toBe(42)
  })

  it('maps installment.due_paid to legacy customer.payment_recorded with amountUsd remapped from amount', () => {
    const event: DomainEvent = { ...baseEvent, type: 'installment.due_paid', payload: { customerId: 'c1', amount: 20, remainingBalance: 0 } }
    const entry = mapEventToAuditEntry(event)
    expect(entry!.event).toBe('customer.payment_recorded')
    expect(entry!.meta.amountUsd).toBe(20)
  })

  it('maps stock.taken to legacy stock_take.completed', () => {
    const event: DomainEvent = { ...baseEvent, type: 'stock.taken', payload: { sessionId: 'sess1', productCount: 5, unexplainedVarianceCount: 1 } }
    const entry = mapEventToAuditEntry(event)
    expect(entry!.event).toBe('stock_take.completed')
  })

  it('maps cash.movement_recorded to legacy cash_movement.recorded with amount remapped from amountUsd', () => {
    const event: DomainEvent = { ...baseEvent, type: 'cash.movement_recorded', payload: { movementId: 'm1', shiftId: 'sh1', direction: 'in', category: 'sale', currency: 'USD', amountUsd: 15 } }
    const entry = mapEventToAuditEntry(event)
    expect(entry!.event).toBe('cash_movement.recorded')
    expect(entry!.meta.amount).toBe(15)
  })

  it('maps product.price_changed to old_price/new_price remapped from oldPriceUsd/newPriceUsd', () => {
    const event: DomainEvent = { ...baseEvent, type: 'product.price_changed', payload: { productId: 'p1', oldPriceUsd: 10, newPriceUsd: 12 } }
    const entry = mapEventToAuditEntry(event)
    expect(entry!.event).toBe('product.price_changed')
    expect(entry!.meta.old_price).toBe(10)
    expect(entry!.meta.new_price).toBe(12)
  })

  it('maps every one of the non-excluded, non-deferred event types to a non-null entry', () => {
    const sample: DomainEvent = { ...baseEvent, type: 'expense.recorded', payload: { expenseId: 'e1', category: 'x', amountUsd: 1, staffId: 's1', photoUrl: undefined } }
    expect(mapEventToAuditEntry(sample)).not.toBeNull()
  })
})

describe('startAuditSubscribers', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writing a mapped event once produces exactly one audit_log insert with source_event_id set', async () => {
    // vi.resetModules() before doMock + a dynamic re-import: the static top-level
    // import above already resolved useEventSubscription to the real implementation,
    // so without resetting the module graph, doMock registers too late and this test
    // would drive 15 REAL useEventSubscription subscriptions against db.watch's
    // mock (an eternal async iterator) -- an infinite loop, not a mock handler.
    vi.resetModules()
    let capturedHandler: ((row: any) => Promise<void>) | undefined
    vi.doMock('@/services/events/useEventSubscription', () => ({
      useEventSubscription: vi.fn((_type: string, handler: any) => {
        capturedHandler = handler
        return { stop: vi.fn() }
      }),
    }))
    // resetModules also re-runs the top-of-file db mock factory, producing a fresh
    // set of vi.fn()s -- the stale top-level `db` import no longer points at the
    // instance auditSubscriber.ts will call, so re-import it too.
    const { db: freshDb } = await import('@/data/powersync/db')
    const { startAuditSubscribers: freshStart } = await import('@/services/events/auditSubscriber')
    vi.mocked(freshDb.getOptional).mockResolvedValue(null) // not already processed, not already in audit_log
    freshStart('shop1')
    await capturedHandler!({
      id: 'evt1', type: 'expense.recorded', entity_id: 'e1', payload: { expenseId: 'e1', category: 'x', amountUsd: 1, staffId: 's1' },
      payload_version: 1, staff_id: 's1', shop_id: 'shop1', occurred_at: '2026-08-05T00:00:00.000Z', created_at: '2026-08-05T00:00:00.000Z',
    })
    const auditInsert = vi.mocked(freshDb.execute).mock.calls.find(([sql]) => sql.includes('insert into audit_log'))
    expect(auditInsert).toBeDefined()
    const [, params] = auditInsert!
    expect(params).toContain('evt1') // source_event_id present
  })
})
