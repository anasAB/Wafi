import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

// WAFI-018. "Contribution Margin" (marginUsd = revenueUsd - cogsUsd) internally
// and in code — the UI-facing label is plain language ("Sales after product
// cost"), per the design doc's split between accounting-precise internal
// naming and owner-facing wording. This does NOT allocate shop-level expenses
// per employee (rent, utilities aren't attributable to one person) — see the
// design doc for why that's explicitly out of scope.
export interface StaffPerformanceRow {
  staffId: string
  name: string
  revenueUsd: number
  cogsUsd: number
  marginUsd: number
  // Share of the shop-period Contribution Margin total this staff member
  // contributed. null when the shop-period total is 0 (nothing to divide by).
  marginPct: number | null
  salesCount: number
  // null (not 0/NaN) when salesCount is 0 — "no data," not "sold for free."
  avgTicketUsd: number | null
  // discountUsd: sale-level discount only (SUM(sale_discount_amount_usd)),
  // same column/precedent useAnomalyDetection.ts already uses for the
  // shop-wide discount total — NOT line-level discounts.
  discountUsd: number
  // null (not 0) when revenueUsd is 0 — same "no data" convention as avgTicketUsd.
  discountRate: number | null
}

export function useStaffPerformanceMetrics() {
  const device = useDeviceStore()
  const rows = ref<StaffPerformanceRow[]>([])

  async function load(start: string, end: string) {
    const [salesRows, cogsRows, returnRevenueRows, returnCogsRows, discountRows] = await Promise.all([
      // Revenue + sales count per staff member who confirmed the sale
      // (sales.staff_id). Sales with no attributed operator (null staff_id)
      // are excluded — there's no employee to attribute them to.
      db.getAll<{ staffId: string; name: string; salesCount: number; grossUsd: number }>(
        `SELECT s.staff_id AS staffId, st.name AS name,
                COUNT(*) AS salesCount, COALESCE(SUM(s.total_usd), 0) AS grossUsd
         FROM sales s
         JOIN staff st ON st.id = s.staff_id
         WHERE s.shop_id = ? AND s.staff_id IS NOT NULL
           AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
         GROUP BY s.staff_id, st.name`,
        [device.shopId, start, end]
      ),
      // COGS per staff member, same per-sale attribution as revenue above.
      db.getAll<{ staffId: string; cogs: number }>(
        `SELECT s.staff_id AS staffId,
                COALESCE(SUM(sli.quantity * COALESCE(sli.unit_cost_usd, 0)), 0) AS cogs
         FROM sale_line_items sli
         JOIN sales s ON sli.sale_id = s.id
         WHERE s.shop_id = ? AND s.staff_id IS NOT NULL
           AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
         GROUP BY s.staff_id`,
        [device.shopId, start, end]
      ),
      // Returns have no direct staff_id (see design doc) — attributed to
      // whoever's shift the return fell under (cashier_shifts.staff_id), not
      // necessarily the original salesperson or whoever clicked "return."
      db.getAll<{ staffId: string; total: number }>(
        `SELECT cs.staff_id AS staffId, COALESCE(SUM(r.refund_amount_usd), 0) AS total
         FROM returns r
         JOIN cashier_shifts cs ON cs.id = r.shift_id
         WHERE r.shop_id = ? AND cs.staff_id IS NOT NULL
           AND DATE(r.created_at, 'localtime') BETWEEN ? AND ?
         GROUP BY cs.staff_id`,
        [device.shopId, start, end]
      ),
      // Restocked-return COGS reversal, attributed the same way as return
      // revenue above. Same per-(sale, product) dedup as useDashboardMetrics
      // (WAFI-005) — a row-level join would double-count a product sold on
      // two lines of the same original sale.
      //
      // WAFI-153 (staff_summary evaluation): the inline subquery is scoped to
      // shop_id — sale_line_items carries its own shop_id column (see
      // 001_initial_schema.sql), indexed via idx_sale_lines_shop — so this no
      // longer aggregates every shop's entire history on every call. It is
      // deliberately NOT date-range-scoped: c.unit_cost_usd must resolve the
      // ORIGINAL sale's cost, which can fall outside the requested [start, end]
      // return-date window, so filtering by that range here would silently
      // drop valid cost lookups for older original sales.
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
        [device.shopId, device.shopId, start, end]
      ),
      // Sale-level discount total per staff member, same column/precedent as
      // useDashboardMetrics.ts (WAFI-146 Task 1) — SUM(sale_discount_amount_usd).
      db.getAll<{ staffId: string; discountUsd: number }>(
        `SELECT s.staff_id AS staffId, COALESCE(SUM(s.sale_discount_amount_usd), 0) AS discountUsd
         FROM sales s
         WHERE s.shop_id = ? AND s.staff_id IS NOT NULL
           AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
         GROUP BY s.staff_id`,
        [device.shopId, start, end]
      ),
    ])

    const cogsMap          = new Map(cogsRows.map(r => [r.staffId, r.cogs]))
    const returnRevenueMap = new Map(returnRevenueRows.map(r => [r.staffId, r.total]))
    const returnCogsMap    = new Map(returnCogsRows.map(r => [r.staffId, r.cogs]))
    const discountMap      = new Map(discountRows.map(r => [r.staffId, r.discountUsd]))

    const built = salesRows.map((s): StaffPerformanceRow => {
      const returnRevenue = returnRevenueMap.get(s.staffId) ?? 0
      const returnCogs    = returnCogsMap.get(s.staffId) ?? 0
      const revenueUsd    = s.grossUsd - returnRevenue
      const cogsUsd       = (cogsMap.get(s.staffId) ?? 0) - returnCogs
      const marginUsd     = revenueUsd - cogsUsd
      // Avg ticket reflects gross sale size (unaffected by a later return that
      // may be attributed to a different staff member's shift).
      const avgTicketUsd  = s.salesCount > 0 ? s.grossUsd / s.salesCount : null
      const discountUsd   = discountMap.get(s.staffId) ?? 0

      return {
        staffId: s.staffId,
        name: s.name,
        revenueUsd,
        cogsUsd,
        marginUsd,
        marginPct: null, // filled in below once the shop-period total is known
        salesCount: s.salesCount,
        avgTicketUsd,
        discountUsd,
        discountRate: revenueUsd > 0 ? (discountUsd / revenueUsd) * 100 : null,
      }
    })

    const totalMarginUsd = built.reduce((sum, r) => sum + r.marginUsd, 0)
    rows.value = built.map(r => ({
      ...r,
      marginPct: totalMarginUsd !== 0 ? (r.marginUsd / totalMarginUsd) * 100 : null,
    }))
  }

  return { rows, load }
}
