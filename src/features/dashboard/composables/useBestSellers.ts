import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { getDateRange } from './periodUtils'
import type { Period } from './periodUtils'

export interface BestSeller {
  nameAr:     string
  unitsSold:  number
  revenueUsd: number
}

export function useBestSellers() {
  const items = ref<BestSeller[]>([])

  async function load(period: Period) {
    const device = useDeviceStore()
    const { start, end } = getDateRange(period)

    const rows = await db.getAll<{ name_ar: string; units_sold: number; revenue_usd: number }>(
      `SELECT p.name_ar,
              SUM(sli.quantity)       AS units_sold,
              SUM(sli.line_total_usd) AS revenue_usd
       FROM sale_line_items sli
       JOIN sales s    ON sli.sale_id = s.id
       JOIN products p ON sli.product_id = p.id
       WHERE s.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
         AND (p.deleted = 0 OR p.deleted IS NULL)
       GROUP BY sli.product_id
       ORDER BY units_sold DESC, revenue_usd DESC, p.name_ar ASC
       LIMIT 5`,
      [device.shopId, start, end]
    )

    items.value = rows.map(r => ({
      nameAr:     r.name_ar,
      unitsSold:  r.units_sold,
      revenueUsd: r.revenue_usd,
    }))
  }

  return { items, load }
}
