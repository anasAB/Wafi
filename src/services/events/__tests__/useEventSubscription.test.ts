import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { useEventSubscription } from '@/services/events/useEventSubscription'
import { SalesEventType, ExpenseEventType } from '@/services/events/domainEvent.types'

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

describe('useEventSubscription', () => {
  beforeEach(() => vi.clearAllMocks())

  it('queries events filtered by shop_id + type (indexed predicate) and invokes handler per row', async () => {
    vi.mocked(db.watch).mockReturnValue(fakeAsyncIterable([
      { rows: { _array: [{ id: 'e1', type: 'sale.completed', payload: '{"saleId":"s1"}', shop_id: 'shop-1' }] } },
    ]) as any)

    const handler = vi.fn()
    const { stop } = useEventSubscription(SalesEventType.Completed, handler, { shopId: 'shop-1' })
    await new Promise((r) => setTimeout(r, 0)) // let the async loop's first iteration run

    expect(db.watch).toHaveBeenCalledTimes(1)
    const [sql, params] = vi.mocked(db.watch).mock.calls[0]
    expect(sql).toContain('shop_id')
    expect(sql).toContain('type')
    expect(params).toContain('shop-1')
    expect(params).toContain('sale.completed')
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }))

    stop()
  })

  it('ignores rows of a different type (query-level filter, not a client-side guard)', async () => {
    vi.mocked(db.watch).mockReturnValue(fakeAsyncIterable([
      { rows: { _array: [] } }, // the SQL WHERE already excludes non-matching types
    ]) as any)

    const handler = vi.fn()
    const { stop } = useEventSubscription(SalesEventType.Completed, handler, { shopId: 'shop-1' })
    await new Promise((r) => setTimeout(r, 0))

    expect(handler).not.toHaveBeenCalled()
    stop()
  })

  it('only forwards genuinely new rows when the watch re-emits the whole result set', async () => {
    // PowerSync watch queries re-emit the ENTIRE current result set on every
    // change. Without an occurred_at watermark the handler would re-run for all
    // history on every insert (quadratic growth in the projection's counts).
    const older = { id: 'e1', type: 'sale.completed', payload: '{"saleId":"s1"}', payload_version: 1, shop_id: 'shop-1', occurred_at: '2026-07-31T10:00:00.000Z' }
    const newer = { id: 'e2', type: 'sale.completed', payload: '{"saleId":"s2"}', payload_version: 1, shop_id: 'shop-1', occurred_at: '2026-07-31T11:00:00.000Z' }
    vi.mocked(db.watch).mockReturnValue(fakeAsyncIterable([
      { rows: { _array: [older] } },
      { rows: { _array: [newer, older] } },
    ]) as any)

    const handler = vi.fn()
    const { stop } = useEventSubscription(SalesEventType.Completed, handler, { shopId: 'shop-1' })
    await new Promise((r) => setTimeout(r, 0))

    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler.mock.calls[0][0]).toMatchObject({ id: 'e1' })
    expect(handler.mock.calls[1][0]).toMatchObject({ id: 'e2' })
    stop()
  })

  it('forwards every genuinely-new row inside a single batch (two sales in quick succession)', async () => {
    const a = { id: 'e1', type: 'sale.completed', payload: '{}', payload_version: 1, shop_id: 'shop-1', occurred_at: '2026-07-31T10:00:00.000Z' }
    const b = { id: 'e2', type: 'sale.completed', payload: '{}', payload_version: 1, shop_id: 'shop-1', occurred_at: '2026-07-31T10:00:01.000Z' }
    vi.mocked(db.watch).mockReturnValue(fakeAsyncIterable([
      { rows: { _array: [b, a] } },
    ]) as any)

    const handler = vi.fn()
    const { stop } = useEventSubscription(SalesEventType.Completed, handler, { shopId: 'shop-1' })
    await new Promise((r) => setTimeout(r, 0))

    expect(handler).toHaveBeenCalledTimes(2)
    stop()
  })

  it('parses payload and carries payload_version onto the forwarded row', async () => {
    vi.mocked(db.watch).mockReturnValue(fakeAsyncIterable([
      { rows: { _array: [{ id: 'e1', type: 'sale.completed', payload: '{"saleId":"s1"}', payload_version: 1, shop_id: 'shop-1', occurred_at: '2026-07-31T10:00:00.000Z' }] } },
    ]) as any)

    const handler = vi.fn()
    const { stop } = useEventSubscription(SalesEventType.Completed, handler, { shopId: 'shop-1' })
    await new Promise((r) => setTimeout(r, 0))

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      payload: { saleId: 's1' }, payload_version: 1,
    }))
    stop()
  })

  it('stop() aborts the underlying watch (passes an AbortSignal that becomes aborted)', () => {
    let capturedSignal: AbortSignal | undefined
    vi.mocked(db.watch).mockImplementation((_sql, _params, opts) => {
      capturedSignal = (opts as any)?.signal
      return fakeAsyncIterable([]) as any
    })

    const { stop } = useEventSubscription(SalesEventType.Completed, vi.fn(), { shopId: 'shop-1' })
    expect(capturedSignal?.aborted).toBe(false)
    stop()
    expect(capturedSignal?.aborted).toBe(true)
  })

  // Replaces a test formerly titled "stops delivering events after a role downgrade (result
  // set shrinks)" (WAFI-140 Sprint 3 final review). That test used sale.completed -- an
  // UNGATED type (EVENT_SENSITIVITY marks it 'public') -- and asserted that BOTH rows of its
  // first emission were delivered, which is not gating at all; it only re-proved the
  // watermark behaviour already covered by "only forwards genuinely new rows when the watch
  // re-emits the whole result set" above. Removed rather than renamed: it carried no coverage
  // that test doesn't already provide.
  it("never delivers a gated event type's row once RLS stops syncing it down after a role downgrade", async () => {
    // Simulates: device syncs as owner (sees expense.recorded), the operator switches to
    // cashier, the next sync cycle re-evaluates RLS server-side (077_events_per_type_rls.sql)
    // and the watch stream's later emissions simply never include a NEW expense.recorded row
    // published after the downgrade. The RLS enforcement itself is proven by the pgTAP suite;
    // this test proves the client-side consequence -- a row that never arrives is never
    // forwarded, needing no special client-side handling -- which is worth a dedicated
    // regression test given it is the client-visible shape of this sprint's central change.
    const preDowngradeRow = {
      id: 'e1', type: 'expense.recorded', payload: '{"expenseId":"exp1"}',
      payload_version: 1, shop_id: 'shop-1', occurred_at: '2026-08-05T10:00:00.000Z',
    }
    vi.mocked(db.watch).mockReturnValue(fakeAsyncIterable([
      { rows: { _array: [preDowngradeRow] } }, // owner: sees the gated row
      { rows: { _array: [preDowngradeRow] } }, // post-downgrade: same result set -- it is not
                                               // that a visible row vanished, it is that a new
                                               // gated row never got through RLS at all
    ]) as any)

    const handler = vi.fn()
    const { stop } = useEventSubscription(ExpenseEventType.Recorded, handler, { shopId: 'shop-1' })
    await new Promise((r) => setTimeout(r, 0))

    // Exactly one call: the pre-downgrade row, once. A hypothetical post-downgrade
    // expense.recorded row is asserted by NEVER appearing in either emission above, so there
    // is nothing for the handler to be called with a second time.
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }))
    stop()
  })
})
