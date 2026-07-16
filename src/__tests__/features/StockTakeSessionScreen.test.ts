import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: 's1' } }),
  useRouter: () => ({ push: vi.fn() }),
}))

import { db } from '@/data/powersync/db'
import StockTakeSessionScreen from '@/features/stock-take/components/StockTakeSessionScreen.vue'

describe('StockTakeSessionScreen', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getOptional).mockResolvedValue({
      id: 's1', shop_id: 'shop1', started_at: '2026-07-14T00:00:00Z',
      completed_at: null, status: 'in_progress', created_by: 'dev1', scope: null,
    } as any)
    vi.mocked(db.getAll).mockResolvedValue([
      { id: 'l1', session_id: 's1', product_id: 'p1', name_ar: 'منتج ١', expected_stock: 10, counted_stock: null, variance: null, variance_value_usd: null },
    ] as any)
  })

  it('shows progress and lets the counter enter a quantity for the current line', async () => {
    const wrapper = mount(StockTakeSessionScreen)
    await flushPromisesLoop()

    expect(wrapper.get('[data-testid="stock-take-progress"]').text()).toContain('0')
    expect(wrapper.get('[data-testid="stock-take-progress"]').text()).toContain('1')

    await wrapper.get('[data-testid="stock-take-count-input"]').setValue('9')
    await wrapper.get('[data-testid="stock-take-count-submit"]').trigger('click')
    await flushPromisesLoop()

    const updateCall = vi.mocked(db.execute).mock.calls.find(([sql]) => /UPDATE stock_take_lines/.test(sql))
    expect(updateCall).toBeTruthy()
  })
})

async function flushPromisesLoop() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}
