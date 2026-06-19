import { ref, computed } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import type { Product } from '@/features/pos/pos.types'
import type { AdjustmentReason } from '@/features/products/product.types'
import { rowToProduct, type ProductRow } from '@/features/products/product.utils'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'

export function useProducts() {
  const products = ref<Product[]>([])

  const {
    logProductCreated, logProductUpdated, logProductPriceChanged,
    logProductDeleted, logStockAdjusted,
  } = useAuditLog()

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
    const normalizedBarcode = (data.barcode ?? '').trim()
    if (normalizedBarcode) {
      const duplicate = await db.getOptional<{ id: string }>(
        `SELECT id FROM products
         WHERE shop_id = ?
           AND barcode = ?
           AND (deleted = 0 OR deleted IS NULL)
           AND (? IS NULL OR id <> ?)
         LIMIT 1`,
        [data.shopId, normalizedBarcode, data.id ?? null, data.id ?? null]
      )
      if (duplicate?.id) {
        throw new Error('الباركود مستخدم مسبقاً لمنتج آخر. غيّر الباركود ثم أعد المحاولة.')
      }
    }

    const now = new Date().toISOString()
    if (data.id) {
      const old = await db.getOptional<{ price_usd: number }>(
        `SELECT price_usd FROM products WHERE id = ?`, [data.id]
      )
      await db.execute(
        `UPDATE products SET name_ar=?, name_en=?, barcode=?, category=?,
         price_usd=?, cost_price_usd=?, current_stock=?, low_stock_threshold=?,
         photo_url=?, is_active=?, updated_at=?, sync_status='pending' WHERE id=?`,
        [data.nameAr, data.nameEn ?? null, normalizedBarcode || null, data.category ?? null,
         data.salePriceUsd, data.costPriceUsd, data.currentStock, data.lowStockThreshold,
         data.photoUrl ?? null, data.isActive ? 1 : 0, now, data.id]
      )
      await load()
      if (old && old.price_usd !== data.salePriceUsd) {
        await logProductPriceChanged(data.id, data.nameAr, old.price_usd, data.salePriceUsd)
      } else {
        await logProductUpdated(data.id, data.nameAr)
      }
    } else {
      const id = uuidv4()
      await db.execute(
        `INSERT INTO products
         (id, shop_id, name_ar, name_en, barcode, category, price_usd, cost_price_usd,
          current_stock, low_stock_threshold, photo_url, is_active, deleted,
          sync_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending', ?, ?)`,
        [id, data.shopId, data.nameAr, data.nameEn ?? null, normalizedBarcode || null,
         data.category ?? null, data.salePriceUsd, data.costPriceUsd,
         data.currentStock, data.lowStockThreshold, data.photoUrl ?? null,
         data.isActive ? 1 : 0, now, now]
      )
      await load()
      await logProductCreated(id, data.nameAr)
    }
  }

  async function softDelete(id: string) {
    const row = await db.getOptional<{ name_ar: string }>(
      `SELECT name_ar FROM products WHERE id = ?`, [id]
    )
    await db.execute(
      `UPDATE products SET deleted = 1, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
      [new Date().toISOString(), id]
    )
    await load()
    if (row) await logProductDeleted(id, row.name_ar)
  }

  async function adjustStock(
    productId: string,
    newValue: number,
    reason: AdjustmentReason,
    notes?: string
  ) {
    const now = new Date().toISOString()
    const device = useDeviceStore()
    let oldValue = 0

    await db.writeTransaction(async (tx) => {
      const stockResult = await tx.execute(
        'SELECT current_stock FROM products WHERE id = ?', [productId]
      )
      oldValue = (stockResult as any).rows._array[0]?.current_stock ?? 0
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

    const nameRow = await db.getOptional<{ name_ar: string }>(
      `SELECT name_ar FROM products WHERE id = ?`, [productId]
    )
    await load()
    await logStockAdjusted(productId, nameRow?.name_ar ?? productId, oldValue, newValue)
  }

  return { products, lowStockProducts, load, getById, save, softDelete, adjustStock }
}
