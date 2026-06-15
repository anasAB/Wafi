interface ReconciliationInput {
  openingCashUsd:  number
  cashUsdSales:    number
  cashExpensesUsd: number
  closingCashUsd:  number
  cashSypSalesRaw: number
  closingCashSyp:  number
  // Optional — default 0 so existing callers keep their behavior.
  cashExpensesSyp?: number  // SYP-denominated cash expenses (leave the SYP drawer)
  cashRefundsUsd?:  number  // cash USD refunds paid out this shift
  cashRefundsSyp?:  number  // cash SYP refunds paid out this shift
}

export interface ReconciliationResult {
  expectedUsd: number
  varianceUsd: number
  expectedSyp: number
  varianceSyp: number
}

export function computeCashReconciliation(input: ReconciliationInput): ReconciliationResult {
  const cashExpensesSyp = input.cashExpensesSyp ?? 0
  const cashRefundsUsd  = input.cashRefundsUsd  ?? 0
  const cashRefundsSyp  = input.cashRefundsSyp  ?? 0

  // Each currency reconciles against its own drawer. SYP expenses/refunds must hit the
  // SYP bucket — not the USD one — or both variances are wrong.
  const expectedUsd =
    input.openingCashUsd + input.cashUsdSales - input.cashExpensesUsd - cashRefundsUsd
  const expectedSyp =
    input.cashSypSalesRaw - cashExpensesSyp - cashRefundsSyp

  return {
    expectedUsd,
    varianceUsd: input.closingCashUsd - expectedUsd,
    expectedSyp,
    varianceSyp: input.closingCashSyp - expectedSyp,
  }
}
