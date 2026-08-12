import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

export function useMissingCostCount() {
  const missingCostCount = ref(0)

  async function load(): Promise<void> {
    const { shopId } = useDeviceStore()
    const row = await db.getOptional<{ count: number }>(
      `SELECT COUNT(*) as count FROM products
       WHERE shop_id = ? AND is_active = 1 AND (deleted = 0 OR deleted IS NULL)
         AND (cost_price_usd = 0 OR cost_price_usd IS NULL)`,
      [shopId],
    )
    missingCostCount.value = row?.count ?? 0
  }

  return { missingCostCount, load }
}
