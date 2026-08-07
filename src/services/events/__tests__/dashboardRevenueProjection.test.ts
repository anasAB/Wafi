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
    expect(insertCall![1]).toContain('2026-08-06') // date derived from occurred_at
    expect(insertCall![1]).toContain(42)            // revenue_usd
  })
})
