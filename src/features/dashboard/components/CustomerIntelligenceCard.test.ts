import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { createI18n } from 'vue-i18n'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/store/device.store', () => ({ useDeviceStore: () => ({ shopId: 'shop1' }) }))
vi.mock('@/features/dashboard/composables/useCustomerIntelligence')
vi.mock('@/features/messaging/useSendChurnReminder')
vi.mock('@/features/receipt/composables/useReceiptSettings')

import { db } from '@/data/powersync/db'
import { useCustomerIntelligence } from '@/features/dashboard/composables/useCustomerIntelligence'
import { useSendChurnReminder } from '@/features/messaging/useSendChurnReminder'
import { useReceiptSettings } from '@/features/receipt/composables/useReceiptSettings'
import CustomerIntelligenceCard from './CustomerIntelligenceCard.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/customers/:id', component: { template: '<div>Customer Detail</div>' } },
  ],
})

const i18n = createI18n({
  legacy: false,
  locale: 'ar',
  messages: {
    ar: {
      dashboard2: {
        customer: {
          headline: 'عدد العملاء غير النشطين: {count}',
          lastPurchase: 'آخر شراء منذ {days} يوم',
          sendReminder: 'إرسال تذكير',
          viewDetail: 'عرض التفاصيل',
        },
      },
    },
  },
})

describe('CustomerIntelligenceCard', () => {
  beforeEach(() => {
    vi.resetAllMocks()

    // Mock useCustomerIntelligence with proper refs
    vi.mocked(useCustomerIntelligence).mockReturnValue({
      data: ref(null),
      state: ref('loading' as const),
      load: vi.fn(),
    } as any)

    // Mock useSendChurnReminder
    vi.mocked(useSendChurnReminder).mockReturnValue({
      prepare: vi.fn((opts: any) => ({ phone: opts.phoneRaw || null, text: 'test' })),
      send: vi.fn(),
    } as any)

    // Mock useReceiptSettings with proper refs
    vi.mocked(useReceiptSettings).mockReturnValue({
      settings: ref({ shopName: 'محل تجريبي' }),
      load: vi.fn().mockResolvedValue(undefined),
      save: vi.fn(),
    } as any)
  })

  it('renders inactive count in the headline', async () => {
    const mockLoad = vi.fn()
    vi.mocked(useCustomerIntelligence).mockReturnValue({
      data: ref({
        inactiveCount: 1,
        inactiveCustomers: [
          {
            customerId: 'c1',
            customerName: 'زبون',
            lastPurchaseAt: '2026-05-01T00:00:00.000Z',
            daysSincePurchase: 101,
            phone: null,
            mobile: null,
          },
        ],
      }),
      state: ref('ready' as const),
      load: mockLoad,
    } as any)

    const wrapper = mount(CustomerIntelligenceCard, {
      props: { expanded: true },
      global: { plugins: [router, i18n] },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('1')
  })

  it('hides the send-reminder action when the customer has no phone on file', async () => {
    const mockLoad = vi.fn()
    vi.mocked(useCustomerIntelligence).mockReturnValue({
      data: ref({
        inactiveCount: 1,
        inactiveCustomers: [
          {
            customerId: 'c1',
            customerName: 'زبون',
            lastPurchaseAt: '2026-05-01T00:00:00.000Z',
            daysSincePurchase: 101,
            phone: null,
            mobile: null,
          },
        ],
      }),
      state: ref('ready' as const),
      load: mockLoad,
    } as any)

    const wrapper = mount(CustomerIntelligenceCard, {
      props: { expanded: true },
      global: { plugins: [router, i18n] },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="send-reminder-c1"]').exists()).toBe(false)
  })

  it('shows the send-reminder action when customer has a phone', async () => {
    const mockLoad = vi.fn()
    vi.mocked(useCustomerIntelligence).mockReturnValue({
      data: ref({
        inactiveCount: 1,
        inactiveCustomers: [
          {
            customerId: 'c1',
            customerName: 'زبون',
            lastPurchaseAt: '2026-05-01T00:00:00.000Z',
            daysSincePurchase: 101,
            phone: '0964123456',
            mobile: null,
          },
        ],
      }),
      state: ref('ready' as const),
      load: mockLoad,
    } as any)

    const wrapper = mount(CustomerIntelligenceCard, {
      props: { expanded: true },
      global: { plugins: [router, i18n] },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="send-reminder-c1"]').exists()).toBe(true)
  })

  it('shows the send-reminder action when customer has a mobile', async () => {
    const mockLoad = vi.fn()
    vi.mocked(useCustomerIntelligence).mockReturnValue({
      data: ref({
        inactiveCount: 1,
        inactiveCustomers: [
          {
            customerId: 'c1',
            customerName: 'زبون',
            lastPurchaseAt: '2026-05-01T00:00:00.000Z',
            daysSincePurchase: 101,
            phone: null,
            mobile: '0964123456',
          },
        ],
      }),
      state: ref('ready' as const),
      load: mockLoad,
    } as any)

    const wrapper = mount(CustomerIntelligenceCard, {
      props: { expanded: true },
      global: { plugins: [router, i18n] },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="send-reminder-c1"]').exists()).toBe(true)
  })

  it('routes to /customers/:id when "View customer detail" is clicked', async () => {
    const mockLoad = vi.fn()
    vi.mocked(useCustomerIntelligence).mockReturnValue({
      data: ref({
        inactiveCount: 1,
        inactiveCustomers: [
          {
            customerId: 'c1',
            customerName: 'زبون',
            lastPurchaseAt: '2026-05-01T00:00:00.000Z',
            daysSincePurchase: 101,
            phone: null,
            mobile: null,
          },
        ],
      }),
      state: ref('ready' as const),
      load: mockLoad,
    } as any)

    const wrapper = mount(CustomerIntelligenceCard, {
      props: { expanded: true },
      global: { plugins: [router, i18n] },
    })
    await flushPromises()

    const viewDetailButton = wrapper.find('[data-testid="view-detail-c1"]')
    expect(viewDetailButton.exists()).toBe(true)
  })

  it('does not self-load on mount; parent (Dashboard2Screen) must call reload() explicitly', async () => {
    const mockLoad = vi.fn()
    vi.mocked(useCustomerIntelligence).mockReturnValue({
      data: ref(null),
      state: ref('loading' as const),
      load: mockLoad,
    } as any)

    const mockLoadReceipt = vi.fn().mockResolvedValue(undefined)
    vi.mocked(useReceiptSettings).mockReturnValue({
      settings: ref({ shopName: 'محل تجريبي' }),
      load: mockLoadReceipt,
      save: vi.fn(),
    } as any)

    const wrapper = mount(CustomerIntelligenceCard, {
      props: { expanded: true },
      global: { plugins: [router, i18n] },
    })
    await flushPromises()

    expect(mockLoad).not.toHaveBeenCalled()
    expect(mockLoadReceipt).not.toHaveBeenCalled()

    await (wrapper.vm as any).reload()
    await flushPromises()

    expect(mockLoad).toHaveBeenCalled()
    expect(mockLoadReceipt).toHaveBeenCalled()
  })
})
