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

  it('SYP cash expenses reduce the SYP bucket, not the USD one', () => {
    const r = computeCashReconciliation({
      openingCashUsd:  100,
      cashUsdSales:    0,
      cashExpensesUsd: 0,
      closingCashUsd:  100,
      cashSypSalesRaw: 1_000_000,
      closingCashSyp:  700_000,
      cashExpensesSyp: 300_000,
    })
    expect(r.expectedUsd).toBe(100)       // USD drawer untouched by a SYP expense
    expect(r.varianceUsd).toBe(0)
    expect(r.expectedSyp).toBe(700_000)   // 1,000,000 - 300,000
    expect(r.varianceSyp).toBe(0)
  })

  it('cash credit-payments increase the expected cash in each currency', () => {
    // A customer paying down credit in cash physically enters the drawer, so it
    // must raise expected cash. Non-cash credit payments (wire/USDT) are excluded
    // by the caller, so only cash amounts reach here.
    const r = computeCashReconciliation({
      openingCashUsd:        50,
      cashUsdSales:          100,
      cashExpensesUsd:       0,
      closingCashUsd:        180,        // 50 + 100 + 30 credit cash
      cashSypSalesRaw:       0,
      closingCashSyp:        200_000,    // 0 + 200,000 credit cash
      cashCreditPaymentsUsd: 30,
      cashCreditPaymentsSyp: 200_000,
    })
    expect(r.expectedUsd).toBe(180)
    expect(r.varianceUsd).toBe(0)
    expect(r.expectedSyp).toBe(200_000)
    expect(r.varianceSyp).toBe(0)
  })

  it('opening SYP forms the SYP-drawer baseline (WAFI-059)', () => {
    // Open with SYP=50,000 + USD=35; no sales/expenses → expected = the opening balances.
    const r = computeCashReconciliation({
      openingCashUsd:  35,
      openingCashSyp:  50_000,
      cashUsdSales:    0,
      cashExpensesUsd: 0,
      closingCashUsd:  35,
      cashSypSalesRaw: 0,
      closingCashSyp:  50_000,
    })
    expect(r.expectedSyp).toBe(50_000)
    expect(r.varianceSyp).toBe(0)
    expect(r.expectedUsd).toBe(35)
    expect(r.varianceUsd).toBe(0)
  })

  it('cash refunds reduce the expected cash in each currency', () => {
    const r = computeCashReconciliation({
      openingCashUsd:  50,
      cashUsdSales:    100,
      cashExpensesUsd: 0,
      closingCashUsd:  130,
      cashSypSalesRaw: 500_000,
      closingCashSyp:  450_000,
      cashRefundsUsd:  20,
      cashRefundsSyp:  50_000,
    })
    expect(r.expectedUsd).toBe(130)       // 50 + 100 - 20
    expect(r.varianceUsd).toBe(0)
    expect(r.expectedSyp).toBe(450_000)   // 500,000 - 50,000
    expect(r.varianceSyp).toBe(0)
  })

  it('pay-ins raise and pay-outs lower the expected USD cash', () => {
    const r = computeCashReconciliation({
      openingCashUsd:  50,
      cashUsdSales:    100,
      cashExpensesUsd: 0,
      closingCashUsd:  130,            // 50 + 100 + 20 payIn - 40 payOut = 130
      cashSypSalesRaw: 0,
      closingCashSyp:  0,
      cashPayInsUsd:   20,
      cashPayOutsUsd:  40,
    })
    expect(r.expectedUsd).toBe(130)
    expect(r.varianceUsd).toBe(0)
  })

  it('a SYP drop (pay-out) lowers expected SYP only, not USD', () => {
    const r = computeCashReconciliation({
      openingCashUsd:  100,
      cashUsdSales:    0,
      cashExpensesUsd: 0,
      closingCashUsd:  100,
      cashSypSalesRaw: 1_000_000,
      closingCashSyp:  700_000,        // 1,000,000 - 300,000 dropped to safe
      cashPayOutsSyp:  300_000,
    })
    expect(r.expectedUsd).toBe(100)
    expect(r.varianceUsd).toBe(0)
    expect(r.expectedSyp).toBe(700_000)
    expect(r.varianceSyp).toBe(0)
  })

  it('a void nets to zero (pay-out + equal reversing pay-in) → no variance impact', () => {
    const r = computeCashReconciliation({
      openingCashUsd:  50,
      cashUsdSales:    0,
      cashExpensesUsd: 0,
      closingCashUsd:  50,
      cashSypSalesRaw: 0,
      closingCashSyp:  0,
      cashPayOutsUsd:  30,             // original pay-out
      cashPayInsUsd:   30,             // its reversing void row (opposite direction)
    })
    expect(r.expectedUsd).toBe(50)
    expect(r.varianceUsd).toBe(0)
  })
})
