import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/store/device.store', () => ({ useDeviceStore: () => ({ shopId: 'shop1' }) }))
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

import InventoryIntelligenceCard from './InventoryIntelligenceCard.vue'
import { useInventoryIntelligence } from '../composables/useInventoryIntelligence'

// Manually mock the composable so we can control its return value
vi.mock('../composables/useInventoryIntelligence', () => ({
  useInventoryIntelligence: vi.fn(() => ({
    data: ref(null),
    state: ref('loading'),
    load: vi.fn(),
  })),
}))

describe('InventoryIntelligenceCard', () => {
  beforeEach(() => vi.resetAllMocks())

  it('leads with the dollar figure prominently, count as supporting text', async () => {
    const mockLoad = vi.fn()
    vi.mocked(useInventoryIntelligence).mockReturnValue({
      data: ref({
        totalFrozenCapitalUsd: 500,
        productCount: 1,
        topOffenders: [
          {
            productId: 'p1',
            nameAr: 'منتج',
            currentStock: 10,
            costUsd: 50,
            valueUsd: 500,
            lastSoldAt: null,
            ageBasisDate: '2026-01-01',
            neverSold: true,
            isUncosted: false,
          },
        ],
      }),
      state: ref('ready'),
      load: mockLoad,
    } as any)

    const wrapper = mount(InventoryIntelligenceCard)
    await flushPromises()

    // Expand the card to see the full content
    await wrapper.find('[data-testid="ic-header"]').trigger('click')
    await wrapper.vm.$nextTick()

    // Verify the headline contains the dollar figure prominently
    const headline = wrapper.find('[data-testid="ic-header"] .ic-headline')
    expect(headline.text()).toContain('500')
    expect(headline.text()).toContain('$')

    // Verify the supporting text contains the product count
    expect(wrapper.text()).toContain('1')
    expect(wrapper.text()).toContain('منتج')
  })

  it('renders top-offenders list in the exact order provided by composable', async () => {
    const mockLoad = vi.fn()
    vi.mocked(useInventoryIntelligence).mockReturnValue({
      data: ref({
        totalFrozenCapitalUsd: 1500,
        productCount: 3,
        topOffenders: [
          {
            productId: 'p1',
            nameAr: 'منتج أول',
            currentStock: 10,
            costUsd: 50,
            valueUsd: 500,
            lastSoldAt: null,
            ageBasisDate: '2026-01-01',
            neverSold: true,
            isUncosted: false,
          },
          {
            productId: 'p2',
            nameAr: 'منتج ثاني',
            currentStock: 20,
            costUsd: 50,
            valueUsd: 1000,
            lastSoldAt: '2026-06-01',
            ageBasisDate: '2026-06-01',
            neverSold: false,
            isUncosted: false,
          },
        ],
      }),
      state: ref('ready'),
      load: mockLoad,
    } as any)

    const wrapper = mount(InventoryIntelligenceCard)
    await flushPromises()

    // Expand the card
    await wrapper.find('[data-testid="ic-header"]').trigger('click')
    await wrapper.vm.$nextTick()

    // Verify the offenders list renders in order
    const offenderRows = wrapper.findAll('.inv-offender-row')
    expect(offenderRows).toHaveLength(2)
    expect(offenderRows[0].text()).toContain('منتج أول')
    expect(offenderRows[0].text()).toContain('500')
    expect(offenderRows[1].text()).toContain('منتج ثاني')
    expect(offenderRows[1].text()).toContain('1000')
  })

  it('renders loading state distinctly from error state', async () => {
    const mockLoad = vi.fn()
    vi.mocked(useInventoryIntelligence).mockReturnValue({
      data: ref(null),
      state: ref('loading'),
      load: mockLoad,
    } as any)

    const wrapper = mount(InventoryIntelligenceCard)
    await flushPromises()

    // Expand the card
    await wrapper.find('[data-testid="ic-header"]').trigger('click')
    await wrapper.vm.$nextTick()

    // Verify loading state shows the loading indicator
    expect(wrapper.find('.ic-loading').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ic-error"]').exists()).toBe(false)
  })

  it('renders error state distinctly with retry button', async () => {
    const mockLoad = vi.fn()
    vi.mocked(useInventoryIntelligence).mockReturnValue({
      data: ref(null),
      state: ref('error'),
      load: mockLoad,
    } as any)

    const wrapper = mount(InventoryIntelligenceCard)
    await flushPromises()

    // Verify error state shows the error message and retry button
    expect(wrapper.find('[data-testid="ic-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ic-retry"]').exists()).toBe(true)
    expect(wrapper.find('.ic-loading').exists()).toBe(false)
  })

  it('calls load() on mount', async () => {
    const mockLoad = vi.fn()
    vi.mocked(useInventoryIntelligence).mockReturnValue({
      data: ref(null),
      state: ref('loading'),
      load: mockLoad,
    } as any)

    mount(InventoryIntelligenceCard)
    await flushPromises()

    expect(mockLoad).toHaveBeenCalled()
  })

  it('exposes reload() function for parent refresh', () => {
    const wrapper = mount(InventoryIntelligenceCard)
    expect(typeof wrapper.vm.reload).toBe('function')
  })

  it('calls load() when reload() is invoked', async () => {
    const mockLoad = vi.fn()
    vi.mocked(useInventoryIntelligence).mockReturnValue({
      data: ref(null),
      state: ref('loading'),
      load: mockLoad,
    } as any)

    const wrapper = mount(InventoryIntelligenceCard)
    await flushPromises()

    mockLoad.mockClear()
    await wrapper.vm.reload()
    await flushPromises()

    expect(mockLoad).toHaveBeenCalled()
  })

  it('calls load() when retry button is clicked', async () => {
    const mockLoad = vi.fn()
    vi.mocked(useInventoryIntelligence).mockReturnValue({
      data: ref(null),
      state: ref('error'),
      load: mockLoad,
    } as any)

    const wrapper = mount(InventoryIntelligenceCard)
    await flushPromises()

    mockLoad.mockClear()
    await wrapper.find('[data-testid="ic-retry"]').trigger('click')
    await flushPromises()

    expect(mockLoad).toHaveBeenCalled()
  })

  it('toggles expanded state when header is clicked', async () => {
    vi.mocked(useInventoryIntelligence).mockReturnValue({
      data: ref(null),
      state: ref('ready'),
      load: vi.fn(),
    } as any)

    const wrapper = mount(InventoryIntelligenceCard)
    expect(wrapper.vm.expanded).toBe(false)

    await wrapper.find('[data-testid="ic-header"]').trigger('click')
    expect(wrapper.vm.expanded).toBe(true)

    await wrapper.find('[data-testid="ic-header"]').trigger('click')
    expect(wrapper.vm.expanded).toBe(false)
  })

  it('renders viewDeadStock link when data is ready', async () => {
    const mockLoad = vi.fn()
    const mockPush = vi.fn()
    vi.mocked(useInventoryIntelligence).mockReturnValue({
      data: ref({
        totalFrozenCapitalUsd: 500,
        productCount: 1,
        topOffenders: [],
      }),
      state: ref('ready'),
      load: mockLoad,
    } as any)

    const wrapper = mount(InventoryIntelligenceCard, {
      global: {
        mocks: {
          $router: { push: mockPush },
        },
      },
    })
    await flushPromises()

    // Expand the card
    await wrapper.find('[data-testid="ic-header"]').trigger('click')
    await wrapper.vm.$nextTick()

    // Verify the viewDeadStock link is rendered
    const link = wrapper.find('.inv-action-link')
    expect(link.exists()).toBe(true)
    expect(link.text()).toContain('عرض')
  })
})