import { ref } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import type {
  CategoryWithSubcategories, CategoryRow, SubcategoryRow,
} from '@/features/categories/category.types'

export function useCategories() {
  const categoriesWithSubcategories = ref<CategoryWithSubcategories[]>([])

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
    if (fallback && fallback.id === id) {
      return { deleted: false, productCount: 0, blockedReason: 'fallback' }
    }

    const row = await db.getOptional<{ count: number }>(
      `SELECT COUNT(*) as count FROM products WHERE category_id = ? AND (deleted = 0 OR deleted IS NULL)`,
      [id]
    )
    const productCount = row?.count ?? 0
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

  return {
    categoriesWithSubcategories, load,
    createCategory, renameCategory, createSubcategory, renameSubcategory,
    deleteCategory, deleteSubcategory,
  }
}
