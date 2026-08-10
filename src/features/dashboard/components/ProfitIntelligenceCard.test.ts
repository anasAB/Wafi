import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/store/device.store', () => ({ useDeviceStore: () => ({ shopId: 'shop1' }) }))

import { db } from '@/data/powersync/db'
import ProfitIntelligenceCard from './ProfitIntelligenceCard.vue'
import { useProfitIntelligence } from '../composables/useProfitIntelligence'

// Manually mock the composable so we can control its return value
vi.mock('../composables/useProfitIntelligence', () => ({
  useProfitIntelligence: vi.fn(() => ({
    data: ref(null),
    state: ref('loading'),
    load: vi.fn(),
  })),
}))

describe('ProfitIntelligenceCard', () => {
  beforeEach(() => vi.resetAllMocks())

  it('exposes reload() function for parent refresh', () => {
    const wrapper = mount(ProfitIntelligenceCard, { props: { period: 'week' } })
    expect(typeof wrapper.vm.reload).toBe('function')
  })

  it('renders headline with profit dollar change, not margin percentage', async () => {
    // Mock the composable to return data with upward profit change
    const mockLoad = vi.fn()
    vi.mocked(useProfitIntelligence).mockReturnValue({
      data: ref({
        metric: {
          currentUsd: 1100,
          previousUsd: 1000,
          changePct: 10,
          direction: 'up',
        },
        marginCurrentPct: 22.5,
        marginPreviousPct: 20.0,
        drivers: [
          { key: 'revenue', current: 5000, previous: 4500, changePct: 11.11 },
          { key: 'cogs', current: 3000, previous: 3000, changePct: 0 },
          { key: 'discounts', current: 200, previous: 200, changePct: 0 },
        ],
      }),
      state: ref('ready'),
      load: mockLoad,
    } as any)

    const wrapper = mount(ProfitIntelligenceCard, { props: { period: 'week' } })
    await flushPromises()

    // Verify the headline contains the profit direction and PERCENT CHANGE IN PROFIT
    // NOT margin percentage. The text should contain "الربح" (profit) and "10" (the percent)
    const headline = wrapper.find('[data-testid="ic-header"] .ic-headline')
    expect(headline.text()).toContain('الربح')
    expect(headline.text()).toContain('10')
  })

  it('renders headline with correct text when profit is down', async () => {
    const mockLoad = vi.fn()
    vi.mocked(useProfitIntelligence).mockReturnValue({
      data: ref({
        metric: {
          currentUsd: 900,
          previousUsd: 1000,
          changePct: -10,
          direction: 'down',
        },
        marginCurrentPct: 18.0,
        marginPreviousPct: 20.0,
        drivers: [
          { key: 'revenue', current: 5000, previous: 5000, changePct: 0 },
          { key: 'cogs', current: 3500, previous: 3000, changePct: 16.67 },
          { key: 'discounts', current: 200, previous: 200, changePct: 0 },
        ],
      }),
      state: ref('ready'),
      load: mockLoad,
    } as any)

    const wrapper = mount(ProfitIntelligenceCard, { props: { period: 'week' } })
    await flushPromises()

    // Verify the headline contains the expected Arabic text and percent
    const headline = wrapper.find('[data-testid="ic-header"] .ic-headline')
    expect(headline.text()).toContain('الربح')
    expect(headline.text()).toContain('10')
  })

  it('renders margin supporting line with current and previous percentages', async () => {
    const mockLoad = vi.fn()
    vi.mocked(useProfitIntelligence).mockReturnValue({
      data: ref({
        metric: {
          currentUsd: 1100,
          previousUsd: 1000,
          changePct: 10,
          direction: 'up',
        },
        marginCurrentPct: 22.5,
        marginPreviousPct: 20.0,
        drivers: [
          { key: 'revenue', current: 5000, previous: 4500, changePct: 11.11 },
          { key: 'cogs', current: 3000, previous: 3000, changePct: 0 },
          { key: 'discounts', current: 200, previous: 200, changePct: 0 },
        ],
      }),
      state: ref('ready'),
      load: mockLoad,
    } as any)

    const wrapper = mount(ProfitIntelligenceCard, { props: { period: 'week' } })
    await flushPromises()

    // Expand the card
    await wrapper.find('[data-testid="ic-header"]').trigger('click')
    await wrapper.vm.$nextTick()

    // Verify the margin line is rendered with correct values (23% ← 20% (+3 نقطة))
    const marginLine = wrapper.find('.profit-margin-line')
    expect(marginLine.exists()).toBe(true)
    expect(marginLine.text()).toContain('23')
    expect(marginLine.text()).toContain('20')
    expect(marginLine.text()).toContain('+3')
  })

  it('shows placeholder state when drivers is null (day-period truncation)', async () => {
    const mockLoad = vi.fn()
    vi.mocked(useProfitIntelligence).mockReturnValue({
      data: ref({
        metric: {
          currentUsd: 500,
          previousUsd: 600,
          changePct: -16.67,
          direction: 'down',
        },
        marginCurrentPct: 18.0,
        marginPreviousPct: 20.0,
        drivers: null, // Null drivers triggers placeholder state
      }),
      state: ref('ready'),
      load: mockLoad,
    } as any)

    const wrapper = mount(ProfitIntelligenceCard, { props: { period: 'day' } })
    await wrapper.vm.$nextTick() // Trigger computed property update
    await flushPromises()

    // Expand to see the content
    await wrapper.find('[data-testid="ic-header"]').trigger('click')
    await wrapper.vm.$nextTick()

    // Verify placeholder state is shown, not the drivers list
    expect(wrapper.find('[data-testid="ic-placeholder"]').exists()).toBe(true)
    // The drivers list should not be rendered when drivers is null
    expect(wrapper.find('.profit-drivers').exists()).toBe(false)
  })

  it('renders driver metrics when drivers array is populated', async () => {
    const mockLoad = vi.fn()
    vi.mocked(useProfitIntelligence).mockReturnValue({
      data: ref({
        metric: {
          currentUsd: 1100,
          previousUsd: 1000,
          changePct: 10,
          direction: 'up',
        },
        marginCurrentPct: 22.5,
        marginPreviousPct: 20.0,
        drivers: [
          { key: 'revenue', current: 5000, previous: 4500, changePct: 11.11 },
          { key: 'cogs', current: 3000, previous: 3000, changePct: 0 },
          { key: 'discounts', current: 200, previous: 200, changePct: 0 },
        ],
      }),
      state: ref('ready'),
      load: mockLoad,
    } as any)

    const wrapper = mount(ProfitIntelligenceCard, { props: { period: 'week' } })
    await flushPromises()

    // Expand the card
    await wrapper.find('[data-testid="ic-header"]').trigger('click')
    await wrapper.vm.$nextTick()

    // Verify the drivers list is rendered with correct values
    const driverRows = wrapper.findAll('.profit-driver-row')
    expect(driverRows).toHaveLength(3)
    expect(driverRows[0].text()).toContain('4500')
    expect(driverRows[0].text()).toContain('5000')
    expect(driverRows[1].text()).toContain('3000')
    expect(driverRows[2].text()).toContain('200')
  })

  it('reloads when period prop changes', async () => {
    const mockLoad = vi.fn()
    vi.mocked(useProfitIntelligence).mockReturnValue({
      data: ref(null),
      state: ref('loading'),
      load: mockLoad,
    } as any)

    const wrapper = mount(ProfitIntelligenceCard, { props: { period: 'week' } })
    await flushPromises()
    expect(mockLoad).toHaveBeenCalledWith('week')

    mockLoad.mockClear()
    await wrapper.setProps({ period: 'month' })
    await flushPromises()
    expect(mockLoad).toHaveBeenCalledWith('month')
  })
})
