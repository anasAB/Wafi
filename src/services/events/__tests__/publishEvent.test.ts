import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/services/events/publishRateLimiter', () => ({ tryConsumeToken: vi.fn().mockReturnValue(true) }))

import { db } from '@/data/powersync/db'
import { publishEvent, eventPublishFailureCount } from '@/services/events/publishEvent'
import { ExpenseEventType } from '@/services/events/domainEvent.types'
import type { DomainEvent, ExpenseRecordedPayload } from '@/services/events/domainEvent.types'

describe('publishEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const baseEvent: DomainEvent<ExpenseRecordedPayload> = {
    type: ExpenseEventType.Recorded,
    entityId: 'expense-1',
    payload: { expenseId: 'expense-1', category: 'صيانة', amountUsd: 50, staffId: 'staff-1', photoUrl: undefined },
    payloadVersion: 1,
    staffId: 'staff-1',
    shopId: 'shop-1',
    occurredAt: '2026-07-31T00:00:00.000Z',
  }

  it('inserts one row into events with the correct shape', async () => {
    await publishEvent(baseEvent)

    expect(db.execute).toHaveBeenCalledTimes(1)
    const [sql, params] = vi.mocked(db.execute).mock.calls[0]
    expect(sql).toContain('insert into events')
    expect(params).toContain('expense.recorded')
    expect(params).toContain('expense-1')
    expect(params).toContain(JSON.stringify(baseEvent.payload))
    expect(params).toContain(1) // payload_version
    expect(params).toContain('staff-1')
    expect(params).toContain('shop-1')
    expect(params).toContain('2026-07-31T00:00:00.000Z')
  })

  it('includes a created_at distinct from occurred_at (local persist time)', async () => {
    await publishEvent(baseEvent)
    const [, params] = vi.mocked(db.execute).mock.calls[0]
    // created_at is the last param, occurred_at the one before it -- both present, both
    // strings, and -- the actual point of this test -- not the same value.
    expect(typeof params[params.length - 1]).toBe('string')
    expect(typeof params[params.length - 2]).toBe('string')
    expect(params[params.length - 1]).not.toBe(params[params.length - 2])
  })

  it('increments eventPublishFailureCount and does not throw when db.execute rejects', async () => {
    const before = eventPublishFailureCount.value
    vi.mocked(db.execute).mockRejectedValueOnce(new Error('offline'))
    await expect(publishEvent(baseEvent)).resolves.toBeUndefined()
    expect(eventPublishFailureCount.value).toBe(before + 1)
  })

  it('enqueues the failed event for retry instead of only counting it', async () => {
    vi.mocked(db.execute).mockRejectedValueOnce(new Error('database is locked'))
    await publishEvent(baseEvent)
    // second db.execute call (from enqueueForRetry) inserts into the retry table
    const retryCall = vi.mocked(db.execute).mock.calls.find(
      ([sql]) => sql.includes('local_event_publish_retries'),
    )
    expect(retryCall).toBeDefined()
  })

  it('routes a token-bucket rejection to the retry queue as a transient failure, without touching db.execute', async () => {
    const { tryConsumeToken } = await import('@/services/events/publishRateLimiter')
    vi.mocked(tryConsumeToken).mockReturnValueOnce(false)
    await publishEvent(baseEvent)
    expect(db.execute).toHaveBeenCalledTimes(1) // only the retry-queue insert, not the events insert
    const [sql] = vi.mocked(db.execute).mock.calls[0]
    expect(sql).toContain('local_event_publish_retries')
  })

  it('throws synchronously on an oversized payload, before any db.execute call', async () => {
    const bigPayload = { note: 'x'.repeat(20_000) }
    await expect(publishEvent({ ...baseEvent, payload: bigPayload })).rejects.toThrow(/exceeds/)
    expect(db.execute).not.toHaveBeenCalled()
  })

  it('throws synchronously on a NaN/Infinity field, before any db.execute call', async () => {
    const badPayload = { amountUsd: NaN }
    await expect(publishEvent({ ...baseEvent, payload: badPayload })).rejects.toThrow(/non-finite/)
    expect(db.execute).not.toHaveBeenCalled()
  })
})
