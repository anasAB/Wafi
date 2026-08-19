import { db } from '@/data/powersync/db'
import { readProfitCache } from '../primitives/readProfitCache'
import { getStaffMetrics } from '../primitives/getStaffMetrics'
import { summarySection, detailSection } from '../report.types'
import type { Report, ReportDateRange } from '../report.types'
import { REPORT_DEFINITIONS } from '../reportRegistry'

export interface DiscountByProductRow { productId: string; nameAr: string; discountUsd: number }
export interface BelowCostSaleRow { saleId: string; productId: string; nameAr: string; unitPriceUsd: number; unitCostUsd: number }

// Both "By Product" (one row per distinct product) and "Below-Cost Sales" (one row per
// matching line item, genuinely unbounded over a wide range) can exceed a size that's safe
// to render as a single mobile DetailSection -- fetch one extra row over the cap so the
// exact-boundary case (rows.length === DETAIL_ROW_CAP) is never misreported as truncated.
const DETAIL_ROW_CAP = 500

export async function computeDiscountReport(shopId: string, range: ReportDateRange): Promise<Report> {
  const [profit, staff, byProductRows, belowCostRows] = await Promise.all([
    readProfitCache(shopId, range),
    getStaffMetrics(shopId, range),
    db.getAll<DiscountByProductRow>(
      `SELECT sli.product_id AS productId, p.name_ar AS nameAr,
              SUM(COALESCE(sli.discount_amount_usd, 0)) AS discountUsd
       FROM sale_line_items sli
       JOIN products p ON p.id = sli.product_id
       JOIN sales s ON s.id = sli.sale_id
       WHERE sli.shop_id = ? AND sli.discount_amount_usd > 0
         AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY sli.product_id, p.name_ar ORDER BY discountUsd DESC LIMIT ?`,
      [shopId, range.from, range.to, DETAIL_ROW_CAP + 1],
    ),
    db.getAll<BelowCostSaleRow>(
      `SELECT sli.sale_id AS saleId, sli.product_id AS productId, p.name_ar AS nameAr,
              sli.unit_price_usd AS unitPriceUsd, COALESCE(sli.unit_cost_usd, 0) AS unitCostUsd
       FROM sale_line_items sli
       JOIN sales s ON s.id = sli.sale_id
       JOIN products p ON p.id = sli.product_id
       WHERE sli.shop_id = ? AND sli.unit_cost_usd IS NOT NULL AND sli.unit_price_usd < sli.unit_cost_usd
         AND DATE(s.created_at, 'localtime') BETWEEN ? AND ? LIMIT ?`,
      [shopId, range.from, range.to, DETAIL_ROW_CAP + 1],
    ),
  ])
  const byProduct = byProductRows.slice(0, DETAIL_ROW_CAP)
  const byProductTruncated = byProductRows.length > DETAIL_ROW_CAP
  const belowCost = belowCostRows.slice(0, DETAIL_ROW_CAP)
  const belowCostTruncated = belowCostRows.length > DETAIL_ROW_CAP

  return {
    id: 'discount-report', name: 'Discount Report', dateRange: range, generatedAt: new Date().toISOString(),
    sections: [
      summarySection({ title: 'Total Discounts', metrics: [{ label: 'Total discount given', value: profit.discountUsd, unit: 'USD' }] }),
      detailSection({
        title: 'By Staff',
        columns: [{ key: 'name', label: 'Staff' }, { key: 'discountUsd', label: 'Discount' }],
        rows: [...staff].sort((a, b) => b.discountUsd - a.discountUsd),
        visibility: 'staff',
      }),
      detailSection<DiscountByProductRow>({
        title: 'By Product',
        columns: [{ key: 'nameAr', label: 'Product' }, { key: 'discountUsd', label: 'Discount', format: 'currency-usd', align: 'end' }],
        rows: byProduct,
        truncated: byProductTruncated,
      }),
      detailSection<BelowCostSaleRow>({
        title: 'Below-Cost Sales',
        columns: [{ key: 'nameAr', label: 'Product' }, { key: 'unitPriceUsd', label: 'Sold at', format: 'currency-usd', align: 'end' }, { key: 'unitCostUsd', label: 'Cost', format: 'currency-usd', align: 'end' }],
        rows: belowCost,
        truncated: belowCostTruncated,
      }),
    ],
  }
}

REPORT_DEFINITIONS['discount-report'] = { id: 'discount-report', name: 'Discount Report', cadenceHint: 'weekly', compute: computeDiscountReport }
