import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

// WAFI-101 — an unknown-cost line (quick-add skipped cost, or a legacy
// zero-cost product) silently inflates profit if treated as free. This never
// changes the profit math; it only surfaces the count so the owner knows to
// go fill in costs. Counts distinct SALES (not lines) so "N مبيعات" reads
// naturally even when a sale has several uncosted lines.
export function useUncostedSalesNotice() {
  const count = ref(0)

  async function load(startDate: string, endDate: string) {
    const device = useDeviceStore()
    const row = await db.getOptional<{ c: number }>(
      `SELECT COUNT(DISTINCT sli.sale_id) AS c
       FROM sale_line_items sli
       JOIN sales s ON s.id = sli.sale_id
       WHERE s.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
         AND sli.unit_cost_usd <= 0`,
      [device.shopId, startDate, endDate]
    )
    count.value = row?.c ?? 0
  }

  return { count, load }
}
