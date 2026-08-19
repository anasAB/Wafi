import { db } from '@/data/powersync/db'
import { readProfitCache } from '../primitives/readProfitCache'
import { getStaffMetrics } from '../primitives/getStaffMetrics'
import { summarySection, detailSection } from '../report.types'
import type { Report, ReportDateRange } from '../report.types'
import { REPORT_DEFINITIONS } from '../reportRegistry'

export interface ReturnByProductRow { productId: string; nameAr: string; returnCount: number; refundUsd: number }
export interface ReturnByReasonRow { reason: string; count: number }
export interface ReturnByStaffRow { staffId: string; name: string; returnCount: number; returnRevenueUsd: number }

// Same shape risk and same cap as Task 11's Discount Report -- "By Product" (one row per
// distinct returned product) and "Return Reasons" can both exceed a size safe to render as
// one mobile DetailSection. Kept as a local constant (not imported from discountReport.ts)
// since report definitions are deliberately independent modules, not coupled through
// cross-imports of each other's internals.
const DETAIL_ROW_CAP = 500

export async function computeReturnsReport(shopId: string, range: ReportDateRange): Promise<Report> {
  const [profit, staff, byProductRows, byReasonRows] = await Promise.all([
    readProfitCache(shopId, range),
    getStaffMetrics(shopId, range),
    db.getAll<ReturnByProductRow>(
      `SELECT rli.product_id AS productId, p.name_ar AS nameAr,
              COUNT(*) AS returnCount, SUM(rli.qty_returned * rli.unit_price_usd) AS refundUsd
       FROM return_line_items rli
       JOIN returns r ON r.id = rli.return_id
       JOIN products p ON p.id = rli.product_id
       WHERE r.shop_id = ? AND DATE(r.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY rli.product_id, p.name_ar ORDER BY refundUsd DESC LIMIT ?`,
      [shopId, range.from, range.to, DETAIL_ROW_CAP + 1],
    ),
    db.getAll<ReturnByReasonRow>(
      `SELECT COALESCE(reason, 'unspecified') AS reason, COUNT(*) AS count
       FROM returns WHERE shop_id = ? AND DATE(created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY reason ORDER BY count DESC LIMIT ?`,
      [shopId, range.from, range.to, DETAIL_ROW_CAP + 1],
    ),
  ])
  const byProduct = byProductRows.slice(0, DETAIL_ROW_CAP)
  const byProductTruncated = byProductRows.length > DETAIL_ROW_CAP
  const byReason = byReasonRows.slice(0, DETAIL_ROW_CAP)
  const byReasonTruncated = byReasonRows.length > DETAIL_ROW_CAP

  return {
    id: 'returns-report', name: 'Returns Report', dateRange: range, generatedAt: new Date().toISOString(),
    sections: [
      summarySection({
        title: 'Total Returns',
        metrics: [
          { label: 'Return count', value: profit.returnCount },
          { label: 'Return value', value: profit.refundsUsd, unit: 'USD' },
        ],
      }),
      detailSection<ReturnByStaffRow>({
        title: 'By Staff',
        columns: [{ key: 'name', label: 'Staff' }, { key: 'returnCount', label: 'Count' }, { key: 'returnRevenueUsd', label: 'Refund' }],
        rows: staff
          .filter((s) => s.returnCount > 0)
          .map((s): ReturnByStaffRow => ({ staffId: s.staffId, name: s.name, returnCount: s.returnCount, returnRevenueUsd: s.returnRevenueUsd })),
        visibility: 'staff',
      }),
      detailSection<ReturnByProductRow>({
        title: 'By Product',
        columns: [{ key: 'nameAr', label: 'Product' }, { key: 'returnCount', label: 'Count', align: 'end' }, { key: 'refundUsd', label: 'Refund', format: 'currency-usd', align: 'end' }],
        rows: byProduct,
        truncated: byProductTruncated,
      }),
      detailSection<ReturnByReasonRow>({
        title: 'Return Reasons',
        columns: [{ key: 'reason', label: 'Reason' }, { key: 'count', label: 'Count', align: 'end' }],
        rows: byReason,
        truncated: byReasonTruncated,
      }),
    ],
  }
}

REPORT_DEFINITIONS['returns-report'] = { id: 'returns-report', name: 'Returns Report', cadenceHint: 'weekly', compute: computeReturnsReport }
