import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockQueryDeadStockRows = vi.fn()
vi.mock('../../primitives/queryDeadStockRows', () => ({
  queryDeadStockRows: (...args: unknown[]) => mockQueryDeadStockRows(...args),
}))

import { computeDeadStockReport } from '../deadStock'

describe('computeDeadStockReport', () => {
  beforeEach(() => vi.clearAllMocks())

  it('builds Capital Tied Up summary plus Dead Stock detail section from queryDeadStockRows', async () => {
    mockQueryDeadStockRows.mockResolvedValueOnce({
      rows: [
        { productId: 'p1', nameAr: 'منتج 1', currentStock: 10, valueUsd: 100, lastSoldAt: '2026-05-01' },
        { productId: 'p2', nameAr: 'منتج 2', currentStock: 5, valueUsd: 50, lastSoldAt: '2026-04-15' },
      ],
      truncated: false,
    })

    const report = await computeDeadStockReport('shop1', { from: '2026-08-01', to: '2026-08-31' })

    expect(report.id).toBe('dead-stock')
    expect(report.name).toBe('Dead Stock Report')

    // Section structure
    const types = report.sections.map((s) => s.type)
    expect(types).toEqual(['summary', 'detail'])

    // Capital Tied Up summary
    const summarySection = report.sections[0]
    expect(summarySection.type).toBe('summary')
    if (summarySection.type === 'summary') {
      const capitalMetric = summarySection.metrics[0]
      expect(capitalMetric.label).toContain('Capital in dead stock')
      expect(capitalMetric.value).toBe(150) // 100 + 50
      expect(capitalMetric.unit).toBe('USD')
    }

    // Dead Stock detail
    const detailSection = report.sections[1]
    expect(detailSection.type).toBe('detail')
    if (detailSection.type === 'detail') {
      expect(detailSection.title).toContain('No Sales')
      expect(detailSection.title).toContain('90+')
      expect(detailSection.rows.length).toBe(2)
      expect(detailSection.truncated).toBe(false)
    }
  })

  it('labels summary metric when result is truncated', async () => {
    mockQueryDeadStockRows.mockResolvedValueOnce({
      rows: [
        { productId: 'p1', nameAr: 'منتج 1', currentStock: 10, valueUsd: 100, lastSoldAt: '2026-05-01' },
      ],
      truncated: true,
    })

    const report = await computeDeadStockReport('shop1', { from: '2026-08-01', to: '2026-08-31' })

    const summarySection = report.sections[0]
    expect(summarySection.type).toBe('summary')
    if (summarySection.type === 'summary') {
      const capitalMetric = summarySection.metrics[0]
      expect(capitalMetric.label).toContain('top')
      expect(capitalMetric.label).toContain('more not shown')
    }
  })
})
