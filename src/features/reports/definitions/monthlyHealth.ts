import { readProfitCache } from '../primitives/readProfitCache'
import { getStaffMetrics } from '../primitives/getStaffMetrics'
import { db } from '@/data/powersync/db'
import { summarySection, detailSection } from '../report.types'
import type { Report, ReportDateRange } from '../report.types'
import { REPORT_DEFINITIONS } from '../reportRegistry'
import type { TopProductByMetricRow } from './topProducts'
import type { TopCustomerRow } from './topCustomers'

export async function computeMonthlyHealthReport(shopId: string, range: ReportDateRange): Promise<Report> {
  const [profit, staff, topProducts, topCustomers, valuationRow] = await Promise.all([
    readProfitCache(shopId, range),
    getStaffMetrics(shopId, range),
    db.getAll<TopProductByMetricRow>(
      `SELECT sli.product_id AS productId, p.name_ar AS nameAr, SUM(sli.line_total_usd) AS value
       FROM sale_line_items sli JOIN products p ON p.id = sli.product_id JOIN sales s ON s.id = sli.sale_id
       WHERE sli.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY sli.product_id, p.name_ar ORDER BY value DESC LIMIT 10`,
      [shopId, range.from, range.to],
    ),
    db.getAll<TopCustomerRow>(
      `SELECT c.id AS customerId, c.name AS customerName, SUM(s.total_usd) AS revenueUsd, COUNT(*) AS visitCount
       FROM sales s JOIN customers c ON c.id = s.customer_id
       WHERE s.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY c.id, c.name ORDER BY revenueUsd DESC LIMIT 10`,
      [shopId, range.from, range.to],
    ),
    db.getOptional<{ total: number }>(
      `SELECT COALESCE(SUM(current_stock * cost_price_usd), 0) AS total FROM products WHERE shop_id = ? AND (deleted = 0 OR deleted IS NULL)`,
      [shopId],
    ),
  ])

  return {
    id: 'monthly-health', name: 'Monthly Business Health', dateRange: range, generatedAt: new Date().toISOString(),
    sections: [
      summarySection({
        title: 'P&L Summary',
        metrics: [
          { label: 'Revenue', value: profit.revenueUsd, unit: 'USD' },
          { label: 'COGS', value: profit.netCogsUsd, unit: 'USD' },
          { label: 'Gross profit', value: profit.netRevenueUsd - profit.netCogsUsd, unit: 'USD' },
          { label: 'Expenses', value: profit.expensesUsd, unit: 'USD' },
          { label: 'Net profit', value: profit.profitUsd, unit: 'USD' },
        ],
      }),
      summarySection({ title: 'Inventory Valuation (current snapshot)', metrics: [{ label: 'Current inventory value', value: valuationRow?.total ?? 0, unit: 'USD' }] }),
      detailSection<TopProductByMetricRow>({ title: 'Top 10 Products', columns: [{ key: 'nameAr', label: 'Product' }, { key: 'value', label: 'Revenue' }], rows: topProducts }),
      detailSection<TopCustomerRow>({ title: 'Top 10 Customers', columns: [{ key: 'customerName', label: 'Customer' }, { key: 'revenueUsd', label: 'Revenue' }], rows: topCustomers }),
      detailSection({ title: 'Staff Performance Review', columns: [{ key: 'name', label: 'Staff' }, { key: 'marginUsd', label: 'Margin' }], rows: staff, visibility: 'staff' }),
    ],
  }
}

REPORT_DEFINITIONS['monthly-health'] = { id: 'monthly-health', name: 'Monthly Business Health', cadenceHint: 'monthly', compute: computeMonthlyHealthReport }
