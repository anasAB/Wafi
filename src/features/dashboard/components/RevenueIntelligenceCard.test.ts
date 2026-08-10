import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/store/device.store', () => ({ useDeviceStore: () => ({ shopId: 'shop1' }) }))
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

import { db } from '@/data/powersync/db'
import RevenueIntelligenceCard from './RevenueIntelligenceCard.vue'
import { useRevenueIntelligence } from '../composables/useRevenueIntelligence'

// Manually mock the composable so we can control its return value
vi.mock('../composables/useRevenueIntelligence', () => ({
  useRevenueIntelligence: vi.fn(() => ({
    data: ref(null),
    state: ref('loading'),
    load: vi.fn(),
  })),
}))

describe('RevenueIntelligenceCard', () => {
  beforeEach(() => vi.resetAllMocks())

  it('exposes reload() function for parent refresh', () => {
    const wrapper = mount(RevenueIntelligenceCard, { props: { period: 'week', expanded: false } })
    expect(typeof wrapper.vm.reload).toBe('function')
  })

  it('emits toggle when header is clicked instead of managing expand state internally', async () => {
    vi.mocked(useRevenueIntelligence).mockReturnValue({
      data: ref(null),
      state: ref('loading'),
      load: vi.fn(),
    } as any)

    const wrapper = mount(RevenueIntelligenceCard, { props: { period: 'week', expanded: false } })
    await flushPromises()

    await wrapper.find('[data-testid="ic-header"]').trigger('click')
    expect(wrapper.emitted('toggle')).toBeTruthy()
    expect(wrapper.emitted('toggle')).toHaveLength(1)
  })

  it('renders headline with correct text when revenue is up', async () => {
    // Mock the composable to return data with upward revenue change
    const mockLoad = vi.fn()
    vi.mocked(useRevenueIntelligence).mockReturnValue({
      data: ref({
        metric: {
          currentUsd: 1100,
          previousUsd: 1000,
          changePct: 10,
          direction: 'up',
        },
        drivers: [
          { key: 'transactionCount', current: 45, previous: 40, changePct: 12.5 },
          { key: 'returnCount', current: 2, previous: 1, changePct: 100 },
          { key: 'avgBasket', current: 24.44, previous: 25, changePct: -2.24 },
        ],
      }),
      state: ref('ready'),
      load: mockLoad,
    } as any)

    const wrapper = mount(RevenueIntelligenceCard, { props: { period: 'week', expanded: false } })
    await flushPromises()

    // Verify the headline contains the expected Arabic text and percent
    const headline = wrapper.find('[data-testid="ic-header"] .ic-headline')
    expect(headline.text()).toContain('الإيرادات')
    expect(headline.text()).toContain('10')
  })

  it('renders headline with correct text when revenue is down', async () => {
    const mockLoad = vi.fn()
    vi.mocked(useRevenueIntelligence).mockReturnValue({
      data: ref({
        metric: {
          currentUsd: 900,
          previousUsd: 1000,
          changePct: -10,
          direction: 'down',
        },
        drivers: [
          { key: 'transactionCount', current: 35, previous: 40, changePct: -12.5 },
          { key: 'returnCount', current: 3, previous: 1, changePct: 200 },
          { key: 'avgBasket', current: 25.71, previous: 25, changePct: 2.84 },
        ],
      }),
      state: ref('ready'),
      load: mockLoad,
    } as any)

    const wrapper = mount(RevenueIntelligenceCard, { props: { period: 'week', expanded: false } })
    await flushPromises()

    // Verify the headline contains the expected Arabic text and percent
    const headline = wrapper.find('[data-testid="ic-header"] .ic-headline')
    expect(headline.text()).toContain('الإيرادات')
    expect(headline.text()).toContain('10')
  })

  it('shows placeholder state when drivers is null (day-period truncation)', async () => {
    const mockLoad = vi.fn()
    vi.mocked(useRevenueIntelligence).mockReturnValue({
      data: ref({
        metric: {
          currentUsd: 500,
          previousUsd: 600,
          changePct: -16.67,
          direction: 'down',
        },
        drivers: null, // Null drivers triggers placeholder state
      }),
      state: ref('ready'),
      load: mockLoad,
    } as any)

    const wrapper = mount(RevenueIntelligenceCard, { props: { period: 'day', expanded: true } })
    await wrapper.vm.$nextTick() // Trigger computed property update
    await flushPromises()

    // Verify placeholder state is shown, not the drivers list
    expect(wrapper.find('[data-testid="ic-placeholder"]').exists()).toBe(true)
    // The drivers list should not be rendered when drivers is null
    expect(wrapper.find('.rev-drivers').exists()).toBe(false)
  })

  it('renders driver metrics when drivers array is populated', async () => {
    const mockLoad = vi.fn()
    vi.mocked(useRevenueIntelligence).mockReturnValue({
      data: ref({
        metric: {
          currentUsd: 1100,
          previousUsd: 1000,
          changePct: 10,
          direction: 'up',
        },
        drivers: [
          { key: 'transactionCount', current: 45, previous: 40, changePct: 12.5 },
          { key: 'returnCount', current: 2, previous: 1, changePct: 100 },
          { key: 'avgBasket', current: 24.44, previous: 25, changePct: -2.24 },
        ],
      }),
      state: ref('ready'),
      load: mockLoad,
    } as any)

    const wrapper = mount(RevenueIntelligenceCard, { props: { period: 'week', expanded: true } })
    await flushPromises()

    // Verify the drivers list is rendered with correct values
    const driverRows = wrapper.findAll('.rev-driver-row')
    expect(driverRows).toHaveLength(3)
    expect(driverRows[0].text()).toContain('40 → 45')
    expect(driverRows[1].text()).toContain('1 → 2')
    expect(driverRows[2].text()).toContain('25 → 24')
  })

  it('reloads when period prop changes', async () => {
    const mockLoad = vi.fn()
    vi.mocked(useRevenueIntelligence).mockReturnValue({
      data: ref(null),
      state: ref('loading'),
      load: mockLoad,
    } as any)

    const wrapper = mount(RevenueIntelligenceCard, { props: { period: 'week', expanded: false } })
    await flushPromises()
    expect(mockLoad).toHaveBeenCalledWith('week')

    mockLoad.mockClear()
    await wrapper.setProps({ period: 'month' })
    await flushPromises()
    expect(mockLoad).toHaveBeenCalledWith('month')
  })
})
