import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useDashboardMetrics } from '@/features/dashboard/composables/useDashboardMetrics'
import { db } from '@/data/powersync/db'

describe('useDashboardMetrics', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getOptional).mockResolvedValue(null)
  })

  it('revenue defaults to 0', async () => {
    const { revenueUsd, load } = useDashboardMetrics()
    await load('today')
    expect(revenueUsd.value).toBe(0)
  })

  // Query order in load(): revenue, cogs, expenses, refunds, cogsReversal, missingCost, count
  it('load queries revenue from sales with date range', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ total: 450 } as any)  // revenue
      .mockResolvedValueOnce({ cogs: 210 } as any)   // cogs
      .mockResolvedValueOnce({ total: 80 } as any)   // expenses
      .mockResolvedValueOnce({ total: 0 } as any)    // refunds
      .mockResolvedValueOnce({ cogs: 0 } as any)     // cogs reversal
      .mockResolvedValueOnce({ count: 2 } as any)    // missing cost
    const { revenueUsd, load } = useDashboardMetrics()
    await load('today')
    expect(revenueUsd.value).toBe(450)
    expect(db.getOptional).toHaveBeenCalledWith(
      expect.stringContaining('SUM(total_usd)'),
      expect.any(Array)
    )
  })

  it('profitUsd is revenue - cogs - expenses (computed)', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ total: 450 } as any)
      .mockResolvedValueOnce({ cogs: 210 } as any)
      .mockResolvedValueOnce({ total: 80 } as any)
      .mockResolvedValueOnce({ total: 0 } as any)
      .mockResolvedValueOnce({ cogs: 0 } as any)
    const { profitUsd, load } = useDashboardMetrics()
    await load('today')
    expect(profitUsd.value).toBeCloseTo(160, 5)
  })

  it('profitUsd is negative when expenses exceed revenue', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ total: 50 } as any)
      .mockResolvedValueOnce({ cogs: 0 } as any)
      .mockResolvedValueOnce({ total: 100 } as any)
      .mockResolvedValueOnce({ total: 0 } as any)
      .mockResolvedValueOnce({ cogs: 0 } as any)
    const { profitUsd, load } = useDashboardMetrics()
    await load('today')
    expect(profitUsd.value).toBe(-50)
  })

  it('returns reduce revenue and reverse restocked COGS', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ total: 450 } as any)  // gross revenue
      .mockResolvedValueOnce({ cogs: 210 } as any)   // gross cogs
      .mockResolvedValueOnce({ total: 0 } as any)    // expenses
      .mockResolvedValueOnce({ total: 100 } as any)  // refunds
      .mockResolvedValueOnce({ cogs: 60 } as any)    // cogs reversal (restocked)
    const { revenueUsd, cogsUsd, refundsUsd, profitUsd, load } = useDashboardMetrics()
    await load('today')
    expect(refundsUsd.value).toBe(100)
    expect(revenueUsd.value).toBe(350) // 450 - 100
    expect(cogsUsd.value).toBe(150)    // 210 - 60
    expect(profitUsd.value).toBe(200)  // 350 - 150 - 0
  })

  it('reverses restocked COGS once per product even when it is on multiple sale lines (WAFI-005)', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ total: 0, cogs: 0, count: 0 } as any)
    const { load } = useDashboardMetrics()
    await load('today')

    const reversalSql = vi.mocked(db.getOptional).mock.calls
      .map(c => c[0] as string)
      .find(sql => sql.includes('qty_returned') && sql.includes('restock'))
    expect(reversalSql).toBeDefined()
    // Must collapse a product's original-sale lines to ONE unit cost per
    // (sale, product) before multiplying by qty_returned...
    expect(reversalSql).toContain('GROUP BY')
    // ...and must NOT row-multiply via a direct line-level join (the WAFI-005 bug:
    // a product on two sale lines doubled the reversed COGS).
    expect(reversalSql).not.toMatch(/JOIN\s+sale_line_items\s+sli\s+ON\s+sli\.sale_id\s*=\s*r\.original_sale_id/i)
  })

  it('missingCostCount reflects products with missing cost price', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ total: 0 } as any)
      .mockResolvedValueOnce({ cogs: 0 } as any)
      .mockResolvedValueOnce({ total: 0 } as any)
      .mockResolvedValueOnce({ total: 0 } as any)
      .mockResolvedValueOnce({ cogs: 0 } as any)
      .mockResolvedValueOnce({ count: 5 } as any)
    const { missingCostCount, load } = useDashboardMetrics()
    await load('today')
    expect(missingCostCount.value).toBe(5)
  })

  // ── WAFI-054: period-accurate "profit is estimated" caveat ──
  // Query order in load(): revenue, cogs, expenses, refunds, cogsReversal,
  // missingCost(active products), count(sales), costlessSalesInPeriod.

  it('flags profit as estimated when a sale in the period had a missing/zero unit cost', async () => {
    // Period with one full-cost sale and one zero-cost sale → the period query
    // counts the single distorted sale.
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ total: 450 } as any)  // revenue
      .mockResolvedValueOnce({ cogs: 210 } as any)   // cogs
      .mockResolvedValueOnce({ total: 0 } as any)    // expenses
      .mockResolvedValueOnce({ total: 0 } as any)    // refunds
      .mockResolvedValueOnce({ cogs: 0 } as any)     // cogs reversal
      .mockResolvedValueOnce({ count: 0 } as any)    // missing-cost active products
      .mockResolvedValueOnce({ count: 2 } as any)    // sales count
      .mockResolvedValueOnce({ count: 1 } as any)    // costless sales in period
    const { costlessSalesInPeriod, profitIsEstimated, load } = useDashboardMetrics()
    await load('today')
    expect(costlessSalesInPeriod.value).toBe(1)
    expect(profitIsEstimated.value).toBe(true)
  })

  it('does NOT flag profit as estimated when every sale in the period has a cost', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ total: 450 } as any)  // revenue
      .mockResolvedValueOnce({ cogs: 210 } as any)   // cogs
      .mockResolvedValueOnce({ total: 0 } as any)    // expenses
      .mockResolvedValueOnce({ total: 0 } as any)    // refunds
      .mockResolvedValueOnce({ cogs: 0 } as any)     // cogs reversal
      .mockResolvedValueOnce({ count: 3 } as any)    // missing-cost active products (irrelevant to caveat)
      .mockResolvedValueOnce({ count: 5 } as any)    // sales count
      .mockResolvedValueOnce({ count: 0 } as any)    // costless sales in period
    const { costlessSalesInPeriod, profitIsEstimated, load } = useDashboardMetrics()
    await load('today')
    expect(costlessSalesInPeriod.value).toBe(0)
    // Caveat is driven by the PERIOD query, not the active-product count — a shop
    // with cost-less active products but no cost-less sales this period is clean.
    expect(profitIsEstimated.value).toBe(false)
  })

  it('does NOT flag profit as estimated for an empty period (zero sales)', async () => {
    vi.mocked(db.getOptional).mockResolvedValue(null as any)
    const { costlessSalesInPeriod, profitIsEstimated, load } = useDashboardMetrics()
    await load('today')
    expect(costlessSalesInPeriod.value).toBe(0)
    expect(profitIsEstimated.value).toBe(false)
  })

  it('counts costless sales at sale granularity within the period, scoped to shop and date range', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ count: 0 } as any)
    const { load } = useDashboardMetrics()
    await load('today')

    const costlessSql = vi.mocked(db.getOptional).mock.calls
      .map(c => c[0] as string)
      .find(sql => sql.includes('unit_cost_usd IS NULL') && sql.includes('EXISTS'))
    expect(costlessSql).toBeDefined()
    // Counts distinct SALES (not line items) so the message can speak in "sales".
    expect(costlessSql).toContain('FROM sales')
    // Uses the same localtime day boundary as revenue/COGS (UTC+3 shop).
    expect(costlessSql).toContain("DATE(s.created_at, 'localtime')")
    // A fully-returned sale no longer distorts profit, so it must be excluded.
    expect(costlessSql).toContain('qty_returned')
  })
})
