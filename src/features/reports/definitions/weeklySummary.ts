import { db } from '@/data/powersync/db'
import { readProfitCache } from '../primitives/readProfitCache'
import { getStaffMetrics } from '../primitives/getStaffMetrics'
import { getCustomerAgingSnapshot } from '../primitives/getCustomerAgingSnapshot'
import { summarySection, detailSection } from '../report.types'
import type { Report, ReportDateRange } from '../report.types'
import { REPORT_DEFINITIONS } from '../reportRegistry'
import { addCalendarDays } from '../dateUtils'

/** I4: shift back by the ACTUAL selected range length (inclusive day count), not a
 *  hardcoded 7 -- ReportDetailPage lets an owner pick any date range, and "prior
 *  week" for a 3-day or 30-day selection must be that same length immediately
 *  before it, not a fixed week-sized jump. */
function priorWeekRange(range: ReportDateRange): ReportDateRange {
  const [fy, fm, fd] = range.from.split('-').map(Number)
  const [ty, tm, td] = range.to.split('-').map(Number)
  const rangeLengthDays = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000) + 1
  return { from: addCalendarDays(range.from, -rangeLengthDays), to: addCalendarDays(range.to, -rangeLengthDays) }
}

export interface InventoryChangeRow { productId: string; nameAr: string; adjustmentCount: number; netQuantityDelta: number }

export async function computeWeeklySummaryReport(shopId: string, range: ReportDateRange): Promise<Report> {
  const prior = priorWeekRange(range)
  const [current, previous, staff, currentAging, priorAging, inventoryChanges, dailyRows] = await Promise.all([
    readProfitCache(shopId, range),
    readProfitCache(shopId, prior),
    getStaffMetrics(shopId, range),
    getCustomerAgingSnapshot(shopId, range.to),
    getCustomerAgingSnapshot(shopId, prior.to),
    db.getAll<InventoryChangeRow>(
      `SELECT sa.product_id AS productId, p.name_ar AS nameAr,
              COUNT(*) AS adjustmentCount, SUM(sa.new_value - sa.old_value) AS netQuantityDelta
       FROM stock_adjustments sa
       JOIN products p ON p.id = sa.product_id
       WHERE sa.shop_id = ? AND DATE(sa.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY sa.product_id, p.name_ar ORDER BY adjustmentCount DESC`,
      [shopId, range.from, range.to],
    ),
    // "Best/worst performing days" (original 13-report spec field, previously
    // dropped without note in an earlier draft of this plan -- restored here).
    // profit_cache already has one row per day; no new aggregation needed.
    db.getAll<{ day: string; revenue_usd: number }>(
      `SELECT day, revenue_usd FROM profit_cache WHERE shop_id = ? AND day BETWEEN ? AND ? ORDER BY revenue_usd DESC`,
      [shopId, range.from, range.to],
    ),
  ])

  const currentDebt = currentAging.reduce((s, r) => s + Math.max(0, r.balanceUsd), 0)
  const priorDebt = priorAging.reduce((s, r) => s + Math.max(0, r.balanceUsd), 0)
  const ranked = [...staff].sort((a, b) => b.revenueUsd - a.revenueUsd)
  const bestDay = dailyRows[0]
  const worstDay = dailyRows[dailyRows.length - 1]

  return {
    id: 'weekly-summary', name: 'Weekly Summary', dateRange: range, generatedAt: new Date().toISOString(),
    sections: [
      summarySection({
        title: 'Week over Week',
        metrics: [
          { label: 'Revenue', value: current.revenueUsd, unit: 'USD' },
          { label: 'Revenue vs. last week', value: current.revenueUsd - previous.revenueUsd, unit: 'USD' },
          { label: 'Profit', value: current.profitUsd, unit: 'USD' },
          { label: 'Expenses', value: current.expensesUsd, unit: 'USD' },
        ],
      }),
      detailSection({
        title: 'Staff Ranking',
        columns: [{ key: 'name', label: 'Staff' }, { key: 'revenueUsd', label: 'Revenue' }],
        rows: ranked,
        visibility: 'staff',
      }),
      detailSection<InventoryChangeRow>({
        title: 'Inventory Changes',
        columns: [{ key: 'nameAr', label: 'Product' }, { key: 'adjustmentCount', label: 'Adjustments' }, { key: 'netQuantityDelta', label: 'Net Qty Change' }],
        rows: inventoryChanges,
      }),
      summarySection({
        title: 'Best/Worst Performing Days',
        metrics: dailyRows.length === 0 ? [] : [
          { label: 'Best day', value: `${bestDay.day} ($${(bestDay.revenue_usd / 100).toFixed(2)})` },
          { label: 'Worst day', value: `${worstDay.day} ($${(worstDay.revenue_usd / 100).toFixed(2)})` },
        ],
      }),
      // Customer Debt Trend is a real field in the original spec's Weekly
      // Summary list (WAFI_Event_Driven_Platform_Plan_v1.md:667), not an
      // addition invented merely because getCustomerAgingSnapshot exists.
      summarySection({
        title: 'Customer Debt Trend',
        metrics: [
          { label: 'Outstanding debt', value: currentDebt, unit: 'USD' },
          { label: 'Change vs. last week', value: currentDebt - priorDebt, unit: 'USD' },
        ],
      }),
    ],
  }
}

REPORT_DEFINITIONS['weekly-summary'] = { id: 'weekly-summary', name: 'Weekly Summary', cadenceHint: 'weekly', compute: computeWeeklySummaryReport }
