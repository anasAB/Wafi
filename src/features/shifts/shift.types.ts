export interface CashierShift {
  id:             string
  shopId:         string
  deviceId:       string
  staffId:        string
  openedAt:       string        // ISO timestamp
  closedAt:       string | null // null = still open
  openingCashUsd: number
  openingCashSyp: number        // WAFI-059: opening cash in SYP (primary currency); 0 default
  closingCashUsd: number | null
  closingCashSyp: number | null
  // WAFI-060 — immutable close evidence. Optional so callers/fixtures predating the
  // column stay valid; rowToShift always populates them (null until a shift closes).
  varianceUsd?:   number | null
  varianceSyp?:   number | null
  closeNote?:     string | null
  forceClosedBy?: string | null
  zReportData?:   ZReportMetrics | null  // Z-report snapshot captured at close
  status:         'open' | 'closed'
}

/**
 * Severity of a cash variance, for consistent colour-coding across the shift
 * history rows and the detail screen (WAFI-061):
 *   'match' (exact, green) · 'warn' (<5%, yellow) · 'alert' (≥5%, red).
 * A nonzero variance against a zero expected is 'alert' (unexplained cash).
 */
export type VarianceLevel = 'match' | 'warn' | 'alert'

export function varianceLevel(variance: number, expected: number): VarianceLevel {
  if (variance === 0) return 'match'
  if (expected === 0) return 'alert'
  return Math.abs(variance) / Math.abs(expected) >= 0.05 ? 'alert' : 'warn'
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
