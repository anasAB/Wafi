import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { mount, flushPromises } from '@vue/test-utils'
import { i18n } from '@/i18n'
import { db } from '@/data/powersync/db'
import ReportsPage from '@/features/dashboard/components/ReportsPage.vue'

const ApexStub = { name: 'apexchart', props: ['type', 'height', 'series', 'options'], template: '<div />' }

const CURRENT_KEY = '2026-06-01|2026-06-12'
const PREV_KEY = '2026-05-20|2026-05-31'

// useProfitCache reads one row-set from `profit_cache`, summed in cents, keyed by
// the [shopId, from, to] range it's called with -- unlike the old
// useDashboardMetrics which issued several fine-grained getOptional() queries.
function setupRangeMock(prevInvoiceCount: number) {
  vi.mocked(db.getOptional).mockImplementation(async (sql: string) => {
    if (/FROM products/.test(sql)) return { count: 0 } as any
    if (/EXISTS/.test(sql)) return { count: 0 } as any
    if (/sale_discount_amount_usd/.test(sql)) return { total: 0 } as any
    return { total: 0, cogs: 0, count: 0 } as any
  })

  vi.mocked(db.getAll).mockImplementation(async (sql: string, params?: unknown[]) => {
    if (/FROM profit_cache/.test(sql)) {
      const p = Array.isArray(params) ? params : []
      const start = String(p[1] ?? '')
      const end = String(p[2] ?? '')
      const key = `${start}|${end}`

      if (key === CURRENT_KEY) {
        return [{
          revenue_usd: 30000, revenue_syp: 0, cogs_usd: 7000, cogs_reversal_usd: 0,
          expenses_usd: 0, refunds_usd: 0, discount_usd: 0,
          invoice_count: 5, return_count: 0, costless_sale_count: 0,
        }] as any
      }
      if (key === PREV_KEY) {
        return [{
          revenue_usd: 25000, revenue_syp: 0, cogs_usd: 5000, cogs_reversal_usd: 0,
          expenses_usd: 0, refunds_usd: 0, discount_usd: 0,
          invoice_count: prevInvoiceCount, return_count: 0, costless_sale_count: 0,
        }] as any
      }
      return [] as any
    }
    return [] as any
  })
}

function mountPage() {
  return mount(ReportsPage, {
    global: {
      plugins: [i18n],
      stubs: { apexchart: ApexStub, VueApexCharts: ApexStub, RouterLink: true },
    },
  })
}

async function selectCustomRange(w: ReturnType<typeof mountPage>) {
  await w.get('[data-test="period-custom"]').trigger('click')
  await w.get('#reports-custom-start').setValue('2026-06-01')
  await w.get('#reports-custom-end').setValue('2026-06-12')
  await flushPromises()
}

describe('ReportsPage period-over-period delta', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('shows a green +15% delta when current profit is above previous equivalent period', async () => {
    // current profit = 300 - 70 = 230; previous profit = 250 - 50 = 200; delta = +15%
    setupRangeMock(4)
    const w = mountPage()
    await flushPromises()
    await selectCustomRange(w)

    const delta = w.get('[data-test="profit-delta"]').text()
    expect(delta).toContain('+15%')
  })

  it('hides delta when previous period has zero invoices', async () => {
    setupRangeMock(0)
    const w = mountPage()
    await flushPromises()
    await selectCustomRange(w)

    expect(w.find('[data-test="profit-delta"]').exists()).toBe(false)
  })

  it('shows explanatory text when the info button is tapped', async () => {
    setupRangeMock(4)
    const w = mountPage()
    await flushPromises()
    await selectCustomRange(w)

    await w.get('[data-test="profit-info"]').trigger('click')
    expect(w.get('[data-test="profit-info-text"]').text()).toContain('هذا ربح التشغيل')
  })
})
