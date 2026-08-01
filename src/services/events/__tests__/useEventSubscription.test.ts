import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { useEventSubscription } from '@/services/events/useEventSubscription'
import { SalesEventType } from '@/services/events/domainEvent.types'

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
})
