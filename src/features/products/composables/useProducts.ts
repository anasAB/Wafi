import { ref, computed } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import type { Product } from '@/features/pos/pos.types'
import type { AdjustmentReason } from '@/features/products/product.types'
import { rowToProduct, type ProductRow } from '@/features/products/product.utils'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'
import { adjustInventory } from '@/services/inventory.service'

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
      categoryId?: string; subcategoryId?: string
      /** WAFI-101 — 'quick_add' when created inline from an unknown barcode scan. */
      createdVia?: string
    }
  ) {
    // Stock floors at zero — never persist a negative on-hand count.
    const currentStock = Math.max(0, data.currentStock)
    // subcategory_id may never be persisted without its parent category_id (spec:
    // "subcategory-without-category" edge case) — defensive backstop in case a caller
    // bypasses the product form's own guard that disables the subcategory dropdown.
    const effectiveSubcategoryId = data.categoryId ? data.subcategoryId : undefined
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
      const old = await db.getOptional<{ price_usd: number; cost_price_usd: number }>(
        `SELECT price_usd, cost_price_usd FROM products WHERE id = ?`, [data.id]
      )
      const costChanged = old ? old.cost_price_usd !== data.costPriceUsd : false
      const sql = costChanged
        ? `UPDATE products SET name_ar=?, name_en=?, barcode=?, category_id=?, subcategory_id=?,
           price_usd=?, cost_price_usd=?, current_stock=?, low_stock_threshold=?,
           photo_url=?, is_active=?, cost_updated_at=?, updated_at=?, sync_status='pending' WHERE id=?`
        : `UPDATE products SET name_ar=?, name_en=?, barcode=?, category_id=?, subcategory_id=?,
           price_usd=?, cost_price_usd=?, current_stock=?, low_stock_threshold=?,
           photo_url=?, is_active=?, updated_at=?, sync_status='pending' WHERE id=?`
      const baseParams = [
        data.nameAr, data.nameEn ?? null, normalizedBarcode || null,
        data.categoryId ?? null, effectiveSubcategoryId ?? null,
        data.salePriceUsd, data.costPriceUsd, currentStock, data.lowStockThreshold,
        data.photoUrl ?? null, data.isActive ? 1 : 0,
      ]
      const params = costChanged
        ? [...baseParams, now, now, data.id]
        : [...baseParams, now, data.id]
      await db.execute(sql, params)
      await load()
      if (old && old.price_usd !== data.salePriceUsd) {
        await logProductPriceChanged(data.id, data.nameAr, old.price_usd, data.salePriceUsd)
      } else {
        await logProductUpdated(data.id, data.nameAr)
      }
      return data.id
    } else {
      const id = uuidv4()
      const costUpdatedAt = data.costPriceUsd > 0 ? now : null
      await db.execute(
        `INSERT INTO products
         (id, shop_id, name_ar, name_en, barcode, category, category_id, subcategory_id,
          price_usd, cost_price_usd, current_stock, low_stock_threshold, photo_url,
          is_active, deleted, sync_status, created_at, updated_at, cost_updated_at, created_via)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, data.shopId, data.nameAr, data.nameEn ?? null, normalizedBarcode || null,
         null, data.categoryId ?? null, effectiveSubcategoryId ?? null,
         data.salePriceUsd, data.costPriceUsd,
         currentStock, data.lowStockThreshold, data.photoUrl ?? null,
         data.isActive ? 1 : 0, 0, 'pending', now, now, costUpdatedAt, data.createdVia ?? null]
      )
      await load()
      await logProductCreated(id, data.nameAr)
      return id
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
    const device = useDeviceStore()
    await adjustInventory(
      device.shopId, device.deviceId,
      { mode: 'absolute', productId, newValue, reason, notes },
      { logStockAdjusted },
    )
    await load()
  }

  // WAFI-121: snapshot-based flows (stock take, spot checks) must commit
  // RELATIVE deltas against live stock — an absolute write erases any sale or
  // return rung between snapshot and commit. Read-modify-write happens inside
  // one transaction so a concurrent local write can't interleave.
  async function adjustStockBy(
    productId: string,
    delta: number,
    reason: AdjustmentReason,
    notes?: string
  ) {
    if (delta === 0) return
    const device = useDeviceStore()
    await adjustInventory(
      device.shopId, device.deviceId,
      { mode: 'delta', productId, delta, reason, notes },
      { logStockAdjusted },
    )
    await load()
  }

  return { products, lowStockProducts, load, getById, save, softDelete, adjustStock, adjustStockBy }
}
