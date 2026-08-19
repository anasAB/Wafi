import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetAll = vi.fn()
const mockGetOptional = vi.fn()
vi.mock('@/data/powersync/db', () => ({
  db: {
    getAll: (...a: unknown[]) => mockGetAll(...a),
    getOptional: (...a: unknown[]) => mockGetOptional(...a),
  },
}))

const mockQueryDeadStockRows = vi.fn()
vi.mock('../../primitives/queryDeadStockRows', () => ({
  queryDeadStockRows: (...args: unknown[]) => mockQueryDeadStockRows(...args),
}))

import { computeInventoryHealthReport } from '../inventoryHealth'

describe('computeInventoryHealthReport', () => {
  beforeEach(() => vi.clearAllMocks())

  it('builds Inventory Overview, Low Stock, Fast-Moving, Slow-Moving, and Dead Stock sections', async () => {
    mockGetAll
      .mockResolvedValueOnce([
        { productId: 'p1', nameAr: 'منتج 1', currentStock: 2, lowStockThreshold: 5 },
      ])
      .mockResolvedValueOnce([
        { productId: 'p2', nameAr: 'منتج 2', quantitySold: 100 },
        { productId: 'p3', nameAr: 'منتج 3', quantitySold: 90 },
      ])
      .mockResolvedValueOnce([
        { productId: 'p4', nameAr: 'منتج 4', quantitySold: 5 },
        { productId: 'p5', nameAr: 'منتج 5', quantitySold: 3 },
      ])

    mockGetOptional
      .mockResolvedValueOnce({ totalCost: 1000, totalCogs: 0 })
      .mockResolvedValueOnce({ cogs: 200 })

    mockQueryDeadStockRows.mockResolvedValueOnce({
      rows: [
        { productId: 'p6', nameAr: 'منتج 6', currentStock: 10, valueUsd: 100, lastSoldAt: '2026-05-01' },
      ],
      truncated: false,
    })

    const report = await computeInventoryHealthReport('shop1', { from: '2026-08-01', to: '2026-08-31' })

    expect(report.id).toBe('inventory-health')
    expect(report.name).toBe('Inventory Health Report')

    // Section structure
    const types = report.sections.map((s) => s.type)
    expect(types).toEqual(['summary', 'detail', 'detail', 'detail', 'detail'])

    // Overview summary
    const overviewSection = report.sections[0]
    expect(overviewSection.type).toBe('summary')
    if (overviewSection.type === 'summary') {
      expect(overviewSection.metrics.find((m) => m.label.includes('inventory value'))).toBeDefined()
      expect(overviewSection.metrics.find((m) => m.label.includes('Turnover'))?.value).toBeCloseTo(0.2) // 200 / 1000
    }

    // Low Stock
    const lowStockSection = report.sections[1]
    expect(lowStockSection.type).toBe('detail')
    if (lowStockSection.type === 'detail') {
      expect(lowStockSection.title).toContain('Low Stock')
      expect(lowStockSection.rows.length).toBe(1)
    }

    // Fast-Moving
    const fastSection = report.sections[2]
    expect(fastSection.type).toBe('detail')
    if (fastSection.type === 'detail') {
      expect(fastSection.title).toBe('Fast-Moving SKUs')
      expect(fastSection.rows.length).toBe(2)
    }

    // Slow-Moving
    const slowSection = report.sections[3]
    expect(slowSection.type).toBe('detail')
    if (slowSection.type === 'detail') {
      expect(slowSection.title).toBe('Slow-Moving SKUs')
      expect(slowSection.rows.length).toBe(2)
    }

    // Dead Stock
    const deadSection = report.sections[4]
    expect(deadSection.type).toBe('detail')
    if (deadSection.type === 'detail') {
      expect(deadSection.title).toContain('Dead Stock')
      expect(deadSection.rows.length).toBe(1)
    }
  })
})
