import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { defineDeferredSubscriber } from '@/services/events/deferredSubscriber'
import { registerJobHandler, resetJobTypeRegistry } from '@/services/events/jobTypeRegistry'

let capturedHandler: ((row: any) => Promise<void>) | undefined
vi.mock('@/services/events/useEventSubscription', () => ({
  useEventSubscription: vi.fn((_type: string, handler: any) => {
    capturedHandler = handler
    return { stop: vi.fn() }
  }),
}))

const row = {
  id: 'event1', type: 'sale.completed', entity_id: 'sale1', payload: { saleId: 'sale1' },
  payload_version: 2, staff_id: 's1', shop_id: 'shop1',
  occurred_at: '2026-08-12T00:00:00.000Z', created_at: '2026-08-12T00:00:00.000Z',
}

describe('defineDeferredSubscriber', () => {
  beforeEach(() => { vi.clearAllMocks(); capturedHandler = undefined; resetJobTypeRegistry() })

  it('enqueues before returning, and the event flow never executes the job handler directly', async () => {
    registerJobHandler({ jobType: 'test.receipt', handler: vi.fn(), priority: 'normal', requiresNetwork: false, maxQueuedJobs: 200 })
    vi.mocked(db.getOptional).mockResolvedValueOnce(null) // not yet in local_subscriber_processed_events
    defineDeferredSubscriber({
      subscriberName: 'testReceiptSubscriber',
      eventType: 'sale.completed' as any,
      shopId: 'shop1',
      jobType: 'test.receipt',
      toJobPayload: (e: any) => ({ saleId: e.payload.saleId }),
    })
    await capturedHandler!(row)
    const insertCall = vi.mocked(db.execute).mock.calls.find(([sql]) => sql.includes('INSERT INTO local_deferred_jobs'))
    expect(insertCall).toBeDefined()
    const ledgerInsert = vi.mocked(db.execute).mock.calls.find(([sql]) => sql.includes('local_subscriber_processed_events'))
    expect(ledgerInsert).toBeDefined() // marks processed on success, same as runDurableSubscriber
  })

  it('skips a row already recorded in local_subscriber_processed_events for this subscriber (redelivery/restart dedup)', async () => {
    registerJobHandler({ jobType: 'test.receipt', handler: vi.fn(), priority: 'normal', requiresNetwork: false, maxQueuedJobs: 200 })
    vi.mocked(db.getOptional).mockResolvedValueOnce({ event_id: row.id })
    defineDeferredSubscriber({
      subscriberName: 'testReceiptSubscriber',
      eventType: 'sale.completed' as any,
      shopId: 'shop1',
      jobType: 'test.receipt',
      toJobPayload: (e: any) => ({ saleId: e.payload.saleId }),
    })
    await capturedHandler!(row)
    const insertCall = vi.mocked(db.execute).mock.calls.find(([sql]) => sql.includes('INSERT INTO local_deferred_jobs'))
    expect(insertCall).toBeUndefined() // never re-enqueued
  })

  it('on enqueue failure, routes to enqueueForProcessingRetry and does NOT rethrow into the watch loop', async () => {
    registerJobHandler({ jobType: 'test.receipt', handler: vi.fn(), priority: 'critical', requiresNetwork: false, maxQueuedJobs: 200 })
    vi.mocked(db.getOptional).mockResolvedValueOnce(null)
    // Simulate enqueueDeferredJob's underlying writeTransaction throwing (e.g. capacity
    // exhausted with no evictable candidate) by making the mocked db.execute reject on
    // the INSERT statement specifically.
    vi.mocked(db.execute).mockImplementation(((sql: string) => {
      if (sql.includes('INSERT INTO local_deferred_jobs')) return Promise.reject(new Error('capacity exhausted'))
      return Promise.resolve({ rows: { _array: [] } })
    }) as any)

    defineDeferredSubscriber({
      subscriberName: 'testReceiptSubscriber',
      eventType: 'sale.completed' as any,
      shopId: 'shop1',
      jobType: 'test.receipt',
      toJobPayload: (e: any) => ({ saleId: e.payload.saleId }),
    })
    await expect(capturedHandler!(row)).resolves.not.toThrow()
    const retryInsert = vi.mocked(db.execute).mock.calls.find(([sql]) => sql.includes('local_event_processing_retries'))
    expect(retryInsert).toBeDefined()
  })
})
