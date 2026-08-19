// src/features/reports/primitives/__tests__/readProfitCache.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetAll = vi.fn()
vi.mock('@/data/powersync/db', () => ({ db: { getAll: (...args: unknown[]) => mockGetAll(...args) } }))

import { readProfitCache } from '../readProfitCache'

describe('readProfitCache', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sums integer-cent columns across rows before converting to dollars once', async () => {
    mockGetAll.mockResolvedValue([
      { revenue_usd: 10000, revenue_syp: 500000, cogs_usd: 4000, cogs_reversal_usd: 0, expenses_usd: 1000, refunds_usd: 0, discount_usd: 500, invoice_count: 3, return_count: 0, costless_sale_count: 0 },
      { revenue_usd: 5000, revenue_syp: 250000, cogs_usd: 2000, cogs_reversal_usd: 0, expenses_usd: 0, refunds_usd: 200, discount_usd: 0, invoice_count: 1, return_count: 1, costless_sale_count: 0 },
    ])

    const result = await readProfitCache('shop1', { from: '2026-08-01', to: '2026-08-02' })

    expect(mockGetAll).toHaveBeenCalledWith(
      expect.stringContaining('FROM profit_cache WHERE shop_id = ? AND day BETWEEN ? AND ?'),
      ['shop1', '2026-08-01', '2026-08-02'],
    )
    expect(result.revenueUsd).toBe(150)
    expect(result.refundsUsd).toBe(2)
    expect(result.netRevenueUsd).toBe(148)
    expect(result.invoiceCount).toBe(4)
    expect(result.returnCount).toBe(1)
  })

  it('clamps a transiently negative costlessSaleCount to zero for display (no profitIsEstimated field on this primitive -- see Task 0 P1 finding 20, this only covers the clamp)', async () => {
    mockGetAll.mockResolvedValue([
      { revenue_usd: 1000, revenue_syp: 0, cogs_usd: 0, cogs_reversal_usd: 0, expenses_usd: 0, refunds_usd: 0, discount_usd: 0, invoice_count: 1, return_count: 0, costless_sale_count: -1 },
    ])
    const result = await readProfitCache('shop1', { from: '2026-08-01', to: '2026-08-01' })
    expect(result.costlessSaleCount).toBe(0)
  })
})
