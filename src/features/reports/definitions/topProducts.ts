import { db } from '@/data/powersync/db'
import { detailSection } from '../report.types'
import type { Report, ReportDateRange } from '../report.types'
import { REPORT_DEFINITIONS } from '../reportRegistry'

export interface TopProductByMetricRow { productId: string; nameAr: string; value: number }

async function topBy(shopId: string, range: ReportDateRange, sql: string): Promise<TopProductByMetricRow[]> {
  return db.getAll<TopProductByMetricRow>(sql, [shopId, range.from, range.to])
}

export async function computeTopProductsReport(shopId: string, range: ReportDateRange): Promise<Report> {
  const [byRevenue, byQty, byProfit, mostDiscounted, mostReturned] = await Promise.all([
    topBy(shopId, range, `SELECT sli.product_id AS productId, p.name_ar AS nameAr, SUM(sli.line_total_usd) AS value
      FROM sale_line_items sli JOIN products p ON p.id = sli.product_id JOIN sales s ON s.id = sli.sale_id
      WHERE sli.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
      GROUP BY sli.product_id, p.name_ar ORDER BY value DESC LIMIT 20`),
    topBy(shopId, range, `SELECT sli.product_id AS productId, p.name_ar AS nameAr, SUM(sli.quantity) AS value
      FROM sale_line_items sli JOIN products p ON p.id = sli.product_id JOIN sales s ON s.id = sli.sale_id
      WHERE sli.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
      GROUP BY sli.product_id, p.name_ar ORDER BY value DESC LIMIT 20`),
    // "Profit" = GROSS sale-line profit, not net of returns -- see this task's
    // Interfaces note above for why netting is deliberately out of scope here.
    topBy(shopId, range, `SELECT sli.product_id AS productId, p.name_ar AS nameAr,
        SUM(sli.line_total_usd - sli.quantity * COALESCE(sli.unit_cost_usd, 0)) AS value
      FROM sale_line_items sli JOIN products p ON p.id = sli.product_id JOIN sales s ON s.id = sli.sale_id
      WHERE sli.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
      GROUP BY sli.product_id, p.name_ar ORDER BY value DESC LIMIT 20`),
    topBy(shopId, range, `SELECT sli.product_id AS productId, p.name_ar AS nameAr,
        SUM(COALESCE(sli.discount_amount_usd, 0)) AS value
      FROM sale_line_items sli JOIN products p ON p.id = sli.product_id JOIN sales s ON s.id = sli.sale_id
      WHERE sli.shop_id = ? AND sli.discount_amount_usd > 0
        AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
      GROUP BY sli.product_id, p.name_ar ORDER BY value DESC LIMIT 20`),
    // "Most Returned" = UNITS returned (SUM(qty_returned)), not return-
    // transaction count -- one return transaction can return several units.
    topBy(shopId, range, `SELECT rli.product_id AS productId, p.name_ar AS nameAr, SUM(rli.qty_returned) AS value
      FROM return_line_items rli JOIN products p ON p.id = rli.product_id JOIN returns r ON r.id = rli.return_id
      WHERE r.shop_id = ? AND DATE(r.created_at, 'localtime') BETWEEN ? AND ?
      GROUP BY rli.product_id, p.name_ar ORDER BY value DESC LIMIT 20`),
  ])

  const cols = [{ key: 'nameAr' as const, label: 'Product' }, { key: 'value' as const, label: 'Value' }]
  return {
    id: 'top-products', name: 'Top Products Report', dateRange: range, generatedAt: new Date().toISOString(),
    sections: [
      detailSection<TopProductByMetricRow>({ title: 'Top 20 by Revenue', columns: cols, rows: byRevenue }),
      detailSection<TopProductByMetricRow>({ title: 'Top 20 by Quantity Sold', columns: cols, rows: byQty }),
      detailSection<TopProductByMetricRow>({ title: 'Top 20 by Profit (gross, not net of returns)', columns: cols, rows: byProfit }),
      detailSection<TopProductByMetricRow>({ title: 'Most Discounted', columns: cols, rows: mostDiscounted }),
      detailSection<TopProductByMetricRow>({ title: 'Most Returned (units)', columns: cols, rows: mostReturned }),
    ],
  }
}

REPORT_DEFINITIONS['top-products'] = { id: 'top-products', name: 'Top Products Report', cadenceHint: 'monthly', compute: computeTopProductsReport }
