// src/features/reports/primitives/getStaffMetrics.ts
// WAFI-147A primitive 2: generalized from useStaffPerformanceMetrics.ts (WAFI-018) --
// same query/attribution logic, extracted to a plain function so report definitions
// (which are not Vue components) can call it directly without a ref-based composable.
import { db } from '@/data/powersync/db'
import type { ReportDateRange } from '../report.types'

export interface StaffMetricsRow {
  staffId: string
  name: string
  revenueUsd: number
  cogsUsd: number
  marginUsd: number
  marginPct: number | null
  salesCount: number
  avgTicketUsd: number | null
  discountUsd: number
  discountRate: number | null
  /** Task 0 finding 8: surfaced separately (not just netted into revenueUsd/
   *  cogsUsd above) so Returns Report (Task 12) has a real per-staff return
   *  figure instead of dumping the whole row. */
  returnRevenueUsd: number
  returnCount: number
}

export async function getStaffMetrics(shopId: string, range: ReportDateRange): Promise<StaffMetricsRow[]> {
  const { from: start, to: end } = range
  const [salesRows, cogsRows, returnRevenueRows, returnCogsRows, discountRows] = await Promise.all([
    db.getAll<{ staffId: string; name: string; salesCount: number; grossUsd: number }>(
      `SELECT s.staff_id AS staffId, st.name AS name,
              COUNT(*) AS salesCount, COALESCE(SUM(s.total_usd), 0) AS grossUsd
       FROM sales s
       JOIN staff st ON st.id = s.staff_id
       WHERE s.shop_id = ? AND s.staff_id IS NOT NULL
         AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY s.staff_id, st.name`,
      [shopId, start, end],
    ),
    db.getAll<{ staffId: string; cogs: number }>(
      `SELECT s.staff_id AS staffId,
              COALESCE(SUM(sli.quantity * COALESCE(sli.unit_cost_usd, 0)), 0) AS cogs
       FROM sale_line_items sli
       JOIN sales s ON sli.sale_id = s.id
       WHERE s.shop_id = ? AND s.staff_id IS NOT NULL
         AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY s.staff_id`,
      [shopId, start, end],
    ),
    // Task 0 P2 finding 21: staffId here is whoever's SHIFT the return fell
    // under (cashier_shifts.staff_id via r.shift_id) -- the staff member who
    // PROCESSED the return, not necessarily the original sale's cashier. Both
    // Returns Report's "By Staff" section (Task 12) and any future consumer
    // must be read as "returns processed by," not "returns caused by."
    db.getAll<{ staffId: string; total: number; returnCount: number }>(
      `SELECT cs.staff_id AS staffId, COALESCE(SUM(r.refund_amount_usd), 0) AS total, COUNT(*) AS returnCount
       FROM returns r
       JOIN cashier_shifts cs ON cs.id = r.shift_id
       WHERE r.shop_id = ? AND cs.staff_id IS NOT NULL
         AND DATE(r.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY cs.staff_id`,
      [shopId, start, end],
    ),
    db.getAll<{ staffId: string; cogs: number }>(
      `SELECT cs.staff_id AS staffId,
              COALESCE(SUM(rli.qty_returned * COALESCE(c.unit_cost_usd, 0)), 0) AS cogs
       FROM return_line_items rli
       JOIN returns r ON r.id = rli.return_id
       JOIN cashier_shifts cs ON cs.id = r.shift_id
       LEFT JOIN (
         SELECT sale_id, product_id, AVG(unit_cost_usd) as unit_cost_usd
         FROM sale_line_items
         WHERE shop_id = ?
         GROUP BY sale_id, product_id
       ) c ON c.sale_id = r.original_sale_id AND c.product_id = rli.product_id
       WHERE r.shop_id = ? AND rli.restock = 1 AND cs.staff_id IS NOT NULL
         AND DATE(r.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY cs.staff_id`,
      [shopId, shopId, start, end],
    ),
    db.getAll<{ staffId: string; discountUsd: number }>(
      `SELECT s.staff_id AS staffId, COALESCE(SUM(s.sale_discount_amount_usd), 0) AS discountUsd
       FROM sales s
       WHERE s.shop_id = ? AND s.staff_id IS NOT NULL
         AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY s.staff_id`,
      [shopId, start, end],
    ),
  ])

  const cogsMap = new Map(cogsRows.map((r) => [r.staffId, r.cogs]))
  const returnRevenueMap = new Map(returnRevenueRows.map((r) => [r.staffId, r.total]))
  const returnCountMap = new Map(returnRevenueRows.map((r) => [r.staffId, r.returnCount]))
  const returnCogsMap = new Map(returnCogsRows.map((r) => [r.staffId, r.cogs]))
  const discountMap = new Map(discountRows.map((r) => [r.staffId, r.discountUsd]))

  const built = salesRows.map((s): StaffMetricsRow => {
    const returnRevenue = returnRevenueMap.get(s.staffId) ?? 0
    const returnCogs = returnCogsMap.get(s.staffId) ?? 0
    const revenueUsd = s.grossUsd - returnRevenue
    const cogsUsd = (cogsMap.get(s.staffId) ?? 0) - returnCogs
    const marginUsd = revenueUsd - cogsUsd
    const avgTicketUsd = s.salesCount > 0 ? s.grossUsd / s.salesCount : null
    const discountUsd = discountMap.get(s.staffId) ?? 0
    return {
      staffId: s.staffId, name: s.name, revenueUsd, cogsUsd, marginUsd, marginPct: null,
      salesCount: s.salesCount, avgTicketUsd, discountUsd,
      discountRate: revenueUsd > 0 ? (discountUsd / revenueUsd) * 100 : null,
      // Task 0 finding 8 (Returns Report needs this per-staff, not just netted
      // into revenueUsd/cogsUsd above): the same values already computed for
      // the netting above, surfaced separately rather than discarded.
      returnRevenueUsd: returnRevenue,
      returnCount: returnCountMap.get(s.staffId) ?? 0,
    }
  })

  const totalMarginUsd = built.reduce((sum, r) => sum + r.marginUsd, 0)
  return built.map((r) => ({
    ...r,
    marginPct: totalMarginUsd !== 0 ? (r.marginUsd / totalMarginUsd) * 100 : null,
  }))
}
