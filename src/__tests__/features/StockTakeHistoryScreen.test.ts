import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: {} }),
  useRouter: () => ({ push: vi.fn() }),
}))

import { db } from '@/data/powersync/db'
import StockTakeHistoryScreen from '@/features/stock-take/components/StockTakeHistoryScreen.vue'

describe('StockTakeHistoryScreen', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([
      { id: 's2', started_at: '2026-07-14T00:00:00Z', created_by: 'dev1', products_counted: 20, total_shrinkage_usd: -15 },
      { id: 's1', started_at: '2026-06-14T00:00:00Z', created_by: 'dev1', products_counted: 15, total_shrinkage_usd: 2 },
    ] as any)
  })

  it('lists past sessions newest-first with the last-3 trend total', async () => {
    const wrapper = mount(StockTakeHistoryScreen)
    await new Promise((r) => setTimeout(r, 0))

    const rows = wrapper.findAll('[data-testid="stock-take-history-row"]')
    expect(rows).toHaveLength(2)
    expect(wrapper.get('[data-testid="stock-take-trend"]').text()).toContain('-13')
  })
})
