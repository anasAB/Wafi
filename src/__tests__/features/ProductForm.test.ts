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
    await w.find('[data-testid="name-ar"]').setValue('منتج جديد')
    await w.find('[data-testid="cost-price"]').setValue('5')
    await w.find('[data-testid="sale-price"]').setValue('10')
    await w.find('[data-testid="current-stock"]').setValue('20')
    await w.find('[data-testid="save-btn"]').trigger('click')
    await new Promise(r => setTimeout(r, 10))
    expect(w.emitted('saved')).toBeTruthy()
  })

  it('saves successfully when user confirms price-below-cost warning', async () => {
    const w = mountForm()
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
