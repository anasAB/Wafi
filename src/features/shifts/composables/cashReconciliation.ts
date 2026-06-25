interface ReconciliationInput {
  openingCashUsd:  number
  cashUsdSales:    number
  cashExpensesUsd: number
  closingCashUsd:  number
  cashSypSalesRaw: number
  closingCashSyp:  number
  // Optional — default 0 so existing callers keep their behavior.
  openingCashSyp?:  number  // WAFI-059: opening cash counted in SYP (enters the SYP drawer)
  cashExpensesSyp?: number  // SYP-denominated cash expenses (leave the SYP drawer)
  cashRefundsUsd?:  number  // cash USD refunds paid out this shift
  cashRefundsSyp?:  number  // cash SYP refunds paid out this shift
  cashCreditPaymentsUsd?: number  // cash USD collected against customer credit (enters the drawer)
  cashCreditPaymentsSyp?: number  // cash SYP collected against customer credit (enters the drawer)
}

export interface ReconciliationResult {
  expectedUsd: number
  varianceUsd: number
  expectedSyp: number
  varianceSyp: number
}

export function computeCashReconciliation(input: ReconciliationInput): ReconciliationResult {
  const openingCashSyp        = input.openingCashSyp        ?? 0
  const cashExpensesSyp       = input.cashExpensesSyp       ?? 0
  const cashRefundsUsd        = input.cashRefundsUsd        ?? 0
  const cashRefundsSyp        = input.cashRefundsSyp        ?? 0
  const cashCreditPaymentsUsd = input.cashCreditPaymentsUsd ?? 0
  const cashCreditPaymentsSyp = input.cashCreditPaymentsSyp ?? 0

  // Each currency reconciles against its own drawer. SYP expenses/refunds must hit the
  // SYP bucket — not the USD one — or both variances are wrong. Cash credit-payments
  // are an inflow (customer hands over cash to settle debt). The opening balance is the
  // baseline each drawer starts from (WAFI-059 adds the SYP opening, mirroring USD).
  const expectedUsd =
    input.openingCashUsd + input.cashUsdSales + cashCreditPaymentsUsd
    - input.cashExpensesUsd - cashRefundsUsd
  const expectedSyp =
    openingCashSyp + input.cashSypSalesRaw + cashCreditPaymentsSyp
    - cashExpensesSyp - cashRefundsSyp

  return {
    expectedUsd,
    varianceUsd: input.closingCashUsd - expectedUsd,
    expectedSyp,
    varianceSyp: input.closingCashSyp - expectedSyp,
  }
}
