import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import ProductList from '@/features/products/components/ProductList.vue'
import type { Product } from '@/features/pos/pos.types'

const router = createRouter({
  history: createMemoryHistory(),
  routes:  [{ path: '/:p(.*)', component: { template: '<div/>' } }],
})

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1', shopId: 's1', nameAr: 'منتج', salePriceUsd: 10, costPriceUsd: 7,
    currentStock: 10, lowStockThreshold: 5, isActive: true,
    createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function mountList(products: Product[], filterLowStock = false) {
  const pinia = createPinia()
  pinia.use(piniaPluginPersistedstate)
  return mount(ProductList, {
    props: { products, filterLowStock },
    global: { plugins: [pinia, router] },
  })
}

describe('ProductList', () => {
  it('renders a card for each product', () => {
    const w = mountList([makeProduct({ id: 'p1' }), makeProduct({ id: 'p2', nameAr: 'منتج 2' })])
    expect(w.findAll('[data-testid^="product-card-"]')).toHaveLength(2)
  })

  it('shows yellow low-stock indicator when stock <= threshold', () => {
    const w = mountList([makeProduct({ id: 'p1', currentStock: 2, lowStockThreshold: 5 })])
    expect(w.find('[data-testid="low-stock-badge-p1"]').exists()).toBe(true)
  })

  it('shows stock in red when negative', () => {
    const w = mountList([makeProduct({ id: 'p1', currentStock: -1 })])
    const stockEl = w.find('[data-testid="stock-p1"]')
    expect(stockEl.classes()).toContain('stock-neg')
  })

  it('filters by search query on Arabic name', async () => {
    const products = [
      makeProduct({ id: 'p1', nameAr: 'تفاحة' }),
      makeProduct({ id: 'p2', nameAr: 'برتقال' }),
    ]
    const w = mountList(products)
    await w.find('[data-testid="search"]').setValue('تفاح')
    expect(w.findAll('[data-testid^="product-card-"]')).toHaveLength(1)
  })

  it('filters by filterLowStock prop', () => {
    const products = [
      makeProduct({ id: 'p1', currentStock: 2, lowStockThreshold: 5 }),
      makeProduct({ id: 'p2', currentStock: 10, lowStockThreshold: 5 }),
    ]
    const w = mountList(products, true)
    expect(w.findAll('[data-testid^="product-card-"]')).toHaveLength(1)
  })

  it('emits edit event when product card is tapped', async () => {
    const w = mountList([makeProduct({ id: 'p1' })])
    await w.find('[data-testid="product-card-p1"]').trigger('click')
    expect(w.emitted('edit')).toBeTruthy()
    expect((w.emitted('edit') as string[][])[0][0]).toBe('p1')
  })
})
