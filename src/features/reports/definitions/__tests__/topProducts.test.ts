import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetAll = vi.fn()
vi.mock('@/data/powersync/db', () => ({
  db: { getAll: (...a: unknown[]) => mockGetAll(...a) },
}))

import { computeTopProductsReport } from '../topProducts'

describe('computeTopProductsReport', () => {
  beforeEach(() => vi.clearAllMocks())

  it('builds Top 20 by Revenue, Quantity, Profit, Discounts, and Returns sections', async () => {
    mockGetAll
      .mockResolvedValueOnce([
        { productId: 'p1', nameAr: 'منتج 1', value: 500 },
      ])
      .mockResolvedValueOnce([
        { productId: 'p1', nameAr: 'منتج 1', value: 100 },
      ])
      .mockResolvedValueOnce([
        { productId: 'p1', nameAr: 'منتج 1', value: 250 },
      ])
      .mockResolvedValueOnce([
        { productId: 'p1', nameAr: 'منتج 1', value: 50 },
      ])
      .mockResolvedValueOnce([
        { productId: 'p1', nameAr: 'منتج 1', value: 30 },
      ])

    const report = await computeTopProductsReport('shop1', { from: '2026-08-01', to: '2026-08-31' })

    expect(report.id).toBe('top-products')
    expect(report.name).toBe('Top Products Report')

    // Section structure
    const types = report.sections.map((s) => s.type)
    expect(types).toEqual(['detail', 'detail', 'detail', 'detail', 'detail'])

    // Section titles
    expect(report.sections[0].type === 'detail' && report.sections[0].title).toBe('Top 20 by Revenue')
    expect(report.sections[1].type === 'detail' && report.sections[1].title).toBe('Top 20 by Quantity Sold')
    expect(report.sections[2].type === 'detail' && report.sections[2].title).toContain('Profit')
    expect(report.sections[3].type === 'detail' && report.sections[3].title).toBe('Most Discounted')
    expect(report.sections[4].type === 'detail' && report.sections[4].title).toContain('Returned')
  })
})
