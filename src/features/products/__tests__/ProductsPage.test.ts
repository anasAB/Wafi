import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { ref } from 'vue'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

const pushMock = vi.fn()
let queryFilter: string | undefined

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock, back: vi.fn() }),
  useRoute: () => ({ query: { filter: queryFilter } }),
}))
vi.mock('@/composables/useBarcodeScan', () => ({
  useBarcodeScan: () => ({ onScan: vi.fn(), destroy: vi.fn() }),
}))

import ProductsPage from '../ProductsPage.vue'
import { useProducts } from '../composables/useProducts'

vi.mock('../composables/useProducts', () => ({ useProducts: vi.fn() }))

function stubProducts(products: any[] = []) {
  vi.mocked(useProducts).mockReturnValue({
    products: ref(products),
    load: vi.fn().mockResolvedValue(undefined),
    softDelete: vi.fn(),
    adjustStock: vi.fn(),
  } as any)
}

// ProductList.vue is a plain <script setup> component with no explicit `name`
// option, so findComponent({ name: 'ProductList' }) can't locate it in this
// codebase (see SalePanel.test.ts / ReturnSheet.test.ts comments on the same
// limitation) — assert via the rendered DOM instead.

describe('ProductsPage — WAFI-013 imprecise-cost chip + backward-compat query param', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    queryFilter = undefined
  })

  it('the new query-param value activates the imprecise-cost filter', () => {
    queryFilter = 'imprecise-cost'
    stubProducts([])
    const wrapper = mount(ProductsPage)
    const chip = wrapper.findAll('.filter-chip').find(b => b.text().includes('بدون سعر دقيق'))
    expect(chip?.classes()).toContain('filter-chip-active')
  })

  it('the OLD query-param value ("missing-cost") still activates the same filter (backward compat)', () => {
    queryFilter = 'missing-cost'
    stubProducts([])
    const wrapper = mount(ProductsPage)
    const chip = wrapper.findAll('.filter-chip').find(b => b.text().includes('بدون سعر دقيق'))
    expect(chip?.classes()).toContain('filter-chip-active')
  })

  it('no filter query param means the filter is off', () => {
    queryFilter = undefined
    stubProducts([])
    const wrapper = mount(ProductsPage)
    const chip = wrapper.findAll('.filter-chip').find(b => b.text().includes('بدون سعر دقيق'))
    expect(chip?.classes() ?? []).not.toContain('filter-chip-active')
  })

  it('shows a visible chip with a count badge reflecting the number of imprecise-cost products', () => {
    const now = new Date().toISOString()
    stubProducts([
      { id: 'p1', nameAr: 'a', costPriceUsd: 0, salePriceUsd: 10, costUpdatedAt: undefined, currentStock: 5, lowStockThreshold: 1 },
      { id: 'p2', nameAr: 'b', costPriceUsd: 5, salePriceUsd: 10, costUpdatedAt: now, currentStock: 5, lowStockThreshold: 1 },
    ])
    const wrapper = mount(ProductsPage)
    expect(wrapper.text()).toContain('بدون سعر دقيق')
    expect(wrapper.find('.filter-chip-badge').text()).toBe('1')
  })
})
