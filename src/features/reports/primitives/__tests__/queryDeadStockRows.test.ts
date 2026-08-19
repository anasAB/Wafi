// src/features/reports/primitives/__tests__/queryDeadStockRows.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetAll = vi.fn()
vi.mock('@/data/powersync/db', () => ({ db: { getAll: (...a: unknown[]) => mockGetAll(...a) } }))

import { queryDeadStockRows } from '../queryDeadStockRows'

describe('queryDeadStockRows', () => {
  beforeEach(() => vi.clearAllMocks())

  it('computes valueUsd as current_stock * cost_price_usd, excludes uncosted products, not truncated below the cap', async () => {
    mockGetAll.mockResolvedValue([
      { id: 'p1', name_ar: 'قلم', current_stock: 10, cost_price_usd: 2, last_sold_at: null },
      { id: 'p2', name_ar: 'دفتر', current_stock: 5, cost_price_usd: 0, last_sold_at: '2026-05-01' }, // uncosted, excluded
    ])
    const { rows, truncated } = await queryDeadStockRows('shop1', 90)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ productId: 'p1', currentStock: 10, valueUsd: 20, lastSoldAt: null })
    expect(truncated).toBe(false)
  })

  it('caps at DEAD_STOCK_ROW_CAP, sorted by valueUsd descending, and reports truncated', async () => {
    const many = Array.from({ length: 501 }, (_, i) => ({
      id: `p${i}`, name_ar: `منتج ${i}`, current_stock: 1, cost_price_usd: i + 1, last_sold_at: null,
    }))
    mockGetAll.mockResolvedValue(many)
    const { rows, truncated } = await queryDeadStockRows('shop1', 90)
    expect(rows).toHaveLength(500)
    expect(rows[0].valueUsd).toBe(501) // highest cost_price_usd (i=500) sorts first
    expect(truncated).toBe(true)
  })
})
