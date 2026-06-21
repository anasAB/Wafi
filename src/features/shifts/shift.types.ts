export interface CashierShift {
  id:             string
  shopId:         string
  deviceId:       string
  staffId:        string
  openedAt:       string        // ISO timestamp
  closedAt:       string | null // null = still open
  openingCashUsd: number
  closingCashUsd: number | null
  closingCashSyp: number | null
  status:         'open' | 'closed'
}

/** One operator's sales within a single shift (operator switching). */
export interface OperatorSales {
  staffId:    string | null   // null for sales rung before per-operator attribution
  name:       string | null   // staff name, null when unattributed
  salesCount: number
  totalUsd:   number
}

export interface ZReportMetrics {
  invoiceCount:    number
  totalRevenueUsd: number
  cashUsdSales:    number
  cashSypSalesRaw: number   // raw SYP amount as entered by cashier
  cardSales:       number
  creditSales:     number
  cashExpensesUsd: number
  cashExpensesSyp: number
  cashRefundsUsd:  number
  cashRefundsSyp:  number
  cashCreditPaymentsUsd: number  // cash USD collected against customer credit
  cashCreditPaymentsSyp: number  // cash SYP collected against customer credit
  // USD reconciliation
  expectedUsd:     number
  actualUsd:       number
  varianceUsd:     number
  // SYP reconciliation
  expectedSyp:     number
  actualSyp:       number
  varianceSyp:     number
  // duration
  durationMinutes: number
  // per-operator sales breakdown within this one shift (cash variance above stays
  // a single shift-level figure)
  byOperator:      OperatorSales[]
}
