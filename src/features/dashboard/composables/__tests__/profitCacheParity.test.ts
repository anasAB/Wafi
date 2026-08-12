import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { useDashboardMetrics } from '../useDashboardMetrics'
import { useProfitCache } from '../useProfitCache'

// ---------------------------------------------------------------------------
// Fixture model
//
// A single scenario is expressed once, as raw facts (sales / sale_line_items
// / returns / return_line_items / expenses -- the old composable's actual
// tables). From that ONE fixture we derive two independent projections:
//
//   1. oldExpectations  -- a faithful JS transcription of each of
//      useDashboardMetrics.ts's 10 SQL queries, run over the fixture.
//   2. profitCacheRows  -- the profit_cache row(s) 086_profit_cache_apply.sql
//      (sale.completed / sale.returned / expense.recorded branches) and
//      087_profit_cache_rebuild.sql's backfill loop would produce for the
//      same facts, computed by hand in TS using the identical formulas.
//
// Both projections are driven from the SAME fixture object, so a mismatch
// between old and new can only come from the two formulas actually
// disagreeing -- not from independently-invented numbers that happen to
// match. See task-13-report.md for the per-scenario formula citations.
// ---------------------------------------------------------------------------

interface Line {
  productId: string
  quantity: number
  unitCostUsd: number | null
  discountAmountUsd?: number
}

interface Sale {
  id: string
  day: string // localtime date, 'YYYY-MM-DD'
  totalUsd: number
  totalSyp: number
  saleDiscountUsd: number
  lines: Line[]
}

interface ReturnLine {
  productId: string
  qtyReturned: number
  restock: boolean
}

interface ReturnFixture {
  id: string
  day: string
  saleId: string
  refundAmountUsd: number
  lines: ReturnLine[]
}

interface Expense {
  day: string
  amountUsd: number
}

interface Fixture {
  sales: Sale[]
  returns: ReturnFixture[]
  expenses: Expense[]
}

const round2 = (n: number) => Math.round(n * 100) / 100
const centsOf = (n: number) => Math.round(n * 100)
const inRange = (day: string, start: string, end: string) => day >= start && day <= end

function saleCogs(sale: Sale): number {
  return sale.lines.reduce((sum, l) => sum + l.quantity * (l.unitCostUsd ?? 0), 0)
}

function hasCostlessLine(sale: Sale): boolean {
  return sale.lines.some((l) => l.unitCostUsd === null || l.unitCostUsd === 0)
}

// AVG(unit_cost_usd) per (sale_id, product_id) -- mirrors the subquery both
// useDashboardMetrics.ts's cogsReversalRow query (WAFI-005 fix) and
// 087's backfill return loop use, so a duplicate-product sale reverses cost
// exactly once regardless of how many lines carried that product.
function avgUnitCostForProduct(sale: Sale, productId: string): number {
  const matching = sale.lines.filter((l) => l.productId === productId)
  if (matching.length === 0) return 0
  const sum = matching.reduce((s, l) => s + (l.unitCostUsd ?? 0), 0)
  return sum / matching.length
}

// Total quantity returned for a product across ALL returns against a sale
// (not restricted to restock=1) -- matches useDashboardMetrics.ts's
// costlessRow subquery and 087's is_full_return subquery.
function totalReturnedQtyForProduct(fixture: Fixture, saleId: string, productId: string): number {
  return fixture.returns
    .filter((r) => r.saleId === saleId)
    .flatMap((r) => r.lines)
    .filter((l) => l.productId === productId)
    .reduce((sum, l) => sum + l.qtyReturned, 0)
}

function isFullReturn(fixture: Fixture, sale: Sale): boolean {
  return sale.lines.every((l) => l.quantity <= totalReturnedQtyForProduct(fixture, sale.id, l.productId))
}

// ---------------------------------------------------------------------------
// 1. Old composable expectations -- faithful transcription of each query in
//    useDashboardMetrics.ts, run over the fixture for [start, end].
// ---------------------------------------------------------------------------
function computeOldExpectations(fixture: Fixture, start: string, end: string) {
  const salesInRange = fixture.sales.filter((s) => inRange(s.day, start, end))
  const returnsInRange = fixture.returns.filter((r) => inRange(r.day, start, end))
  const expensesInRange = fixture.expenses.filter((e) => inRange(e.day, start, end))

  const revenueGross = round2(salesInRange.reduce((sum, s) => sum + s.totalUsd, 0))
  const cogs = round2(salesInRange.reduce((sum, s) => sum + saleCogs(s), 0))
  const expensesUsd = round2(expensesInRange.reduce((sum, e) => sum + e.amountUsd, 0))
  const refundsUsd = round2(returnsInRange.reduce((sum, r) => sum + r.refundAmountUsd, 0))

  const cogsReversal = round2(
    returnsInRange.reduce((sum, r) => {
      const sale = fixture.sales.find((s) => s.id === r.saleId)
      if (!sale) return sum
      const restocked = r.lines.filter((l) => l.restock)
      return sum + restocked.reduce((s2, l) => s2 + l.qtyReturned * avgUnitCostForProduct(sale, l.productId), 0)
    }, 0),
  )

  const invoiceCount = salesInRange.length
  const returnCount = returnsInRange.length

  // WAFI-054: a sale in-period counts as costless-distorted iff it has a
  // costless line AND is not fully returned yet.
  const costlessSalesInPeriod = salesInRange.filter((s) => {
    if (!hasCostlessLine(s)) return false
    const totalQty = s.lines.reduce((sum, l) => sum + l.quantity, 0)
    const totalReturnedQty = fixture.returns
      .filter((r) => r.saleId === s.id)
      .flatMap((r) => r.lines)
      .reduce((sum, l) => sum + l.qtyReturned, 0)
    return totalQty > totalReturnedQty
  }).length

  const revenueUsd = round2(revenueGross - refundsUsd)
  const cogsUsd = round2(cogs - cogsReversal)
  const profitUsd = round2(revenueUsd - cogsUsd - expensesUsd)

  return { revenueUsd, cogsUsd, expensesUsd, profitUsd, invoiceCount, returnCount, costlessSalesInPeriod }
}

// Mocks db.getOptional for useDashboardMetrics.ts's 10 parallel queries,
// dispatching on the distinguishing SQL fragment each query alone contains
// (same discipline as useDashboardMetrics.test.ts's existing regex mocks).
function mockOldDb(fixture: Fixture, start: string, end: string) {
  const exp = computeOldExpectations(fixture, start, end)
  vi.mocked(db.getOptional).mockImplementation(async (sql: unknown) => {
    const s = (sql as string).replace(/\s+/g, ' ')
    const grossRevenue = round2(
      fixture.sales.filter((sale) => inRange(sale.day, start, end)).reduce((sum, sale) => sum + sale.totalUsd, 0),
    )
    const grossCogs = round2(
      fixture.sales.filter((sale) => inRange(sale.day, start, end)).reduce((sum, sale) => sum + saleCogs(sale), 0),
    )
    if (/return_line_items rli\s+JOIN returns r ON r\.id = rli\.return_id\s+JOIN sales s/.test(s) && /restock = 1/.test(s)) {
      return { cogs: cogsReversalOf(fixture, start, end) } as any
    }
    if (/SUM\(total_usd\)/.test(s)) return { total: grossRevenue } as any
    if (/SUM\(sale_discount_amount_usd\)/.test(s)) return { total: discountOf(fixture, start, end) } as any
    if (/FROM sale_line_items sli\s+JOIN sales s ON sli\.sale_id = s\.id/.test(s)) return { cogs: grossCogs } as any
    if (/FROM expenses/.test(s)) return { total: exp.expensesUsd } as any
    if (/SUM\(r\.refund_amount_usd\)/.test(s)) return { total: refundsOf(fixture, start, end) } as any
    if (/FROM products/.test(s)) return { count: 0 } as any
    if (/FROM sales s\s+WHERE s\.shop_id/.test(s)) return { count: exp.costlessSalesInPeriod } as any
    if (/COUNT\(\*\) as count FROM returns r/.test(s)) return { count: exp.returnCount } as any
    if (/COUNT\(\*\) as count FROM sales WHERE/.test(s)) return { count: exp.invoiceCount } as any
    return { total: 0, count: 0 } as any
  })
}

function refundsOf(fixture: Fixture, start: string, end: string): number {
  return round2(fixture.returns.filter((r) => inRange(r.day, start, end)).reduce((sum, r) => sum + r.refundAmountUsd, 0))
}

function discountOf(fixture: Fixture, start: string, end: string): number {
  return round2(fixture.sales.filter((s) => inRange(s.day, start, end)).reduce((sum, s) => sum + s.saleDiscountUsd, 0))
}

function cogsReversalOf(fixture: Fixture, start: string, end: string): number {
  return round2(
    fixture.returns
      .filter((r) => inRange(r.day, start, end))
      .reduce((sum, r) => {
        const sale = fixture.sales.find((s) => s.id === r.saleId)
        if (!sale) return sum
        const restocked = r.lines.filter((l) => l.restock)
        return sum + restocked.reduce((s2, l) => s2 + l.qtyReturned * avgUnitCostForProduct(sale, l.productId), 0)
      }, 0),
  )
}

// ---------------------------------------------------------------------------
// 2. New composable (profit_cache) rows -- hand-derived per 086/087's
//    formulas, from the SAME fixture.
// ---------------------------------------------------------------------------
interface ProfitCacheRow {
  day: string
  revenue_usd: number; revenue_syp: number; cogs_usd: number; cogs_reversal_usd: number
  expenses_usd: number; refunds_usd: number; discount_usd: number
  invoice_count: number; return_count: number; costless_sale_count: number
}

function emptyRow(day: string): ProfitCacheRow {
  return {
    day, revenue_usd: 0, revenue_syp: 0, cogs_usd: 0, cogs_reversal_usd: 0,
    expenses_usd: 0, refunds_usd: 0, discount_usd: 0,
    invoice_count: 0, return_count: 0, costless_sale_count: 0,
  }
}

function computeProfitCacheRows(fixture: Fixture): ProfitCacheRow[] {
  const byDay = new Map<string, ProfitCacheRow>()
  const row = (day: string) => {
    if (!byDay.has(day)) byDay.set(day, emptyRow(day))
    return byDay.get(day)!
  }

  // sale.completed branch (086 lines 91-108): applied on the sale's own
  // projection day.
  for (const sale of fixture.sales) {
    const r = row(sale.day)
    r.revenue_usd += centsOf(sale.totalUsd)
    r.revenue_syp += centsOf(sale.totalSyp)
    r.cogs_usd += centsOf(saleCogs(sale))
    const lineDiscounts = sale.lines.reduce((sum, l) => sum + (l.discountAmountUsd ?? 0), 0)
    r.discount_usd += centsOf(sale.saleDiscountUsd + lineDiscounts)
    r.invoice_count += 1
    r.costless_sale_count += hasCostlessLine(sale) ? 1 : 0
  }

  // sale.returned branch (086 lines 111-138): refunds/cogs_reversal/return_count
  // on the RETURN's own day; the costless decrement lands on the ORIGINAL
  // SALE's day (originalSaleProjectionDay), which may differ (cross-day return).
  for (const ret of fixture.returns) {
    const sale = fixture.sales.find((s) => s.id === ret.saleId)
    if (!sale) continue
    const r = row(ret.day)
    r.refunds_usd += centsOf(ret.refundAmountUsd)
    const restocked = ret.lines.filter((l) => l.restock)
    const cogsReversal = restocked.reduce((sum, l) => sum + l.qtyReturned * avgUnitCostForProduct(sale, l.productId), 0)
    r.cogs_reversal_usd += centsOf(cogsReversal)
    r.return_count += 1

    if (isFullReturn(fixture, sale) && hasCostlessLine(sale)) {
      row(sale.day).costless_sale_count -= 1
    }
  }

  // expense.recorded branch (086 lines 141-148).
  for (const exp of fixture.expenses) {
    row(exp.day).expenses_usd += centsOf(exp.amountUsd)
  }

  return [...byDay.values()]
}

function mockProfitCacheDb(fixture: Fixture) {
  vi.mocked(db.getAll).mockResolvedValue(computeProfitCacheRows(fixture) as any)
}

// ---------------------------------------------------------------------------
// Scenario fixtures
// ---------------------------------------------------------------------------
const scenarios: Record<string, Fixture> = {
  'same-day return': {
    sales: [{
      id: 'S1', day: '2026-02-01', totalUsd: 50, totalSyp: 0, saleDiscountUsd: 0,
      lines: [{ productId: 'A', quantity: 2, unitCostUsd: 10 }],
    }],
    returns: [{
      id: 'R1', day: '2026-02-01', saleId: 'S1', refundAmountUsd: 25,
      lines: [{ productId: 'A', qtyReturned: 1, restock: true }],
    }],
    expenses: [],
  },

  'cross-day return': {
    sales: [{
      id: 'S2', day: '2026-02-01', totalUsd: 100, totalSyp: 0, saleDiscountUsd: 0,
      lines: [{ productId: 'B', quantity: 1, unitCostUsd: 40 }],
    }],
    returns: [{
      id: 'R2', day: '2026-02-03', saleId: 'S2', refundAmountUsd: 100,
      lines: [{ productId: 'B', qtyReturned: 1, restock: true }],
    }],
    expenses: [],
  },

  'multiple sales in one day': {
    sales: [
      { id: 'S3', day: '2026-02-05', totalUsd: 30, totalSyp: 0, saleDiscountUsd: 0, lines: [{ productId: 'C', quantity: 1, unitCostUsd: 12 }] },
      { id: 'S4', day: '2026-02-05', totalUsd: 45, totalSyp: 0, saleDiscountUsd: 0, lines: [{ productId: 'D', quantity: 1, unitCostUsd: 20 }] },
    ],
    returns: [],
    expenses: [],
  },

  'multiple distinct products on one sale': {
    sales: [{
      id: 'S5', day: '2026-02-06', totalUsd: 60, totalSyp: 0, saleDiscountUsd: 0,
      lines: [
        { productId: 'C', quantity: 1, unitCostUsd: 5 },
        { productId: 'D', quantity: 2, unitCostUsd: 8 },
      ],
    }],
    returns: [],
    expenses: [],
  },

  'duplicate product across two lines of one sale': {
    sales: [{
      id: 'S6', day: '2026-02-07', totalUsd: 90, totalSyp: 0, saleDiscountUsd: 0,
      lines: [
        { productId: 'E', quantity: 1, unitCostUsd: 10 },
        { productId: 'E', quantity: 2, unitCostUsd: 12 },
      ],
    }],
    returns: [{
      id: 'R6', day: '2026-02-07', saleId: 'S6', refundAmountUsd: 30,
      lines: [{ productId: 'E', qtyReturned: 1, restock: true }],
    }],
    expenses: [],
  },

  'a costless sale later fully returned': {
    sales: [{
      id: 'S7', day: '2026-02-08', totalUsd: 20, totalSyp: 0, saleDiscountUsd: 0,
      lines: [{ productId: 'F', quantity: 1, unitCostUsd: null }],
    }],
    returns: [{
      id: 'R7', day: '2026-02-08', saleId: 'S7', refundAmountUsd: 20,
      lines: [{ productId: 'F', qtyReturned: 1, restock: true }],
    }],
    expenses: [],
  },

  'a costless sale only partially returned': {
    sales: [{
      id: 'S8', day: '2026-02-09', totalUsd: 40, totalSyp: 0, saleDiscountUsd: 0,
      lines: [{ productId: 'G', quantity: 2, unitCostUsd: 0 }],
    }],
    returns: [{
      id: 'R8', day: '2026-02-09', saleId: 'S8', refundAmountUsd: 20,
      lines: [{ productId: 'G', qtyReturned: 1, restock: true }],
    }],
    expenses: [],
  },

  'an expense': {
    sales: [],
    returns: [],
    expenses: [{ day: '2026-02-10', amountUsd: 15 }],
  },

  'a discount': {
    sales: [{
      id: 'S9', day: '2026-02-11', totalUsd: 90, totalSyp: 0, saleDiscountUsd: 10,
      lines: [{ productId: 'H', quantity: 1, unitCostUsd: 30, discountAmountUsd: 5 }],
    }],
    returns: [],
    expenses: [],
  },

  'a zero-value sale': {
    sales: [{
      id: 'S10', day: '2026-02-12', totalUsd: 0, totalSyp: 0, saleDiscountUsd: 0,
      lines: [{ productId: 'I', quantity: 1, unitCostUsd: 0 }],
    }],
    returns: [],
    expenses: [],
  },
}

const RANGE_START = '2026-01-01'
const RANGE_END = '2026-12-31'

describe('useDashboardMetrics vs useProfitCache — old-vs-new financial parity', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
    useDeviceStore().shopId = 'shop1'
  })

  it.each(Object.keys(scenarios))('matches exactly for: %s', async (scenarioName) => {
    const fixture = scenarios[scenarioName]

    mockOldDb(fixture, RANGE_START, RANGE_END)
    const old = useDashboardMetrics()
    await old.loadRange(RANGE_START, RANGE_END)

    mockProfitCacheDb(fixture)
    const next = useProfitCache()
    await next.loadRange(RANGE_START, RANGE_END)

    expect(next.metrics.value.revenueUsd - next.metrics.value.refundsUsd).toBeCloseTo(old.revenueUsd.value, 2)
    expect(next.metrics.value.cogsUsd - next.metrics.value.cogsReversalUsd).toBeCloseTo(old.cogsUsd.value, 2)
    expect(next.metrics.value.expensesUsd).toBeCloseTo(old.expensesUsd.value, 2)
    expect(next.metrics.value.profitUsd).toBeCloseTo(old.profitUsd.value, 2)
    expect(next.metrics.value.invoiceCount).toBe(old.invoiceCount.value)
    expect(next.metrics.value.returnCount).toBe(old.returnCount.value)

    // costlessSaleCount parity: old's costlessSalesInPeriod already excludes
    // fully-returned sales (WAFI-054); profit_cache's cross-day decrement is
    // what closes that same gap. Both must agree, exercised directly by the
    // "fully returned" / "partially returned" costless scenarios.
    expect(next.metrics.value.costlessSaleCount).toBe(old.costlessSalesInPeriod.value)
  })
})
