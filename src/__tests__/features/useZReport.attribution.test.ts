import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useZReport } from '@/features/shifts/composables/useZReport'
import { db } from '@/data/powersync/db'
import type { CashierShift } from '@/features/shifts/shift.types'

// WAFI-120: the Z-report's cash-expense and credit-collection sums must
// attribute by shift_id (direct linkage), falling back to the legacy time
// window ONLY for pre-migration rows (null shift_id, null/own device_id).
// This is what stops two overlapping shifts double-counting the same cash.
const shift = {
  id: 'shift-A', shopId: 'shop1', staffId: 'st1', staffName: 'خالد',
  deviceId: 'dev-1', openedAt: '2026-07-18T08:00:00Z', closedAt: null,
  openingCashUsd: 10, openingCashSyp: 100000,
  closingCashUsd: null, closingCashSyp: null,
  varianceUsd: null, varianceSyp: null, closeNote: null, forceClosedBy: null,
  zReportData: null, status: 'open',
} as unknown as CashierShift

describe('useZReport — WAFI-120 drawer attribution', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getOptional).mockResolvedValue({ count: 0, total: 0 } as any)
    vi.mocked(db.getAll).mockResolvedValue([])
  })

  function queriesFor(table: string): Array<[string, unknown[]]> {
    return vi.mocked(db.getOptional).mock.calls
      .filter(([sql]) => new RegExp(`FROM ${table}\\b`).test(sql as string)) as Array<[string, unknown[]]>
  }

  it('cash expenses attribute by shift_id with a legacy null-row fallback scoped to this device', async () => {
    const { compute } = useZReport()
    await compute(shift, 0, 0)

    const expenseQueries = queriesFor('expenses')
    expect(expenseQueries.length).toBeGreaterThanOrEqual(2) // USD + SYP
    for (const [sql, params] of expenseQueries) {
      expect(sql).toMatch(/shift_id = \?/)                    // direct linkage
      expect(sql).toMatch(/shift_id IS NULL/)                 // legacy fallback exists
      expect(sql).toMatch(/device_id IS NULL OR device_id = \?/) // fallback never counts another device's rows
      expect(params).toContain('shift-A')
      expect(params).toContain('dev-1')
    }
  })

  it('cash credit collections attribute the same way', async () => {
    const { compute } = useZReport()
    await compute(shift, 0, 0)

    const paymentQueries = queriesFor('customer_payments')
    expect(paymentQueries.length).toBeGreaterThanOrEqual(2) // USD + SYP
    for (const [sql, params] of paymentQueries) {
      expect(sql).toMatch(/shift_id = \?/)
      expect(sql).toMatch(/shift_id IS NULL/)
      expect(params).toContain('shift-A')
      // Non-cash methods stay out of drawer math (existing invariant preserved)
      expect(sql).toMatch(/method = 'cash'/)
    }
  })

  it('two overlapping shifts: each Z-report requests only its own shift_id', async () => {
    const shiftB = { ...shift, id: 'shift-B', deviceId: 'dev-2' } as CashierShift
    const { compute } = useZReport()
    await compute(shift, 0, 0)
    await compute(shiftB, 0, 0)

    const expenseParams = queriesFor('expenses').map(([, p]) => p)
    const withA = expenseParams.filter(p => p.includes('shift-A'))
    const withB = expenseParams.filter(p => p.includes('shift-B'))
    expect(withA.length).toBeGreaterThanOrEqual(2)
    expect(withB.length).toBeGreaterThanOrEqual(2)
    // No query mixes both shifts — attribution is exclusive
    expect(expenseParams.some(p => p.includes('shift-A') && p.includes('shift-B'))).toBe(false)
  })
})
