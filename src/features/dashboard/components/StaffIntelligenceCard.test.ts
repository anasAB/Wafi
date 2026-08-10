import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/store/device.store', () => ({ useDeviceStore: () => ({ shopId: 'shop1' }) }))

// Create a mock router object that we can track calls on
const mockRouterPush = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockRouterPush }),
}))

import StaffIntelligenceCard from './StaffIntelligenceCard.vue'
import { useStaffIntelligence } from '../composables/useStaffIntelligence'

// Manually mock the composable so we can control its return value
vi.mock('../composables/useStaffIntelligence', () => ({
  useStaffIntelligence: vi.fn(() => ({
    data: ref(null),
    state: ref('loading'),
    load: vi.fn(),
  })),
}))

describe('StaffIntelligenceCard', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockRouterPush.mockClear()
  })

  it('exposes reload() function for parent refresh', () => {
    const wrapper = mount(StaffIntelligenceCard, { props: { period: 'week', expanded: false } })
    expect(typeof wrapper.vm.reload).toBe('function')
  })

  it('emits toggle when header is clicked instead of managing expand state internally', async () => {
    vi.mocked(useStaffIntelligence).mockReturnValue({
      data: ref(null),
      state: ref('loading'),
      load: vi.fn(),
    } as any)

    const wrapper = mount(StaffIntelligenceCard, { props: { period: 'week', expanded: false } })
    await flushPromises()

    await wrapper.find('[data-testid="ic-header"]').trigger('click')
    expect(wrapper.emitted('toggle')).toBeTruthy()
    expect(wrapper.emitted('toggle')).toHaveLength(1)
  })

  it('shows top performer and highest discount rate as two separate facts', async () => {
    const mockLoad = vi.fn()
    vi.mocked(useStaffIntelligence).mockReturnValue({
      data: ref({
        topPerformer: { staffId: 'ahmed', name: 'Ahmed', revenueUsd: 1000 },
        highestDiscountRate: { staffId: 'sara', name: 'Sara', discountRatePct: 8.5 },
        shopAverageDiscountRatePct: 5.2,
      }),
      state: ref('ready'),
      load: mockLoad,
    } as any)

    const wrapper = mount(StaffIntelligenceCard, { props: { period: 'week', expanded: true } })
    await flushPromises()

    // Check that headline contains top performer name and revenue
    const headline = wrapper.find('[data-testid="ic-header"] .ic-headline')
    expect(headline.text()).toContain('Ahmed')
    expect(headline.text()).toContain('1000')

    // Check that discount rate line is rendered with distinct text
    const discountLine = wrapper.find('.staff-discount-line')
    expect(discountLine.exists()).toBe(true)
    expect(discountLine.text()).toContain('Sara')
    expect(discountLine.text()).toContain('8.5')
    expect(discountLine.text()).toContain('5.2')

    // Verify they are two separate, distinguishable pieces of text
    // by checking they are in different elements
    expect(headline.text()).not.toContain('Sara')
    expect(discountLine.text()).not.toContain('Ahmed')
  })

  it('does not render discount rate line when highestDiscountRate is null', async () => {
    const mockLoad = vi.fn()
    vi.mocked(useStaffIntelligence).mockReturnValue({
      data: ref({
        topPerformer: { staffId: 'ahmed', name: 'Ahmed', revenueUsd: 1000 },
        highestDiscountRate: null,
        shopAverageDiscountRatePct: 5.2,
      }),
      state: ref('ready'),
      load: mockLoad,
    } as any)

    const wrapper = mount(StaffIntelligenceCard, { props: { period: 'week', expanded: true } })
    await flushPromises()

    // Check that headline still shows top performer
    const headline = wrapper.find('[data-testid="ic-header"] .ic-headline')
    expect(headline.text()).toContain('Ahmed')
    expect(headline.text()).toContain('1000')

    // Check that discount rate line does NOT render
    const discountLine = wrapper.find('.staff-discount-line')
    expect(discountLine.exists()).toBe(false)
  })

  it('routes to /reports/staff when action link is clicked', async () => {
    const mockLoad = vi.fn()
    vi.mocked(useStaffIntelligence).mockReturnValue({
      data: ref({
        topPerformer: { staffId: 'ahmed', name: 'Ahmed', revenueUsd: 1000 },
        highestDiscountRate: { staffId: 'sara', name: 'Sara', discountRatePct: 8.5 },
        shopAverageDiscountRatePct: 5.2,
      }),
      state: ref('ready'),
      load: mockLoad,
    } as any)

    const wrapper = mount(StaffIntelligenceCard, { props: { period: 'week', expanded: true } })
    await flushPromises()

    // Find and click the action link
    const actionLink = wrapper.find('.staff-action-link')
    expect(actionLink.exists()).toBe(true)
    await actionLink.trigger('click')

    // Verify router.push was called with correct path
    expect(mockRouterPush).toHaveBeenCalledWith('/reports/staff')
  })

  it('reloads when period prop changes', async () => {
    const mockLoad = vi.fn()
    vi.mocked(useStaffIntelligence).mockReturnValue({
      data: ref(null),
      state: ref('loading'),
      load: mockLoad,
    } as any)

    const wrapper = mount(StaffIntelligenceCard, { props: { period: 'week', expanded: false } })
    await flushPromises()
    expect(mockLoad).toHaveBeenCalledWith('week')

    mockLoad.mockClear()
    await wrapper.setProps({ period: 'month' })
    await flushPromises()
    expect(mockLoad).toHaveBeenCalledWith('month')
  })

  it('loads data on mount', async () => {
    const mockLoad = vi.fn()
    vi.mocked(useStaffIntelligence).mockReturnValue({
      data: ref(null),
      state: ref('loading'),
      load: mockLoad,
    } as any)

    mount(StaffIntelligenceCard, { props: { period: 'week', expanded: false } })
    await flushPromises()

    expect(mockLoad).toHaveBeenCalledWith('week')
  })
})