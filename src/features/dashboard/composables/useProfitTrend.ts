import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

export interface ProfitTrendPoint { label: string; profitUsd: number }

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

  async function load(start: string, end: string, bucket: 'day' | 'month') {
    const sb  = bucketExpr('created_at', bucket)
    const sbS = bucketExpr('s.created_at', bucket)
    const sbR = bucketExpr('r.created_at', bucket)
    const eb  = bucketExpr('expense_date', bucket, true)

    const [salesRows, cogsRows, refundRows, reversalRows, expenseRows] = await Promise.all([
      db.getAll<{ day: string; total: number }>(
        `SELECT ${sb} as day, COALESCE(SUM(total_usd), 0) as total
         FROM sales WHERE shop_id = ? AND DATE(created_at, 'localtime') BETWEEN ? AND ?
         GROUP BY day`, [device.shopId, start, end]),
      db.getAll<{ day: string; cogs: number }>(
        `SELECT ${sbS} as day, COALESCE(SUM(sli.quantity * COALESCE(sli.unit_cost_usd, 0)), 0) as cogs
         FROM sale_line_items sli JOIN sales s ON sli.sale_id = s.id
         WHERE s.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
         GROUP BY day`, [device.shopId, start, end]),
      db.getAll<{ day: string; total: number }>(
        `SELECT ${sb} as day, COALESCE(SUM(refund_amount_usd), 0) as total
         FROM returns WHERE shop_id = ? AND DATE(created_at, 'localtime') BETWEEN ? AND ?
         GROUP BY day`, [device.shopId, start, end]),
      // Same per-(sale, product) cost dedup as useDashboardMetrics/useSalesChart (WAFI-005).
      db.getAll<{ day: string; cogs: number }>(
        `SELECT ${sbR} as day, COALESCE(SUM(rli.qty_returned * COALESCE(c.unit_cost_usd, 0)), 0) as cogs
         FROM return_line_items rli JOIN returns r ON r.id = rli.return_id
         LEFT JOIN (
           SELECT sale_id, product_id, AVG(unit_cost_usd) as unit_cost_usd
           FROM sale_line_items GROUP BY sale_id, product_id
         ) c ON c.sale_id = r.original_sale_id AND c.product_id = rli.product_id
         WHERE r.shop_id = ? AND rli.restock = 1 AND DATE(r.created_at, 'localtime') BETWEEN ? AND ?
         GROUP BY day`, [device.shopId, start, end]),
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
      return { label: dayLabel(k, bucket), profitUsd: rev - cogs - exp }   // no clamp — losses show negative
    })
  }

  return { points, load }
}
