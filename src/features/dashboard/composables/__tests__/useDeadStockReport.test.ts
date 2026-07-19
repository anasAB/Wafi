import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useDeadStockReport } from '../useDeadStockReport'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

function sqlOf(c: any[]): string { return c[0] as string }

describe('useDeadStockReport', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useDeviceStore().shopId = 'shop-1'
  })

  it('queries once with a single JOIN — never one query per product', async () => {
    vi.mocked(db.getAll).mockResolvedValue([])
    const { load } = useDeadStockReport()
    await load()
    expect(db.getAll).toHaveBeenCalledTimes(1)
    expect(sqlOf(vi.mocked(db.getAll).mock.calls[0])).toMatch(/LEFT JOIN/)
  })

  it('never-sold products use created_at as the age basis and are flagged neverSold', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { id: 'p1', name_ar: 'قلم', current_stock: 10, cost_price_usd: 2, created_at: '2026-01-01T00:00:00.000Z', last_sold_at: null },
    ] as any)
    const { rows, load } = useDeadStockReport()
    await load()
    expect(rows.value[0].neverSold).toBe(true)
    expect(rows.value[0].ageBasisDate).toBe('2026-01-01T00:00:00.000Z')
  })

  it('excludes zero-cost (uncosted) products from the frozen-capital headline', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { id: 'p1', name_ar: 'مُسعّر', current_stock: 10, cost_price_usd: 5, created_at: '2026-01-01', last_sold_at: null },
      { id: 'p2', name_ar: 'غير مُسعّر', current_stock: 20, cost_price_usd: 0, created_at: '2026-01-01', last_sold_at: null },
    ] as any)
    const { totalFrozenCapitalUsd, uncostedRows, load } = useDeadStockReport()
    await load()
    expect(totalFrozenCapitalUsd.value).toBe(50)
    expect(uncostedRows.value.map(r => r.productId)).toEqual(['p2'])
  })

  it('sorts by value tied up (default) or by age', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { id: 'p1', name_ar: 'أ', current_stock: 5, cost_price_usd: 2, created_at: '2026-01-01', last_sold_at: '2026-01-01T00:00:00.000Z' },
      { id: 'p2', name_ar: 'ب', current_stock: 100, cost_price_usd: 10, created_at: '2026-01-01', last_sold_at: '2026-03-01T00:00:00.000Z' },
    ] as any)
    const { rows, sort, load } = useDeadStockReport()
    await load()

    sort.value = 'value'
    expect(rows.value.map(r => r.productId)).toEqual(['p2', 'p1']) // 1000 > 10

    sort.value = 'age'
    expect(rows.value.map(r => r.productId)).toEqual(['p1', 'p2']) // oldest last-sold first
  })

  it('passes a cutoff derived from the selected threshold', async () => {
    vi.mocked(db.getAll).mockResolvedValue([])
    const { thresholdDays, load } = useDeadStockReport()
    thresholdDays.value = 30
    await load()
    const params = vi.mocked(db.getAll).mock.calls[0][1] as unknown[]
    expect(params).toContain('shop-1')
    expect(typeof params[2]).toBe('string') // cutoff ISO string
  })
})
