import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { mount, flushPromises } from '@vue/test-utils'
import { i18n } from '@/i18n'
import { db } from '@/data/powersync/db'
import ReportsPage from '@/features/dashboard/components/ReportsPage.vue'

const ApexStub = { name: 'apexchart', props: ['type','height','series','options'], template: '<div/>' }

function mountPage() {
  return mount(ReportsPage, {
    global: {
      plugins: [i18n],
      stubs: { apexchart: ApexStub, VueApexCharts: ApexStub, RouterLink: true },
    },
  })
}

describe('ReportsPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([] as any)
  })

  it('shows the profit headline for the default period', async () => {
    vi.mocked(db.getOptional).mockImplementation(async (sql: string) => {
      if (/SUM\(total_usd\)/.test(sql)) return { total: 500 } as any
      if (/as cogs/.test(sql) && /sale_line_items/.test(sql) && !/return/.test(sql)) return { cogs: 200 } as any
      if (/FROM expenses/.test(sql))    return { total: 50 } as any
      if (/COUNT\(\*\) as count FROM sales/.test(sql)) return { count: 7 } as any
      return { total: 0, cogs: 0, count: 0 } as any
    })
    const w = mountPage()
    await flushPromises()
    expect(w.text()).toContain('250')             // profit headline 500-200-50
  })

  it('shows the empty state when the period has no sales', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ total: 0, cogs: 0, count: 0 } as any)
    const w = mountPage()
    await flushPromises()
    expect(w.text()).toContain('لا توجد مبيعات في هذه الفترة')
  })

  it('rejects an inverted custom range (start > end) without querying', async () => {
    const w = mountPage()
    await flushPromises()
    await w.get('[data-test="period-custom"]').trigger('click')
    await w.get('#reports-custom-start').setValue('2026-06-30')
    await w.get('#reports-custom-end').setValue('2026-06-01')
    await flushPromises()
    expect(w.get('[data-test="range-error"]').exists()).toBe(true)
  })

  it('hides the trend chart and shows cold-start message when day data is < 3 days', async () => {
    vi.mocked(db.getOptional).mockImplementation(async (sql: string) => {
      if (/SUM\(total_usd\)/.test(sql)) return { total: 300 } as any
      if (/as cogs/.test(sql) && /sale_line_items/.test(sql) && !/return/.test(sql)) return { cogs: 100 } as any
      if (/FROM expenses/.test(sql)) return { total: 20 } as any
      if (/COUNT\(\*\) as count FROM sales/.test(sql)) return { count: 5 } as any
      return { total: 0, cogs: 0, count: 0 } as any
    })
    vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
      if (/FROM sales/.test(sql)) {
        return [
          { day: '2026-06-01', total: 120 },
          { day: '2026-06-02', total: 180 },
        ] as any
      }
      return [] as any
    })

    const w = mountPage()
    await flushPromises()
    expect(w.find('[data-test="trend-cold-start"]').exists()).toBe(true)
    expect(w.findComponent(ApexStub).exists()).toBe(false)
  })

  it('shows the trend chart when day data has 3 or more points', async () => {
    vi.mocked(db.getOptional).mockImplementation(async (sql: string) => {
      if (/SUM\(total_usd\)/.test(sql)) return { total: 300 } as any
      if (/as cogs/.test(sql) && /sale_line_items/.test(sql) && !/return/.test(sql)) return { cogs: 100 } as any
      if (/FROM expenses/.test(sql)) return { total: 20 } as any
      if (/COUNT\(\*\) as count FROM sales/.test(sql)) return { count: 5 } as any
      return { total: 0, cogs: 0, count: 0 } as any
    })
    vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
      if (/FROM sales/.test(sql)) {
        return [
          { day: '2026-06-01', total: 120 },
          { day: '2026-06-02', total: 90 },
          { day: '2026-06-03', total: 90 },
        ] as any
      }
      return [] as any
    })

    const w = mountPage()
    await flushPromises()
    expect(w.findComponent(ApexStub).exists()).toBe(true)
    expect(w.find('[data-test="trend-cold-start"]').exists()).toBe(false)
  })

  it('shows anomaly banner when expense ratio crosses threshold above revenue floor', async () => {
    vi.mocked(db.getOptional).mockImplementation(async (sql: string) => {
      if (/SUM\(total_usd\)/.test(sql)) return { total: 1000 } as any
      if (/sale_line_items/.test(sql) && !/return/.test(sql)) return { cogs: 200 } as any
      if (/FROM expenses/.test(sql)) return { total: 350 } as any
      if (/refund_amount_usd/.test(sql)) return { total: 0 } as any
      if (/return_line_items/.test(sql)) return { cogs: 0 } as any
      if (/COUNT\(\*\) as count FROM sales/.test(sql)) return { count: 5 } as any
      return { total: 0, cogs: 0, count: 0 } as any
    })
    vi.mocked(db.getAll).mockResolvedValue([] as any)

    const w = mountPage()
    await flushPromises()

    expect(w.text()).toContain('⚠️ مصاريفك مرتفعة بشكل غير معتاد هذه الفترة.')
  })

  it('opens drilldown sheet when selecting a day point on the trend chart', async () => {
    vi.mocked(db.getOptional).mockImplementation(async (sql: string) => {
      if (/SUM\(total_usd\)/.test(sql)) return { total: 300 } as any
      if (/sale_line_items/.test(sql) && !/return/.test(sql)) return { cogs: 100 } as any
      if (/FROM expenses/.test(sql)) return { total: 20 } as any
      if (/refund_amount_usd/.test(sql)) return { total: 0 } as any
      if (/return_line_items/.test(sql)) return { cogs: 0 } as any
      if (/COUNT\(\*\) as count FROM sales/.test(sql)) return { count: 5 } as any
      return { total: 0, cogs: 0, count: 0 } as any
    })
    vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
      if (/FROM sales/.test(sql) && /GROUP BY day/.test(sql)) {
        return [
          { day: '2026-06-01', total: 100 },
          { day: '2026-06-02', total: 100 },
          { day: '2026-06-03', total: 100 },
        ] as any
      }
      if (/SELECT id, category, amount_usd, expense_date, notes, photo_url/.test(sql)) {
        return [
          {
            id: 'e1',
            category: 'إيجار',
            amount_usd: 20,
            expense_date: '2026-06-02',
            notes: 'فاتورة',
            photo_url: 'https://cdn/r.jpg',
          },
        ] as any
      }
      return [] as any
    })

    const w = mountPage()
    await flushPromises()

    const apex = w.findComponent(ApexStub)
    const onSelect = apex.props('options').chart.events.dataPointSelection
    onSelect({}, {}, { dataPointIndex: 1 })
    await flushPromises()

    expect(w.text()).toContain('تفاصيل يوم 2026-06-02')
    expect(w.text()).toContain('فاتورة')
  })

  it('renders tabs and switches to expenses panel', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ total: 0, cogs: 0, count: 0 } as any)
    vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
      if (/TRIM\(category\)/.test(sql)) return [{ category: 'إيجار', total: 90 }] as any
      if (/SELECT id, category, amount_usd, expense_date, notes, photo_url/.test(sql)) {
        return [{ id: 'e1', category: 'إيجار', amount_usd: 90, expense_date: '2026-06-01', notes: 'إيجار', photo_url: null }] as any
      }
      return [] as any
    })

    const w = mountPage()
    await flushPromises()

    expect(w.find('[data-test="tab-profitability"]').exists()).toBe(true)
    expect(w.find('[data-test="tab-expenses"]').exists()).toBe(true)

    await w.get('[data-test="tab-expenses"]').trigger('click')
    await flushPromises()

    expect(w.find('[data-test="expenses-tab-panel"]').exists()).toBe(true)
    expect(w.find('[data-test="profitability-tab-panel"]').exists()).toBe(false)
  })

  it('filters top-expenses list by selected donut category and clears filter', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ total: 0, cogs: 0, count: 0 } as any)
    vi.mocked(db.getAll).mockImplementation(async (sql: string, params?: unknown[]) => {
      if (/SELECT TRIM\(category\) AS category/.test(sql)) {
        return [
          { category: 'إيجار', total: 100 },
          { category: 'كهرباء', total: 50 },
        ] as any
      }
      if (/SELECT id, category, amount_usd, expense_date, notes, photo_url/.test(sql)) {
        const p = Array.isArray(params) ? params : []
        const categoryFilter = p[3]
        if (categoryFilter === 'إيجار') {
          return [
            { id: 'e1', category: 'إيجار', amount_usd: 100, expense_date: '2026-06-01', notes: 'إيجار محل', photo_url: null },
          ] as any
        }
        return [
          { id: 'e1', category: 'إيجار', amount_usd: 100, expense_date: '2026-06-01', notes: 'إيجار محل', photo_url: null },
          { id: 'e2', category: 'كهرباء', amount_usd: 50, expense_date: '2026-06-02', notes: 'فاتورة كهرباء', photo_url: null },
        ] as any
      }
      return [] as any
    })

    const w = mountPage()
    await flushPromises()
    await w.get('[data-test="tab-expenses"]').trigger('click')
    await flushPromises()

    const apex = w.findComponent(ApexStub)
    const onSelect = apex.props('options').chart.events.dataPointSelection
    onSelect({}, {}, { dataPointIndex: 0 }) // إيجار
    await flushPromises()

    expect(w.text()).toContain('إيجار محل')
    expect(w.text()).not.toContain('فاتورة كهرباء')
    expect(w.find('[data-test="clear-expense-filter"]').exists()).toBe(true)

    await w.get('[data-test="clear-expense-filter"]').trigger('click')
    await flushPromises()

    expect(w.text()).toContain('إيجار محل')
    expect(w.text()).toContain('فاتورة كهرباء')
  })
})
