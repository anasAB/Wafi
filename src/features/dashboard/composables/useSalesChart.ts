import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { getDateRange } from './periodUtils'
import type { Period } from './periodUtils'

export interface SalesChartData {
  labels:  string[]
  sales:   number[]
  profit:  number[]
}

function toDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function dayLabelFromDateStr(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, (m ?? 1) - 1, d ?? 1)
  return `${date.getDate()}/${date.getMonth() + 1}`
}

function dateRangeDays(start: string, end: string): string[] {
  const [sy, sm, sd] = start.split('-').map(Number)
  const [ey, em, ed] = end.split('-').map(Number)
  const from = new Date(sy, (sm ?? 1) - 1, sd ?? 1)
  const to = new Date(ey, (em ?? 1) - 1, ed ?? 1)
  const days: string[] = []

  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    days.push(toDateStr(d))
  }

  return days
}

export function useSalesChart() {
  const device  = useDeviceStore()
  const data    = ref<SalesChartData>({ labels: [], sales: [], profit: [] })
  const loading = ref(false)

  async function load(period: Period) {
    loading.value = true
    try {
      const { start, end } = getDateRange(period)
      const days = dateRangeDays(start, end)

      // created_at is stored as UTC; bucket by local-time date so the chart
      // matches useDashboardMetrics and late-night sales land on the right day.
      const salesRows = await db.getAll<{ day: string; total: number }>(
        `SELECT DATE(created_at, 'localtime') as day,
                COALESCE(SUM(total_usd), 0) as total
         FROM sales
         WHERE shop_id = ? AND DATE(created_at, 'localtime') BETWEEN ? AND ?
         GROUP BY day`,
        [device.shopId, start, end]
      )

      const cogsRows = await db.getAll<{ day: string; cogs: number }>(
        `SELECT DATE(s.created_at, 'localtime') as day,
                COALESCE(SUM(sli.quantity * COALESCE(sli.unit_cost_usd, 0)), 0) as cogs
         FROM sale_line_items sli
         JOIN sales s ON sli.sale_id = s.id
         WHERE s.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
         GROUP BY day`,
        [device.shopId, start, end]
      )

      const salesMap = new Map(salesRows.map(r => [r.day, r.total]))
      const cogsMap  = new Map(cogsRows.map(r => [r.day, r.cogs]))

      data.value = {
        labels: days.map(dayLabelFromDateStr),
        sales:  days.map(d => salesMap.get(d) ?? 0),
        profit: days.map(d => {
          const rev  = salesMap.get(d) ?? 0
          const cogs = cogsMap.get(d)  ?? 0
          // Do NOT clamp at 0 — a loss day must show as negative, not be hidden.
          return rev - cogs
        }),
      }
    } finally {
      loading.value = false
    }
  }

  return { data, loading, load }
}
