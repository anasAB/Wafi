import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { useCategories } from '@/features/categories/composables/useCategories'

describe('useCategories — load/create/rename', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('loads categories with nested subcategories', async () => {
    vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
      if (/FROM categories/.test(sql)) {
        return [{ id: 'c1', shop_id: 'shop1', name: 'هواتف', created_at: '2026-07-14T00:00:00Z' }] as any
      }
      if (/FROM subcategories/.test(sql)) {
        return [{ id: 's1', category_id: 'c1', shop_id: 'shop1', name: 'إكسسوارات', created_at: '2026-07-14T00:00:00Z' }] as any
      }
      return []
    })

    const { load, categoriesWithSubcategories } = useCategories()
    await load()

    expect(categoriesWithSubcategories.value).toHaveLength(1)
    expect(categoriesWithSubcategories.value[0].subcategories).toHaveLength(1)
    expect(categoriesWithSubcategories.value[0].subcategories[0].name).toBe('إكسسوارات')
  })

  it('createCategory inserts a row and returns its id when the name is not taken', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce(null)

    const { createCategory } = useCategories()
    const result = await createCategory('أجهزة منزلية')

    expect(result.error).toBeNull()
    expect(typeof result.id).toBe('string')
    const insertCall = vi.mocked(db.execute).mock.calls.find(([sql]) => /INSERT INTO categories/.test(sql))
    expect(insertCall![1]).toContain('أجهزة منزلية')
  })

  it('createCategory returns a duplicate error and does not insert when the name already exists (case-insensitive)', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({ id: 'c1' } as any)

    const { createCategory } = useCategories()
    const result = await createCategory('هواتف')

    expect(result).toEqual({ id: null, error: 'duplicate' })
    expect(vi.mocked(db.execute).mock.calls.some(([sql]) => /INSERT INTO categories/.test(sql))).toBe(false)
  })

  it('renameCategory updates the name when not taken by another category', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce(null)

    const { renameCategory } = useCategories()
    const result = await renameCategory('c1', 'هواتف ذكية')

    expect(result.error).toBeNull()
    const updateCall = vi.mocked(db.execute).mock.calls.find(([sql]) => /UPDATE categories/.test(sql))
    expect(updateCall![1]).toEqual(expect.arrayContaining(['هواتف ذكية', 'c1']))
  })

  it('deleteCategory blocks deletion when products are still assigned, with a count', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ id: 'other-cat', name: 'هواتف' } as any) // fallback-name lookup: not this category
      .mockResolvedValueOnce({ count: 3 } as any)

    const { deleteCategory } = useCategories()
    const result = await deleteCategory('c1')

    expect(result).toEqual({ deleted: false, productCount: 3, blockedReason: 'in_use' })
    expect(vi.mocked(db.execute).mock.calls.some(([sql]) => /DELETE FROM categories/.test(sql))).toBe(false)
  })

  it('deleteCategory deletes when no products are assigned', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ id: 'other', name: 'غير مصنف' } as any) // fallback is a different row than c1
      .mockResolvedValueOnce({ count: 0 } as any)

    const { deleteCategory } = useCategories()
    const result = await deleteCategory('c1')

    expect(result).toEqual({ deleted: true, productCount: 0 })
    expect(vi.mocked(db.execute).mock.calls.some(([sql]) => /DELETE FROM categories/.test(sql))).toBe(true)
  })

  it('deleteCategory refuses to delete the "غير مصنف" fallback category even with zero products', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({ id: 'c1', name: 'غير مصنف' } as any)

    const { deleteCategory } = useCategories()
    const result = await deleteCategory('c1')

    expect(result).toEqual({ deleted: false, productCount: 0, blockedReason: 'fallback' })
    expect(vi.mocked(db.execute).mock.calls.some(([sql]) => /DELETE FROM categories/.test(sql))).toBe(false)
  })

  it('deleteCategory reports the real product count when refusing to delete the fallback category', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ id: 'c1', name: 'غير مصنف' } as any) // this IS the fallback row
      .mockResolvedValueOnce({ count: 12 } as any)

    const { deleteCategory } = useCategories()
    const result = await deleteCategory('c1')

    expect(result).toEqual({ deleted: false, productCount: 12, blockedReason: 'fallback' })
    expect(vi.mocked(db.execute).mock.calls.some(([sql]) => /DELETE FROM categories/.test(sql))).toBe(false)
  })
})

// ── WAFI-133: fallback creation, reassign-delete, merge, overlap guard ───────

function setupTx() {
  const exec = vi.fn().mockResolvedValue({ rows: { _array: [] } })
  vi.mocked(db.writeTransaction).mockImplementation(async (fn: any) => { await fn({ execute: exec }) })
  return exec
}

describe('useCategories — WAFI-133', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([])
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
    vi.mocked(db.getOptional).mockResolvedValue(null)
  })

  it('ensureFallbackCategory creates "غير مصنف" on first need, reuses it after', async () => {
    const { ensureFallbackCategory } = useCategories()

    vi.mocked(db.getOptional).mockResolvedValueOnce(null) // not found → create
    const created = await ensureFallbackCategory()
    expect(typeof created).toBe('string')
    const insert = vi.mocked(db.execute).mock.calls.find(([sql]) => /INSERT INTO categories/.test(sql as string))!
    expect(insert[1]).toContain('غير مصنف')

    vi.mocked(db.getOptional).mockResolvedValueOnce({ id: 'fb-1' } as any) // exists → reuse
    expect(await ensureFallbackCategory()).toBe('fb-1')
  })

  it('deleteCategoryWithReassign moves products (subcategory cleared) then deletes, in one transaction', async () => {
    const exec = setupTx()
    vi.mocked(db.getOptional).mockImplementation(async (sql: string) => {
      if (/غير مصنف|lower\(name\)/.test(sql)) return { id: 'fb-1' } as any
      if (/stock_take_sessions/.test(sql)) return { n: 0 } as any
      if (/COUNT\(\*\) AS n FROM products/.test(sql)) return { n: 7 } as any
      return null
    })

    const { deleteCategoryWithReassign } = useCategories()
    const result = await deleteCategoryWithReassign('cat-src', 'cat-target')

    expect(result).toEqual({ moved: 7, error: null })
    const sqls = exec.mock.calls.map(([sql]) => sql as string)
    expect(sqls.some(s => /UPDATE products SET category_id = \?, subcategory_id = NULL/.test(s))).toBe(true)
    expect(sqls.some(s => /DELETE FROM subcategories WHERE category_id = \?/.test(s))).toBe(true)
    expect(sqls.some(s => /DELETE FROM categories WHERE id = \?/.test(s))).toBe(true)
  })

  it('the fallback "غير مصنف" can never be reassign-deleted', async () => {
    setupTx()
    vi.mocked(db.getOptional).mockResolvedValue({ id: 'fb-1' } as any)
    const { deleteCategoryWithReassign } = useCategories()
    const result = await deleteCategoryWithReassign('fb-1', 'cat-target')
    expect(result.error).toBe('fallback')
  })

  it('a category scoping an OPEN stock-take session blocks delete and merge', async () => {
    setupTx()
    vi.mocked(db.getOptional).mockImplementation(async (sql: string) => {
      if (/stock_take_sessions/.test(sql)) return { n: 1 } as any
      return null
    })

    const { deleteCategoryWithReassign, mergeCategory } = useCategories()
    expect((await deleteCategoryWithReassign('cat-a', 'cat-b')).error).toBe('open-stock-take')
    expect((await mergeCategory('cat-a', 'cat-b')).error).toBe('open-stock-take')
  })

  it('mergeCategory moves products + subcategories, auto-merging name-colliding subcategories', async () => {
    const exec = setupTx()
    vi.mocked(db.getOptional).mockImplementation(async (sql: string) => {
      if (/stock_take_sessions/.test(sql)) return { n: 0 } as any
      if (/COUNT\(\*\) AS n FROM products/.test(sql)) return { n: 3 } as any
      return null // no fallback row
    })
    vi.mocked(db.getAll).mockImplementation(async (sql: string, params?: unknown[]) => {
      if (/FROM subcategories WHERE category_id/.test(sql)) {
        if (params?.[0] === 'cat-src') {
          return [
            { id: 'sub-collide', category_id: 'cat-src', shop_id: 's1', name: 'سامسونج', created_at: '' },
            { id: 'sub-unique',  category_id: 'cat-src', shop_id: 's1', name: 'هواوي',   created_at: '' },
          ] as any
        }
        return [{ id: 'sub-target', category_id: 'cat-target', shop_id: 's1', name: 'سامسونج', created_at: '' }] as any
      }
      return []
    })

    const { mergeCategory } = useCategories()
    const result = await mergeCategory('cat-src', 'cat-target')

    expect(result.error).toBeNull()
    expect(result.movedProducts).toBe(3)
    const calls = exec.mock.calls.map(([sql, p]) => [sql as string, p as unknown[]] as const)
    // Colliding sub: its products repoint to the target's same-named sub, then it's deleted.
    expect(calls.some(([s, p]) => /UPDATE products SET subcategory_id/.test(s) && p[0] === 'sub-target' && p[1] === 'sub-collide')).toBe(true)
    expect(calls.some(([s, p]) => /DELETE FROM subcategories WHERE id = \?/.test(s) && p[0] === 'sub-collide')).toBe(true)
    // Unique sub just moves to the target category.
    expect(calls.some(([s, p]) => /UPDATE subcategories SET category_id/.test(s) && p[0] === 'cat-target' && p[1] === 'sub-unique')).toBe(true)
    // Products move; source category deleted.
    expect(calls.some(([s, p]) => /UPDATE products SET category_id = \?/.test(s) && p[0] === 'cat-target' && p[1] === 'cat-src')).toBe(true)
    expect(calls.some(([s, p]) => /DELETE FROM categories WHERE id = \?/.test(s) && p[0] === 'cat-src')).toBe(true)
  })

  it('load surfaces post-sync duplicate names for the merge suggestion', async () => {
    vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
      if (/FROM categories/.test(sql)) {
        return [
          { id: 'c1', shop_id: 's1', name: 'موبايلات', created_at: '' },
          { id: 'c2', shop_id: 's1', name: 'موبايلات ', created_at: '' }, // same after trim
          { id: 'c3', shop_id: 's1', name: 'عطور', created_at: '' },
        ] as any
      }
      return []
    })

    const { load, duplicateCategoryGroups } = useCategories()
    await load()

    expect(duplicateCategoryGroups.value).toHaveLength(1)
    expect(duplicateCategoryGroups.value[0]).toHaveLength(2)
  })
})
