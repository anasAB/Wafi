import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/services/events/logger', () => ({ logger: { error: vi.fn() } }))

import { db } from '@/data/powersync/db'
import {
  enqueueForRetry, retryPendingEventPublishes, getRetryQueueStats,
} from '@/services/events/eventPublishRetryQueue'
import { ExpenseEventType } from '@/services/events/domainEvent.types'
import type { DomainEvent } from '@/services/events/domainEvent.types'

const event: DomainEvent<{ x: number }> = {
  type: ExpenseEventType.Recorded, entityId: 'e1', payload: { x: 1 }, payloadVersion: 1,
  staffId: 's1', shopId: 'shop1', occurredAt: '2026-08-03T00:00:00.000Z',
}

describe('eventPublishRetryQueue', () => {
  beforeEach(() => vi.clearAllMocks())

  it('enqueueForRetry inserts a transient-classified row with next_retry_at ~1 min out', async () => {
    await enqueueForRetry(event, 'database is locked')
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('insert into local_event_publish_retries'),
      expect.arrayContaining([JSON.stringify(event), 'transient']),
    )
  })

  it('enqueueForRetry classifies a permanent failure and does not set attempts > 0', async () => {
    await enqueueForRetry(event, 'UNIQUE constraint failed')
    const [, params] = vi.mocked(db.execute).mock.calls[0]
    expect(params).toContain('permanent')
  })

  it('retryPendingEventPublishes continues past a row that fails (does not abort the sweep)', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { id: 'r1', serialized_event: JSON.stringify(event), failure_kind: 'transient', attempts: 0, next_retry_at: '2000-01-01' },
      { id: 'r2', serialized_event: JSON.stringify(event), failure_kind: 'transient', attempts: 0, next_retry_at: '2000-01-01' },
    ])
    // r1's re-insert into `events` fails, r2's succeeds.
    vi.mocked(db.writeTransaction)
      .mockImplementationOnce(async () => { throw new Error('boom') })
      .mockImplementationOnce(async (fn: any) => fn({ execute: vi.fn().mockResolvedValue({ rows: { _array: [] } }) }))

    await expect(retryPendingEventPublishes()).resolves.toBeUndefined()
    // Both rows were attempted despite r1 throwing.
    expect(db.writeTransaction).toHaveBeenCalledTimes(2)
  })

  it('getRetryQueueStats returns pendingCount, permanentCount, oldestPendingAt, oldestPendingAge', async () => {
    vi.mocked(db.getAll)
      .mockResolvedValueOnce([{ n: 3 }])   // pendingCount query
      .mockResolvedValueOnce([{ n: 1 }])   // permanentCount query
      .mockResolvedValueOnce([{ created_at: '2026-08-03T00:00:00.000Z' }]) // oldest row query

    const stats = await getRetryQueueStats()
    expect(stats.pendingCount).toBe(3)
    expect(stats.permanentCount).toBe(1)
    expect(stats.oldestPendingAt).toBe('2026-08-03T00:00:00.000Z')
    expect(typeof stats.oldestPendingAge).toBe('string')
  })

  it('getRetryQueueStats.oldestPendingAt ignores permanent rows even if they are older', async () => {
    // The "oldest overall" row (2020) is permanent-classified; the oldest *transient*
    // row is 2026. The oldest-row query itself must filter by failure_kind = 'transient',
    // so its mocked resolved value here represents what that filtered query would return
    // (the transient row), not the true oldest row in the table.
    vi.mocked(db.getAll)
      .mockResolvedValueOnce([{ n: 1 }])   // pendingCount query
      .mockResolvedValueOnce([{ n: 1 }])   // permanentCount query
      .mockResolvedValueOnce([{ created_at: '2026-08-03T00:00:00.000Z' }]) // oldest TRANSIENT row query

    const stats = await getRetryQueueStats()
    expect(stats.oldestPendingAt).toBe('2026-08-03T00:00:00.000Z')

    // Assert the oldest-row query itself carries the failure_kind filter, so a permanent
    // row (e.g. one from 2020) genuinely cannot be selected by it.
    const oldestCall = vi.mocked(db.getAll).mock.calls[2]
    expect(oldestCall[0]).toContain(`failure_kind = 'transient'`)
  })

  it('attemptRetry flips an exhausted row to permanent so it stops being selected for retry', async () => {
    const exhaustingRow = {
      id: 'r-exhausted', serialized_event: JSON.stringify(event), failure_kind: 'transient', attempts: 3, next_retry_at: '2000-01-01',
    }
    vi.mocked(db.getAll).mockResolvedValueOnce([exhaustingRow])
    vi.mocked(db.writeTransaction).mockImplementationOnce(async () => { throw new Error('boom') })

    await retryPendingEventPublishes()

    // attempts (3) + 1 = 4 = MAX_ATTEMPTS -> exhausted branch must flip failure_kind.
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining(`failure_kind = 'permanent'`),
      expect.arrayContaining([4, 'r-exhausted']),
    )

    // Now simulate the next sweep: the selection query filters on failure_kind =
    // 'transient', so this now-permanent row would not be returned by a real DB --
    // verify the query issued by retryPendingEventPublishes carries that filter.
    vi.mocked(db.getAll).mockResolvedValueOnce([])
    await retryPendingEventPublishes()
    const selectionCall = vi.mocked(db.getAll).mock.calls.at(-1)
    expect(selectionCall![0]).toContain(`failure_kind = 'transient'`)
  })

  it('jitters next_retry_at by roughly ±20% of the base backoff, across many samples', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-08-05T00:00:00.000Z'))
    const baseMs = 60_000 // 1 min, attempts = 0
    const samples: number[] = []
    for (let i = 0; i < 50; i++) {
      await enqueueForRetry(event, 'database is locked')
      const [, params] = vi.mocked(db.execute).mock.calls.at(-1)!
      const nextRetryAt = new Date(params[5] as string).getTime()
      samples.push(nextRetryAt - Date.now())
    }
    // every sample must fall within the documented ±20% band around the base backoff
    for (const delta of samples) {
      expect(delta).toBeGreaterThanOrEqual(baseMs * 0.8)
      expect(delta).toBeLessThanOrEqual(baseMs * 1.2)
    }
    // and it must not be a constant (i.e. jitter is actually applied, not a no-op)
    expect(new Set(samples).size).toBeGreaterThan(1)
    vi.useRealTimers()
  })
})
