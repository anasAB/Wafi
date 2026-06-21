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

  it('load queries cash payments, expenses, refunds, and credit collections in parallel', async () => {
    const { load } = useCashDrawer()
    await load()
    expect(db.getAll).toHaveBeenCalledTimes(4)
    const calls = vi.mocked(db.getAll).mock.calls.map(c => c[0] as string)
    expect(calls.some(sql => sql.includes('sale_payments') && sql.includes('cash_usd'))).toBe(true)
    expect(calls.some(sql => sql.includes('expenses') && sql.includes('paid_in_cash'))).toBe(true)
    expect(calls.some(sql => sql.includes('returns') && sql.includes('refund_method'))).toBe(true)
    expect(calls.some(sql => sql.includes('customer_payments') && sql.includes("method = 'cash'"))).toBe(true)
  })

  it("buckets 'today' by local-time calendar day, matching the cards (WAFI-007)", async () => {
    const { load } = useCashDrawer()
    await load('today')
    const calls = vi.mocked(db.getAll).mock.calls.map(c => c[0] as string)
    // Every drawer query must use the SAME local-time day boundary as
    // useDashboardMetrics — not a raw UTC `created_at >= ?` 6 AM window, which put
    // a 2 AM local sale in a different day than the revenue card (WAFI-007).
    for (const sql of calls) {
      expect(sql).toContain("DATE(created_at, 'localtime')")
    }
    expect(calls.some(sql => /created_at\s*>=\s*\?/.test(sql))).toBe(false)
  })

  it('adds cash credit collections to the drawer as an inflow', async () => {
    // calls in order: sale_payments, expenses, returns, customer_payments
    vi.mocked(db.getAll)
      .mockResolvedValueOnce([])  // payments
      .mockResolvedValueOnce([])  // expenses
      .mockResolvedValueOnce([])  // refunds
      .mockResolvedValueOnce([
        { currency: 'USD', amount_usd: 40, amount_raw: 40, created_at: '2025-01-01T13:00:00Z' },
        { currency: 'SYP', amount_usd: 0,  amount_raw: 250_000, created_at: '2025-01-01T13:30:00Z' },
      ])
    const { cashUsd, cashSyp, movements, load } = useCashDrawer()
    await load()
    expect(cashUsd.value).toBe(40)
    expect(cashSyp.value).toBe(250_000)
    const creditMoves = movements.value.filter(m => m.type === 'credit_payment')
    expect(creditMoves).toHaveLength(2)
  })

  it('calculates cashUsd as cash_usd legs minus USD expenses minus USD refunds', async () => {
    vi.mocked(db.getAll)
      .mockResolvedValueOnce([
        { method: 'cash_usd', amount_usd: 180, amount_raw: 180, created_at: '2025-01-01T10:00:00Z' },
      ])
      .mockResolvedValueOnce([
        { amount_usd: 50, amount: 50, currency: 'USD', category: 'إيجار', created_at: '2025-01-01T11:00:00Z' },
      ])
      .mockResolvedValueOnce([
        { refund_method: 'cash_usd', refund_amount_usd: 20, refund_amount_syp: 0, created_at: '2025-01-01T12:00:00Z' },
      ])
    const { cashUsd, load } = useCashDrawer()
    await load()
    expect(cashUsd.value).toBe(110) // 180 - 50 - 20
  })

  it('counts the cash leg of a split sale (method=cash_usd in sale_payments)', async () => {
    // A split sale appears in sale_payments as separate legs; the cash leg must be counted
    // even though sales.payment_method would be 'split'.
    vi.mocked(db.getAll)
      .mockResolvedValueOnce([
        { method: 'cash_usd', amount_usd: 50, amount_raw: 50, created_at: '2025-01-01T10:00:00Z' },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    const { cashUsd, load } = useCashDrawer()
    await load()
    expect(cashUsd.value).toBe(50)
  })

  it('calculates cashSyp as cash_syp legs minus SYP expenses minus SYP refunds', async () => {
    vi.mocked(db.getAll)
      .mockResolvedValueOnce([
        { method: 'cash_syp', amount_usd: 0, amount_raw: 2_000_000, created_at: '2025-01-01T10:00:00Z' },
      ])
      .mockResolvedValueOnce([
        { amount_usd: 0, amount: 500_000, currency: 'SYP', category: 'كهرباء', created_at: '2025-01-01T11:00:00Z' },
      ])
      .mockResolvedValueOnce([])
    const { cashSyp, load } = useCashDrawer()
    await load()
    expect(cashSyp.value).toBe(1_500_000) // 2,000,000 - 500,000
  })

  it('movements includes sales, expenses, and refunds sorted newest first', async () => {
    vi.mocked(db.getAll)
      .mockResolvedValueOnce([
        { method: 'cash_usd', amount_usd: 100, amount_raw: 100, created_at: '2025-01-01T12:00:00Z' },
      ])
      .mockResolvedValueOnce([
        { amount_usd: 30, amount: 30, currency: 'USD', category: 'صيانة', created_at: '2025-01-01T11:00:00Z' },
      ])
      .mockResolvedValueOnce([
        { refund_method: 'cash_usd', refund_amount_usd: 15, refund_amount_syp: 0, created_at: '2025-01-01T10:00:00Z' },
      ])
    const { movements, load } = useCashDrawer()
    await load()
    expect(movements.value).toHaveLength(3)
    expect(movements.value[0].type).toBe('sale')    // newest
    expect(movements.value[1].type).toBe('expense')
    expect(movements.value[2].type).toBe('refund')  // oldest
    expect(movements.value[1].usd).toBe(-30)        // negative for expense
    expect(movements.value[2].usd).toBe(-15)        // negative for refund
  })
})
