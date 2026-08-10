import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/store/device.store', () => ({ useDeviceStore: () => ({ shopId: 'shop1', shopName: 'محل' }) }))
vi.mock('@/composables/useCan', () => ({ useCan: () => ({ can: () => ref(true) }) }))

const { mockPush, mockUseEventSubscription } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockUseEventSubscription: vi.fn(() => ({ stop: vi.fn() })),
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: mockPush }) }))
vi.mock('@/services/events/useEventSubscription', () => ({
  useEventSubscription: mockUseEventSubscription,
}))

// Stub the 5 card components -- Dashboard2Screen's job is orchestration, not
// re-testing each card's internal rendering (that's covered by their own
// *.test.ts files). Each stub exposes reload() the same way the real card
// does, and re-emits toggle so accordion wiring can be asserted.
vi.mock('./RevenueIntelligenceCard.vue', () => ({
  default: {
    name: 'RevenueIntelligenceCard',
    props: ['period', 'expanded'],
    emits: ['toggle'],
    template: '<div class="RevenueIntelligenceCard-stub"><button class="stub-toggle" @click="$emit(\'toggle\')">toggle</button></div>',
    setup() { return { reload: vi.fn().mockResolvedValue(undefined) } },
  },
}))
vi.mock('./ProfitIntelligenceCard.vue', () => ({
  default: {
    name: 'ProfitIntelligenceCard',
    props: ['period', 'expanded'],
    emits: ['toggle'],
    template: '<div class="ProfitIntelligenceCard-stub"><button class="stub-toggle" @click="$emit(\'toggle\')">toggle</button></div>',
    setup() { return { reload: vi.fn().mockResolvedValue(undefined) } },
  },
}))
vi.mock('./InventoryIntelligenceCard.vue', () => ({
  default: {
    name: 'InventoryIntelligenceCard',
    props: ['expanded'],
    emits: ['toggle'],
    template: '<div class="InventoryIntelligenceCard-stub"><button class="stub-toggle" @click="$emit(\'toggle\')">toggle</button></div>',
    setup() { return { reload: vi.fn().mockResolvedValue(undefined) } },
  },
}))
vi.mock('./StaffIntelligenceCard.vue', () => ({
  default: {
    name: 'StaffIntelligenceCard',
    props: ['period', 'expanded'],
    emits: ['toggle'],
    template: '<div class="StaffIntelligenceCard-stub"><button class="stub-toggle" @click="$emit(\'toggle\')">toggle</button></div>',
    setup() { return { reload: vi.fn().mockResolvedValue(undefined) } },
  },
}))
vi.mock('./CustomerIntelligenceCard.vue', () => ({
  default: {
    name: 'CustomerIntelligenceCard',
    props: ['expanded'],
    emits: ['toggle'],
    template: '<div class="CustomerIntelligenceCard-stub"><button class="stub-toggle" @click="$emit(\'toggle\')">toggle</button></div>',
    setup() { return { reload: vi.fn().mockResolvedValue(undefined) } },
  },
}))
vi.mock('@/features/expenses/components/ExpenseForm.vue', () => ({
  default: { name: 'ExpenseForm', template: '<div class="expense-form-stub" />' },
}))

import { db } from '@/data/powersync/db'
import Dashboard2Screen from './Dashboard2Screen.vue'

describe('Dashboard2Screen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.getOptional).mockResolvedValue({ total: 0, count: 0, cogs: 0 } as any)
    vi.mocked(db.getAll).mockResolvedValue([] as any)
  })

  it('renders all 5 cards when the viewer has staff-performance permission', async () => {
    const wrapper = mount(Dashboard2Screen)
    await flushPromises()
    expect(wrapper.find('.RevenueIntelligenceCard-stub').exists()).toBe(true)
    expect(wrapper.find('.ProfitIntelligenceCard-stub').exists()).toBe(true)
    expect(wrapper.find('.InventoryIntelligenceCard-stub').exists()).toBe(true)
    expect(wrapper.find('.StaffIntelligenceCard-stub').exists()).toBe(true)
    expect(wrapper.find('.CustomerIntelligenceCard-stub').exists()).toBe(true)
  })

  it('hides the staff card when the viewer lacks staff-performance permission', async () => {
    vi.doMock('@/composables/useCan', () => ({ useCan: () => ({ can: () => ref(false) }) }))
    vi.resetModules()
    const { default: FreshDashboard2Screen } = await import('./Dashboard2Screen.vue')
    const wrapper = mount(FreshDashboard2Screen)
    await flushPromises()
    expect(wrapper.find('.StaffIntelligenceCard-stub').exists()).toBe(false)
  })

  it('renders the period selector with today/week/month options', () => {
    const wrapper = mount(Dashboard2Screen)
    expect(wrapper.text()).toContain('اليوم')
    expect(wrapper.text()).toContain('الأسبوع')
    expect(wrapper.text()).toContain('الشهر')
  })

  it('reloads all cards on mount (Promise.allSettled over each card ref)', async () => {
    const wrapper = mount(Dashboard2Screen)
    await flushPromises()

    const revenueVm = wrapper.findComponent({ name: 'RevenueIntelligenceCard' }).vm as any
    const profitVm = wrapper.findComponent({ name: 'ProfitIntelligenceCard' }).vm as any
    const inventoryVm = wrapper.findComponent({ name: 'InventoryIntelligenceCard' }).vm as any
    const staffVm = wrapper.findComponent({ name: 'StaffIntelligenceCard' }).vm as any
    const customerVm = wrapper.findComponent({ name: 'CustomerIntelligenceCard' }).vm as any

    expect(revenueVm.reload).toHaveBeenCalled()
    expect(profitVm.reload).toHaveBeenCalled()
    expect(inventoryVm.reload).toHaveBeenCalled()
    expect(staffVm.reload).toHaveBeenCalled()
    expect(customerVm.reload).toHaveBeenCalled()
  })

  it('coalesces multiple rapid domain events into a single reload cycle', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = mount(Dashboard2Screen)
      await flushPromises()

      const revenueVm = wrapper.findComponent({ name: 'RevenueIntelligenceCard' }).vm as any
      revenueVm.reload.mockClear()

      // useEventSubscription is registered once per REFRESH_ON_EVENTS entry
      // (sale.completed, sale.returned, customer.debt_changed, sale.discounted).
      // Invoke every handler "rapidly" (well within the debounce window) the way
      // several events fired by a single sale would -- this must still resolve
      // into exactly one reload cycle, not one per event.
      for (const call of mockUseEventSubscription.mock.calls) {
        const handler = call[1] as () => void
        handler()
      }

      await vi.advanceTimersByTimeAsync(400)
      await flushPromises()

      expect(revenueVm.reload).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('mobile accordion allows only one card expanded at a time', async () => {
    // Force isMobile true for this assertion by mounting at a narrow width.
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: true, // pretend every query matches -> isMobile becomes true
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })))

    const wrapper = mount(Dashboard2Screen)
    await flushPromises()

    const revenueStub = wrapper.find('.RevenueIntelligenceCard-stub .stub-toggle')
    const profitStub = wrapper.find('.ProfitIntelligenceCard-stub .stub-toggle')

    await revenueStub.trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.findComponent({ name: 'RevenueIntelligenceCard' }).props('expanded')).toBe(true)
    expect(wrapper.findComponent({ name: 'ProfitIntelligenceCard' }).props('expanded')).toBe(false)

    await profitStub.trigger('click')
    await wrapper.vm.$nextTick()
    // Expanding profit on mobile should collapse revenue (only one open at a time).
    expect(wrapper.findComponent({ name: 'ProfitIntelligenceCard' }).props('expanded')).toBe(true)
    expect(wrapper.findComponent({ name: 'RevenueIntelligenceCard' }).props('expanded')).toBe(false)

    vi.unstubAllGlobals()
  })

  it('desktop allows multiple cards expanded independently', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: false, // desktop: isMobile stays false
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })))

    const wrapper = mount(Dashboard2Screen)
    await flushPromises()

    const revenueStub = wrapper.find('.RevenueIntelligenceCard-stub .stub-toggle')
    const profitStub = wrapper.find('.ProfitIntelligenceCard-stub .stub-toggle')

    await revenueStub.trigger('click')
    await profitStub.trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.findComponent({ name: 'RevenueIntelligenceCard' }).props('expanded')).toBe(true)
    expect(wrapper.findComponent({ name: 'ProfitIntelligenceCard' }).props('expanded')).toBe(true)

    vi.unstubAllGlobals()
  })

  it('navigates to /pos when "ring sale" quick action is clicked', async () => {
    const wrapper = mount(Dashboard2Screen)
    await flushPromises()
    await wrapper.findAll('.d2-quick-actions button')[0].trigger('click')
    expect(mockPush).toHaveBeenCalledWith('/pos')
  })

  it('opens the ExpenseForm dialog when "add expense" quick action is clicked', async () => {
    const wrapper = mount(Dashboard2Screen)
    await flushPromises()
    expect(wrapper.find('.expense-form-stub').exists()).toBe(false)

    await wrapper.findAll('.d2-quick-actions button')[1].trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.expense-form-stub').exists()).toBe(true)
  })

  it('navigates to /customers/collections when "record payment" quick action is clicked', async () => {
    const wrapper = mount(Dashboard2Screen)
    await flushPromises()
    await wrapper.findAll('.d2-quick-actions button')[2].trigger('click')
    expect(mockPush).toHaveBeenCalledWith('/customers/collections')
  })

  it('navigates to /pos when "open shift" quick action is clicked (global LockScreen flow handles the rest)', async () => {
    const wrapper = mount(Dashboard2Screen)
    await flushPromises()
    await wrapper.findAll('.d2-quick-actions button')[3].trigger('click')
    expect(mockPush).toHaveBeenCalledWith('/pos')
  })
})
