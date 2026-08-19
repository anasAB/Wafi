// WAFI-147A report 1/13. "generated at shift close or midnight" per the original
// spec's cadence -- this compute() is on-demand only; no scheduling here (147B).
import { db } from '@/data/powersync/db'
import { readProfitCache } from '../primitives/readProfitCache'
import { getStaffMetrics } from '../primitives/getStaffMetrics'
import { readShiftCashReconciliation } from '../primitives/readShiftCashReconciliation'
import { summarySection, detailSection } from '../report.types'
import type { Report, ReportDateRange } from '../report.types'
import { REPORT_DEFINITIONS } from '../reportRegistry'

export interface TopProductRow {
  productId: string
  nameAr: string
  quantitySold: number
  revenueUsd: number
}

export async function computeDailyClosingReport(shopId: string, range: ReportDateRange): Promise<Report> {
  const [profit, staff, cash, topProductRows, paymentsRow] = await Promise.all([
    readProfitCache(shopId, range),
    getStaffMetrics(shopId, range),
    readShiftCashReconciliation(shopId, range),
    db.getAll<TopProductRow>(
      `SELECT sli.product_id AS productId, p.name_ar AS nameAr,
              SUM(sli.quantity) AS quantitySold, SUM(sli.line_total_usd) AS revenueUsd
       FROM sale_line_items sli
       JOIN sales s ON s.id = sli.sale_id
       JOIN products p ON p.id = sli.product_id
       WHERE sli.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY sli.product_id, p.name_ar
       ORDER BY revenueUsd DESC LIMIT 5`,
      [shopId, range.from, range.to],
    ),
    // paid_at is a DATE column (verified, migration 009), not a timestamp --
    // plain BETWEEN is correct and inclusive with no end-of-day adjustment
    // needed. Do not "fix" this into a timestamp-style >=/< comparison; that
    // would be solving a problem this column doesn't have (Task 0 P1
    // finding 10, second review).
    db.getOptional<{ total: number }>(
      `SELECT COALESCE(SUM(amount_usd), 0) AS total FROM customer_payments
       WHERE shop_id = ? AND paid_at BETWEEN ? AND ?`,
      [shopId, range.from, range.to],
    ),
  ])

  return {
    id: 'daily-closing',
    name: 'Daily Closing Report',
    dateRange: range,
    generatedAt: new Date().toISOString(),
    sections: [
      summarySection({
        title: 'Sales Totals',
        metrics: [
          { label: 'Total sales', value: profit.revenueUsd, unit: 'USD' },
          { label: 'Transactions', value: profit.invoiceCount },
          { label: 'Average basket', value: profit.invoiceCount > 0 ? profit.revenueUsd / profit.invoiceCount : 0, unit: 'USD' },
        ],
      }),
      summarySection({
        title: 'Cash Reconciliation',
        metrics: [
          { label: 'Expected cash', value: cash.expectedUsd, unit: 'USD' },
          { label: 'Actual cash', value: cash.actualUsd, unit: 'USD' },
          { label: 'Variance', value: cash.varianceUsd, unit: 'USD' },
        ],
      }),
      summarySection({
        title: 'Expenses & Customer Payments',
        metrics: [
          { label: 'Expenses', value: profit.expensesUsd, unit: 'USD' },
          { label: 'Customer payments received', value: paymentsRow?.total ?? 0, unit: 'USD' },
        ],
      }),
      detailSection<TopProductRow>({
        title: 'Top 5 Products',
        columns: [
          { key: 'nameAr', label: 'Product' },
          { key: 'quantitySold', label: 'Qty' },
          { key: 'revenueUsd', label: 'Revenue' },
        ],
        rows: topProductRows,
      }),
      detailSection({
        title: 'Staff Performance',
        columns: [
          { key: 'name', label: 'Staff' },
          { key: 'revenueUsd', label: 'Revenue' },
          { key: 'salesCount', label: 'Sales' },
        ],
        rows: staff,
        visibility: 'staff', // Task 0 P0 finding 4 (second review) -- previously missing here
      }),
    ],
  }
}

REPORT_DEFINITIONS['daily-closing'] = {
  id: 'daily-closing',
  name: 'Daily Closing Report',
  cadenceHint: 'daily',
  compute: computeDailyClosingReport,
}
