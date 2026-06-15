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
}
