import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

export interface ProfitTrendPoint { label: string; profitUsd: number; bucketKey?: string }

// WAFI-008: optional source filter, inert by default — see useDashboardMetrics.ts
// for the same MetricsOptions shape and rationale.
export interface ProfitTrendOptions {
  sources?: string[]
}

function sourceFilter(alias: string, sources?: string[]): { clause: string; params: string[] } {
  if (!sources || sources.length === 0) return { clause: '', params: [] }
  const placeholders = sources.map(() => '?').join(', ')
  return { clause: ` AND ${alias}.source IN (${placeholders})`, params: sources }
}

// SQLite bucket expression per granularity. Sales/returns bucket on created_at
// (local time); expenses on their expense_date (already a 'YYYY-MM-DD' string).
function bucketExpr(col: string, bucket: 'day' | 'month', isExpenseDate = false): string {
  if (isExpenseDate) {
    return bucket === 'month' ? `substr(${col}, 1, 7)` : col
  }
  return bucket === 'month'
    ? `strftime('%Y-%m', ${col}, 'localtime')`
    : `DATE(${col}, 'localtime')`
}

function dayLabel(key: string, bucket: 'day' | 'month'): string {
  if (bucket === 'month') return key                       // '2026-04'
  const [, m, d] = key.split('-').map(Number)
  return `${d}/${m}`                                       // '1/6'
}

export function useProfitTrend() {
  const device = useDeviceStore()
  const points = ref<ProfitTrendPoint[]>([])

  async function load(start: string, end: string, bucket: 'day' | 'month', options?: ProfitTrendOptions) {
    const sb  = bucketExpr('created_at', bucket)
    const sbS = bucketExpr('s.created_at', bucket)
    const sbR = bucketExpr('r.created_at', bucket)
    const eb  = bucketExpr('expense_date', bucket, true)

    const sales = sourceFilter('sales', options?.sources)
    const s     = sourceFilter('s', options?.sources)

    const [salesRows, cogsRows, refundRows, reversalRows, expenseRows] = await Promise.all([
      db.getAll<{ day: string; total: number }>(
        `SELECT ${sb} as day, COALESCE(SUM(total_usd), 0) as total
         FROM sales WHERE shop_id = ? AND DATE(created_at, 'localtime') BETWEEN ? AND ?${sales.clause}
         GROUP BY day`, [device.shopId, start, end, ...sales.params]),
      db.getAll<{ day: string; cogs: number }>(
        `SELECT ${sbS} as day, COALESCE(SUM(sli.quantity * COALESCE(sli.unit_cost_usd, 0)), 0) as cogs
         FROM sale_line_items sli JOIN sales s ON sli.sale_id = s.id
         WHERE s.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?${s.clause}
         GROUP BY day`, [device.shopId, start, end, ...s.params]),
      // Joined to the original sale so a source filter also excludes refunds
      // against an excluded sale (matches useDashboardMetrics.ts's refund query).
      db.getAll<{ day: string; total: number }>(
        `SELECT ${sb} as day, COALESCE(SUM(r.refund_amount_usd), 0) as total
         FROM returns r JOIN sales s ON s.id = r.original_sale_id
         WHERE r.shop_id = ? AND DATE(r.created_at, 'localtime') BETWEEN ? AND ?${s.clause}
         GROUP BY day`, [device.shopId, start, end, ...s.params]),
      // Same per-(sale, product) cost dedup as useDashboardMetrics/useSalesChart (WAFI-005).
      db.getAll<{ day: string; cogs: number }>(
        `SELECT ${sbR} as day, COALESCE(SUM(rli.qty_returned * COALESCE(c.unit_cost_usd, 0)), 0) as cogs
         FROM return_line_items rli JOIN returns r ON r.id = rli.return_id
         JOIN sales s ON s.id = r.original_sale_id
         LEFT JOIN (
           SELECT sale_id, product_id, AVG(unit_cost_usd) as unit_cost_usd
           FROM sale_line_items GROUP BY sale_id, product_id
         ) c ON c.sale_id = r.original_sale_id AND c.product_id = rli.product_id
         WHERE r.shop_id = ? AND rli.restock = 1 AND DATE(r.created_at, 'localtime') BETWEEN ? AND ?${s.clause}
         GROUP BY day`, [device.shopId, start, end, ...s.params]),
      db.getAll<{ day: string; total: number }>(
        `SELECT ${eb} as day, COALESCE(SUM(amount_usd), 0) as total
         FROM expenses WHERE shop_id = ? AND expense_date BETWEEN ? AND ?
         GROUP BY day`, [device.shopId, start, end]),
    ])

    const salesMap    = new Map(salesRows.map(r => [r.day, r.total]))
    const cogsMap     = new Map(cogsRows.map(r => [r.day, r.cogs]))
    const refundMap   = new Map(refundRows.map(r => [r.day, r.total]))
    const reversalMap = new Map(reversalRows.map(r => [r.day, r.cogs]))
    const expenseMap  = new Map(expenseRows.map(r => [r.day, r.total]))

    const keys = Array.from(new Set([
      ...salesMap.keys(), ...cogsMap.keys(), ...refundMap.keys(),
      ...reversalMap.keys(), ...expenseMap.keys(),
    ])).sort()

    points.value = keys.map(k => {
      const rev  = (salesMap.get(k) ?? 0) - (refundMap.get(k) ?? 0)
      const cogs = (cogsMap.get(k)  ?? 0) - (reversalMap.get(k) ?? 0)
      const exp  = expenseMap.get(k) ?? 0
      return { label: dayLabel(k, bucket), profitUsd: rev - cogs - exp, bucketKey: k }   // no clamp — losses show negative
    })
  }

  return { points, load }
}
