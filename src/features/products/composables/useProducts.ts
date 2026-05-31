import { ref, computed } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import type { Product } from '@/features/pos/pos.types'
import type { AdjustmentReason } from '@/features/products/product.types'

type ProductRow = {
  id: string; shop_id: string; name_ar: string; name_en: string | null
  price_usd: number; cost_price_usd: number; barcode: string | null
  category: string | null; current_stock: number; low_stock_threshold: number
  photo_url: string | null; created_at: string; updated_at: string
  is_active: number; deleted: number; sync_status: string
}

function rowToProduct(r: ProductRow): Product {
  return {
    id: r.id, shopId: r.shop_id, nameAr: r.name_ar,
    nameEn: r.name_en ?? undefined, salePriceUsd: r.price_usd,
    costPriceUsd: r.cost_price_usd ?? 0, barcode: r.barcode ?? undefined,
    category: r.category ?? undefined, photoUrl: r.photo_url ?? undefined,
    currentStock: r.current_stock ?? 0, lowStockThreshold: r.low_stock_threshold ?? 5,
    isActive: r.is_active === 1, createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

export function useProducts() {
  const products = ref<Product[]>([])

  const lowStockProducts = computed(() =>
    products.value.filter(p => p.currentStock <= p.lowStockThreshold)
  )

  async function load() {
    const rows = await db.getAll<ProductRow>(
      'SELECT * FROM products WHERE deleted = 0 OR deleted IS NULL ORDER BY name_ar'
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
         photo_url=?, updated_at=?, sync_status='pending' WHERE id=?`,
        [data.nameAr, data.nameEn ?? null, data.barcode ?? null, data.category ?? null,
         data.salePriceUsd, data.costPriceUsd, data.currentStock, data.lowStockThreshold,
         data.photoUrl ?? null, now, data.id]
      )
    } else {
      const id = uuidv4()
      await db.execute(
        `INSERT INTO products
         (id, shop_id, name_ar, name_en, barcode, category, price_usd, cost_price_usd,
          current_stock, low_stock_threshold, photo_url, is_active, deleted,
          sync_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 'pending', ?, ?)`,
        [id, data.shopId, data.nameAr, data.nameEn ?? null, data.barcode ?? null,
         data.category ?? null, data.salePriceUsd, data.costPriceUsd,
         data.currentStock, data.lowStockThreshold, data.photoUrl ?? null, now, now]
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
    const device = useDeviceStore()
    const old = products.value.find(p => p.id === productId)
    const oldValue = old?.currentStock ?? 0
    const now = new Date().toISOString()

    await db.writeTransaction(async (tx) => {
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
