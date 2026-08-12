import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import AnomalyBanner from './AnomalyBanner.vue'

const mockAnomalies = vi.fn()
const mockLoad = vi.fn()
const mockError = { value: false }

vi.mock('@/composables/useAnomalyDetection', () => ({
  useAnomalyDetection: () => ({
    anomalies: { value: mockAnomalies() },
    loading: { value: false },
    error: mockError,
    load: mockLoad,
  }),
}))
vi.mock('@/composables/useAnomalyDismissal', () => ({
  isDismissed: vi.fn(() => false),
  dismiss: vi.fn(),
}))
vi.mock('@/store/device.store', () => ({
  useDeviceStore: () => ({ shopId: 'shop-1' }),
}))
const mockMetricsLoad = vi.fn()
vi.mock('@/features/dashboard/composables/useProfitCache', () => ({
  useProfitCache: () => ({
    metrics: { value: { netRevenueUsd: 0, netCogsUsd: 0, expensesUsd: 0, refundsUsd: 0 } },
    load: mockMetricsLoad,
  }),
}))

const canViewReports = { value: true }
vi.mock('@/composables/useCan', () => ({
  useCan: () => ({ can: () => canViewReports }),
}))

const i18n = createI18n({
  legacy: false, locale: 'en',
  messages: { en: {
    anomalies: { HIGH_EXPENSES_RATIO: { title: 'High expenses', message: 'Expenses are high.' } },
    home: {
      anomalyBannerTitle: '{count} things need your attention',
      anomalyBannerDismiss: 'Dismiss', anomalyBannerError: 'Unable to check for issues right now',
      anomalyBannerExpand: 'Show details',
    },
  } },
})

describe('AnomalyBanner', () => {
  beforeEach(() => {
    mockAnomalies.mockReturnValue([
      { code: 'HIGH_EXPENSES_RATIO', severity: 'warning', kind: 'aggregate', title: 'High expenses', message: 'Expenses are high.' },
    ])
    canViewReports.value = true
    mockError.value = false
  })

  it('renders the banner when the caller can view reports and anomalies exist', async () => {
    const wrapper = mount(AnomalyBanner, { global: { plugins: [i18n] } })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('1 things need your attention')
  })

  it('renders nothing when the caller lacks can_view_reports', async () => {
    canViewReports.value = false
    const wrapper = mount(AnomalyBanner, { global: { plugins: [i18n] } })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-test="anomaly-banner"]').exists()).toBe(false)
  })

  it('renders nothing when there are no anomalies', async () => {
    mockAnomalies.mockReturnValue([])
    const wrapper = mount(AnomalyBanner, { global: { plugins: [i18n] } })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-test="anomaly-banner"]').exists()).toBe(false)
  })

  it('renders the fail-closed info card when error is true, not a blank screen', async () => {
    mockError.value = true
    mockAnomalies.mockReturnValue([])
    const wrapper = mount(AnomalyBanner, { global: { plugins: [i18n] } })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Unable to check for issues right now')
  })
})
