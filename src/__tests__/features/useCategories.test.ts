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
