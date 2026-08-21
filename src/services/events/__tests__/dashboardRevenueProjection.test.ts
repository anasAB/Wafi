import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { startDashboardRevenueProjection } from '@/services/events/dashboardRevenueProjection'

describe('startDashboardRevenueProjection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('inserts a new row for a sale.completed on a day with no existing projection row', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce(null)  // processProjectionAtMostOnce's own ledger check
      .mockResolvedValueOnce(null)  // this projection's own "existing row for today" check
    vi.mocked(db.watch).mockReturnValue({
      [Symbol.asyncIterator]: () => {
        let done = false
        return {
          next: async () => {
            if (done) return { value: undefined, done: true }
            done = true
            return {
              value: {
                rows: {
                  _array: [{
                    id: 'evt1', type: 'sale.completed', entity_id: 'sale1',
                    payload: JSON.stringify({ saleId: 'sale1', shopId: 'shop1', staffId: 's1', totalUsd: 42, totalSyp: 630000, paymentSummary: { cashUsd: 42, cashSyp: 0, cardTotal: 0, creditTotal: 0, methodCount: 1 }, itemCount: 1, discountApplied: false }),
                    payload_version: 1, staff_id: 's1', shop_id: 'shop1',
                    occurred_at: '2026-08-06T10:00:00.000Z', created_at: '2026-08-06T10:00:00.000Z',
                    event_projection_day: '2026-08-06',
                  }],
                },
              },
              done: false,
            }
          },
          return: async () => ({ value: undefined, done: true }),
        }
      },
    })

    startDashboardRevenueProjection('shop1')
    await new Promise((r) => setTimeout(r, 0)) // let the async watch-loop IIFE run one tick

    const insertCall = vi.mocked(db.execute).mock.calls.find(([sql]) => sql.toLowerCase().includes('insert into local_today_revenue_projection'))
    expect(insertCall).toBeDefined()
    expect(insertCall![1]).toContain('2026-08-06') // date derived from event_projection_day (WAFI-148 follow-up)
    expect(insertCall![1]).toContain(42)            // revenue_usd
  })

  it('increments revenue_usd/revenue_syp on an existing row for the shop+date instead of replacing them', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce(null)  // processProjectionAtMostOnce's own ledger check
      .mockResolvedValueOnce({ id: 'row-1', revenue_usd: 100, revenue_syp: 1500000 })  // existing projection row
    vi.mocked(db.watch).mockReturnValue({
      [Symbol.asyncIterator]: () => {
        let done = false
        return {
          next: async () => {
            if (done) return { value: undefined, done: true }
            done = true
            return {
              value: {
                rows: {
                  _array: [{
                    id: 'evt2', type: 'sale.completed', entity_id: 'sale2',
                    payload: JSON.stringify({ saleId: 'sale2', shopId: 'shop1', staffId: 's1', totalUsd: 42, totalSyp: 630000, paymentSummary: { cashUsd: 42, cashSyp: 0, cardTotal: 0, creditTotal: 0, methodCount: 1 }, itemCount: 1, discountApplied: false }),
                    payload_version: 1, staff_id: 's1', shop_id: 'shop1',
                    occurred_at: '2026-08-06T11:00:00.000Z', created_at: '2026-08-06T11:00:00.000Z',
                    event_projection_day: '2026-08-06',
                  }],
                },
              },
              done: false,
            }
          },
          return: async () => ({ value: undefined, done: true }),
        }
      },
    })

    startDashboardRevenueProjection('shop1')
    await new Promise((r) => setTimeout(r, 0)) // let the async watch-loop IIFE run one tick

    const updateCall = vi.mocked(db.execute).mock.calls.find(([sql]) => sql.toLowerCase().includes('update local_today_revenue_projection'))
    expect(updateCall).toBeDefined()
    const [sql, params] = updateCall!
    expect(sql.toLowerCase()).not.toContain('insert')
    // params order: [revenue_usd, revenue_syp, updated_at, id] -- incremented, not replaced
    expect(params[0]).toBe(142)      // 100 + 42
    expect(params[1]).toBe(2130000)  // 1500000 + 630000
    expect(params[3]).toBe('row-1')
  })
})
