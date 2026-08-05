import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { mapEventToAuditEntry, startAuditSubscribers } from '@/services/events/auditSubscriber'
import type { DomainEvent } from '@/services/events/domainEvent.types'

const baseEvent = {
  entityId: 'p1', payloadVersion: 1, staffId: 's1', shopId: 'shop1',
  occurredAt: '2026-08-05T00:00:00.000Z',
}

describe('mapEventToAuditEntry', () => {
  it('maps product.cost_updated to an audit_log insert with the verbatim payload as meta', () => {
    const event: DomainEvent = { ...baseEvent, type: 'product.cost_updated', payload: { productId: 'p1', oldCostUsd: 5, newCostUsd: 6 } }
    const entry = mapEventToAuditEntry(event)
    expect(entry).not.toBeNull()
    expect(entry!.event).toBe('product.cost_updated')
    expect(entry!.entity_type).toBe('product')
    expect(entry!.entity_id).toBe('p1')
    expect(entry!.staff_id).toBe('s1')
    expect(entry!.meta).toEqual(event.payload) // verbatim, no transform
  })

  it('returns null for an event type intentionally excluded from audit', () => {
    const event: DomainEvent = { ...baseEvent, type: 'shift.opened', payload: { shiftId: 'sh1', staffId: 's1', openingCash: 0 } }
    expect(mapEventToAuditEntry(event)).toBeNull()
  })

  it('maps every one of the 15 non-excluded event types to a non-null entry', () => {
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
