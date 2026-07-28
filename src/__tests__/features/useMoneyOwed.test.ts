import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useMoneyOwed } from '@/features/customers/composables/useMoneyOwed'
import { db } from '@/data/powersync/db'

function iso(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString()
}

function dateStr(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10)
}

describe('useMoneyOwed', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('combines credit-only, installment-only, and both-sources customers into one row set', async () => {
    // Credit-only: Ali, $100 owed, 10 days old.
    // Installment-only: Sara, $50 owed, due 5 days ago.
    // Both: Nour, $30 credit (10 days) + $70 installment (5 days).
    vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
      if (/FROM customers c\b/.test(sql)) {
        return [
          { id: 'ali', name: 'Ali', phone: null, mobile: null, last_reminded_at: null, balance_usd: 100 },
          { id: 'nour', name: 'Nour', phone: null, mobile: null, last_reminded_at: null, balance_usd: 30 },
        ] as any
      }
      if (/FROM installment_dues d\b/.test(sql)) {
        return [
          { due_id: 'd1', plan_id: 'p1', customer_id: 'sara', customer_name: 'Sara', due_date: dateStr(5), amount_due_usd: 50, amount_paid_usd: 0, status: 'pending' },
          { due_id: 'd2', plan_id: 'p2', customer_id: 'nour', customer_name: 'Nour', due_date: dateStr(5), amount_due_usd: 70, amount_paid_usd: 0, status: 'pending' },
        ] as any
      }
      return [] as any
    })
    vi.mocked(db.getOptional).mockImplementation(async (sql: string, params?: unknown[]) => {
      if (/MIN\(s.created_at\)/.test(sql)) {
        const customerId = (params as any)[0]
        if (customerId === 'ali') return { oldest: iso(10) } as any
        if (customerId === 'nour') return { oldest: iso(10) } as any
      }
      if (/MAX\(paid_at\)/.test(sql)) return { paid_at: null } as any
      return null
    })

    const mo = useMoneyOwed()
    await mo.load()

    const byId = Object.fromEntries(mo.rows.value.map(r => [r.customerId, r]))
    expect(Object.keys(byId).sort()).toEqual(['ali', 'nour', 'sara'])

    expect(byId.ali.creditOwedUsd).toBe(100)
    expect(byId.ali.installmentOwedUsd).toBe(0)
    expect(byId.ali.totalOwedUsd).toBe(100)

    expect(byId.sara.creditOwedUsd).toBe(0)
    expect(byId.sara.installmentOwedUsd).toBe(50)
    expect(byId.sara.totalOwedUsd).toBe(50)

    expect(byId.nour.creditOwedUsd).toBe(30)
    expect(byId.nour.installmentOwedUsd).toBe(70)
    expect(byId.nour.totalOwedUsd).toBe(100)
  })

  it('excludes a customer whose only installment dues are not yet due (future-only)', async () => {
    vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
      if (/FROM customers c\b/.test(sql)) return [] as any
      if (/FROM installment_dues d\b/.test(sql)) {
        return [
          { due_id: 'd1', plan_id: 'p1', customer_id: 'future', customer_name: 'Future Customer', due_date: dateStr(-30), amount_due_usd: 50, amount_paid_usd: 0, status: 'pending' },
        ] as any
      }
      return [] as any
    })

    const mo = useMoneyOwed()
    await mo.load()

    expect(mo.rows.value).toHaveLength(0)
    expect(mo.totals.value.grandTotal).toBe(0)
  })

  it('bucket = 60_plus when the worse of two component ages wins (31-day credit vs 61-day overdue installment)', async () => {
    vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
      if (/FROM customers c\b/.test(sql)) {
        return [{ id: 'c1', name: 'Customer', phone: null, mobile: null, last_reminded_at: null, balance_usd: 100 }] as any
      }
      if (/FROM installment_dues d\b/.test(sql)) {
        return [
          { due_id: 'd1', plan_id: 'p1', customer_id: 'c1', customer_name: 'Customer', due_date: dateStr(61), amount_due_usd: 200, amount_paid_usd: 0, status: 'pending' },
        ] as any
      }
      return [] as any
    })
    vi.mocked(db.getOptional).mockImplementation(async (sql: string) => {
      if (/MIN\(s.created_at\)/.test(sql)) return { oldest: iso(31) } as any
      if (/MAX\(paid_at\)/.test(sql)) return { paid_at: null } as any
      return null
    })

    const mo = useMoneyOwed()
    await mo.load()

    expect(mo.rows.value).toHaveLength(1)
    expect(mo.rows.value[0].ageDays).toBe(61)
    expect(mo.rows.value[0].bucket).toBe('60_plus')
  })

  it('a same-day-only credit sale (age 0) is included in bucket 0_30, not excluded', async () => {
    vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
      if (/FROM customers c\b/.test(sql)) {
        return [{ id: 'c1', name: 'Customer', phone: null, mobile: null, last_reminded_at: null, balance_usd: 50 }] as any
      }
      return [] as any
    })
    vi.mocked(db.getOptional).mockImplementation(async (sql: string) => {
      if (/MIN\(s.created_at\)/.test(sql)) return { oldest: iso(0) } as any
      if (/MAX\(paid_at\)/.test(sql)) return { paid_at: null } as any
      return null
    })

    const mo = useMoneyOwed()
    await mo.load()

    expect(mo.rows.value).toHaveLength(1)
    expect(mo.rows.value[0].ageDays).toBe(0)
    expect(mo.rows.value[0].bucket).toBe('0_30')
  })

  it('bucket totals are SUM(totalOwedUsd) per bucket, not customer counts', async () => {
    vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
      if (/FROM customers c\b/.test(sql)) {
        return [
          { id: 'a', name: 'A', phone: null, mobile: null, last_reminded_at: null, balance_usd: 100 },
          { id: 'b', name: 'B', phone: null, mobile: null, last_reminded_at: null, balance_usd: 50 },
        ] as any
      }
      return [] as any
    })
    vi.mocked(db.getOptional).mockImplementation(async (sql: string, params?: unknown[]) => {
      if (/MIN\(s.created_at\)/.test(sql)) {
        const customerId = (params as any)[0]
        return { oldest: customerId === 'a' ? iso(5) : iso(10) } as any
      }
      if (/MAX\(paid_at\)/.test(sql)) return { paid_at: null } as any
      return null
    })

    const mo = useMoneyOwed()
    await mo.load()

    expect(mo.totals.value['0_30']).toBe(150) // both a (100) and b (50) fall in 0-30
    expect(mo.totals.value['31_60']).toBe(0)
    expect(mo.totals.value['60_plus']).toBe(0)
    expect(mo.totals.value.grandTotal).toBe(150)
  })
})
