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
    // Reset the implementation (clearAllMocks only clears calls) so a per-test
    // rate mock can't leak into the next test.
    vi.mocked(db.getOptional).mockResolvedValue(null)
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

  it('duplicateLastMonth re-costs SYP at the current rate and strips the recurring marker (WAFI-025)', async () => {
    // Last month: a SYP rent booked at an old rate (150 USD), tagged recurring.
    vi.mocked(db.getAll).mockResolvedValueOnce([{
      id: 'e1', shop_id: 's1', amount: 1_500_000, currency: 'SYP', amount_usd: 150,
      category: 'إيجار', expense_date: '2025-04-05',
      notes: 'دفعة الإيجار\n__wafi_recurring__:2025-01-05|2025-12-05',
      photo_url: null, paid_in_cash: 1, created_at: '2025-04-05T08:00:00Z', sync_status: 'synced',
    }])
    // Today's rate moved to 15000 → 1,500,000 / 15,000 = 100 USD.
    vi.mocked(db.getOptional).mockResolvedValue({ rate: 15000 } as any)

    const { duplicateLastMonth } = useExpenses()
    await duplicateLastMonth()

    const insert = vi.mocked(db.execute).mock.calls.find(c => (c[0] as string).includes('INSERT INTO expenses'))!
    const params = insert[1] as any[]
    expect(params).toContain(100)        // recomputed at the new rate
    expect(params).not.toContain(150)    // not the stale copied USD
    // The recurring meta marker must not be carried into a plain duplicate.
    expect(params.some(p => typeof p === 'string' && p.includes('__wafi_recurring__'))).toBe(false)
  })

  it('books recurring SYP occurrences at each occurrence-date rate, not one creation-time rate (WAFI-025)', async () => {
    // Rate history: 10000 in January, 20000 from February on.
    vi.mocked(db.getOptional).mockImplementation((async (_sql: string, params: any[]) =>
      (params[1] as string).startsWith('2025-01') ? { rate: 10000 } : { rate: 20000 }
    ) as any)

    const { save } = useExpenses()
    await save({
      amount: 1_000_000, currency: 'SYP', amountUsd: 100,
      category: 'إيجار', expenseDate: '2025-01-15', paidInCash: true,
      isRecurringMonthly: true, recurringStartDate: '2025-01-15', recurringEndDate: '2025-02-15',
    })

    const inserts = vi.mocked(db.execute).mock.calls.filter(c => (c[0] as string).includes('INSERT INTO expenses'))
    expect(inserts).toHaveLength(2)
    // amount_usd is param index 4: Jan @10000 → 100, Feb @20000 → 50.
    const usdValues = inserts.map(c => (c[1] as any[])[4]).sort((a, b) => a - b)
    expect(usdValues).toEqual([50, 100])
  })

  it('deleteExpense removes the expense', async () => {
    const { deleteExpense } = useExpenses()
    await deleteExpense('e1')
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM expenses'),
      expect.arrayContaining(['e1'])
    )
  })
})
