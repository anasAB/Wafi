import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import CategoriesManagementScreen from '@/features/categories/components/CategoriesManagementScreen.vue'

describe('CategoriesManagementScreen', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
      if (/FROM categories/.test(sql)) return [{ id: 'c1', shop_id: 'shop1', name: 'هواتف', created_at: '2026-07-14T00:00:00Z' }] as any
      if (/FROM subcategories/.test(sql)) return [] as any
      return []
    })
  })

  it('lists categories and creates a new one from the input', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce(null)
    const wrapper = mount(CategoriesManagementScreen)
    await new Promise((r) => setTimeout(r, 0))

    // Category names render as the value of an inline-rename <input>, not as
    // plain text — wrapper.text() only sees element textContent, so check the
    // input's bound value instead.
    expect((wrapper.get('.category-row input').element as HTMLInputElement).value).toBe('هواتف')

    await wrapper.get('[data-testid="new-category-input"]').setValue('أجهزة منزلية')
    await wrapper.get('[data-testid="new-category-submit"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    const insertCall = vi.mocked(db.execute).mock.calls.find(([sql]) => /INSERT INTO categories/.test(sql))
    expect(insertCall![1]).toContain('أجهزة منزلية')
  })

  it('WAFI-133: deleting an in-use category opens the inline reassignment picker with the product count', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ id: 'other', name: 'غير مصنف' } as any) // fallback lookup: not c1
      .mockResolvedValueOnce({ count: 4 } as any)
    const wrapper = mount(CategoriesManagementScreen)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.get('[data-testid="delete-category-c1"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    // The dead-end message is gone — the target picker opens instead,
    // showing how many products will move (WAFI-133 bulk reassignment).
    expect(wrapper.find('[data-testid="target-picker"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('4')
  })

  it('blocks delete of the غير مصنف fallback category with a distinct message, even with zero products', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({ id: 'c1', name: 'غير مصنف' } as any)
    const wrapper = mount(CategoriesManagementScreen)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.get('[data-testid="delete-category-c1"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.get('[data-testid="blocked-message"]').text()).toContain('غير مصنف')
  })

  it('opens category product picker and assigns multiple existing products', async () => {
    vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
      if (/FROM categories/.test(sql)) return [{ id: 'c1', shop_id: 'shop1', name: 'هواتف', created_at: '2026-07-14T00:00:00Z' }] as any
      if (/FROM subcategories/.test(sql)) return [] as any
      if (/FROM products/.test(sql)) {
        return [
          { id: 'p1', name_ar: 'سامسونج A', category_id: null },
          { id: 'p2', name_ar: 'غطاء', category_id: null },
        ] as any
      }
      return []
    })

    const wrapper = mount(CategoriesManagementScreen)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.get('[data-testid="open-product-picker-c1"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.get('[data-testid="product-picker-item-p1"]').setValue(true)
    await wrapper.get('[data-testid="product-picker-item-p2"]').setValue(true)
    await wrapper.get('[data-testid="assign-selected-products"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    const updateCalls = vi.mocked(db.execute).mock.calls.filter(([sql]) => /UPDATE products/.test(sql))
    expect(updateCalls.length).toBe(2)
    expect(updateCalls[0][1]?.[0]).toBe('c1')
    expect(updateCalls[1][1]?.[0]).toBe('c1')
  })
})
