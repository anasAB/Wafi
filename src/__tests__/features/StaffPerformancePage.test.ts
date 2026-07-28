import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { mount, flushPromises } from '@vue/test-utils'
import { db } from '@/data/powersync/db'
import StaffPerformancePage from '@/features/dashboard/components/StaffPerformancePage.vue'

function mountPage() {
  return mount(StaffPerformancePage, {
    global: { stubs: { RouterLink: true } },
  })
}

function mockRows(rows: Array<{ staffId: string; name: string; salesCount: number; grossUsd: number; cogs?: number }>) {
  vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
    if (/FROM sales s\b/.test(sql) && /grossUsd/.test(sql)) {
      return rows.map(r => ({ staffId: r.staffId, name: r.name, salesCount: r.salesCount, grossUsd: r.grossUsd })) as any
    }
    if (/FROM sale_line_items sli\b/.test(sql)) {
      return rows.filter(r => r.cogs !== undefined).map(r => ({ staffId: r.staffId, cogs: r.cogs })) as any
    }
    return [] as any
  })
}

describe('StaffPerformancePage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('shows the zero state when no staff had activity in the period', async () => {
    vi.mocked(db.getAll).mockResolvedValue([] as any)
    const w = mountPage()
    await flushPromises()
    expect(w.get('[data-test="empty"]').text()).toContain('لا يوجد نشاط للموظفين خلال هذه الفترة')
    expect(w.find('[data-test="staff-table"]').exists()).toBe(false)
  })

  it('renders rows sorted by Contribution Margin descending by default', async () => {
    mockRows([
      { staffId: 'ahmed', name: 'Ahmed', salesCount: 2, grossUsd: 500, cogs: 400 }, // margin 100
      { staffId: 'sara',  name: 'Sara',  salesCount: 1, grossUsd: 300, cogs: 100 }, // margin 200
    ])
    const w = mountPage()
    await flushPromises()

    const rows = w.findAll('[data-test^="staff-row-"]')
    expect(rows).toHaveLength(2)
    expect(rows[0].attributes('data-test')).toBe('staff-row-sara')  // higher margin first
    expect(rows[1].attributes('data-test')).toBe('staff-row-ahmed')
  })

  it('re-sorts by a clicked column and toggles direction on repeat click, preserving the sort across a period change', async () => {
    mockRows([
      { staffId: 'ahmed', name: 'Ahmed', salesCount: 2, grossUsd: 500, cogs: 400 }, // avg ticket 250
      { staffId: 'sara',  name: 'Sara',  salesCount: 1, grossUsd: 300, cogs: 100 }, // avg ticket 300
    ])
    const w = mountPage()
    await flushPromises()

    await w.get('[data-test="sort-avg-ticket"]').trigger('click')
    let rows = w.findAll('[data-test^="staff-row-"]')
    expect(rows[0].attributes('data-test')).toBe('staff-row-sara') // 300 > 250, desc default

    await w.get('[data-test="sort-avg-ticket"]').trigger('click') // toggle to ascending
    rows = w.findAll('[data-test^="staff-row-"]')
    expect(rows[0].attributes('data-test')).toBe('staff-row-ahmed')

    // Switching the period must not reset the sort back to margin-descending.
    await w.get('[data-test="period-week"]').trigger('click')
    await flushPromises()
    rows = w.findAll('[data-test^="staff-row-"]')
    expect(rows[0].attributes('data-test')).toBe('staff-row-ahmed')
  })

  it('renders avgTicketUsd as an em dash, not $0.00, for a staff member with zero sales', async () => {
    mockRows([{ staffId: 'idle', name: 'Idle', salesCount: 0, grossUsd: 0, cogs: 0 }])
    const w = mountPage()
    await flushPromises()
    expect(w.get('[data-test="avg-ticket-cell"]').text()).toBe('—')
  })
})
