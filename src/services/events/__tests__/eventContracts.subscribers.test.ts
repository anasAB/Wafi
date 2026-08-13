// WAFI-157 Event Contract Testing. Runs the ONE canonical fixture per event type
// (eventContractFixtures.ts) through every real, registered subscriber -- so a
// producer renaming/removing a field is caught here even when it doesn't throw.
//
// Two tiers, per the approved design:
//   Level 1 (structural) -- the subscriber can consume the fixture and produces a
//     result matching its OWN minimal contract (not a generic "is defined" check),
//     or an explicitly-expected null.
//   Level 2 (semantic)   -- a handful of targeted assertions on business values that
//     would silently regress even if Level 1 passed (e.g. a value fell back to a
//     default instead of throwing). NOT a full output snapshot -- see design notes.
//
// Plus a consumer-completeness check: every DomainEventType must have >=1 consumer
// among the event-type lists each subscriber module already exports for its own
// purposes, or be explicitly listed in DORMANT_EVENTS (eventContractFixtures.ts).
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/services/notifications/notificationSettings')

import { db } from '@/data/powersync/db'
import { getNotificationSettings } from '@/services/notifications/notificationSettings'
import { FIXTURES, DORMANT_EVENTS } from './eventContractFixtures'
import { mapEventToAuditEntry, AUDITED_EVENT_TYPES } from '@/services/events/auditSubscriber'
import { mapEventToNotification, NOTIFIED_EVENT_TYPES } from '@/services/events/notificationSubscriber'
import { startDashboardRevenueProjection, DASHBOARD_PROJECTION_EVENT_TYPES } from '@/services/events/dashboardRevenueProjection'
import { startProfitCacheProjection, PROFIT_CACHE_PROJECTION_EVENT_TYPES } from '@/services/events/profitCacheProjection'
import { startDailyEventCountsProjection, DAILY_EVENT_COUNTS_EVENT_TYPES } from '@/services/events/dailyEventCountsProjection'
import type { DomainEvent, DomainEventType } from '@/services/events/domainEvent.types'

function fakeAsyncIterable(results: unknown[]) {
  let i = 0
  return {
    [Symbol.asyncIterator]: () => ({
      next: async () => (i < results.length ? { value: results[i++], done: false } : { value: undefined, done: true }),
      return: async () => ({ value: undefined, done: true }),
    }),
  }
}

function toDbRow(event: DomainEvent, id: string) {
  return {
    id, type: event.type, entity_id: event.entityId,
    payload: JSON.stringify(event.payload), payload_version: event.payloadVersion,
    staff_id: event.staffId, shop_id: event.shopId,
    occurred_at: event.occurredAt, created_at: event.occurredAt,
  }
}

// --- Consumer completeness -------------------------------------------------

describe('event consumer completeness', () => {
  const CONSUMER_EVENT_TYPES = new Set<DomainEventType>([
    ...AUDITED_EVENT_TYPES,
    ...NOTIFIED_EVENT_TYPES,
    ...DASHBOARD_PROJECTION_EVENT_TYPES,
    ...PROFIT_CACHE_PROJECTION_EVENT_TYPES,
    ...DAILY_EVENT_COUNTS_EVENT_TYPES,
  ])

  it.each(Object.keys(FIXTURES) as DomainEventType[])('%s has a registered consumer or is explicitly dormant', (type) => {
    const hasConsumer = CONSUMER_EVENT_TYPES.has(type)
    const isDormant = (DORMANT_EVENTS as readonly string[]).includes(type)
    expect(hasConsumer || isDormant).toBe(true)
  })
})

// --- audit subscriber (Level 1 + Level 2) ----------------------------------

describe('mapEventToAuditEntry against canonical fixtures', () => {
  // Audited event types whose mapping deliberately returns null (see
  // auditSubscriber.ts's switch for the per-type rationale -- not repeated here).
  const EXPECTED_NULL: DomainEventType[] = ['product.cost_updated', 'stock.received', 'inventory.adjusted']

  it.each(Object.entries(FIXTURES))('%s: does not throw', (_type, fixture) => {
    expect(() => mapEventToAuditEntry(fixture)).not.toThrow()
  })

  it.each(AUDITED_EVENT_TYPES.filter((t) => !EXPECTED_NULL.includes(t)))(
    '%s: produces a well-shaped audit row (Level 1)',
    (type) => {
      const entry = mapEventToAuditEntry(FIXTURES[type])
      expect(entry).not.toBeNull()
      expect(entry!.event).toBeTruthy()
      expect(entry!.entity_type).toBeTruthy()
      expect(entry!.staff_id).toBeTruthy()
      expect(entry!.meta).toBeTypeOf('object')
    },
  )

  it.each(EXPECTED_NULL)('%s: is an explicitly-expected null mapping', (type) => {
    expect(mapEventToAuditEntry(FIXTURES[type])).toBeNull()
  })

  it('sale.completed: preserves totalUsd/cogsUsd verbatim into audit meta (Level 2)', () => {
    const entry = mapEventToAuditEntry(FIXTURES['sale.completed'])!
    const payload = FIXTURES['sale.completed'].payload as { totalUsd: number; cogsUsd: number }
    expect((entry.meta as any).totalUsd).toBe(payload.totalUsd)
    expect((entry.meta as any).cogsUsd).toBe(payload.cogsUsd)
  })
})

// --- notification subscriber (Level 1 + Level 2) ---------------------------

describe('mapEventToNotification against canonical fixtures', () => {
  beforeEach(() => {
    vi.mocked(getNotificationSettings).mockResolvedValue({
      type: 'discount.large_applied', discountPercentCap: 30, enabled: true,
    })
  })

  it.each(Object.entries(FIXTURES))('%s: does not throw', async (_type, fixture) => {
    await expect(mapEventToNotification(fixture)).resolves.toBeDefined()
  })

  it('sale.completed: unrelated event type maps to null (protects the mapping boundary)', async () => {
    expect(await mapEventToNotification(FIXTURES['sale.completed'])).toBeNull()
  })

  it('sale.discounted below-cost variant maps to a CRITICAL notification (Level 2)', async () => {
    const belowCost: DomainEvent = {
      ...FIXTURES['sale.discounted'],
      payload: { ...(FIXTURES['sale.discounted'].payload as object), belowCost: true },
    }
    const entry = await mapEventToNotification(belowCost)
    expect(entry).not.toBeNull()
    expect(entry!.severity).toBe('CRITICAL')
  })

  it('canonical sale.discounted fixture (not below-cost, not over cap) maps to null', async () => {
    expect(await mapEventToNotification(FIXTURES['sale.discounted'])).toBeNull()
  })
})

// --- lightweight projections (Level 1 + Level 2, via existing db.watch mock pattern) ---

describe('startDashboardRevenueProjection against the canonical sale.completed fixture', () => {
  beforeEach(() => vi.clearAllMocks())

  it('folds totalUsd/totalSyp from the fixture into local_today_revenue_projection unchanged', async () => {
    const fixture = FIXTURES['sale.completed']
    vi.mocked(db.getOptional).mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    vi.mocked(db.watch).mockReturnValue(fakeAsyncIterable([{ rows: { _array: [toDbRow(fixture, 'evt1')] } }]) as any)

    startDashboardRevenueProjection(fixture.shopId)
    await new Promise((r) => setTimeout(r, 0))

    const insertCall = vi.mocked(db.execute).mock.calls.find(([sql]) => sql.toLowerCase().includes('insert into local_today_revenue_projection'))
    expect(insertCall).toBeDefined()
    const payload = fixture.payload as { totalUsd: number; totalSyp: number }
    expect(insertCall![1]).toContain(payload.totalUsd)
    expect(insertCall![1]).toContain(payload.totalSyp)
  })
})

describe('startProfitCacheProjection against canonical fixtures (marker-only, no metric values)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writes a source_event_id marker for the canonical sale.completed fixture', async () => {
    const fixture = FIXTURES['sale.completed']
    vi.mocked(db.getOptional).mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    vi.mocked(db.watch)
      .mockReturnValueOnce(fakeAsyncIterable([{ rows: { _array: [toDbRow(fixture, 'evt1')] } }]) as any)
      .mockReturnValueOnce(fakeAsyncIterable([]) as any)
      .mockReturnValueOnce(fakeAsyncIterable([]) as any)

    startProfitCacheProjection(fixture.shopId)
    await new Promise((r) => setTimeout(r, 0))

    const insertCall = vi.mocked(db.execute).mock.calls.find(([sql]) => sql.toLowerCase().includes('insert into profit_cache'))
    expect(insertCall).toBeDefined()
    expect(insertCall![1]).toContain('evt1')
  })
})

describe('startDailyEventCountsProjection against the canonical sale.completed fixture', () => {
  beforeEach(() => vi.clearAllMocks())

  it('counts the canonical sale.completed fixture into daily_event_counts', async () => {
    const fixture = FIXTURES['sale.completed']
    vi.mocked(db.getOptional).mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    vi.mocked(db.watch).mockReturnValue(fakeAsyncIterable([{ rows: { _array: [toDbRow(fixture, 'evt1')] } }]) as any)

    startDailyEventCountsProjection(fixture.shopId)
    await new Promise((r) => setTimeout(r, 0))

    const insertCall = vi.mocked(db.execute).mock.calls.find(([sql]) => sql.toLowerCase().includes('insert into daily_event_counts'))
    expect(insertCall).toBeDefined()
  })
})
