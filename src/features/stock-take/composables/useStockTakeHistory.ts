import { ref, computed } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

export interface StockTakeHistoryEntry {
  id: string
  startedAt: string
  createdBy: string
  productsCounted: number
  totalShrinkageUsd: number
}

type HistoryRow = {
  id: string; started_at: string; created_by: string
  products_counted: number; total_shrinkage_usd: number
}

export function useStockTakeHistory() {
  const sessions = ref<StockTakeHistoryEntry[]>([])

  async function load(): Promise<void> {
    const device = useDeviceStore()
    const rows = await db.getAll<HistoryRow>(
      `SELECT s.id, s.started_at, s.created_by,
              COUNT(l.id) AS products_counted,
              COALESCE(SUM(l.variance_value_usd), 0) AS total_shrinkage_usd
       FROM stock_take_sessions s
       LEFT JOIN stock_take_lines l ON l.session_id = s.id
       WHERE s.shop_id = ? AND s.status = 'completed'
       GROUP BY s.id, s.started_at, s.created_by
       ORDER BY s.started_at DESC`,
      [device.shopId]
    )
    sessions.value = rows.map(r => ({
      id: r.id, startedAt: r.started_at, createdBy: r.created_by,
      productsCounted: r.products_counted, totalShrinkageUsd: r.total_shrinkage_usd,
    }))
  }

  const lastThreeTrendUsd = computed(() =>
    sessions.value.slice(0, 3).reduce((sum, s) => sum + s.totalShrinkageUsd, 0)
  )

  return { sessions, load, lastThreeTrendUsd }
}
