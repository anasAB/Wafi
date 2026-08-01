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
    vi.mocked(db.getOptional).mockResolvedValue(null as any)
    vi.mocked(db.watch).mockReturnValue(fakeAsyncIterable([
      { rows: { _array: [{
        id: 'e1', type: 'sale.completed', entity_id: 'sale-1',
        payload: JSON.stringify({ saleId: 'sale-1' }), payload_version: 1,
        staff_id: 's1', shop_id: 'shop-1', occurred_at: '2026-07-31T10:00:00.000Z', created_at: '2026-07-31T10:00:00.000Z',
      }] } },
    ]) as any)

    const { stop } = startDailyEventCountsProjection('shop-1')
    await new Promise((r) => setTimeout(r, 0))

    // Lookup first (no ON CONFLICT: PowerSync local tables are views).
    const [selectSql, selectParams] = vi.mocked(db.getOptional).mock.calls[0]
    expect(selectSql.toLowerCase()).toContain('select id, count from daily_event_counts')
    expect(selectParams).toEqual(['shop-1', 'sale.completed', '2026-07-31'])

    expect(db.execute).toHaveBeenCalledTimes(1)
    const [sql, params] = vi.mocked(db.execute).mock.calls[0]
    expect(sql.toLowerCase()).toContain('insert into daily_event_counts')
    expect(sql.toLowerCase()).not.toContain('on conflict')
    expect(typeof (params as unknown[])[0]).toBe('string') // explicit generated id
    expect(params).toContain('shop-1')
    expect(params).toContain('sale.completed')
    expect(params).toContain('2026-07-31') // day, derived from occurred_at

    stop()
  })

  it('increments the existing row count when one already exists for the day', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ id: 'row-1', count: 4 } as any)
    vi.mocked(db.watch).mockReturnValue(fakeAsyncIterable([
      { rows: { _array: [{
        id: 'e1', type: 'sale.completed', entity_id: 'sale-1',
        payload: JSON.stringify({ saleId: 'sale-1' }), payload_version: 1,
        staff_id: 's1', shop_id: 'shop-1', occurred_at: '2026-07-31T10:00:00.000Z', created_at: '2026-07-31T10:00:00.000Z',
      }] } },
    ]) as any)

    const { stop } = startDailyEventCountsProjection('shop-1')
    await new Promise((r) => setTimeout(r, 0))

    expect(db.execute).toHaveBeenCalledTimes(1)
    const [sql, params] = vi.mocked(db.execute).mock.calls[0]
    expect(sql.toLowerCase()).toContain('update daily_event_counts')
    expect(params).toEqual([5, 'row-1'])

    stop()
  })

  it('double-counts across a restart (fresh in-memory watermark) -- documented at-least-once limitation, not a bug', async () => {
    const sameRow = {
      id: 'e1', type: 'sale.completed', entity_id: 'sale-1',
      payload: JSON.stringify({ saleId: 'sale-1' }), payload_version: 1,
      staff_id: 's1', shop_id: 'shop-1', occurred_at: '2026-07-31T10:00:00.000Z', created_at: '2026-07-31T10:00:00.000Z',
    }
    vi.mocked(db.getOptional).mockResolvedValue(null as any)
    // Within ONE subscription the occurred_at watermark now suppresses a
    // re-delivered row (Critical 4 fix). What is still NOT deduped -- and is the
    // accepted Sprint-1 limitation (design spec §3/§7) -- is a restart: the
    // watermark lives in memory only, so a second subscription re-processes the
    // same history from scratch. Sprint 2's persisted idempotent dedup must
    // update this test rather than silently break it.
    vi.mocked(db.watch)
      .mockReturnValueOnce(fakeAsyncIterable([{ rows: { _array: [sameRow] } }]) as any)
      .mockReturnValueOnce(fakeAsyncIterable([{ rows: { _array: [sameRow] } }]) as any)

    const first = startDailyEventCountsProjection('shop-1')
    await new Promise((r) => setTimeout(r, 0))
    first.stop()
    const second = startDailyEventCountsProjection('shop-1')
    await new Promise((r) => setTimeout(r, 0))
    second.stop()

    expect(db.execute).toHaveBeenCalledTimes(2)
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

    // 2, not 3: only the genuinely new row is folded in on the second emission.
    expect(db.execute).toHaveBeenCalledTimes(2)
    stop()
  })
})
