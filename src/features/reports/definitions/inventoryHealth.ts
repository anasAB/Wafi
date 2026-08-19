import { db } from '@/data/powersync/db'
import { summarySection, detailSection } from '../report.types'
import type { Report, ReportDateRange } from '../report.types'
import { REPORT_DEFINITIONS } from '../reportRegistry'
import { queryDeadStockRows } from '../primitives/queryDeadStockRows'
import type { DeadStockRow } from '../primitives/queryDeadStockRows'

export interface LowStockRow { productId: string; nameAr: string; currentStock: number; lowStockThreshold: number }
export interface VelocityRow { productId: string; nameAr: string; quantitySold: number }

const DEAD_STOCK_THRESHOLD_DAYS = 90 // spec offers 60/90/180; 90 is the shared default (matches useDeadStockReport.ts)

export async function computeInventoryHealthReport(shopId: string, range: ReportDateRange): Promise<Report> {
  const [lowStock, fastMovers, slowMovers, valuationRow, deadStockResult] = await Promise.all([
    db.getAll<LowStockRow>(
      `SELECT id AS productId, name_ar AS nameAr, current_stock AS currentStock, low_stock_threshold AS lowStockThreshold
       FROM products WHERE shop_id = ? AND (deleted = 0 OR deleted IS NULL)
         AND low_stock_threshold IS NOT NULL AND current_stock <= low_stock_threshold`,
      [shopId],
    ),
    db.getAll<VelocityRow>(
      `SELECT sli.product_id AS productId, p.name_ar AS nameAr, SUM(sli.quantity) AS quantitySold
       FROM sale_line_items sli JOIN products p ON p.id = sli.product_id JOIN sales s ON s.id = sli.sale_id
       WHERE sli.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY sli.product_id, p.name_ar ORDER BY quantitySold DESC LIMIT 20`,
      [shopId, range.from, range.to],
    ),
    db.getAll<VelocityRow>(
      `SELECT sli.product_id AS productId, p.name_ar AS nameAr, SUM(sli.quantity) AS quantitySold
       FROM sale_line_items sli JOIN products p ON p.id = sli.product_id JOIN sales s ON s.id = sli.sale_id
       WHERE sli.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY sli.product_id, p.name_ar ORDER BY quantitySold ASC LIMIT 20`,
      [shopId, range.from, range.to],
    ),
    db.getOptional<{ totalCost: number; totalCogs: number }>(
      `SELECT COALESCE(SUM(current_stock * cost_price_usd), 0) AS totalCost, 0 AS totalCogs
       FROM products WHERE shop_id = ? AND (deleted = 0 OR deleted IS NULL)`,
      [shopId],
    ),
    queryDeadStockRows(shopId, DEAD_STOCK_THRESHOLD_DAYS),
  ])

  // Turnover rate = COGS sold in range / average inventory value. Average inventory
  // value needs a start-of-period snapshot this codebase does not retain (products
  // only carry current_stock, not historical stock-on-hand-by-date) -- approximate
  // with current valuation as the denominator, documented as an approximation in
  // the metric label itself so it is never confused with a true historical average.
  const cogsInRange = await db.getOptional<{ cogs: number }>(
    `SELECT COALESCE(SUM(sli.quantity * COALESCE(sli.unit_cost_usd, 0)), 0) AS cogs
     FROM sale_line_items sli JOIN sales s ON s.id = sli.sale_id
     WHERE sli.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?`,
    [shopId, range.from, range.to],
  )
  const currentValuation = valuationRow?.totalCost ?? 0
  const turnoverRate = currentValuation > 0 ? (cogsInRange?.cogs ?? 0) / currentValuation : 0
  const { rows: deadStock, truncated: deadStockTruncated } = deadStockResult

  return {
    id: 'inventory-health', name: 'Inventory Health Report', dateRange: range, generatedAt: new Date().toISOString(),
    sections: [
      summarySection({
        // "(current snapshot)" is load-bearing, not decoration -- current_stock/
        // cost_price_usd reflect today's state regardless of `range` (Global
        // Constraints / Task 0 finding: historical vs. current-snapshot metrics
        // must be labeled explicitly). An Inventory Health report for last week
        // still shows TODAY's stock levels.
        title: 'Inventory Overview (current snapshot)',
        metrics: [
          { label: 'Current inventory value', value: currentValuation, unit: 'USD' },
          { label: 'Turnover rate (approx., current valuation basis)', value: Math.round(turnoverRate * 100) / 100 },
        ],
      }),
      detailSection<LowStockRow>({ title: 'Low Stock Alerts (current snapshot)', columns: [{ key: 'nameAr', label: 'Product' }, { key: 'currentStock', label: 'Stock' }, { key: 'lowStockThreshold', label: 'Threshold' }], rows: lowStock }),
      detailSection<VelocityRow>({ title: 'Fast-Moving SKUs', columns: [{ key: 'nameAr', label: 'Product' }, { key: 'quantitySold', label: 'Qty Sold' }], rows: fastMovers }),
      detailSection<VelocityRow>({ title: 'Slow-Moving SKUs', columns: [{ key: 'nameAr', label: 'Product' }, { key: 'quantitySold', label: 'Qty Sold' }], rows: slowMovers }),
      detailSection<DeadStockRow>({
        title: `Dead Stock (${DEAD_STOCK_THRESHOLD_DAYS}+ days, current snapshot)`,
        columns: [{ key: 'nameAr', label: 'Product' }, { key: 'currentStock', label: 'Stock', align: 'end' }, { key: 'valueUsd', label: 'Value', format: 'currency-usd', align: 'end' }],
        rows: deadStock,
        truncated: deadStockTruncated,
      }),
    ],
  }
}

REPORT_DEFINITIONS['inventory-health'] = { id: 'inventory-health', name: 'Inventory Health Report', cadenceHint: 'weekly', compute: computeInventoryHealthReport }
