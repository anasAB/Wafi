import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import InsightBanner from './InsightBanner.vue'
import { useAutomaticInsights } from '@/composables/useAutomaticInsights'

vi.mock('@/composables/useAutomaticInsights')

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      insights: {
        revenue: { up: 'Revenue is {percent}% higher than {label}', down: 'Revenue is {percent}% lower than {label}', noSalesToday: 'No sales today, compared to ${previous} {label}' },
        profit: { up: 'Profit is {percent}% higher than {label}', down: 'Profit is {percent}% lower than {label}', loss_to_profit: 'Profit improved by ${amount} — from a loss to a profit', profit_to_loss: 'Profit dropped by ${amount} — from a profit to a loss', loss_widened: 'Loss widened by ${amount}', loss_narrowed: 'Loss narrowed by ${amount}' },
        comparisonLabel: { day: 'last {weekday}', week: 'last week', month: 'last month' },
      },
    },
  },
})

function mockInsights(insights: unknown[]) {
  vi.mocked(useAutomaticInsights).mockReturnValue({
    insights: { value: insights } as any,
    loading: { value: false } as any,
    error: { value: null } as any,
    load: vi.fn().mockResolvedValue(undefined),
  })
}

describe('InsightBanner', () => {
  it('renders nothing when there are no insights', () => {
    mockInsights([])
    const wrapper = mount(InsightBanner, { props: { period: 'day' }, global: { plugins: [i18n] } })
    expect(wrapper.find('[data-test="insight-banner"]').exists()).toBe(false)
  })

  it('renders a revenue-up card with primary and secondary lines', () => {
    mockInsights([
      { metric: 'revenue', direction: 'up', currentUsd: 115, previousUsd: 100, percentChange: 15 },
    ])
    const wrapper = mount(InsightBanner, { props: { period: 'week' }, global: { plugins: [i18n] } })
    expect(wrapper.text()).toContain('Revenue is 15% higher than last week')
    expect(wrapper.text()).toContain('$115.00')
    expect(wrapper.text()).toContain('$100.00')
  })

  it('renders a dollar-only profit card with no percent figure', () => {
    mockInsights([
      { metric: 'profit', direction: 'loss_to_profit', currentUsd: 30, previousUsd: -50, percentChange: null },
    ])
    const wrapper = mount(InsightBanner, { props: { period: 'month' }, global: { plugins: [i18n] } })
    expect(wrapper.text()).toContain('Profit improved by $80.00 — from a loss to a profit')
  })

  it('calls load() again when the period prop changes', async () => {
    mockInsights([])
    const wrapper = mount(InsightBanner, { props: { period: 'week' }, global: { plugins: [i18n] } })
    const { load } = useAutomaticInsights()
    await wrapper.setProps({ period: 'month' })
    expect(load).toHaveBeenCalledWith('month')
  })
})
