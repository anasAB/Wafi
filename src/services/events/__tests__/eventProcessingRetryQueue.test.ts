import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import {
  enqueueForProcessingRetry,
  retryPendingEventProcessing,
  startProcessingRetrySweeper,
} from '@/services/events/eventProcessingRetryQueue'
import type { DomainEvent } from '@/services/events/domainEvent.types'

// eventId is not part of the plain DomainEvent shape, but every serialized_event
// actually round-tripped through the retry queue is a DurableEvent (see
// runDurableSubscriber.ts) -- included here to match the real runtime shape this
// module reads eventId off of (final review I2).
const event = {
  type: 'sale.completed', entityId: 'sale1', payload: {}, payloadVersion: 1,
  staffId: 's1', shopId: 'shop1', occurredAt: '2026-08-05T00:00:00.000Z',
  eventId: 'evt1',
} as unknown as DomainEvent

describe('enqueueForProcessingRetry', () => {
  beforeEach(() => vi.clearAllMocks())

  it('classifies a transient error and inserts with subscriber_name', async () => {
    await enqueueForProcessingRetry('audit', event, 'database is locked')
    expect(db.execute).toHaveBeenCalledTimes(1)
    const [sql, params] = vi.mocked(db.execute).mock.calls[0]
    expect(sql).toContain('local_event_processing_retries')
    expect(params).toContain('audit')
    expect(params).toContain('transient')
  })

  it('classifies an unrecognized error as permanent', async () => {
    await enqueueForProcessingRetry('audit', event, 'malformed payload: missing field')
    const [, params] = vi.mocked(db.execute).mock.calls[0]
    expect(params).toContain('permanent')
  })
})

describe('retryPendingEventProcessing', () => {
  beforeEach(() => vi.clearAllMocks())

  it('re-invokes the handler for the matching subscriber_name and deletes the row on success', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { id: 'row1', subscriber_name: 'audit', serialized_event: JSON.stringify(event), failure_kind: 'transient', attempts: 0 },
    ])
    const handler = vi.fn().mockResolvedValue(undefined)
    await retryPendingEventProcessing(new Map([['audit', handler]]))
    expect(handler).toHaveBeenCalledWith(event)
    const deleteCall = vi.mocked(db.execute).mock.calls.find(([sql]) => sql.includes('delete from local_event_processing_retries'))
    expect(deleteCall).toBeDefined()
  })

  it('writes the durable processed-ledger row on a successful retry (final review I2)', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { id: 'row1', subscriber_name: 'audit', serialized_event: JSON.stringify(event), failure_kind: 'transient', attempts: 0 },
    ])
    const handler = vi.fn().mockResolvedValue(undefined)
    await retryPendingEventProcessing(new Map([['audit', handler]]))

    const ledgerInsert = vi.mocked(db.execute).mock.calls.find(
      ([sql]) => sql.includes('insert into local_subscriber_processed_events'),
    )
    expect(ledgerInsert).toBeDefined()
    const [, params] = ledgerInsert!
    expect(params).toContain('audit')
    expect(params).toContain('evt1') // the event's eventId, not the retry row's id
  })

  it('does not write the ledger row when the handler rejects', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { id: 'row1', subscriber_name: 'audit', serialized_event: JSON.stringify(event), failure_kind: 'transient', attempts: 0 },
    ])
    const handler = vi.fn().mockRejectedValue(new Error('still locked'))
    await retryPendingEventProcessing(new Map([['audit', handler]]))

    const ledgerInsert = vi.mocked(db.execute).mock.calls.find(
      ([sql]) => sql.includes('insert into local_subscriber_processed_events'),
    )
    expect(ledgerInsert).toBeUndefined()
  })

  it('leaves the row in place and continues the sweep if the handler rejects again', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { id: 'row1', subscriber_name: 'audit', serialized_event: JSON.stringify(event), failure_kind: 'transient', attempts: 0 },
    ])
    const handler = vi.fn().mockRejectedValue(new Error('still locked'))
    await expect(retryPendingEventProcessing(new Map([['audit', handler]]))).resolves.not.toThrow()
    const updateCall = vi.mocked(db.execute).mock.calls.find(([sql]) => sql.includes('update local_event_processing_retries'))
    expect(updateCall).toBeDefined()
  })
})

describe('startProcessingRetrySweeper', () => {
  beforeEach(() => vi.clearAllMocks())

  it('runs once on start and again on reconnect', () => {
    let capturedListener: any
    vi.mocked(db.registerListener).mockImplementation((listener: any) => {
      capturedListener = listener
      return () => {}
    })
    startProcessingRetrySweeper(new Map())
    expect(db.getAll).toHaveBeenCalled()
    vi.clearAllMocks()
    capturedListener.statusChanged({ connected: true })
    expect(db.getAll).toHaveBeenCalled()
  })

  it('stop() unsubscribes the reconnect listener', () => {
    const unsubscribe = vi.fn()
    vi.mocked(db.registerListener).mockReturnValue(unsubscribe)
    const { stop } = startProcessingRetrySweeper(new Map())
    stop()
    expect(unsubscribe).toHaveBeenCalled()
  })
})
