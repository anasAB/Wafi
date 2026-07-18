import { ref } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'
import type {
  CategoryWithSubcategories, CategoryRow, SubcategoryRow,
} from '@/features/categories/category.types'

export const FALLBACK_CATEGORY_NAME = 'غير مصنف'

export function useCategories() {
  const categoriesWithSubcategories = ref<CategoryWithSubcategories[]>([])
  // WAFI-133: same-named categories created on different offline devices — the
  // local duplicate guard can't see across devices, so post-sync duplicates are
  // surfaced here for a one-tap merge suggestion.
  const duplicateCategoryGroups = ref<CategoryWithSubcategories[][]>([])
  const { logCategoryMerged, logCategoryDeletedWithReassign } = useAuditLog()

  async function load(): Promise<void> {
    const device = useDeviceStore()
    const categoryRows = await db.getAll<CategoryRow>(
      `SELECT * FROM categories WHERE shop_id = ? ORDER BY name`, [device.shopId]
    )
    const subcategoryRows = await db.getAll<SubcategoryRow>(
      `SELECT * FROM subcategories WHERE shop_id = ? ORDER BY name`, [device.shopId]
    )

    categoriesWithSubcategories.value = categoryRows.map(c => ({
      id: c.id, shopId: c.shop_id, name: c.name, createdAt: c.created_at,
      subcategories: subcategoryRows
        .filter(s => s.category_id === c.id)
        .map(s => ({ id: s.id, categoryId: s.category_id, shopId: s.shop_id, name: s.name, createdAt: s.created_at })),
    }))

    const byName = new Map<string, CategoryWithSubcategories[]>()
    for (const c of categoriesWithSubcategories.value) {
      const k = c.name.trim().toLowerCase()
      byName.set(k, [...(byName.get(k) ?? []), c])
    }
    duplicateCategoryGroups.value = [...byName.values()].filter(g => g.length > 1)
  }

  /**
   * WAFI-133 (code-verification finding): "غير مصنف" was only ever looked up —
   * a shop without that exact row had no protected fallback. Create-on-first-
   * need so it is always a valid reassign/merge target.
   */
  async function ensureFallbackCategory(): Promise<string> {
    const device = useDeviceStore()
    const existing = await db.getOptional<{ id: string }>(
      `SELECT id FROM categories WHERE shop_id = ? AND lower(name) = lower(?)`,
      [device.shopId, FALLBACK_CATEGORY_NAME]
    )
    if (existing) return existing.id
    const id = uuidv4()
    await db.execute(
      `INSERT INTO categories (id, shop_id, name, created_at, sync_status) VALUES (?, ?, ?, ?, 'pending')`,
      [id, device.shopId, FALLBACK_CATEGORY_NAME, new Date().toISOString()]
    )
    return id
  }

  /** A category scoping an OPEN stock-take session may not be merged/deleted —
   *  same guard family as WAFI-113/134 (two variance systems over one scope). */
  async function isScopedByOpenStockTake(categoryId: string): Promise<boolean> {
    const row = await db.getOptional<{ n: number }>(
      `SELECT COUNT(*) AS n FROM stock_take_sessions
       WHERE status = 'in_progress' AND scope_category_id = ?`,
      [categoryId]
    )
    return (row?.n ?? 0) > 0
  }

  async function createCategory(name: string): Promise<{ id: string | null; error: 'duplicate' | null }> {
    const device = useDeviceStore()
    const trimmed = name.trim()
    const existing = await db.getOptional<{ id: string }>(
      `SELECT id FROM categories WHERE shop_id = ? AND lower(name) = lower(?)`,
      [device.shopId, trimmed]
    )
    if (existing) return { id: null, error: 'duplicate' }

    const id = uuidv4()
    await db.execute(
      `INSERT INTO categories (id, shop_id, name, created_at, sync_status) VALUES (?, ?, ?, ?, 'pending')`,
      [id, device.shopId, trimmed, new Date().toISOString()]
    )
    await load()
    return { id, error: null }
  }

  async function renameCategory(id: string, name: string): Promise<{ error: 'duplicate' | null }> {
    const device = useDeviceStore()
    const trimmed = name.trim()
    const existing = await db.getOptional<{ id: string }>(
      `SELECT id FROM categories WHERE shop_id = ? AND lower(name) = lower(?) AND id != ?`,
      [device.shopId, trimmed, id]
    )
    if (existing) return { error: 'duplicate' }

    await db.execute(
      `UPDATE categories SET name = ?, sync_status = 'pending' WHERE id = ?`,
      [trimmed, id]
    )
    await load()
    return { error: null }
  }

  async function createSubcategory(categoryId: string, name: string): Promise<{ id: string | null; error: 'duplicate' | null }> {
    const device = useDeviceStore()
    const trimmed = name.trim()
    const existing = await db.getOptional<{ id: string }>(
      `SELECT id FROM subcategories WHERE category_id = ? AND lower(name) = lower(?)`,
      [categoryId, trimmed]
    )
    if (existing) return { id: null, error: 'duplicate' }

    const id = uuidv4()
    await db.execute(
      `INSERT INTO subcategories (id, category_id, shop_id, name, created_at, sync_status) VALUES (?, ?, ?, ?, ?, 'pending')`,
      [id, categoryId, device.shopId, trimmed, new Date().toISOString()]
    )
    await load()
    return { id, error: null }
  }

  async function renameSubcategory(id: string, name: string): Promise<{ error: 'duplicate' | null }> {
    const trimmed = name.trim()
    const row = await db.getOptional<{ category_id: string }>(
      `SELECT category_id FROM subcategories WHERE id = ?`, [id]
    )
    if (!row) return { error: null }
    const existing = await db.getOptional<{ id: string }>(
      `SELECT id FROM subcategories WHERE category_id = ? AND lower(name) = lower(?) AND id != ?`,
      [row.category_id, trimmed, id]
    )
    if (existing) return { error: 'duplicate' }

    await db.execute(
      `UPDATE subcategories SET name = ?, sync_status = 'pending' WHERE id = ?`,
      [trimmed, id]
    )
    await load()
    return { error: null }
  }

  async function deleteCategory(id: string): Promise<{ deleted: boolean; productCount: number; blockedReason?: 'in_use' | 'fallback' }> {
    const device = useDeviceStore()
    const fallback = await db.getOptional<{ id: string; name: string }>(
      `SELECT id, name FROM categories WHERE shop_id = ? AND lower(name) = lower('غير مصنف')`,
      [device.shopId]
    )

    const row = await db.getOptional<{ count: number }>(
      `SELECT COUNT(*) as count FROM products WHERE category_id = ? AND (deleted = 0 OR deleted IS NULL)`,
      [id]
    )
    const productCount = row?.count ?? 0

    if (fallback && fallback.id === id) {
      return { deleted: false, productCount, blockedReason: 'fallback' }
    }
    if (productCount > 0) return { deleted: false, productCount, blockedReason: 'in_use' }

    await db.execute(`DELETE FROM categories WHERE id = ?`, [id])
    await load()
    return { deleted: true, productCount: 0 }
  }

  async function deleteSubcategory(id: string): Promise<{ deleted: boolean; productCount: number }> {
    const row = await db.getOptional<{ count: number }>(
      `SELECT COUNT(*) as count FROM products WHERE subcategory_id = ? AND (deleted = 0 OR deleted IS NULL)`,
      [id]
    )
    const productCount = row?.count ?? 0
    if (productCount > 0) return { deleted: false, productCount }

    await db.execute(`DELETE FROM subcategories WHERE id = ?`, [id])
    await load()
    return { deleted: true, productCount: 0 }
  }

  /**
   * WAFI-133: delete a category WITH products by first reassigning them all to
   * a target category, in one transaction — replaces the reclassify-one-by-one
   * dead end. Reassigned products lose their subcategory (it belonged to the
   * deleted category); the deleted category's subcategories go with it.
   */
  async function deleteCategoryWithReassign(
    id: string,
    targetCategoryId: string,
  ): Promise<{ moved: number; error: 'fallback' | 'same-target' | 'open-stock-take' | null }> {
    if (id === targetCategoryId) return { moved: 0, error: 'same-target' }
    const device = useDeviceStore()
    const fallback = await db.getOptional<{ id: string }>(
      `SELECT id FROM categories WHERE shop_id = ? AND lower(name) = lower(?)`,
      [device.shopId, FALLBACK_CATEGORY_NAME]
    )
    if (fallback?.id === id) return { moved: 0, error: 'fallback' }
    if (await isScopedByOpenStockTake(id)) return { moved: 0, error: 'open-stock-take' }

    const countRow = await db.getOptional<{ n: number }>(
      `SELECT COUNT(*) AS n FROM products WHERE category_id = ? AND (deleted = 0 OR deleted IS NULL)`, [id]
    )
    const moved = countRow?.n ?? 0
    const sourceName = categoriesWithSubcategories.value.find(c => c.id === id)?.name ?? id

    await db.writeTransaction(async (tx) => {
      await tx.execute(
        `UPDATE products SET category_id = ?, subcategory_id = NULL, sync_status = 'pending' WHERE category_id = ?`,
        [targetCategoryId, id]
      )
      await tx.execute(`DELETE FROM subcategories WHERE category_id = ?`, [id])
      await tx.execute(`DELETE FROM categories WHERE id = ?`, [id])
    })
    await logCategoryDeletedWithReassign(id, sourceName, targetCategoryId, moved)
    await load()
    return { moved, error: null }
  }

  /**
   * WAFI-133: merge source into target — products and subcategories move (name-
   * colliding subcategories auto-merge), source is deleted. One transaction.
   * "غير مصنف" may be a merge TARGET, never a source.
   */
  async function mergeCategory(
    sourceId: string,
    targetId: string,
  ): Promise<{ movedProducts: number; movedSubcategories: number; error: 'fallback' | 'same-target' | 'open-stock-take' | null }> {
    if (sourceId === targetId) return { movedProducts: 0, movedSubcategories: 0, error: 'same-target' }
    const device = useDeviceStore()
    const fallback = await db.getOptional<{ id: string }>(
      `SELECT id FROM categories WHERE shop_id = ? AND lower(name) = lower(?)`,
      [device.shopId, FALLBACK_CATEGORY_NAME]
    )
    if (fallback?.id === sourceId) return { movedProducts: 0, movedSubcategories: 0, error: 'fallback' }
    if (await isScopedByOpenStockTake(sourceId) || await isScopedByOpenStockTake(targetId)) {
      return { movedProducts: 0, movedSubcategories: 0, error: 'open-stock-take' }
    }

    const sourceSubs = await db.getAll<SubcategoryRow>(
      `SELECT * FROM subcategories WHERE category_id = ?`, [sourceId]
    )
    const targetSubs = await db.getAll<SubcategoryRow>(
      `SELECT * FROM subcategories WHERE category_id = ?`, [targetId]
    )
    const targetSubByName = new Map(targetSubs.map(s => [s.name.trim().toLowerCase(), s]))

    const countRow = await db.getOptional<{ n: number }>(
      `SELECT COUNT(*) AS n FROM products WHERE category_id = ? AND (deleted = 0 OR deleted IS NULL)`, [sourceId]
    )
    const movedProducts = countRow?.n ?? 0
    const sourceName = categoriesWithSubcategories.value.find(c => c.id === sourceId)?.name ?? sourceId
    const targetName = categoriesWithSubcategories.value.find(c => c.id === targetId)?.name ?? targetId

    await db.writeTransaction(async (tx) => {
      for (const sub of sourceSubs) {
        const collision = targetSubByName.get(sub.name.trim().toLowerCase())
        if (collision) {
          // Same-named subcategory exists on the target — auto-merge into it.
          await tx.execute(
            `UPDATE products SET subcategory_id = ?, sync_status = 'pending' WHERE subcategory_id = ?`,
            [collision.id, sub.id]
          )
          await tx.execute(`DELETE FROM subcategories WHERE id = ?`, [sub.id])
        } else {
          await tx.execute(
            `UPDATE subcategories SET category_id = ?, sync_status = 'pending' WHERE id = ?`,
            [targetId, sub.id]
          )
        }
      }
      await tx.execute(
        `UPDATE products SET category_id = ?, sync_status = 'pending' WHERE category_id = ?`,
        [targetId, sourceId]
      )
      await tx.execute(`DELETE FROM categories WHERE id = ?`, [sourceId])
    })
    await logCategoryMerged(sourceId, sourceName, targetId, targetName, movedProducts)
    await load()
    return { movedProducts, movedSubcategories: sourceSubs.length, error: null }
  }

  return {
    categoriesWithSubcategories, duplicateCategoryGroups, load,
    createCategory, renameCategory, createSubcategory, renameSubcategory,
    deleteCategory, deleteSubcategory,
    ensureFallbackCategory, deleteCategoryWithReassign, mergeCategory,
  }
}
