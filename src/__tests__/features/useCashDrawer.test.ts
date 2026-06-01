import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useCashDrawer } from '@/features/dashboard/composables/useCashDrawer'
import { db } from '@/data/powersync/db'

describe('useCashDrawer', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([])
  })

  it('cashUsd and cashSyp default to 0', () => {
    const { cashUsd, cashSyp } = useCashDrawer()
    expect(cashUsd.value).toBe(0)
    expect(cashSyp.value).toBe(0)
  })

  it('load queries cash sales and cash expenses in parallel', async () => {
    const { load } = useCashDrawer()
    await load()
    expect(db.getAll).toHaveBeenCalledTimes(2)
    const calls = vi.mocked(db.getAll).mock.calls.map(c => c[0] as string)
    expect(calls.some(sql => sql.includes('sales') && sql.includes('cash_usd'))).toBe(true)
    expect(calls.some(sql => sql.includes('expenses') && sql.includes('paid_in_cash'))).toBe(true)
  })

  it('calculates cashUsd as cash_usd sales minus USD expenses', async () => {
    vi.mocked(db.getAll)
      .mockResolvedValueOnce([
        { total_usd: 180, total_syp: 0, payment_method: 'cash_usd', created_at: '2025-01-01T10:00:00Z' },
      ])
      .mockResolvedValueOnce([
        { amount_usd: 50, amount: 50, currency: 'USD', category: 'إيجار', created_at: '2025-01-01T11:00:00Z' },
      ])
    const { cashUsd, load } = useCashDrawer()
    await load()
    expect(cashUsd.value).toBe(130) // 180 - 50
  })

  it('calculates cashSyp as cash_syp sales minus SYP expenses', async () => {
    vi.mocked(db.getAll)
      .mockResolvedValueOnce([
        { total_usd: 0, total_syp: 2_000_000, payment_method: 'cash_syp', created_at: '2025-01-01T10:00:00Z' },
      ])
      .mockResolvedValueOnce([
        { amount_usd: 0, amount: 500_000, currency: 'SYP', category: 'كهرباء', created_at: '2025-01-01T11:00:00Z' },
      ])
    const { cashSyp, load } = useCashDrawer()
    await load()
    expect(cashSyp.value).toBe(1_500_000) // 2,000,000 - 500,000
  })

  it('movements includes both sales and expenses sorted newest first', async () => {
    vi.mocked(db.getAll)
      .mockResolvedValueOnce([
        { total_usd: 100, total_syp: 0, payment_method: 'cash_usd', created_at: '2025-01-01T12:00:00Z' },
      ])
      .mockResolvedValueOnce([
        { amount_usd: 30, amount: 30, currency: 'USD', category: 'صيانة', created_at: '2025-01-01T11:00:00Z' },
      ])
    const { movements, load } = useCashDrawer()
    await load()
    expect(movements.value).toHaveLength(2)
    expect(movements.value[0].type).toBe('sale')    // newer
    expect(movements.value[1].type).toBe('expense') // older
    expect(movements.value[1].usd).toBe(-30)        // negative for expense
  })
})
