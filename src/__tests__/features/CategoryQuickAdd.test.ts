import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import CategoryQuickAdd from '@/features/categories/components/CategoryQuickAdd.vue'

describe('CategoryQuickAdd', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('creates a category and emits created with its id', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce(null)
    const wrapper = mount(CategoryQuickAdd)

    await wrapper.get('[data-testid="quick-add-category-input"]').setValue('إلكترونيات')
    await wrapper.get('[data-testid="quick-add-category-submit"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.emitted('created')).toBeTruthy()
    expect(typeof wrapper.emitted('created')![0][0]).toBe('string')
  })

  it('shows a duplicate-name error and does not emit created when the name already exists', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({ id: 'c1' } as any)
    const wrapper = mount(CategoryQuickAdd)

    await wrapper.get('[data-testid="quick-add-category-input"]').setValue('هواتف')
    await wrapper.get('[data-testid="quick-add-category-submit"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.emitted('created')).toBeFalsy()
    expect(wrapper.text()).toContain('موجودة بالفعل')
  })
})
