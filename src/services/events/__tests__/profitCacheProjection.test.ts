// src/services/events/__tests__/profitCacheProjection.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { startProfitCacheProjection } from '@/services/events/profitCacheProjection'

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

const saleCompletedRow = {
  id: 'e1', type: 'sale.completed', entity_id: 'sale-1',
  payload: JSON.stringify({ saleId: 'sale-1' }), payload_version: 2,
  staff_id: 's1', shop_id: 'shop-1', occurred_at: '2026-07-31T10:00:00.000Z', created_at: '2026-07-31T10:00:00.000Z',
}

const returnedRow = {
  id: 'e2', type: 'sale.returned', entity_id: 'return-1',
  payload: JSON.stringify({ returnId: 'return-1' }), payload_version: 2,
  staff_id: 's1', shop_id: 'shop-1', occurred_at: '2026-07-31T12:00:00.000Z', created_at: '2026-07-31T12:00:00.000Z',
}

const expenseRecordedRow = {
  id: 'e3', type: 'expense.recorded', entity_id: 'expense-1',
  payload: JSON.stringify({ expenseId: 'expense-1' }), payload_version: 2,
  staff_id: 's1', shop_id: 'shop-1', occurred_at: '2026-07-31T14:00:00.000Z', created_at: '2026-07-31T14:00:00.000Z',
}

const emptyIterable = () => fakeAsyncIterable([])

// The subscriber watches all three event types (sale.completed, sale.returned,
// expense.recorded) concurrently, each with its own db.watch() call filtered by
// `type` in the SQL params. The fake db.watch mock doesn't apply the SQL filter
// itself, so route each call by the `type` param to only the matching handler --
// otherwise every subscription would replay the same rows regardless of type.
function watchOnlyForType(type: string, results: any[]) {
  return (_sql: string, params: unknown[]) =>
    params.includes(type) ? fakeAsyncIterable(results) : emptyIterable()
}

describe('startProfitCacheProjection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('inserts a new profit_cache row writing only source_event_id, never a metric column', async () => {
    // Call order: 1) ledger check (not yet processed) 2) the projection's own
    // existing-row lookup (none for the day either).
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce(null as any) // ledger check
      .mockResolvedValueOnce(null as any) // profit_cache existing-row lookup
    vi.mocked(db.watch).mockImplementation(
      watchOnlyForType('sale.completed', [{ rows: { _array: [saleCompletedRow] } }]) as any,
    )

    const { stop } = startProfitCacheProjection('shop-1')
    await new Promise((r) => setTimeout(r, 0))

    const [ledgerSelectSql] = vi.mocked(db.getOptional).mock.calls[0]
    expect(ledgerSelectSql.toLowerCase()).toContain('select subscriber_id from local_event_processed_ledger')
    const [selectSql, selectParams] = vi.mocked(db.getOptional).mock.calls[1]
    expect(selectSql.toLowerCase()).toContain('select id from profit_cache')
    expect(selectParams).toEqual(['shop-1', '2026-07-31'])

    // 2: ledger insert + the real profit_cache insert.
    expect(db.execute).toHaveBeenCalledTimes(2)
    const [insertSql, insertParams] = vi.mocked(db.execute).mock.calls[1]
    expect(insertSql.toLowerCase()).toContain('insert into profit_cache')
    expect(insertSql).not.toMatch(/revenue_usd|revenue_syp|cogs_usd|cogs_reversal_usd|expenses_usd|refunds_usd|discount_usd|invoice_count|return_count|costless_sale_count/i)
    expect(insertParams).toContain('shop-1')
    expect(insertParams).toContain('2026-07-31')
    expect(insertParams).toContain('e1') // source_event_id only

    stop()
  })

  it('updates the existing row source_event_id only when one already exists for the day', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce(null as any) // ledger check
      .mockResolvedValueOnce({ id: 'row-1' } as any) // profit_cache existing-row lookup
    vi.mocked(db.watch).mockImplementation(
      watchOnlyForType('sale.completed', [{ rows: { _array: [saleCompletedRow] } }]) as any,
    )

    const { stop } = startProfitCacheProjection('shop-1')
    await new Promise((r) => setTimeout(r, 0))

    expect(db.execute).toHaveBeenCalledTimes(2)
    const [updateSql, updateParams] = vi.mocked(db.execute).mock.calls[1]
    expect(updateSql.toLowerCase()).toContain('update profit_cache')
    expect(updateSql.toLowerCase()).toContain('set source_event_id')
    expect(updateSql).not.toMatch(/revenue_usd|cogs_usd|expenses_usd/i)
    expect(updateParams).toEqual(['e1', 'row-1'])

    stop()
  })

  it('inserts a new profit_cache row for a sale.returned event, writing only source_event_id', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce(null as any) // ledger check
      .mockResolvedValueOnce(null as any) // profit_cache existing-row lookup
    vi.mocked(db.watch).mockImplementation(
      watchOnlyForType('sale.returned', [{ rows: { _array: [returnedRow] } }]) as any,
    )

    const { stop } = startProfitCacheProjection('shop-1')
    await new Promise((r) => setTimeout(r, 0))

    expect(db.execute).toHaveBeenCalledTimes(2)
    const [insertSql, insertParams] = vi.mocked(db.execute).mock.calls[1]
    expect(insertSql.toLowerCase()).toContain('insert into profit_cache')
    expect(insertSql).not.toMatch(/revenue_usd|revenue_syp|cogs_usd|cogs_reversal_usd|expenses_usd|refunds_usd|discount_usd|invoice_count|return_count|costless_sale_count/i)
    expect(insertParams).toContain('shop-1')
    expect(insertParams).toContain('2026-07-31')
    expect(insertParams).toContain('e2') // source_event_id only

    stop()
  })

  it('updates the existing row source_event_id only for a sale.returned event', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce(null as any) // ledger check
      .mockResolvedValueOnce({ id: 'row-2' } as any) // profit_cache existing-row lookup
    vi.mocked(db.watch).mockImplementation(
      watchOnlyForType('sale.returned', [{ rows: { _array: [returnedRow] } }]) as any,
    )

    const { stop } = startProfitCacheProjection('shop-1')
    await new Promise((r) => setTimeout(r, 0))

    expect(db.execute).toHaveBeenCalledTimes(2)
    const [updateSql, updateParams] = vi.mocked(db.execute).mock.calls[1]
    expect(updateSql.toLowerCase()).toContain('update profit_cache')
    expect(updateSql.toLowerCase()).toContain('set source_event_id')
    expect(updateSql).not.toMatch(/revenue_usd|cogs_usd|expenses_usd/i)
    expect(updateParams).toEqual(['e2', 'row-2'])

    stop()
  })

  it('inserts a new profit_cache row for an expense.recorded event, writing only source_event_id', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce(null as any) // ledger check
      .mockResolvedValueOnce(null as any) // profit_cache existing-row lookup
    vi.mocked(db.watch).mockImplementation(
      watchOnlyForType('expense.recorded', [{ rows: { _array: [expenseRecordedRow] } }]) as any,
    )

    const { stop } = startProfitCacheProjection('shop-1')
    await new Promise((r) => setTimeout(r, 0))

    expect(db.execute).toHaveBeenCalledTimes(2)
    const [insertSql, insertParams] = vi.mocked(db.execute).mock.calls[1]
    expect(insertSql.toLowerCase()).toContain('insert into profit_cache')
    expect(insertSql).not.toMatch(/revenue_usd|revenue_syp|cogs_usd|cogs_reversal_usd|expenses_usd|refunds_usd|discount_usd|invoice_count|return_count|costless_sale_count/i)
    expect(insertParams).toContain('shop-1')
    expect(insertParams).toContain('2026-07-31')
    expect(insertParams).toContain('e3') // source_event_id only

    stop()
  })

  it('updates the existing row source_event_id only for an expense.recorded event', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce(null as any) // ledger check
      .mockResolvedValueOnce({ id: 'row-3' } as any) // profit_cache existing-row lookup
    vi.mocked(db.watch).mockImplementation(
      watchOnlyForType('expense.recorded', [{ rows: { _array: [expenseRecordedRow] } }]) as any,
    )

    const { stop } = startProfitCacheProjection('shop-1')
    await new Promise((r) => setTimeout(r, 0))

    expect(db.execute).toHaveBeenCalledTimes(2)
    const [updateSql, updateParams] = vi.mocked(db.execute).mock.calls[1]
    expect(updateSql.toLowerCase()).toContain('update profit_cache')
    expect(updateSql.toLowerCase()).toContain('set source_event_id')
    expect(updateSql).not.toMatch(/revenue_usd|cogs_usd|expenses_usd/i)
    expect(updateParams).toEqual(['e3', 'row-3'])

    stop()
  })

  it('does NOT double-process across a restart (ledger guard)', async () => {
    vi.mocked(db.watch).mockImplementation(
      watchOnlyForType('sale.completed', [{ rows: { _array: [saleCompletedRow] } }]) as any,
    )

    vi.mocked(db.getOptional)
      .mockResolvedValueOnce(null as any)  // ledger check, subscription 1 -> not yet processed
      .mockResolvedValueOnce(null as any)  // profit_cache existing-row lookup, subscription 1
      .mockResolvedValueOnce({ subscriber_id: 'profit_cache_projection' } as any) // ledger check, subscription 2 -> already processed

    const first = startProfitCacheProjection('shop-1')
    await new Promise((r) => setTimeout(r, 0))
    first.stop()
    const second = startProfitCacheProjection('shop-1')
    await new Promise((r) => setTimeout(r, 0))
    second.stop()

    // Subscription 1: ledger insert + real insert (2 calls). Subscription 2:
    // ledger check finds the row already processed, short-circuits before any execute.
    expect(db.execute).toHaveBeenCalledTimes(2)
    const insertCalls = vi.mocked(db.execute).mock.calls.filter(
      ([sql]) => sql.toLowerCase().includes('insert into profit_cache'),
    )
    expect(insertCalls).toHaveLength(1)
  })
})
