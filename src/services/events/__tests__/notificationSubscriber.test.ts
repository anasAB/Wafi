import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/services/notifications/notificationSettings')

import { db } from '@/data/powersync/db'
import { getNotificationSettings } from '@/services/notifications/notificationSettings'
import { mapEventToNotification, startNotificationSubscribers } from '@/services/events/notificationSubscriber'
import type { DomainEvent } from '@/services/events/domainEvent.types'

const baseEvent = {
  entityId: 'sale1', payloadVersion: 1, staffId: 's1', shopId: 'shop1',
  occurredAt: '2026-08-06T00:00:00.000Z',
}

describe('mapEventToNotification', () => {
  beforeEach(() => {
    vi.mocked(getNotificationSettings).mockResolvedValue({
      type: 'discount.large_applied', discountPercentCap: 30, enabled: true,
    })
  })

  it('maps a below-cost sale.discounted event to a CRITICAL notification', async () => {
    const event: DomainEvent = {
      ...baseEvent, type: 'sale.discounted',
      payload: { discountType: 'percent', discountValue: 40, discountPercentage: 40, finalPriceUsd: 6, belowCost: true, pinApproval: false },
    }
    const entry = await mapEventToNotification(event)
    expect(entry).not.toBeNull()
    expect(entry!.severity).toBe('CRITICAL')
    expect(entry!.entity_type).toBe('sale')
    expect(entry!.entity_id).toBe('sale1')
    expect(entry!.recipient_role).toBe('owner')
  })

  it('maps a PIN-approved (but not below-cost) sale.discounted event to a WARNING notification', async () => {
    const event: DomainEvent = {
      ...baseEvent, type: 'sale.discounted',
      payload: { discountType: 'fixed', discountValue: 5, finalPriceUsd: 20, belowCost: false, pinApproval: true },
    }
    const entry = await mapEventToNotification(event)
    expect(entry).not.toBeNull()
    expect(entry!.severity).toBe('WARNING')
  })

  it('returns null for a sale.discounted event that is neither below-cost nor PIN-approved', async () => {
    const event: DomainEvent = {
      ...baseEvent, type: 'sale.discounted',
      payload: { discountType: 'percent', discountValue: 5, discountPercentage: 5, finalPriceUsd: 19, belowCost: false, pinApproval: false },
    }
    expect(await mapEventToNotification(event)).toBeNull()
  })

  it('returns null for an unrelated event type (protects the mapping boundary)', async () => {
    const event: DomainEvent = {
      ...baseEvent, type: 'sale.completed',
      payload: { saleId: 'sale1', shopId: 'shop1', staffId: 's1', totalUsd: 10, totalSyp: 150000, paymentSummary: { cashUsd: 10, cashSyp: 0, cardTotal: 0, creditTotal: 0, methodCount: 1 }, itemCount: 1, discountApplied: false },
    }
    expect(await mapEventToNotification(event)).toBeNull()
  })

  it('fires WARNING when discount % exceeds the configured cap, even without belowCost/pinApproval', async () => {
    vi.mocked(getNotificationSettings).mockResolvedValue({
      type: 'discount.large_applied', discountPercentCap: 20, enabled: true,
    })
    const event = {
      type: 'sale.discounted', entityId: 'sale1', staffId: 's1', shopId: 'shop1',
      occurredAt: '2026-01-01T00:00:00.000Z', payloadVersion: 1,
      payload: { discountType: 'percent', discountValue: 25, discountPercentage: 25, finalPriceUsd: 10, belowCost: false, pinApproval: false },
    } as any
    const entry = await mapEventToNotification(event)
    expect(entry?.severity).toBe('WARNING')
  })

  it('returns null when the rule is disabled, even if belowCost is true', async () => {
    vi.mocked(getNotificationSettings).mockResolvedValue({
      type: 'discount.large_applied', discountPercentCap: 30, enabled: false,
    })
    const event: DomainEvent = {
      ...baseEvent, type: 'sale.discounted',
      payload: { discountType: 'percent', discountValue: 40, discountPercentage: 40, finalPriceUsd: 6, belowCost: true, pinApproval: false },
    }
    expect(await mapEventToNotification(event)).toBeNull()
  })

  it('does not coerce an undefined discountPercentage (fixed-amount discount) into the cap comparison', async () => {
    vi.mocked(getNotificationSettings).mockResolvedValue({
      type: 'discount.large_applied', discountPercentCap: 5, enabled: true,
    })
    const event: DomainEvent = {
      ...baseEvent, type: 'sale.discounted',
      payload: { discountType: 'fixed', discountValue: 50, finalPriceUsd: 20, belowCost: false, pinApproval: false },
    }
    expect(await mapEventToNotification(event)).toBeNull()
  })
})

describe('startNotificationSubscribers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getNotificationSettings).mockResolvedValue({
      type: 'discount.large_applied', discountPercentCap: 30, enabled: true,
    })
  })

  it('writing a below-cost discount once produces exactly one notifications insert with source_event_id set', async () => {
    // See Global Constraints' "known footgun" note -- resetModules BEFORE doMock +
    // dynamic re-import, and re-import db fresh too, exactly like
    // auditSubscriber.test.ts's equivalent test.
    vi.resetModules()
    let capturedHandler: ((row: any) => Promise<void>) | undefined
    vi.doMock('@/services/events/useEventSubscription', () => ({
      useEventSubscription: vi.fn((_type: string, handler: any) => {
        capturedHandler = handler
        return { stop: vi.fn() }
      }),
    }))
    const { db: freshDb } = await import('@/data/powersync/db')
    const { startNotificationSubscribers: freshStart } = await import('@/services/events/notificationSubscriber')
    vi.mocked(freshDb.getOptional).mockResolvedValue(null)
    freshStart('shop1')
    await capturedHandler!({
      id: 'evt1', type: 'sale.discounted', entity_id: 'sale1',
      payload: { discountType: 'percent', discountValue: 40, discountPercentage: 40, finalPriceUsd: 6, belowCost: true, pinApproval: false },
      payload_version: 1, staff_id: 's1', shop_id: 'shop1', occurred_at: '2026-08-06T00:00:00.000Z', created_at: '2026-08-06T00:00:00.000Z',
    })
    const insertCall = vi.mocked(freshDb.execute).mock.calls.find(([sql]) => sql.includes('insert into notifications'))
    expect(insertCall).toBeDefined()
    expect(insertCall![1]).toContain('evt1') // source_event_id present
  })

  it('redelivering the same event does not duplicate the notification (idempotency)', async () => {
    vi.resetModules()
    let capturedHandler: ((row: any) => Promise<void>) | undefined
    vi.doMock('@/services/events/useEventSubscription', () => ({
      useEventSubscription: vi.fn((_type: string, handler: any) => {
        capturedHandler = handler
        return { stop: vi.fn() }
      }),
    }))
    const { db: freshDb } = await import('@/data/powersync/db')
    const { startNotificationSubscribers: freshStart } = await import('@/services/events/notificationSubscriber')
    // First delivery: not yet processed, not yet in notifications.
    vi.mocked(freshDb.getOptional).mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    // Second (redelivered) call: runDurableSubscriber's own processed-ledger check will
    // short-circuit before this handler's own dedup lookup even runs -- but assert on
    // the OUTCOME (one insert total), not on which specific guard caught it, since
    // that's an implementation detail of runDurableSubscriber, not this subscriber.
    freshStart('shop1')
    const row = {
      id: 'evt1', type: 'sale.discounted', entity_id: 'sale1',
      payload: { discountType: 'percent', discountValue: 40, discountPercentage: 40, finalPriceUsd: 6, belowCost: true, pinApproval: false },
      payload_version: 1, staff_id: 's1', shop_id: 'shop1', occurred_at: '2026-08-06T00:00:00.000Z', created_at: '2026-08-06T00:00:00.000Z',
    }
    await capturedHandler!(row)
    vi.mocked(freshDb.getOptional).mockResolvedValue({ event_id: 'evt1' }) // now "already processed"
    await capturedHandler!(row)
    const inserts = vi.mocked(freshDb.execute).mock.calls.filter(([sql]) => sql.includes('insert into notifications'))
    expect(inserts).toHaveLength(1)
  })
})
