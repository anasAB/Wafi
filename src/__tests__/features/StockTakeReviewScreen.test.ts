import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: 's1' } }),
  useRouter: () => ({ push: vi.fn() }),
}))

import { db } from '@/data/powersync/db'
import StockTakeReviewScreen from '@/features/stock-take/components/StockTakeReviewScreen.vue'

describe('StockTakeReviewScreen', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getOptional).mockResolvedValue({
      id: 's1', shop_id: 'shop1', started_at: '2026-07-14T00:00:00Z',
      completed_at: null, status: 'in_progress', created_by: 'dev1', scope: null,
    } as any)
    vi.mocked(db.getAll).mockResolvedValue([
      { id: 'l1', session_id: 's1', product_id: 'p1', name_ar: 'منتج ١', expected_stock: 10, counted_stock: 8, variance: -2, variance_value_usd: -10 },
    ] as any)
  })

  it('shows total shrinkage and confirms the session on button click', async () => {
    const wrapper = mount(StockTakeReviewScreen)
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.get('[data-testid="stock-take-total-shrinkage"]').text()).toContain('10')

    await wrapper.get('[data-testid="stock-take-confirm"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    const sessionUpdate = vi.mocked(db.execute).mock.calls.find(([sql]) => /UPDATE stock_take_sessions/.test(sql))
    expect(sessionUpdate).toBeTruthy()
  })
})
