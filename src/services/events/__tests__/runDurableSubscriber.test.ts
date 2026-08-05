import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { runDurableSubscriber } from '@/services/events/runDurableSubscriber'

let capturedHandler: ((row: any) => Promise<void>) | undefined
vi.mock('@/services/events/useEventSubscription', () => ({
  useEventSubscription: vi.fn((_type: string, handler: any) => {
    capturedHandler = handler
    return { stop: vi.fn() }
  }),
}))

const row = {
  id: 'event1', type: 'sale.completed', entity_id: 'sale1', payload: {},
  payload_version: 1, staff_id: 's1', shop_id: 'shop1',
  occurred_at: '2026-08-05T00:00:00.000Z', created_at: '2026-08-05T00:00:00.000Z',
}

describe('runDurableSubscriber', () => {
  beforeEach(() => { vi.clearAllMocks(); capturedHandler = undefined })

  it('skips a row already in local_subscriber_processed_events for this subscriber', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({ event_id: row.id })
    const handler = vi.fn()
    runDurableSubscriber({ subscriberName: 'audit', eventType: 'sale.completed', shopId: 'shop1', handler })
    await capturedHandler!(row)
    expect(handler).not.toHaveBeenCalled()
  })

  it('passes eventId (the events.id row, not entityId) through to the handler', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce(null)
    const handler = vi.fn().mockResolvedValue(undefined)
    runDurableSubscriber({ subscriberName: 'audit', eventType: 'sale.completed', shopId: 'shop1', handler })
    await capturedHandler!(row)
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ eventId: row.id, entityId: row.entity_id }))
  })

  it('on success, writes the processed ledger and never touches the retry table', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce(null)
    const handler = vi.fn().mockResolvedValue(undefined)
    runDurableSubscriber({ subscriberName: 'audit', eventType: 'sale.completed', shopId: 'shop1', handler })
    await capturedHandler!(row)
    const ledgerInsert = vi.mocked(db.execute).mock.calls.find(([sql]) => sql.includes('local_subscriber_processed_events'))
    expect(ledgerInsert).toBeDefined()
    const retryInsert = vi.mocked(db.execute).mock.calls.find(([sql]) => sql.includes('local_event_processing_retries'))
    expect(retryInsert).toBeUndefined()
  })

  it('on a transient failure, enqueues a retry and does NOT write the processed ledger', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce(null)
    const handler = vi.fn().mockRejectedValue(new Error('database is locked'))
    runDurableSubscriber({ subscriberName: 'audit', eventType: 'sale.completed', shopId: 'shop1', handler })
    await capturedHandler!(row)
    const retryInsert = vi.mocked(db.execute).mock.calls.find(([sql]) => sql.includes('local_event_processing_retries'))
    expect(retryInsert).toBeDefined()
    const [, params] = retryInsert!
    expect(params).toContain('transient')
    const ledgerInsert = vi.mocked(db.execute).mock.calls.find(([sql]) => sql.includes('local_subscriber_processed_events'))
    expect(ledgerInsert).toBeUndefined()
  })

  it('on a permanent failure, enqueues a permanent retry row and does not throw back into useEventSubscription', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce(null)
    const handler = vi.fn().mockRejectedValue(new Error('malformed payload'))
    runDurableSubscriber({ subscriberName: 'audit', eventType: 'sale.completed', shopId: 'shop1', handler })
    await expect(capturedHandler!(row)).resolves.not.toThrow()
    const retryInsert = vi.mocked(db.execute).mock.calls.find(([sql]) => sql.includes('local_event_processing_retries'))
    const [, params] = retryInsert!
    expect(params).toContain('permanent')
  })
})
