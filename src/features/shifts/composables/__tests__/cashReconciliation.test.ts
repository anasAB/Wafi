import { describe, it, expect } from 'vitest'
import { computeCashReconciliation } from '../cashReconciliation'

describe('computeCashReconciliation', () => {
  it('exact match — zero variance', () => {
    const r = computeCashReconciliation({
      openingCashUsd:  50,
      cashUsdSales:    100,
      cashExpensesUsd: 20,
      closingCashUsd:  130,    // 50 + 100 - 20 = 130
      cashSypSalesRaw: 500_000,
      closingCashSyp:  500_000,
    })
    expect(r.expectedUsd).toBe(130)
    expect(r.varianceUsd).toBe(0)
    expect(r.expectedSyp).toBe(500_000)
    expect(r.varianceSyp).toBe(0)
  })

  it('shortage — cashier short by $5', () => {
    const r = computeCashReconciliation({
      openingCashUsd:  50,
      cashUsdSales:    100,
      cashExpensesUsd: 20,
      closingCashUsd:  125,    // expected 130, short $5
      cashSypSalesRaw: 0,
      closingCashSyp:  0,
    })
    expect(r.varianceUsd).toBe(-5)
  })

  it('overage — cashier over by $10', () => {
    const r = computeCashReconciliation({
      openingCashUsd:  50,
      cashUsdSales:    100,
      cashExpensesUsd: 20,
      closingCashUsd:  140,
      cashSypSalesRaw: 0,
      closingCashSyp:  0,
    })
    expect(r.varianceUsd).toBe(10)
  })

  it('no opening cash — pure sales', () => {
    const r = computeCashReconciliation({
      openingCashUsd:  0,
      cashUsdSales:    75,
      cashExpensesUsd: 0,
      closingCashUsd:  75,
      cashSypSalesRaw: 0,
      closingCashSyp:  0,
    })
    expect(r.expectedUsd).toBe(75)
    expect(r.varianceUsd).toBe(0)
  })

  it('SYP variance calculated correctly', () => {
    const r = computeCashReconciliation({
      openingCashUsd:  0,
      cashUsdSales:    0,
      cashExpensesUsd: 0,
      closingCashUsd:  0,
      cashSypSalesRaw: 1_000_000,
      closingCashSyp:  950_000,
    })
    expect(r.expectedSyp).toBe(1_000_000)
    expect(r.varianceSyp).toBe(-50_000)
  })
})
