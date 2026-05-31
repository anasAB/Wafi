import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useExpenses } from '@/features/expenses/composables/useExpenses'
import { db } from '@/data/powersync/db'

describe('useExpenses', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([])
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
  })

  it('load calls db.getAll with date range and shop filter', async () => {
    const { load } = useExpenses()
    await load('2025-05-01', '2025-05-31')
    expect(db.getAll).toHaveBeenCalledWith(
      expect.stringContaining('expense_date BETWEEN'),
      expect.arrayContaining(['2025-05-01', '2025-05-31'])
    )
  })

  it('load maps rows to Expense objects', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([{
      id: 'e1', shop_id: 's1', amount: 80, currency: 'USD', amount_usd: 80,
      category: 'إيجار', expense_date: '2025-05-01', notes: null, photo_url: null,
      paid_in_cash: 1, created_at: '2025-05-01T10:00:00Z', sync_status: 'pending',
    }])
    const { expenses, load } = useExpenses()
    await load('2025-05-01', '2025-05-31')
    expect(expenses.value).toHaveLength(1)
    expect(expenses.value[0].amountUsd).toBe(80)
    expect(expenses.value[0].paidInCash).toBe(true)
  })

  it('save calls INSERT INTO expenses', async () => {
    const { save } = useExpenses()
    await save({
      amount: 80, currency: 'USD', amountUsd: 80,
      category: 'إيجار', expenseDate: '2025-05-01', paidInCash: true,
    })
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO expenses'),
      expect.any(Array)
    )
  })

  it('save converts SYP to USD using rate', async () => {
    const { save } = useExpenses()
    await save({
      amount: 1_450_000, currency: 'SYP', amountUsd: 100,
      category: 'كهرباء', expenseDate: '2025-05-01', paidInCash: true,
    })
    const call = vi.mocked(db.execute).mock.calls[0]
    expect(call[1]).toContain(100)
    expect(call[1]).toContain('SYP')
  })

  it('softDelete removes the expense', async () => {
    const { softDelete } = useExpenses()
    await softDelete('e1')
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM expenses'),
      expect.arrayContaining(['e1'])
    )
  })
})
