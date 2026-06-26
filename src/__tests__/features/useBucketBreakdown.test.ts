import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { useBucketBreakdown } from '@/features/dashboard/composables/useBucketBreakdown'

describe('useBucketBreakdown', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('returns bucket totals and cleaned expense rows for a day window', async () => {
    vi.mocked(db.getOptional).mockImplementation(async (sql: string) => {
      if (/SUM\(total_usd\)/.test(sql)) return { total: 300 } as any
      if (/sale_line_items/.test(sql) && !/return/.test(sql)) return { cogs: 100 } as any
      if (/FROM expenses/.test(sql)) return { total: 35 } as any
      if (/refund_amount_usd/.test(sql)) return { total: 10 } as any
      if (/return_line_items/.test(sql)) return { cogs: 5 } as any
      return { total: 0, cogs: 0 } as any
    })

    vi.mocked(db.getAll).mockResolvedValue([
      {
        id: 'e1',
        category: 'إيجار',
        amount_usd: 25,
        expense_date: '2026-06-02',
        notes: 'دفعة الإيجار\n__wafi_recurring__:2026-01-01|2026-12-01',
        photo_url: 'https://cdn/rent.jpg',
      },
      {
        id: 'e2',
        category: 'نقل',
        amount_usd: 10,
        expense_date: '2026-06-02',
        notes: null,
        photo_url: null,
      },
    ] as any)

    const b = useBucketBreakdown()
    await b.load('2026-06-02', '2026-06-02')

    expect(b.totals.value.grossIncomeUsd).toBe(300)
    expect(b.totals.value.refundsUsd).toBe(10)
    expect(b.totals.value.cogsUsd).toBe(95)
    expect(b.totals.value.expensesUsd).toBe(35)
    expect(b.totals.value.profitUsd).toBe(160)

    expect(b.expenses.value[0]).toMatchObject({
      id: 'e1',
      amountUsd: 25,
      notes: 'دفعة الإيجار',
      photoUrl: 'https://cdn/rent.jpg',
    })
  })
})
