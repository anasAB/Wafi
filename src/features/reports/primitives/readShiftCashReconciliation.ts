// src/features/reports/primitives/readShiftCashReconciliation.ts
// WAFI-147A primitive 4 (added by Task 0, finding 2): the ONLY source of cash-
// reconciliation figures for any report -- never recompute expected/actual/
// variance from raw revenue and expenses. z_report_data is an immutable
// snapshot of ZReportMetrics (shift.types.ts), captured at close time by the
// app's own verified computeCashReconciliation engine (cashReconciliation.ts,
// via useZReport.ts) -- it already accounts for cash sales, cash credit-
// payment collection, cash refunds, and mid-shift pay-ins/pay-outs.
import { db } from '@/data/powersync/db'
import type { ReportDateRange } from '../report.types'

export interface ShiftCashSummary {
  expectedUsd: number; actualUsd: number; varianceUsd: number
  cashSalesUsd: number; cashExpensesUsd: number; cashRefundsUsd: number
  cashCreditPaymentsUsd: number; cashPayInsUsd: number; cashPayOutsUsd: number
}

const ZERO: ShiftCashSummary = {
  expectedUsd: 0, actualUsd: 0, varianceUsd: 0, cashSalesUsd: 0, cashExpensesUsd: 0,
  cashRefundsUsd: 0, cashCreditPaymentsUsd: 0, cashPayInsUsd: 0, cashPayOutsUsd: 0,
}

// Subset of ZReportMetrics (shift.types.ts) this primitive reads back out of the
// JSON snapshot -- field names must match that interface exactly, since
// z_report_data is JSON.stringify(zReport) written verbatim at close time.
type ZReportSubset = {
  expectedUsd: number; actualUsd: number; varianceUsd: number
  cashUsdSales: number; cashExpensesUsd: number; cashRefundsUsd: number
  cashCreditPaymentsUsd: number; cashPayInsUsd: number; cashPayOutsUsd: number
}

const REQUIRED_FIELDS: (keyof ZReportSubset)[] = [
  'expectedUsd', 'actualUsd', 'varianceUsd', 'cashUsdSales', 'cashExpensesUsd',
  'cashRefundsUsd', 'cashCreditPaymentsUsd', 'cashPayInsUsd', 'cashPayOutsUsd',
]

/** Task 0 P0 finding 12: a financial report must never silently treat
 *  malformed/incomplete z_report_data as zero -- that would understate real
 *  cash movement and look like a clean reconciliation when the underlying
 *  data is actually broken. JSON.parse() throwing, or any required field
 *  being missing/non-finite (NaN, undefined, a string), is treated as a hard
 *  failure: this function throws, which surfaces as the report's visible
 *  error state (ReportDetailPage.vue's existing catch/error.value), not a
 *  silently-wrong number. A legacy pre-WAFI-060 row with a genuinely NULL
 *  z_report_data column is the one deliberately tolerated case -- that's a
 *  known, documented absence (shifts closed before the Z-report snapshot
 *  existed), not malformed data. */
function parseZReport(shiftId: string, raw: string): ZReportSubset {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`readShiftCashReconciliation: shift ${shiftId} has unparseable z_report_data`)
  }
  const obj = parsed as Record<string, unknown>
  for (const field of REQUIRED_FIELDS) {
    const value = obj[field]
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`readShiftCashReconciliation: shift ${shiftId}'s z_report_data.${field} is missing or not a finite number`)
    }
  }
  return obj as unknown as ZReportSubset
}

export async function readShiftCashReconciliation(shopId: string, range: ReportDateRange): Promise<ShiftCashSummary> {
  const rows = await db.getAll<{ id: string; z_report_data: string | null }>(
    `SELECT id, z_report_data FROM cashier_shifts
     WHERE shop_id = ? AND status = 'closed' AND DATE(closed_at, 'localtime') BETWEEN ? AND ?`,
    [shopId, range.from, range.to],
  )

  return rows.reduce<ShiftCashSummary>((acc, row) => {
    if (!row.z_report_data) return acc // legacy pre-WAFI-060 row, no snapshot -- contributes nothing, does not throw
    const z = parseZReport(row.id, row.z_report_data)
    return {
      expectedUsd: acc.expectedUsd + z.expectedUsd,
      actualUsd: acc.actualUsd + z.actualUsd,
      varianceUsd: acc.varianceUsd + z.varianceUsd,
      cashSalesUsd: acc.cashSalesUsd + z.cashUsdSales,
      cashExpensesUsd: acc.cashExpensesUsd + z.cashExpensesUsd,
      cashRefundsUsd: acc.cashRefundsUsd + z.cashRefundsUsd,
      cashCreditPaymentsUsd: acc.cashCreditPaymentsUsd + z.cashCreditPaymentsUsd,
      cashPayInsUsd: acc.cashPayInsUsd + z.cashPayInsUsd,
      cashPayOutsUsd: acc.cashPayOutsUsd + z.cashPayOutsUsd,
    }
  }, ZERO)
}
