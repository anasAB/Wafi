interface ReconciliationInput {
  openingCashUsd:  number
  cashUsdSales:    number
  cashExpensesUsd: number
  closingCashUsd:  number
  cashSypSalesRaw: number
  closingCashSyp:  number
}

export interface ReconciliationResult {
  expectedUsd: number
  varianceUsd: number
  expectedSyp: number
  varianceSyp: number
}

export function computeCashReconciliation(input: ReconciliationInput): ReconciliationResult {
  const expectedUsd = input.openingCashUsd + input.cashUsdSales - input.cashExpensesUsd
  const expectedSyp = input.cashSypSalesRaw
  return {
    expectedUsd,
    varianceUsd: input.closingCashUsd - expectedUsd,
    expectedSyp,
    varianceSyp: input.closingCashSyp - expectedSyp,
  }
}
