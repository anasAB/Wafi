import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { mount, flushPromises } from '@vue/test-utils'
import { db } from '@/data/powersync/db'
import MoneyOwedPage from '@/features/customers/MoneyOwedPage.vue'

function mountPage() {
  return mount(MoneyOwedPage, {
    global: { stubs: { RouterLink: true } },
  })
}

function iso(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString()
}

function mockDebtors(debtors: Array<{ id: string; name: string; balance_usd: number; oldestDaysAgo: number }>) {
  vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
    if (/FROM customers c\b/.test(sql)) {
      return debtors.map(d => ({
        id: d.id, name: d.name, phone: null, mobile: null, last_reminded_at: null, balance_usd: d.balance_usd,
      })) as any
    }
    return [] as any
  })
  vi.mocked(db.getOptional).mockImplementation(async (sql: string, params?: unknown[]) => {
    if (/MIN\(s.created_at\)/.test(sql)) {
      const id = (params as any)[0]
      const d = debtors.find(x => x.id === id)
      return { oldest: iso(d?.oldestDaysAgo ?? 0) } as any
    }
    if (/MAX\(paid_at\)/.test(sql)) return { paid_at: null } as any
    return null
  })
}

describe('MoneyOwedPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('shows the zero state when nobody currently owes anything', async () => {
    vi.mocked(db.getAll).mockResolvedValue([] as any)
    const w = mountPage()
    await flushPromises()
    expect(w.get('[data-test="empty"]').text()).toContain('لا يوجد مبالغ مستحقة حالياً')
    expect(w.find('[data-test="owed-table"]').exists()).toBe(false)
  })

  it('renders rows sorted by age descending by default and computes bucket totals from the row set', async () => {
    mockDebtors([
      { id: 'a', name: 'Ahmed', balance_usd: 100, oldestDaysAgo: 10 },
      { id: 'b', name: 'Sara',  balance_usd: 50,  oldestDaysAgo: 45 },
    ])
    const w = mountPage()
    await flushPromises()

    const rows = w.findAll('[data-test^="owed-row-"]')
    expect(rows).toHaveLength(2)
    expect(rows[0].attributes('data-test')).toBe('owed-row-b') // 45 days > 10 days
    expect(rows[1].attributes('data-test')).toBe('owed-row-a')

    expect(w.get('[data-test="bucket-0_30"]').text()).toContain('100.00')
    expect(w.get('[data-test="bucket-31_60"]').text()).toContain('50.00')
    expect(w.get('[data-test="grand-total"]').text()).toContain('150.00')
  })

  it('re-sorts by a clicked column, applying the fixed tie-break chain behind it', async () => {
    mockDebtors([
      { id: 'a', name: 'Ahmed', balance_usd: 200, oldestDaysAgo: 5 },
      { id: 'b', name: 'Sara',  balance_usd: 50,  oldestDaysAgo: 5 },
    ])
    const w = mountPage()
    await flushPromises()

    await w.get('[data-test="sort-total"]').trigger('click')
    const rows = w.findAll('[data-test^="owed-row-"]')
    expect(rows[0].attributes('data-test')).toBe('owed-row-a') // $200 > $50, desc default for numeric column
  })

  it('displays the USD-only currency caveat', async () => {
    vi.mocked(db.getAll).mockResolvedValue([] as any)
    const w = mountPage()
    await flushPromises()
    expect(w.text()).toContain('المبالغ بالدولار فقط')
  })
})
