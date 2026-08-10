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
    ar: {
      insights: {
        revenue: {
          up: 'المبيعات أعلى بنسبة {percent}% مقارنة بـ {label}',
          down: 'المبيعات أقل بنسبة {percent}% مقارنة بـ {label}',
          noSalesToday: 'لا توجد مبيعات اليوم، مقارنة بـ ${previous} في {label}',
        },
        profit: {
          up: 'الربح أعلى بنسبة {percent}% مقارنة بـ {label}',
          down: 'الربح أقل بنسبة {percent}% مقارنة بـ {label}',
          loss_to_profit: 'تحسن الربح بمقدار ${amount} — من خسارة إلى ربح',
          profit_to_loss: 'انخفض الربح بمقدار ${amount} — من ربح إلى خسارة',
          loss_widened: 'زادت الخسارة بمقدار ${amount}',
          loss_narrowed: 'تراجعت الخسارة بمقدار ${amount}',
        },
        comparisonLabel: {
          day: 'يوم {weekday} الماضي',
          week: 'الأسبوع الماضي',
          month: 'الشهر الماضي',
        },
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

  // Finding 1: the weekday name in the 'day' comparison label must follow the
  // active i18n locale, not be hardcoded to English ('en-US'). Renders the
  // Arabic weekday name (e.g. "الثلاثاء") when locale is 'ar'.
  it('renders the Arabic weekday name in the day comparison label when locale is ar', () => {
    i18n.global.locale.value = 'ar'
    try {
      mockInsights([
        { metric: 'revenue', direction: 'up', currentUsd: 115, previousUsd: 100, percentChange: 15 },
      ])
      const wrapper = mount(InsightBanner, { props: { period: 'day' }, global: { plugins: [i18n] } })
      const expectedWeekday = new Intl.DateTimeFormat('ar', { weekday: 'long' }).format(new Date())
      expect(wrapper.text()).toContain(`مقارنة بـ يوم ${expectedWeekday} الماضي`)
      expect(wrapper.text()).not.toContain('Tuesday')
      expect(wrapper.text()).not.toContain('Monday')
    } finally {
      i18n.global.locale.value = 'en'
    }
  })

  // Finding 2: 'noSalesToday' phrasing must only fire for the 'day' period.
  // A genuinely zero-revenue week/month should fall through to the normal
  // percent-based 'down' phrasing instead.
  it('does not use the noSalesToday phrasing for a zero-revenue week', () => {
    mockInsights([
      { metric: 'revenue', direction: 'down', currentUsd: 0, previousUsd: 100, percentChange: -100 },
    ])
    const wrapper = mount(InsightBanner, { props: { period: 'week' }, global: { plugins: [i18n] } })
    expect(wrapper.text()).toContain('Revenue is 100% lower than last week')
    expect(wrapper.text()).not.toContain('No sales today')
  })

  it('does not use the noSalesToday phrasing for a zero-revenue month', () => {
    mockInsights([
      { metric: 'revenue', direction: 'down', currentUsd: 0, previousUsd: 100, percentChange: -100 },
    ])
    const wrapper = mount(InsightBanner, { props: { period: 'month' }, global: { plugins: [i18n] } })
    expect(wrapper.text()).toContain('Revenue is 100% lower than last month')
    expect(wrapper.text()).not.toContain('No sales today')
  })

  // Finding 3: negative USD amounts must render as -$50.00, not $-50.00.
  it('renders a negative previousUsd with the sign before the dollar sign', () => {
    mockInsights([
      { metric: 'profit', direction: 'loss_to_profit', currentUsd: 30, previousUsd: -50, percentChange: null },
    ])
    const wrapper = mount(InsightBanner, { props: { period: 'month' }, global: { plugins: [i18n] } })
    expect(wrapper.text()).toContain('-$50.00')
    expect(wrapper.text()).not.toContain('$-50.00')
  })
})
