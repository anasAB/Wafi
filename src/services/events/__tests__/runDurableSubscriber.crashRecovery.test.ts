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
  id: 'event1', type: 'expense.recorded', entity_id: 'e1', payload: { amountUsd: 5 },
  payload_version: 1, staff_id: 's1', shop_id: 'shop1',
  occurred_at: '2026-08-05T00:00:00.000Z', created_at: '2026-08-05T00:00:00.000Z',
}

describe('runDurableSubscriber crash recovery', () => {
  beforeEach(() => { vi.clearAllMocks(); capturedHandler = undefined })

  it('simulates: handler succeeds -> process crashes before ledger write -> retry sees no ledger row -> re-runs handler -> handler itself is idempotent so it does not double-write -> ledger written on the successful retry', async () => {
    // First delivery: not yet processed (ledger empty).
    vi.mocked(db.getOptional).mockResolvedValueOnce(null)
    // Simulate the crash: the handler's own side effect (e.g. the audit insert) succeeds,
    // but something between that and this function's own ledger write throws --
    // simulated here by making db.execute reject on its first call (the ledger insert),
    // after the handler itself has already "succeeded" from this test's point of view.
    const handler = vi.fn().mockResolvedValue(undefined)
    vi.mocked(db.execute).mockRejectedValueOnce(new Error('process crashed'))
    runDurableSubscriber({ subscriberName: 'audit', eventType: 'expense.recorded', shopId: 'shop1', handler })
    await capturedHandler!(row)
    // The failed ledger write should have been caught and routed to the retry queue --
    // not rethrown, and not silently lost.
    expect(handler).toHaveBeenCalledTimes(1)
    const retryInsert = vi.mocked(db.execute).mock.calls.find(([sql]) => sql.includes('local_event_processing_retries'))
    expect(retryInsert).toBeDefined()

    // Second delivery (the retry): still not in the ledger (the crash happened before
    // that write landed). The handler is idempotent (per the invariant docstring) --
    // in the audit subscriber's real implementation this is the check-then-insert
    // against audit_log.source_event_id; here we assert the retry re-invokes the
    // handler and, on success this time, DOES write the ledger.
    vi.mocked(db.getOptional).mockResolvedValueOnce(null)
    vi.clearAllMocks()
    await capturedHandler!(row)
    expect(handler).toHaveBeenCalledTimes(1)
    const ledgerInsert = vi.mocked(db.execute).mock.calls.find(([sql]) => sql.includes('local_subscriber_processed_events'))
    expect(ledgerInsert).toBeDefined()
  })
})
