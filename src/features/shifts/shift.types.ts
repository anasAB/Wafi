// WAFI-103 — denomination tally: value (as string, e.g. "5000") → count. Null
// means the cashier used the "enter total directly" fallback for that side.
export type DenominationBreakdown = Record<string, number>

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
  // WAFI-103 — denomination breakdown evidence, one JSON object per currency pair
  // keyed by denomination value; absent/null = manual total entry was used.
  openingBreakdown?: { usd: DenominationBreakdown; syp: DenominationBreakdown } | null
  closingBreakdown?: { usd: DenominationBreakdown; syp: DenominationBreakdown } | null
  // WAFI-065 — 'abandoned' is reserved for orphaned shifts cleared without a count.
  // It is NEVER a fake 'closed': abandoned shifts carry no counted cash/variance and
  // are excluded from revenue/variance analytics. Schema-only for now — nothing is
  // auto-abandoned without a configured threshold + PO sign-off.
  status:         'open' | 'closed' | 'abandoned'
}

// WAFI-065 Part 3 — a shift still 'open' past this many hours is almost certainly a
// forgotten/orphaned ("zombie") shift: a normal retail shift is ≤12h, so >18h means
// it spanned overnight. Used for the long-open badge + history filter. One constant,
// trivial to tune; a real shop-close-time setting can replace it later.
export const LONG_OPEN_HOURS = 18

/**
 * True when `shift` is still open and has been open longer than LONG_OPEN_HOURS.
 * `nowMs` is injected (not read from the clock) so callers stay deterministic/testable.
 */
export function isLongOpen(shift: CashierShift, nowMs: number): boolean {
  if (shift.status !== 'open') return false
  const openedMs = new Date(shift.openedAt).getTime()
  return nowMs - openedMs > LONG_OPEN_HOURS * 3_600_000
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
  cashPayInsUsd:   number   // cash added to the USD drawer mid-shift (movements)
  cashPayInsSyp:   number
  cashPayOutsUsd:  number   // cash removed from the USD drawer mid-shift (movements)
  cashPayOutsSyp:  number
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
