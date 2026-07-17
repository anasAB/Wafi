import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/composables/useBarcodeScan', () => ({ useBarcodeScan: () => ({ onScan: vi.fn(), startCamera: vi.fn() }) }))

import ProductForm from '@/features/products/components/ProductForm.vue'
import { db } from '@/data/powersync/db'
import type { Product } from '@/features/pos/pos.types'

const router = createRouter({
  history: createMemoryHistory(),
  routes:  [{ path: '/:p(.*)', component: { template: '<div/>' } }],
})

function mountForm(props: Record<string, unknown> = {}) {
  const pinia = createPinia()
  pinia.use(piniaPluginPersistedstate)
  return mount(ProductForm, {
    props: { mode: 'add', ...props },
    global: { plugins: [pinia, router] },
  })
}

const baseProduct: Product = {
  id: 'p1', shopId: 's1', nameAr: 'كابل', salePriceUsd: 10, costPriceUsd: 7,
  currentStock: 5, lowStockThreshold: 3, isActive: true,
  createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
}

describe('ProductForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([])
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
  })

  it('shows required-field error for empty Arabic name on save', async () => {
    const w = mountForm()
    await w.find('[data-testid="save-btn"]').trigger('click')
    expect(w.find('[data-testid="error-name-ar"]').exists()).toBe(true)
  })

  it('shows margin percentage when both prices are set', async () => {
    const w = mountForm()
    await w.find('[data-testid="cost-price"]').setValue('7')
    await w.find('[data-testid="sale-price"]').setValue('10')
    const marginText = w.find('[data-testid="margin-display"]').text()
    expect(marginText).toContain('43%')
  })

  it('shows sale-below-cost warning when sale price < cost price on save', async () => {
    const w = mountForm()
    ;(w.vm as any).categoryId = 'cat-1'
    await w.find('[data-testid="name-ar"]').setValue('منتج')
    await w.find('[data-testid="cost-price"]').setValue('10')
    await w.find('[data-testid="sale-price"]').setValue('7')
    await w.find('[data-testid="current-stock"]').setValue('5')
    await w.find('[data-testid="save-btn"]').trigger('click')
    expect(w.find('[data-testid="price-warning"]').exists()).toBe(true)
  })

  it('pre-fills fields in edit mode', () => {
    const w = mountForm({ mode: 'edit', product: baseProduct })
    const input = w.find('[data-testid="name-ar"]').element as HTMLInputElement
    expect(input.value).toBe('كابل')
    const priceInput = w.find('[data-testid="sale-price"]').element as HTMLInputElement
    expect(priceInput.value).toBe('10')
  })

  it('emits saved event after successful save', async () => {
    const w = mountForm()
    ;(w.vm as any).categoryId = 'cat-1'
    await w.find('[data-testid="name-ar"]').setValue('منتج جديد')
    await w.find('[data-testid="cost-price"]').setValue('5')
    await w.find('[data-testid="sale-price"]').setValue('10')
    await w.find('[data-testid="current-stock"]').setValue('20')
    await w.find('[data-testid="save-btn"]').trigger('click')
    await new Promise(r => setTimeout(r, 10))
    expect(w.emitted('saved')).toBeTruthy()
  })

  it('reloads its own category list before assigning a category created via quick-add', async () => {
    // ProductForm and CategoryQuickAdd each hold an independent useCategories()
    // instance — creating a category through the quick-add form must refresh
    // THIS form's own list too, or the new id never resolves in its dropdown
    // and the assignment is effectively lost (the bug this test guards).
    let categoriesQueryCount = 0
    vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
      if (/FROM categories\b/.test(sql)) {
        categoriesQueryCount++
        // First load (onMounted) sees nothing yet; only a reload made AFTER
        // the quick-add's own create+load would see the newly created row.
        return categoriesQueryCount === 1
          ? []
          : [{ id: 'new-cat-id', shop_id: 's1', name: 'فئة جديدة', created_at: '2024-01-01T00:00:00Z' }]
      }
      return []
    })

    const w = mountForm()
    await (w.vm as any).onCategoryCreated('new-cat-id')

    expect((w.vm as any).categoryId).toBe('new-cat-id')
    expect((w.vm as any).categoryOptions).toEqual(
      expect.arrayContaining([{ label: 'فئة جديدة', value: 'new-cat-id' }])
    )
    expect((w.vm as any).showQuickAddCategory).toBe(false)
  })

  it('hides the "create new category" option once a category is already assigned', async () => {
    const w = mountForm({ mode: 'edit', product: { ...baseProduct, categoryId: 'existing-cat' } })
    await new Promise(r => setTimeout(r, 0))

    expect(w.find('[data-testid="quick-add-category-toggle"]').exists()).toBe(false)
  })

  it('shows the "create new category" option when no category is assigned yet', async () => {
    const w = mountForm({ mode: 'add' })
    await new Promise(r => setTimeout(r, 0))

    expect(w.find('[data-testid="quick-add-category-toggle"]').exists()).toBe(true)
  })

  it('shows required-field error for missing category on save', async () => {
    const w = mountForm()
    await w.find('[data-testid="name-ar"]').setValue('منتج')
    await w.find('[data-testid="cost-price"]').setValue('5')
    await w.find('[data-testid="sale-price"]').setValue('10')
    await w.find('[data-testid="current-stock"]').setValue('20')
    await w.find('[data-testid="save-btn"]').trigger('click')
    expect(w.find('[data-testid="error-category"]').exists()).toBe(true)
    expect(w.emitted('saved')).toBeFalsy()
  })

  it('saves successfully when user confirms price-below-cost warning', async () => {
    const w = mountForm()
    ;(w.vm as any).categoryId = 'cat-1'
    await w.find('[data-testid="name-ar"]').setValue('منتج')
    await w.find('[data-testid="cost-price"]').setValue('10')
    await w.find('[data-testid="sale-price"]').setValue('7')
    await w.find('[data-testid="current-stock"]').setValue('5')
    await w.find('[data-testid="save-btn"]').trigger('click')
    // Price warning should be visible
    expect(w.find('[data-testid="price-warning"]').exists()).toBe(true)
    // Click the "yes, save" button inside the warning
    await w.find('[data-testid="confirm-price-warning"]').trigger('click')
    await new Promise(r => setTimeout(r, 10))
    // Should have saved (no warning, saved event emitted)
    expect(w.emitted('saved')).toBeTruthy()
  })
})
