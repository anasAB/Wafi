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

    const wrapper = mount(InventoryIntelligenceCard, { props: { expanded: true } })
    await flushPromises()

    // Verify the headline contains the dollar figure prominently
    const headline = wrapper.find('[data-testid="ic-header"] .ic-headline')
    expect(headline.text()).toContain('500')
    expect(headline.text()).toContain('$')

    // Verify the supporting text contains the product count (scoped to .inv-supporting)
    const supporting = wrapper.find('.inv-supporting')
    expect(supporting.text()).toContain('1')
    expect(supporting.text()).toContain('منتج')
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

    const wrapper = mount(InventoryIntelligenceCard, { props: { expanded: true } })
    await flushPromises()

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

    const wrapper = mount(InventoryIntelligenceCard, { props: { expanded: true } })
    await flushPromises()

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

    const wrapper = mount(InventoryIntelligenceCard, { props: { expanded: false } })
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

    mount(InventoryIntelligenceCard, { props: { expanded: false } })
    await flushPromises()

    expect(mockLoad).toHaveBeenCalled()
  })

  it('exposes reload() function for parent refresh', () => {
    const wrapper = mount(InventoryIntelligenceCard, { props: { expanded: false } })
    expect(typeof wrapper.vm.reload).toBe('function')
  })

  it('calls load() when reload() is invoked', async () => {
    const mockLoad = vi.fn()
    vi.mocked(useInventoryIntelligence).mockReturnValue({
      data: ref(null),
      state: ref('loading'),
      load: mockLoad,
    } as any)

    const wrapper = mount(InventoryIntelligenceCard, { props: { expanded: false } })
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

    const wrapper = mount(InventoryIntelligenceCard, { props: { expanded: false } })
    await flushPromises()

    mockLoad.mockClear()
    await wrapper.find('[data-testid="ic-retry"]').trigger('click')
    await flushPromises()

    expect(mockLoad).toHaveBeenCalled()
  })

  it('emits toggle when header is clicked (expand state is now owned by the parent)', async () => {
    vi.mocked(useInventoryIntelligence).mockReturnValue({
      data: ref(null),
      state: ref('ready'),
      load: vi.fn(),
    } as any)

    const wrapper = mount(InventoryIntelligenceCard, { props: { expanded: false } })

    await wrapper.find('[data-testid="ic-header"]').trigger('click')
    expect(wrapper.emitted('toggle')).toBeTruthy()
    expect(wrapper.emitted('toggle')).toHaveLength(1)

    await wrapper.find('[data-testid="ic-header"]').trigger('click')
    expect(wrapper.emitted('toggle')).toHaveLength(2)
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
      props: { expanded: true },
      global: {
        mocks: {
          $router: { push: mockPush },
        },
      },
    })
    await flushPromises()

    // Verify the viewDeadStock link is rendered
    const link = wrapper.find('.inv-action-link')
    expect(link.exists()).toBe(true)
    expect(link.text()).toContain('عرض')
  })
})
