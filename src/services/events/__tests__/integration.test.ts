// Two-hop pipeline test (WAFI-140 Sprint 1 final review, finding 9).
//
// Every other test in this module mocks at a single boundary, so nothing proved
// that publishEvent's OUTPUT matches useEventSubscription's INPUT assumption.
// This test closes that gap: it runs the real publishEvent, captures the exact
// SQL params it produced, builds the events row those params describe, and
// parses it the way the subscription's row-parsing code does. It is the test
// that would have caught the jsonb/text double-encoding bug (Critical 1) —
// payload must round-trip serialize -> store -> parse back to an object.
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { publishEvent } from '@/services/events/publishEvent'
import { SalesEventType } from '@/services/events/domainEvent.types'
import type { DomainEvent, SaleCompletedPayload } from '@/services/events/domainEvent.types'
import type { EventRow } from '@/services/events/useEventSubscription'

const event: DomainEvent<SaleCompletedPayload> = {
  type: SalesEventType.Completed,
  entityId: 'sale-1',
  payload: {
    saleId: 'sale-1',
    shopId: 'shop-1',
    staffId: 'staff-1',
    totalUsd: 120.5,
    totalSyp: 1_500_000,
    paymentSummary: { cashUsd: 100, cashSyp: 250_000, cardTotal: 0, creditTotal: 0, methodCount: 2 },
    itemCount: 3,
    discountApplied: true,
  },
  payloadVersion: 1,
  staffId: 'staff-1',
  shopId: 'shop-1',
  occurredAt: '2026-07-31T10:00:00.000Z',
}

describe('event bus pipeline: publishEvent -> events row -> subscription parse', () => {
  beforeEach(() => vi.clearAllMocks())

  it('round-trips the payload: what publishEvent writes is what a subscriber parses back', async () => {
    await publishEvent(event)

    const [sql, params] = vi.mocked(db.execute).mock.calls[0]
    // Column order from publishEvent's INSERT, used to build the row the way
    // PowerSync would hand it back — not independently hand-written literals.
    const columns = sql
      .slice(sql.indexOf('(') + 1, sql.indexOf(')'))
      .split(',')
      .map((c) => c.trim())
    expect(columns).toEqual([
      'id', 'type', 'entity_id', 'payload', 'payload_version',
      'staff_id', 'shop_id', 'occurred_at', 'created_at',
    ])

    const row: Record<string, unknown> = {}
    columns.forEach((col, i) => { row[col] = (params as unknown[])[i] })

    // The payload column must hold a JSON *string* (the client/TEXT-column
    // convention, migration 074 + audit_log.meta precedent) — not an object.
    expect(typeof row.payload).toBe('string')

    // Exactly what useEventSubscription's row-parsing code does.
    const parsed: EventRow<SaleCompletedPayload> = {
      ...(row as any),
      payload: JSON.parse(row.payload as string),
      payload_version: row.payload_version as number,
    }

    expect(parsed.payload).toEqual(event.payload)
    expect(typeof parsed.payload).toBe('object')
    expect(parsed.payload.paymentSummary.cashSyp).toBe(250_000)
    expect(parsed.type).toBe(SalesEventType.Completed)
    expect(parsed.entity_id).toBe('sale-1')
    expect(parsed.payload_version).toBe(1)
    expect(parsed.shop_id).toBe('shop-1')
    expect(parsed.staff_id).toBe('staff-1')
    expect(parsed.occurred_at).toBe('2026-07-31T10:00:00.000Z')
    expect(typeof parsed.id).toBe('string')
    expect(parsed.id).not.toBe('')
  })
})
