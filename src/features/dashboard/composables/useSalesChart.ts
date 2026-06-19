import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

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
  return AR_DAYS[date.getDay()]
}

const AR_DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']

export function useSalesChart() {
  const device  = useDeviceStore()
  const data    = ref<SalesChartData>({ labels: [], sales: [], profit: [] })
  const loading = ref(false)

  async function load() {
    loading.value = true
    try {
      const days: string[] = []
      const now = new Date()
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now)
        d.setDate(d.getDate() - i)
        days.push(toDateStr(d))
      }
      const start = days[0]
      const end   = days[days.length - 1]

      const salesRows = await db.getAll<{ day: string; total: number }>(
        `SELECT DATE(created_at) as day,
                COALESCE(SUM(total_usd), 0) as total
         FROM sales
         WHERE shop_id = ? AND DATE(created_at) BETWEEN ? AND ?
         GROUP BY day`,
        [device.shopId, start, end]
      )

      const cogsRows = await db.getAll<{ day: string; cogs: number }>(
        `SELECT DATE(s.created_at) as day,
                COALESCE(SUM(sli.quantity * COALESCE(sli.unit_cost_usd, 0)), 0) as cogs
         FROM sale_line_items sli
         JOIN sales s ON sli.sale_id = s.id
         WHERE s.shop_id = ? AND DATE(s.created_at) BETWEEN ? AND ?
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
