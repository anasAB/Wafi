import { ref, computed } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { rowToProduct, type ProductRow } from '@/features/products/product.utils'
import type { Product } from '@/features/pos/pos.types'

export function useLowStockAlerts() {
  const items = ref<Product[]>([])
  const count = computed(() => items.value.length)
  const top3  = computed(() => items.value.slice(0, 3))
  const allClear = computed(() => items.value.length === 0)

  async function load() {
    const device = useDeviceStore()
    const rows = await db.getAll<ProductRow>(
      `SELECT * FROM products
       WHERE shop_id = ?
         AND is_active = 1
         AND (deleted = 0 OR deleted IS NULL)
         AND current_stock <= low_stock_threshold
       ORDER BY (low_stock_threshold - current_stock) DESC`,
      [device.shopId]
    )
    items.value = rows.map(rowToProduct)
  }

  return { items, count, top3, allClear, load }
}
