import { ref, computed } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import type { Product } from '@/features/pos/pos.types'
import type { AdjustmentReason } from '@/features/products/product.types'
import { rowToProduct, type ProductRow } from '@/features/products/product.utils'

export function useProducts() {
  const products = ref<Product[]>([])

  const lowStockProducts = computed(() =>
    products.value.filter(p => p.currentStock <= p.lowStockThreshold)
  )

  async function load() {
    const device = useDeviceStore()
    const rows = await db.getAll<ProductRow>(
      'SELECT * FROM products WHERE shop_id = ? AND is_active = 1 AND (deleted = 0 OR deleted IS NULL) ORDER BY name_ar',
      [device.shopId]
    )
    products.value = rows.map(rowToProduct)
  }

  function getById(id: string): Product | undefined {
    return products.value.find(p => p.id === id)
  }

  async function save(
    data: Partial<Product> & {
      shopId: string; nameAr: string; salePriceUsd: number; costPriceUsd: number
      currentStock: number; lowStockThreshold: number; isActive: boolean
    }
  ) {
    const now = new Date().toISOString()
    if (data.id) {
      await db.execute(
        `UPDATE products SET name_ar=?, name_en=?, barcode=?, category=?,
         price_usd=?, cost_price_usd=?, current_stock=?, low_stock_threshold=?,
         photo_url=?, is_active=?, updated_at=?, sync_status='pending' WHERE id=?`,
        [data.nameAr, data.nameEn ?? null, data.barcode ?? null, data.category ?? null,
         data.salePriceUsd, data.costPriceUsd, data.currentStock, data.lowStockThreshold,
         data.photoUrl ?? null, data.isActive ? 1 : 0, now, data.id]
      )
    } else {
      const id = uuidv4()
      await db.execute(
        `INSERT INTO products
         (id, shop_id, name_ar, name_en, barcode, category, price_usd, cost_price_usd,
          current_stock, low_stock_threshold, photo_url, is_active, deleted,
          sync_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending', ?, ?)`,
        [id, data.shopId, data.nameAr, data.nameEn ?? null, data.barcode ?? null,
         data.category ?? null, data.salePriceUsd, data.costPriceUsd,
         data.currentStock, data.lowStockThreshold, data.photoUrl ?? null,
         data.isActive ? 1 : 0, now, now]
      )
    }
    await load()
  }

  async function softDelete(id: string) {
    await db.execute(
      `UPDATE products SET deleted = 1, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
      [new Date().toISOString(), id]
    )
    await load()
  }

  async function adjustStock(
    productId: string,
    newValue: number,
    reason: AdjustmentReason,
    notes?: string
  ) {
    const now = new Date().toISOString()
    const device = useDeviceStore()

    await db.writeTransaction(async (tx) => {
      // Read current stock from DB to get accurate old value
      const stockResult = await tx.execute(
        'SELECT current_stock FROM products WHERE id = ?',
        [productId]
      )
      const oldValue = (stockResult as any).rows._array[0]?.current_stock ?? 0

      await tx.execute(
        `UPDATE products SET current_stock = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
        [newValue, now, productId]
      )
      await tx.execute(
        `INSERT INTO stock_adjustments (id, shop_id, product_id, old_value, new_value, reason, notes, created_at, device_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuidv4(), device.shopId, productId, oldValue, newValue, reason, notes ?? null, now, device.deviceId]
      )
    })

    await load()
  }

  return { products, lowStockProducts, load, getById, save, softDelete, adjustStock }
}
