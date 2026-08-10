import { ref, computed } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { getDateRange } from './periodUtils'
import type { Period } from './periodUtils'

// WAFI-008: optional source filter, inert by default (undefined = no filter,
// today's exact behavior — the only value any code path produces is 'pos').
// Reserved for a future sales-import/demo-seed feature; see
// docs/superpowers/specs/2026-07-28-wafi-008-data-source-tagging-design.md.
export interface MetricsOptions {
  sources?: string[]
}

// Builds " AND <alias>.source IN (?, ?, ...)" + its bind params, or an empty
// clause/no params when no filter is requested — so every call site stays a
// no-op change when `sources` is omitted.
function sourceFilter(alias: string, sources?: string[]): { clause: string; params: string[] } {
  if (!sources || sources.length === 0) return { clause: '', params: [] }
  const placeholders = sources.map(() => '?').join(', ')
  return { clause: ` AND ${alias}.source IN (${placeholders})`, params: sources }
}

export function useDashboardMetrics() {
  const device           = useDeviceStore()
  const revenueUsd       = ref(0)
  const cogsUsd          = ref(0)
  const expensesUsd      = ref(0)
  const refundsUsd       = ref(0)
  const missingCostCount = ref(0)
  const invoiceCount     = ref(0)
  // WAFI-054: sales IN THE SELECTED PERIOD whose profit is distorted because at
  // least one sold line had no cost snapshot. Distinct from `missingCostCount`,
  // which counts currently-active products — that signal can disagree with the
  // period being shown, so the profit caveat must be driven by this one.
  const costlessSalesInPeriod = ref(0)
  const returnCount = ref(0)
  const discountUsd = ref(0)

  const grossIncomeUsd = computed(() => revenueUsd.value + refundsUsd.value)
  const profitUsd = computed(() => revenueUsd.value - cogsUsd.value - expensesUsd.value)

  // The profit headline is only an estimate (real profit is lower) when the
  // period contains at least one cost-less sale. A clean period shows no caveat.
  const profitIsEstimated = computed(() => costlessSalesInPeriod.value > 0)

  // The query body, parameterised by an explicit local-time date range. Both the
  // period loader (home dashboard) and the explicit-range loader (reports screen)
  // call this — one profit engine, no second calculation.
  async function run(start: string, end: string, options?: MetricsOptions) {
    const sales    = sourceFilter('sales', options?.sources)
    const s        = sourceFilter('s', options?.sources)

    const [revRow, cogsRow, expRow, refundRow, cogsReversalRow, missingRow, countRow, costlessRow, returnCountRow, discountRow] = await Promise.all([
      db.getOptional<{ total: number }>(
        `SELECT COALESCE(SUM(total_usd), 0) as total
         FROM sales WHERE shop_id = ? AND DATE(created_at, 'localtime') BETWEEN ? AND ?${sales.clause}`,
        [device.shopId, start, end, ...sales.params]
      ),
      db.getOptional<{ cogs: number }>(
        `SELECT COALESCE(SUM(sli.quantity * COALESCE(sli.unit_cost_usd, 0)), 0) as cogs
         FROM sale_line_items sli
         JOIN sales s ON sli.sale_id = s.id
         WHERE s.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?${s.clause}`,
        [device.shopId, start, end, ...s.params]
      ),
      db.getOptional<{ total: number }>(
        `SELECT COALESCE(SUM(amount_usd), 0) as total
         FROM expenses WHERE shop_id = ? AND expense_date BETWEEN ? AND ?`,
        [device.shopId, start, end]
      ),
      // Refunds reduce revenue (money handed back to the customer). Joined to
      // the original sale so a source filter also excludes refunds against an
      // excluded sale (e.g. a return on an imported sale, once that exists).
      db.getOptional<{ total: number }>(
        `SELECT COALESCE(SUM(r.refund_amount_usd), 0) as total
         FROM returns r
         JOIN sales s ON s.id = r.original_sale_id
         WHERE r.shop_id = ? AND DATE(r.created_at, 'localtime') BETWEEN ? AND ?${s.clause}`,
        [device.shopId, start, end, ...s.params]
      ),
      // Restocked returns reverse COGS at the original sale's unit cost (un-restocked
      // items stay in COGS — they are a loss, not recovered inventory). The cost is
      // taken from a per-(sale, product) subquery, NOT a direct line-level join:
      // if the same product sat on two of the original sale's lines, a row-level join
      // would match both and double the reversed COGS (WAFI-005). Collapsing to one
      // average unit cost per (sale, product) reverses each returned unit exactly once.
      db.getOptional<{ cogs: number }>(
        `SELECT COALESCE(SUM(rli.qty_returned * COALESCE(c.unit_cost_usd, 0)), 0) as cogs
         FROM return_line_items rli
         JOIN returns r ON r.id = rli.return_id
         JOIN sales s ON s.id = r.original_sale_id
         LEFT JOIN (
           SELECT sale_id, product_id, AVG(unit_cost_usd) as unit_cost_usd
           FROM sale_line_items
           GROUP BY sale_id, product_id
         ) c ON c.sale_id = r.original_sale_id AND c.product_id = rli.product_id
         WHERE r.shop_id = ? AND rli.restock = 1 AND DATE(r.created_at, 'localtime') BETWEEN ? AND ?${s.clause}`,
        [device.shopId, start, end, ...s.params]
      ),
      db.getOptional<{ count: number }>(
        `SELECT COUNT(*) as count FROM products
         WHERE shop_id = ? AND is_active = 1 AND (deleted = 0 OR deleted IS NULL)
           AND (cost_price_usd = 0 OR cost_price_usd IS NULL)`,
        [device.shopId]
      ),
      db.getOptional<{ count: number }>(
        `SELECT COUNT(*) as count FROM sales
         WHERE shop_id = ? AND DATE(created_at, 'localtime') BETWEEN ? AND ?${sales.clause}`,
        [device.shopId, start, end, ...sales.params]
      ),
      // WAFI-054: count distinct sales IN THE PERIOD whose profit is distorted by
      // a missing cost. A sale counts when it has ≥1 line with no/zero unit cost
      // (mixed lines still count — its profit is partially wrong) AND it has not
      // been fully returned (a fully-returned sale nets ~0 to both revenue and
      // COGS, so a missing cost there no longer distorts profit). Same shop scope
      // and localtime boundary as revenue/COGS so the signal matches the headline.
      db.getOptional<{ count: number }>(
        `SELECT COUNT(*) as count FROM sales s
         WHERE s.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?${s.clause}
           AND EXISTS (
             SELECT 1 FROM sale_line_items sli
             WHERE sli.sale_id = s.id
               AND (sli.unit_cost_usd = 0 OR sli.unit_cost_usd IS NULL)
           )
           AND COALESCE(
                 (SELECT SUM(sli.quantity) FROM sale_line_items sli WHERE sli.sale_id = s.id), 0
               ) > COALESCE(
                 (SELECT SUM(rli.qty_returned)
                  FROM return_line_items rli
                  JOIN returns r ON r.id = rli.return_id
                  WHERE r.original_sale_id = s.id), 0
               )`,
        [device.shopId, start, end, ...s.params]
      ),
      db.getOptional<{ count: number }>(
        `SELECT COUNT(*) as count FROM returns r
         JOIN sales s ON s.id = r.original_sale_id
         WHERE r.shop_id = ? AND DATE(r.created_at, 'localtime') BETWEEN ? AND ?${s.clause}`,
        [device.shopId, start, end, ...s.params]
      ),
      db.getOptional<{ total: number }>(
        `SELECT COALESCE(SUM(sale_discount_amount_usd), 0) as total
         FROM sales WHERE shop_id = ? AND DATE(created_at, 'localtime') BETWEEN ? AND ?${sales.clause}`,
        [device.shopId, start, end, ...sales.params]
      ),
    ])

    refundsUsd.value       = refundRow?.total ?? 0
    revenueUsd.value       = (revRow?.total ?? 0) - refundsUsd.value
    cogsUsd.value          = (cogsRow?.cogs ?? 0) - (cogsReversalRow?.cogs ?? 0)
    expensesUsd.value      = expRow?.total    ?? 0
    missingCostCount.value = missingRow?.count ?? 0
    invoiceCount.value     = countRow?.count   ?? 0
    costlessSalesInPeriod.value = costlessRow?.count ?? 0
    returnCount.value      = returnCountRow?.count ?? 0
    discountUsd.value      = discountRow?.total ?? 0
  }

  async function load(period: Period, options?: MetricsOptions) {
    const { start, end } = getDateRange(period)
    await run(start, end, options)
  }

  async function loadRange(start: string, end: string, options?: MetricsOptions) {
    await run(start, end, options)
  }

  return {
    revenueUsd, grossIncomeUsd, cogsUsd, expensesUsd, refundsUsd, profitUsd,
    missingCostCount, invoiceCount, costlessSalesInPeriod, profitIsEstimated, load, loadRange,
    returnCount, discountUsd,
  }
}
