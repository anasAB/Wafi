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
})
