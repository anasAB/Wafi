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

// useProfitCache reads ONE row-set from `profit_cache` (SUM'd in cents), unlike the
// old useDashboardMetrics which issued several fine-grained getOptional() queries.
// This single row stands in for the whole period's summed profit_cache rows.
function profitCacheRow(opts: {
  revenueUsd?: number; cogsUsd?: number; expensesUsd?: number; refundsUsd?: number
  cogsReversalUsd?: number; discountUsd?: number; invoiceCount?: number
  returnCount?: number; costlessSaleCount?: number
}) {
  return {
    revenue_usd: Math.round((opts.revenueUsd ?? 0) * 100),
    revenue_syp: 0,
    cogs_usd: Math.round((opts.cogsUsd ?? 0) * 100),
    cogs_reversal_usd: Math.round((opts.cogsReversalUsd ?? 0) * 100),
    expenses_usd: Math.round((opts.expensesUsd ?? 0) * 100),
    refunds_usd: Math.round((opts.refundsUsd ?? 0) * 100),
    discount_usd: Math.round((opts.discountUsd ?? 0) * 100),
    invoice_count: opts.invoiceCount ?? 0,
    return_count: opts.returnCount ?? 0,
    costless_sale_count: opts.costlessSaleCount ?? 0,
  }
}

function mockProfitCache(getAllRow: ReturnType<typeof profitCacheRow>) {
  vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
    if (/FROM profit_cache/.test(sql)) return [getAllRow] as any
    return [] as any
  })
}

describe('ReportsPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getOptional).mockResolvedValue({ total: 0, cogs: 0, count: 0 } as any)
    vi.mocked(db.getAll).mockResolvedValue([] as any)
  })

  it('shows the profit headline for the default period', async () => {
    mockProfitCache(profitCacheRow({ revenueUsd: 500, cogsUsd: 200, expensesUsd: 50, invoiceCount: 7 }))
    const w = mountPage()
    await flushPromises()
    expect(w.text()).toContain('250')             // profit headline 500-200-50
  })

  it('shows a cash-movement exclusion note with tooltip and a link to shift history', async () => {
    mockProfitCache(profitCacheRow({ revenueUsd: 500, cogsUsd: 200, expensesUsd: 50, invoiceCount: 7 }))
    const w = mountPage()
    await flushPromises()

    const infoBtn = w.get('[data-test="cash-movement-info"]')
    expect(w.find('[data-test="cash-movement-info-text"]').exists()).toBe(false)
    await infoBtn.trigger('click')
    expect(w.get('[data-test="cash-movement-info-text"]').text()).toContain(
      'حركات الصندوق',
    )

    const link = w.get('[data-test="cash-movement-link"]')
    expect(link.attributes('to')).toBe('/shifts/history')
  })

  it('shows the empty state when the period has no sales', async () => {
    mockProfitCache(profitCacheRow({ invoiceCount: 0 }))
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
    vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
      if (/FROM profit_cache/.test(sql)) return [profitCacheRow({ revenueUsd: 300, cogsUsd: 100, expensesUsd: 20, invoiceCount: 5 })] as any
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
    vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
      if (/FROM profit_cache/.test(sql)) return [profitCacheRow({ revenueUsd: 300, cogsUsd: 100, expensesUsd: 20, invoiceCount: 5 })] as any
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
    // gross income (revenue+refunds) = 1000, expenses 350 => ratio 0.35 > 0.3 threshold
    mockProfitCache(profitCacheRow({ revenueUsd: 1000, cogsUsd: 200, expensesUsd: 350, invoiceCount: 5 }))
    vi.mocked(db.getOptional).mockImplementation(async (sql: string) => {
      if (/sale_discount_amount_usd/.test(sql)) return { total: 0 } as any
      return { total: 0, cogs: 0, count: 0 } as any
    })

    const w = mountPage()
    await flushPromises()

    expect(w.text()).toContain('مصاريف مرتفعة')
    expect(w.text()).toContain('مصاريفك أعلى من المعتاد في هذه الفترة')
  })

  it('opens drilldown sheet when selecting a day point on the trend chart', async () => {
    vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
      if (/FROM profit_cache/.test(sql)) return [profitCacheRow({ revenueUsd: 300, cogsUsd: 100, expensesUsd: 20, invoiceCount: 5 })] as any
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
    mockProfitCache(profitCacheRow({ invoiceCount: 0 }))
    vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
      if (/FROM profit_cache/.test(sql)) return [profitCacheRow({ invoiceCount: 0 })] as any
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
    vi.mocked(db.getAll).mockImplementation(async (sql: string, params?: unknown[]) => {
      if (/FROM profit_cache/.test(sql)) return [profitCacheRow({ invoiceCount: 0 })] as any
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
