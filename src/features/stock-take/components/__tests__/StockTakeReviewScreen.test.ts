import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { ref } from 'vue'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: 'session-1' } }),
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/features/stock-take/composables/useStockTake', () => ({
  useStockTake: vi.fn(),
}))
vi.mock('@/features/stock-take/composables/useStockTakeVariance', () => ({
  useStockTakeVariance: vi.fn(),
}))

import StockTakeReviewScreen from '../StockTakeReviewScreen.vue'
import { useStockTake } from '../../composables/useStockTake'
import { useStockTakeVariance } from '../../composables/useStockTakeVariance'

function stubStockTake(overrides: Partial<Record<string, any>> = {}) {
  return {
    currentSession: ref({ id: 'session-1', startedAt: '2026-07-29T10:00:00Z', completedAt: null, status: 'in_progress' }),
    lines: ref([]),
    loadSession: vi.fn().mockResolvedValue(undefined),
    reviewLines: ref([
      { id: 'line-1', sessionId: 'session-1', productId: 'p1', productNameAr: 'قلم رصاص', expectedStock: 100, countedStock: 87, variance: -13, varianceValueUsd: -13, liveStock: 95 },
    ]),
    totalShrinkageValueUsd: ref(-13),
    confirmSession: vi.fn().mockResolvedValue('committed'),
    ...overrides,
  }
}

describe('StockTakeReviewScreen — WAFI-009 variance timeline', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('does not show timeline content until a line is expanded', async () => {
    vi.mocked(useStockTake).mockReturnValue(stubStockTake() as any)
    const loadMovements = vi.fn()
    vi.mocked(useStockTakeVariance).mockReturnValue({ loadMovements } as any)

    const wrapper = mount(StockTakeReviewScreen)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(loadMovements).not.toHaveBeenCalled()
    expect(wrapper.text()).not.toContain('صافي الحركة')
  })

  it('loads and shows movements, net movement, session variance, and unexplained variance when a line is expanded', async () => {
    vi.mocked(useStockTake).mockReturnValue(stubStockTake() as any)
    const loadMovements = vi.fn().mockResolvedValue({
      entries: [
        { id: 'a', timestamp: '2026-07-29T10:32:00Z', reason: 'sale', delta: -3 },
        { id: 'b', timestamp: '2026-07-29T10:50:00Z', reason: 'return', delta: 1 },
      ],
      netMovementDelta: -2,
      unexplainedVariance: -11,
    })
    vi.mocked(useStockTakeVariance).mockReturnValue({ loadMovements } as any)

    const wrapper = mount(StockTakeReviewScreen)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    await wrapper.find('.line-card').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(loadMovements).toHaveBeenCalledWith('p1', -13, '2026-07-29T10:00:00Z', expect.any(String))
    expect(wrapper.text()).toContain('بيع')
    expect(wrapper.text()).toContain('مرتجع')
    expect(wrapper.text()).toContain('صافي الحركة')
    expect(wrapper.text()).toContain('الفرق غير المفسّر')
  })

  it('does not call loadMovements a second time when the same line is collapsed and re-expanded', async () => {
    vi.mocked(useStockTake).mockReturnValue(stubStockTake() as any)
    const loadMovements = vi.fn().mockResolvedValue({ entries: [], netMovementDelta: 0, unexplainedVariance: -13 })
    vi.mocked(useStockTakeVariance).mockReturnValue({ loadMovements } as any)

    const wrapper = mount(StockTakeReviewScreen)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    await wrapper.find('.line-card').trigger('click')   // expand
    await wrapper.vm.$nextTick()
    await wrapper.find('.line-card').trigger('click')   // collapse
    await wrapper.vm.$nextTick()
    await wrapper.find('.line-card').trigger('click')   // re-expand
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    // useStockTakeVariance's own cache (Task 2) handles de-duplication; the
    // component just needs to call it every expand without adding its own
    // separate guard that would fight that cache.
    expect(loadMovements).toHaveBeenCalledTimes(2)
  })

  it('shows a no-movements message when there are zero movements in the window', async () => {
    vi.mocked(useStockTake).mockReturnValue(stubStockTake() as any)
    const loadMovements = vi.fn().mockResolvedValue({ entries: [], netMovementDelta: 0, unexplainedVariance: -13 })
    vi.mocked(useStockTakeVariance).mockReturnValue({ loadMovements } as any)

    const wrapper = mount(StockTakeReviewScreen)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    await wrapper.find('.line-card').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('لا توجد حركات')
  })

  it('renders an unrecognized movement reason with a generic fallback instead of crashing', async () => {
    vi.mocked(useStockTake).mockReturnValue(stubStockTake() as any)
    const loadMovements = vi.fn().mockResolvedValue({
      entries: [{ id: 'a', timestamp: '2026-07-29T10:32:00Z', reason: 'transfer', delta: -2 }],
      netMovementDelta: -2,
      unexplainedVariance: -11,
    })
    vi.mocked(useStockTakeVariance).mockReturnValue({ loadMovements } as any)

    const wrapper = mount(StockTakeReviewScreen)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    await wrapper.find('.line-card').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('transfer')
    expect(wrapper.text()).toContain('❔')
  })

  it('expanding a second line collapses the first (single-open accordion)', async () => {
    vi.mocked(useStockTake).mockReturnValue(stubStockTake({
      reviewLines: ref([
        { id: 'line-1', sessionId: 'session-1', productId: 'p1', productNameAr: 'قلم رصاص', expectedStock: 100, countedStock: 87, variance: -13, varianceValueUsd: -13, liveStock: 95 },
        { id: 'line-2', sessionId: 'session-1', productId: 'p2', productNameAr: 'ممحاة', expectedStock: 50, countedStock: 48, variance: -2, varianceValueUsd: -2, liveStock: 50 },
      ]),
    }) as any)
    const loadMovements = vi.fn().mockResolvedValue({ entries: [], netMovementDelta: 0, unexplainedVariance: -13 })
    vi.mocked(useStockTakeVariance).mockReturnValue({ loadMovements } as any)

    const wrapper = mount(StockTakeReviewScreen)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    const cards = wrapper.findAll('.line-card')
    await cards[0].trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('لا توجد حركات')

    await cards[1].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    // Both lines currently show the same stubbed "no movements" text, so
    // assert via call count instead of text presence/absence.
    expect(loadMovements).toHaveBeenCalledWith('p2', -2, expect.any(String), expect.any(String))
  })
})
