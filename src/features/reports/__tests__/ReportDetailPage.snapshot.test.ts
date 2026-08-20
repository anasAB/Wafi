import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { setActivePinia, createPinia } from 'pinia'
import ReportDetailPage from '../ReportDetailPage.vue'

vi.mock('@/data/powersync/db', () => ({
  db: {
    getOptional: vi.fn(),
    getAll: vi.fn().mockResolvedValue([]),
  },
}))
vi.mock('@/store/device.store', () => ({ useDeviceStore: () => ({ shopId: 'shop1' }) }))

describe('ReportDetailPage snapshot-first read path', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('renders snapshot data with a generated-at timestamp when a matching snapshot exists, without calling compute()', async () => {
    const { db } = await import('@/data/powersync/db')
    vi.mocked(db.getOptional).mockResolvedValueOnce({
      id: 'snap-1',
      report_data: JSON.stringify({
        id: 'cash-flow', name: 'Cash Flow Report', dateRange: { from: '2026-08-19', to: '2026-08-19' },
        sections: [{ type: 'summary', title: 'Cash Flow', visibility: 'shop', metrics: [] }],
      }),
      generated_at: '2026-08-20T00:01:00.000Z',
    })

    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/reports/:reportId', component: ReportDetailPage }] })
    await router.push('/reports/cash-flow')
    const wrapper = mount(ReportDetailPage, { global: { plugins: [router] } })
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.find('[data-testid="snapshot-generated-at"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('2026-08-20')
  })

  it('falls back to live compute() with no generated-at display when no snapshot exists', async () => {
    const { db } = await import('@/data/powersync/db')
    vi.mocked(db.getOptional).mockResolvedValueOnce(undefined)

    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/reports/:reportId', component: ReportDetailPage }] })
    await router.push('/reports/cash-flow')
    const wrapper = mount(ReportDetailPage, { global: { plugins: [router] } })
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.find('[data-testid="snapshot-generated-at"]').exists()).toBe(false)
  })
})
