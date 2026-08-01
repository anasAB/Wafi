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

  it('upserts an increment into daily_event_counts for each sale.completed row', async () => {
    vi.mocked(db.watch).mockReturnValue(fakeAsyncIterable([
      { rows: { _array: [{
        id: 'e1', type: 'sale.completed', entity_id: 'sale-1',
        payload: JSON.stringify({ saleId: 'sale-1' }),
        staff_id: 's1', shop_id: 'shop-1', occurred_at: '2026-07-31T10:00:00.000Z', created_at: '2026-07-31T10:00:00.000Z',
      }] } },
    ]) as any)

    const { stop } = startDailyEventCountsProjection('shop-1')
    await new Promise((r) => setTimeout(r, 0))

    expect(db.execute).toHaveBeenCalledTimes(1)
    const [sql, params] = vi.mocked(db.execute).mock.calls[0]
    expect(sql.toLowerCase()).toContain('insert into daily_event_counts')
    expect(sql.toLowerCase()).toContain('on conflict')
    expect(params).toContain('shop-1')
    expect(params).toContain('sale.completed')
    expect(params).toContain('2026-07-31') // day, derived from occurred_at

    stop()
  })

  it('double-counts on duplicate handler execution -- documented at-least-once limitation, not a bug', async () => {
    const sameRow = {
      id: 'e1', type: 'sale.completed', entity_id: 'sale-1',
      payload: JSON.stringify({ saleId: 'sale-1' }),
      staff_id: 's1', shop_id: 'shop-1', occurred_at: '2026-07-31T10:00:00.000Z', created_at: '2026-07-31T10:00:00.000Z',
    }
    vi.mocked(db.watch).mockReturnValue(fakeAsyncIterable([
      { rows: { _array: [sameRow] } },
      { rows: { _array: [sameRow] } }, // same row delivered twice (crash-and-replay simulation)
    ]) as any)

    const { stop } = startDailyEventCountsProjection('shop-1')
    await new Promise((r) => setTimeout(r, 0))

    // No dedup: two deliveries of the same row produce two increment calls.
    // This is the known Sprint-1 limitation (design spec §3/§7), asserted here
    // so a future idempotency fix (Sprint 2) has a test that must be updated,
    // not silently broken.
    expect(db.execute).toHaveBeenCalledTimes(2)
    stop()
  })
})
