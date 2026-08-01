import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

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
    // created_at is the last param, occurred_at the one before it -- both present, both strings.
    expect(typeof params[params.length - 1]).toBe('string')
    expect(typeof params[params.length - 2]).toBe('string')
  })

  it('increments eventPublishFailureCount and does not throw when db.execute rejects', async () => {
    const before = eventPublishFailureCount.value
    vi.mocked(db.execute).mockRejectedValueOnce(new Error('offline'))
    await expect(publishEvent(baseEvent)).resolves.toBeUndefined()
    expect(eventPublishFailureCount.value).toBe(before + 1)
  })
})
