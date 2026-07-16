import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import ProductPickerCategoryChips from '@/features/pos/components/ProductPickerCategoryChips.vue'

describe('ProductPickerCategoryChips', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
      if (/FROM categories/.test(sql)) return [{ id: 'c1', shop_id: 'shop1', name: 'هواتف', created_at: '2026-07-14T00:00:00Z' }] as any
      if (/FROM subcategories/.test(sql)) return [{ id: 's1', category_id: 'c1', shop_id: 'shop1', name: 'إكسسوارات', created_at: '2026-07-14T00:00:00Z' }] as any
      return []
    })
  })

  it('emits select with the category id when a chip is tapped, and reveals its subcategory chips', async () => {
    const wrapper = mount(ProductPickerCategoryChips)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.get('[data-testid="category-chip-c1"]').trigger('click')

    expect(wrapper.emitted('select')![0]).toEqual(['c1', null])
    expect(wrapper.find('[data-testid="subcategory-chip-s1"]').exists()).toBe(true)
  })
})
