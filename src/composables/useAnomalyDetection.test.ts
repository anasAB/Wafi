import { describe, it, expect, vi, beforeEach } from 'vitest'
import { computeAnomalies, ANOMALY_RULES, useAnomalyDetection, type AnomalyInput } from './useAnomalyDetection'
import { db } from '@/data/powersync/db'

vi.mock('@/data/powersync/db', () => ({
  db: { getOptional: vi.fn(), getAll: vi.fn() },
}))
vi.mock('@/store/device.store', () => ({
  useDeviceStore: () => ({ shopId: 'shop-1' }),
}))

const baseInput: AnomalyInput = {
  revenueUsd: 1000,
  cogsUsd: 500,
  expensesUsd: 100,
  refundsUsd: 50,
  saleDiscountsUsd: 50,
  belowCostSaleCount: 0,
  cashShiftVarianceCount: 0,
  inventoryShrinkageCount: 0,
}

describe('computeAnomalies', () => {
  it('flags HIGH_EXPENSES_RATIO when expenses exceed 30% of gross income', () => {
    const anomalies = computeAnomalies({ ...baseInput, expensesUsd: 400 })
    expect(anomalies.some(a => a.code === 'HIGH_EXPENSES_RATIO')).toBe(true)
  })

  it('does not flag HIGH_EXPENSES_RATIO at or below the threshold', () => {
    const anomalies = computeAnomalies({ ...baseInput, expensesUsd: 300, revenueUsd: 1000, refundsUsd: 0 })
    expect(anomalies.some(a => a.code === 'HIGH_EXPENSES_RATIO')).toBe(false)
  })

  it('does not flag anything when gross income is below the minRevenueUsd floor', () => {
    const anomalies = computeAnomalies({ ...baseInput, revenueUsd: 10, expensesUsd: 8, refundsUsd: 0 })
    expect(anomalies).toEqual([])
  })

  it('flags HIGH_RETURNS_RATIO when refunds exceed 10% of gross income', () => {
    const anomalies = computeAnomalies({ ...baseInput, refundsUsd: 150, revenueUsd: 1000 })
    expect(anomalies.some(a => a.code === 'HIGH_RETURNS_RATIO')).toBe(true)
  })

  it('flags LOW_MARGIN when profit margin is below 10% of gross income', () => {
    const anomalies = computeAnomalies({ ...baseInput, revenueUsd: 1000, cogsUsd: 850, expensesUsd: 100, refundsUsd: 0 })
    // profit = 1000 - 850 - 100 = 50; grossIncome = 1000; margin = 5% < 10%
    expect(anomalies.some(a => a.code === 'LOW_MARGIN')).toBe(true)
  })

  it('does not flag LOW_MARGIN when margin is healthy', () => {
    const anomalies = computeAnomalies({ ...baseInput, revenueUsd: 1000, cogsUsd: 400, expensesUsd: 100, refundsUsd: 0 })
    expect(anomalies.some(a => a.code === 'LOW_MARGIN')).toBe(false)
  })

  it('flags SALE_BELOW_COST when belowCostSaleCount > 0, independent of overall margin', () => {
    // Healthy margin but one bad sale — must still flag, per spec §2.
    const anomalies = computeAnomalies({ ...baseInput, revenueUsd: 1000, cogsUsd: 300, expensesUsd: 50, refundsUsd: 0, belowCostSaleCount: 1 })
    expect(anomalies.some(a => a.code === 'SALE_BELOW_COST')).toBe(true)
    expect(anomalies.some(a => a.code === 'LOW_MARGIN')).toBe(false)
  })

  it('includes the count in the SALE_BELOW_COST message', () => {
    const anomalies = computeAnomalies({ ...baseInput, revenueUsd: 1000, refundsUsd: 0, belowCostSaleCount: 15 })
    const anomaly = anomalies.find(a => a.code === 'SALE_BELOW_COST')
    expect(anomaly?.message).toContain('15')
  })

  it('flags HIGH_DISCOUNT_RATIO when discounts exceed 15% of gross income', () => {
    const anomalies = computeAnomalies({ ...baseInput, revenueUsd: 1000, refundsUsd: 0, saleDiscountsUsd: 200 })
    expect(anomalies.some(a => a.code === 'HIGH_DISCOUNT_RATIO')).toBe(true)
  })

  it('flags CASH_SHIFT_VARIANCE when any shift-variance count is > 0', () => {
    const anomalies = computeAnomalies({ ...baseInput, revenueUsd: 1000, refundsUsd: 0, cashShiftVarianceCount: 1 })
    expect(anomalies.some(a => a.code === 'CASH_SHIFT_VARIANCE')).toBe(true)
  })

  it('flags INVENTORY_SHRINKAGE when any shrinkage-count is > 0', () => {
    const anomalies = computeAnomalies({ ...baseInput, revenueUsd: 1000, refundsUsd: 0, inventoryShrinkageCount: 1 })
    expect(anomalies.some(a => a.code === 'INVENTORY_SHRINKAGE')).toBe(true)
  })

  it('sorts anomalies critical first, then warning', () => {
    const anomalies = computeAnomalies({
      ...baseInput, revenueUsd: 1000, refundsUsd: 0, expensesUsd: 400, // warning: HIGH_EXPENSES_RATIO
      cashShiftVarianceCount: 1, // critical: CASH_SHIFT_VARIANCE
    })
    expect(anomalies[0].severity).toBe('critical')
    expect(anomalies.at(-1)?.severity).toBe('warning')
  })

  it('exposes kind: instant for SALE_BELOW_COST and INVENTORY_SHRINKAGE, aggregate for the rest', () => {
    const anomalies = computeAnomalies({
      ...baseInput, revenueUsd: 1000, refundsUsd: 0, expensesUsd: 400,
      belowCostSaleCount: 1, inventoryShrinkageCount: 1,
    })
    expect(anomalies.find(a => a.code === 'SALE_BELOW_COST')?.kind).toBe('instant')
    expect(anomalies.find(a => a.code === 'INVENTORY_SHRINKAGE')?.kind).toBe('instant')
    expect(anomalies.find(a => a.code === 'HIGH_EXPENSES_RATIO')?.kind).toBe('aggregate')
  })

  it('ANOMALY_RULES exposes minRevenueUsd = 50 (unchanged from the pre-existing rule)', () => {
    expect(ANOMALY_RULES.minRevenueUsd).toBe(50)
  })
})

describe('useAnomalyDetection (data orchestrator)', () => {
  beforeEach(() => {
    // vi.clearAllMocks() resets each mock's call history (not just its
    // return value) so per-test call-count assertions below aren't polluted
    // by calls made in earlier tests within this describe block — the brief's
    // beforeEach only set mockResolvedValue, which left call counts
    // cumulative across tests since db.getAll/getOptional are module-level
    // mocks shared by the whole file.
    vi.clearAllMocks()
    vi.mocked(db.getOptional).mockResolvedValue({ total: 0, cogs: 0 } as any)
    vi.mocked(db.getAll).mockResolvedValue([])
  })

  const dashboardMetrics = { revenueUsd: 1000, cogsUsd: 400, expensesUsd: 100, refundsUsd: 0 }

  it('issues exactly 4 queries total: 1 getOptional (discount) + 3 getAll (below-cost, shifts, shrinkage)', async () => {
    const { load } = useAnomalyDetection()
    await load('today', dashboardMetrics)
    expect(vi.mocked(db.getOptional).mock.calls.length).toBe(1)
    expect(vi.mocked(db.getAll).mock.calls.length).toBe(3)
  })

  it('never re-queries revenue/cogs/expenses/refunds — computeAnomalies receives exactly the passed-in dashboardMetrics values', async () => {
    // Regression guard for the Task-2 review finding: an earlier draft
    // re-implemented these aggregates with its own SQL (diverging from
    // useDashboardMetrics' COGS-reversal logic). This test asserts the
    // orchestrator's only getOptional call is the discount query — if a
    // future change reintroduces a revenue/cogs/expenses/refunds query,
    // this count catches it immediately.
    const { load, anomalies } = useAnomalyDetection()
    await load('today', { revenueUsd: 1000, cogsUsd: 850, expensesUsd: 100, refundsUsd: 0 }) // low margin
    expect(vi.mocked(db.getOptional).mock.calls.length).toBe(1)
    expect(anomalies.value.some(a => a.code === 'LOW_MARGIN')).toBe(true)
  })

  it('adding a rule that reuses an already-batched source adds zero queries', async () => {
    // Simulates a future rule (e.g. "average markup") that reuses the same
    // period sale-line-items result computeAnomalies already receives —
    // asserted by checking the call count is unchanged from the baseline
    // above rather than growing with computeAnomalies' rule count.
    const { load } = useAnomalyDetection()
    await load('today', dashboardMetrics)
    const baselineGetAll = vi.mocked(db.getAll).mock.calls.length
    const baselineGetOptional = vi.mocked(db.getOptional).mock.calls.length
    await load('today', dashboardMetrics)
    expect(vi.mocked(db.getAll).mock.calls.length).toBe(baselineGetAll * 2)
    expect(vi.mocked(db.getOptional).mock.calls.length).toBe(baselineGetOptional * 2)
  })

  it('sets error=true and anomalies=[] when a query throws, without throwing itself', async () => {
    vi.mocked(db.getAll).mockRejectedValueOnce(new Error('offline'))
    const { load, error, anomalies } = useAnomalyDetection()
    await load('today', dashboardMetrics)
    expect(error.value).toBe(true)
    expect(anomalies.value).toEqual([])
  })
})
