import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { rebuildLocalTodayRevenueProjection } from '../localTodayRevenueRebuild'

describe('rebuildLocalTodayRevenueProjection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('refuses to rebuild when the local event count does not match the authoritative daily_event_counts row', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ event_projection_day: '2026-08-11' } as any) // shop-local "today" from most recent synced event
      .mockResolvedValueOnce({ n: 3 } as any)   // local COUNT(*) of sale.completed events for today
      .mockResolvedValueOnce({ count: 5 } as any) // authoritative daily_event_counts row says 5
    const result = await rebuildLocalTodayRevenueProjection('shop-1')
    expect(result).toEqual({ status: 'coverage_unavailable', reason: expect.stringContaining('coverage') })
    expect(db.execute).not.toHaveBeenCalled()
  })

  it('refuses to rebuild when the authoritative daily_event_counts row is missing (not treated as zero)', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ event_projection_day: '2026-08-11' } as any)
      .mockResolvedValueOnce({ n: 0 } as any)
      .mockResolvedValueOnce(null as any) // no synced row for today yet
    const result = await rebuildLocalTodayRevenueProjection('shop-1')
    expect(result).toEqual({ status: 'coverage_unavailable', reason: expect.stringContaining('coverage') })
  })

  it('refuses to rebuild when a local event in scope lacks a server-assigned sequence', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ event_projection_day: '2026-08-11' } as any)
      .mockResolvedValueOnce({ n: 2 } as any)
      .mockResolvedValueOnce({ count: 2 } as any)
      .mockResolvedValueOnce({ n: 1 } as any) // one of the 2 events has sequence IS NULL
    const result = await rebuildLocalTodayRevenueProjection('shop-1')
    expect(result).toEqual({ status: 'coverage_unavailable', reason: expect.stringContaining('sequence') })
    expect(db.execute).not.toHaveBeenCalled()
  })

  it('rebuilds successfully when coverage passes: replays events in sequence order, writes the projection and ledger inside one writeTransaction', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ event_projection_day: '2026-08-11' } as any) // shop-local "today"
      .mockResolvedValueOnce({ n: 2 } as any)      // local count matches
      .mockResolvedValueOnce({ count: 2 } as any)  // authoritative count matches
      .mockResolvedValueOnce({ n: 0 } as any)      // no unsequenced events
      .mockResolvedValueOnce(null as any)          // existing local projection row lookup -- none yet
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { id: 'e1', payload: JSON.stringify({ totalUsd: 10, totalSyp: 1500 }), sequence: 100 },
      { id: 'e2', payload: JSON.stringify({ totalUsd: 5, totalSyp: 750 }), sequence: 101 },
    ] as any)
    const txExecute = vi.fn()
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => fn({ execute: txExecute }))

    const result = await rebuildLocalTodayRevenueProjection('shop-1')

    expect(result).toEqual({ status: 'success', revenueUsd: 15, revenueSyp: 2250 })
    // The mutation (projection write + both ledger entries) happens inside the
    // single writeTransaction call, on the transaction handle -- not via
    // db.execute directly. This is what gives the client rebuild the
    // "runs inside an exclusive local transaction" property the design spec
    // requires (Client-Side Implementation, "Client-side concurrency").
    expect(db.writeTransaction).toHaveBeenCalledTimes(1)
    expect(db.execute).not.toHaveBeenCalled()
    const insertCalls = txExecute.mock.calls.filter(([sql]) => sql.toLowerCase().includes('insert into local_today_revenue_projection'))
    expect(insertCalls).toHaveLength(1)
    expect(insertCalls[0][1]).toContain(15)
    expect(insertCalls[0][1]).toContain(2250)
    const ledgerCalls = txExecute.mock.calls.filter(([sql]) => sql.toLowerCase().includes('insert into local_event_processed_ledger'))
    expect(ledgerCalls).toHaveLength(2)
  })

  it('a failure partway through the transaction leaves the local projection and ledger untouched (rollback, via writeTransaction rejecting)', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ event_projection_day: '2026-08-11' } as any)
      .mockResolvedValueOnce({ n: 1 } as any)
      .mockResolvedValueOnce({ count: 1 } as any)
      .mockResolvedValueOnce({ n: 0 } as any)
      .mockResolvedValueOnce(null as any)
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { id: 'e1', payload: JSON.stringify({ totalUsd: 10, totalSyp: 1500 }), sequence: 100 },
    ] as any)
    // Simulate the transaction failing partway through (e.g. a disk error on
    // the ledger insert) -- writeTransaction's real implementation rolls back
    // everything in that transaction automatically; this test only needs to
    // confirm the function propagates that failure rather than swallowing it
    // and reporting false success.
    vi.mocked(db.writeTransaction).mockRejectedValueOnce(new Error('simulated write failure'))

    await expect(rebuildLocalTodayRevenueProjection('shop-1')).rejects.toThrow('simulated write failure')
  })
})
