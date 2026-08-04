// src/services/events/__tests__/dailyEventCountsProjection.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { startDailyEventCountsProjection } from '@/services/events/dailyEventCountsProjection'

function fakeAsyncIterable(results: any[]) {
  let i = 0
  return {
    [Symbol.asyncIterator]: () => ({
      next: async () => i < results.length
        ? { value: results[i++], done: false }
        : { value: undefined, done: true },
      return: async () => ({ value: undefined, done: true }),
    }),
  }
}

describe('startDailyEventCountsProjection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('inserts a new daily_event_counts row (with an explicit id) when none exists for the day', async () => {
    // Call order per row: 1) ledger check (no existing ledger row) 2) the
    // projection's own existing-row lookup (none for the day either).
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce(null as any) // ledger check
      .mockResolvedValueOnce(null as any) // daily_event_counts existing-row lookup
    vi.mocked(db.watch).mockReturnValue(fakeAsyncIterable([
      { rows: { _array: [{
        id: 'e1', type: 'sale.completed', entity_id: 'sale-1',
        payload: JSON.stringify({ saleId: 'sale-1' }), payload_version: 1,
        staff_id: 's1', shop_id: 'shop-1', occurred_at: '2026-07-31T10:00:00.000Z', created_at: '2026-07-31T10:00:00.000Z',
      }] } },
    ]) as any)

    const { stop } = startDailyEventCountsProjection('shop-1')
    await new Promise((r) => setTimeout(r, 0))

    // Ledger check first, then the projection's own lookup (no ON CONFLICT:
    // PowerSync local tables are views).
    const [ledgerSelectSql] = vi.mocked(db.getOptional).mock.calls[0]
    expect(ledgerSelectSql.toLowerCase()).toContain('select subscriber_id from local_event_processed_ledger')
    const [selectSql, selectParams] = vi.mocked(db.getOptional).mock.calls[1]
    expect(selectSql.toLowerCase()).toContain('select id, count from daily_event_counts')
    expect(selectParams).toEqual(['shop-1', 'sale.completed', '2026-07-31'])

    // 2, not 1: the WAFI-140 Sprint 2 ledger guard now issues its own
    // execute (the local_event_processed_ledger insert) before the real write.
    expect(db.execute).toHaveBeenCalledTimes(2)
    const [ledgerSql] = vi.mocked(db.execute).mock.calls[0]
    expect(ledgerSql.toLowerCase()).toContain('insert into local_event_processed_ledger')
    const [sql, params] = vi.mocked(db.execute).mock.calls[1]
    expect(sql.toLowerCase()).toContain('insert into daily_event_counts')
    expect(sql.toLowerCase()).not.toContain('on conflict')
    expect(typeof (params as unknown[])[0]).toBe('string') // explicit generated id
    expect(params).toContain('shop-1')
    expect(params).toContain('sale.completed')
    expect(params).toContain('2026-07-31') // day, derived from occurred_at

    stop()
  })

  it('increments the existing row count when one already exists for the day', async () => {
    // Ledger check finds nothing (first time processing this event); the
    // projection's own lookup finds the existing daily_event_counts row.
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce(null as any) // ledger check
      .mockResolvedValueOnce({ id: 'row-1', count: 4 } as any) // daily_event_counts existing-row lookup
    vi.mocked(db.watch).mockReturnValue(fakeAsyncIterable([
      { rows: { _array: [{
        id: 'e1', type: 'sale.completed', entity_id: 'sale-1',
        payload: JSON.stringify({ saleId: 'sale-1' }), payload_version: 1,
        staff_id: 's1', shop_id: 'shop-1', occurred_at: '2026-07-31T10:00:00.000Z', created_at: '2026-07-31T10:00:00.000Z',
      }] } },
    ]) as any)

    const { stop } = startDailyEventCountsProjection('shop-1')
    await new Promise((r) => setTimeout(r, 0))

    // 2, not 1: ledger insert + the real update (WAFI-140 Sprint 2 guard).
    expect(db.execute).toHaveBeenCalledTimes(2)
    const [ledgerSql] = vi.mocked(db.execute).mock.calls[0]
    expect(ledgerSql.toLowerCase()).toContain('insert into local_event_processed_ledger')
    const [sql, params] = vi.mocked(db.execute).mock.calls[1]
    expect(sql.toLowerCase()).toContain('update daily_event_counts')
    expect(params).toEqual([5, 'row-1'])

    stop()
  })

  it('does NOT double-count across a restart (ledger guard, WAFI-140 Sprint 2)', async () => {
    const sameRow = {
      id: 'e1', type: 'sale.completed', entity_id: 'sale-1',
      payload: JSON.stringify({ saleId: 'sale-1' }), payload_version: 1,
      staff_id: 's1', shop_id: 'shop-1', occurred_at: '2026-07-31T10:00:00.000Z', created_at: '2026-07-31T10:00:00.000Z',
    }
    // Two SEPARATE subscriptions (not two emissions on one watch stream): the
    // in-memory occurred_at watermark inside useEventSubscription already
    // suppresses same-row redelivery within a single subscription (that's
    // covered by the "does not re-fold" test below), so it would silently
    // swallow this scenario and never reach the ledger at all. A restart --
    // fresh watermark, same row replayed from history -- is exactly the case
    // the persisted ledger (not the in-memory watermark) has to catch.
    vi.mocked(db.watch)
      .mockReturnValueOnce(fakeAsyncIterable([{ rows: { _array: [sameRow] } }]) as any)
      .mockReturnValueOnce(fakeAsyncIterable([{ rows: { _array: [sameRow] } }]) as any)

    // Check-then-insert (not insert-then-catch, see processProjectionAtMostOnce.ts
    // for why): first subscription's ledger check finds nothing -> proceeds to the
    // real getOptional-then-insert write. Second subscription's ledger check (post-
    // "restart") finds the row the first subscription committed -> `existing` is
    // truthy -> returns immediately, never reaching the real write's own
    // getOptional call or any execute at all.
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce(null as any)  // ledger check, subscription 1 -> not yet processed
      .mockResolvedValueOnce(null as any)  // daily_event_counts existing-row lookup, subscription 1
      .mockResolvedValueOnce({ subscriber_id: 'daily_event_counts_projection' } as any) // ledger check, subscription 2 -> already processed

    const first = startDailyEventCountsProjection('shop-1')
    await new Promise((r) => setTimeout(r, 0))
    first.stop()
    const second = startDailyEventCountsProjection('shop-1')
    await new Promise((r) => setTimeout(r, 0))
    second.stop()

    // Exactly one fold into daily_event_counts (the second subscription's
    // ledger check found the row already processed and skipped before ever
    // reaching the read/write) -- the ledger fixes what the original Sprint-1
    // test documented as an accepted double-counting gap on restart.
    // 2, not 4: subscription 1 makes 2 execute calls (ledger insert + real
    // insert); subscription 2 makes 0 (the ledger check short-circuits it).
    expect(db.execute).toHaveBeenCalledTimes(2)
    const incrementCalls = vi.mocked(db.execute).mock.calls.filter(
      ([sql]) => sql.toLowerCase().includes('insert into daily_event_counts'),
    )
    expect(incrementCalls).toHaveLength(1)
  })

  it('does not re-fold already-seen rows when the watch re-emits the full result set', async () => {
    const older = {
      id: 'e1', type: 'sale.completed', entity_id: 'sale-1',
      payload: JSON.stringify({ saleId: 'sale-1' }), payload_version: 1,
      staff_id: 's1', shop_id: 'shop-1', occurred_at: '2026-07-31T10:00:00.000Z', created_at: '2026-07-31T10:00:00.000Z',
    }
    const newer = { ...older, id: 'e2', entity_id: 'sale-2', occurred_at: '2026-07-31T11:00:00.000Z' }
    vi.mocked(db.getOptional).mockResolvedValue(null as any)
    vi.mocked(db.watch).mockReturnValue(fakeAsyncIterable([
      { rows: { _array: [older] } },
      { rows: { _array: [newer, older] } }, // full result set re-emitted
    ]) as any)

    const { stop } = startDailyEventCountsProjection('shop-1')
    await new Promise((r) => setTimeout(r, 0))

    // 4, not 6: each of the two genuinely-new handler invocations (older on the
    // first emission, newer on the second -- 'older' is suppressed on re-emission
    // by the occurred_at watermark) makes 2 execute calls (ledger insert + the
    // real write) under the WAFI-140 Sprint 2 ledger guard.
    expect(db.execute).toHaveBeenCalledTimes(4)
    const incrementCalls = vi.mocked(db.execute).mock.calls.filter(
      ([sql]) => sql.toLowerCase().includes('insert into daily_event_counts'),
    )
    expect(incrementCalls).toHaveLength(2)
    stop()
  })
})
