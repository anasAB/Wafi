import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useInstallmentsDueAlert } from '@/features/installments/composables/useInstallmentsDueAlert'
import { db } from '@/data/powersync/db'

describe('useInstallmentsDueAlert', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('allClear is true and count is 0 when there are no pending dues', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([])
    const { load, allClear, count } = useInstallmentsDueAlert()
    await load()
    expect(allClear.value).toBe(true)
    expect(count.value).toBe(0)
  })

  it('counts only due/overdue buckets (not upcoming) and sums their remaining amount', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    const nextMonth = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)

    vi.mocked(db.getAll).mockResolvedValueOnce([
      { due_id: 'd1', plan_id: 'p1', customer_id: 'c1', customer_name: 'محمد', due_date: yesterday, amount_due_usd: 100, amount_paid_usd: 0, status: 'pending' },
      { due_id: 'd2', plan_id: 'p2', customer_id: 'c2', customer_name: 'سارة', due_date: today,     amount_due_usd: 50,  amount_paid_usd: 20, status: 'pending' },
      { due_id: 'd3', plan_id: 'p3', customer_id: 'c3', customer_name: 'علي',  due_date: nextMonth, amount_due_usd: 80,  amount_paid_usd: 0,  status: 'pending' },
    ] as any)

    const { load, count, totalDueUsd, top3, allClear } = useInstallmentsDueAlert()
    await load()

    expect(allClear.value).toBe(false)
    expect(count.value).toBe(2) // overdue (d1) + due-today (d2), not upcoming (d3)
    expect(totalDueUsd.value).toBeCloseTo(100 - 0 + (50 - 20))
    expect(top3.value.map(i => i.dueId)).toEqual(['d1', 'd2'])
  })
})
