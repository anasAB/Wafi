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
})
