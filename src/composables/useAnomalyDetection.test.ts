import { describe, it, expect } from 'vitest'
import { computeAnomalies, ANOMALY_RULES, type AnomalyInput } from './useAnomalyDetection'

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
