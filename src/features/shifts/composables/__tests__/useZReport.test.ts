import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useZReport } from '../useZReport'
import { db } from '@/data/powersync/db'
import type { CashierShift } from '../../shift.types'

const shift: CashierShift = {
  id:             'shift-1',
  shopId:         'shop-1',
  deviceId:       'device-A',
  staffId:        'staff-1',
  openedAt:       '2026-06-19T06:00:00.000Z',
  closedAt:       null,
  openingCashUsd: 100,
  openingCashSyp: 0,
  closingCashUsd: null,
  closingCashSyp: null,
  status:         'open',
}

function sqlOf(call: any[]): string { return call[0] as string }
function paramsOf(call: any[]): unknown[] { return call[1] as unknown[] }

describe('useZReport — shift/device scoping (multi-device)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getOptional).mockResolvedValue({ total: 0, count: 0 } as any)
  })

  it('scopes sales queries to this device, not just the shop', async () => {
    const { compute } = useZReport()
    await compute(shift, 0, 0)
    const salesCalls = vi.mocked(db.getOptional).mock.calls
      .filter(c => /FROM sales\b/.test(sqlOf(c)))
    expect(salesCalls.length).toBeGreaterThan(0)
    for (const c of salesCalls) {
      expect(sqlOf(c)).toMatch(/device_id\s*=\s*\?/)
      expect(paramsOf(c)).toContain('device-A')
    }
  })

  it('scopes cash-payment queries to this device', async () => {
    const { compute } = useZReport()
    await compute(shift, 0, 0)
    const payCalls = vi.mocked(db.getOptional).mock.calls
      .filter(c => /FROM sale_payments\b/.test(sqlOf(c)))
    expect(payCalls.length).toBeGreaterThan(0)
    for (const c of payCalls) {
      expect(sqlOf(c)).toMatch(/device_id\s*=\s*\?/)
      expect(paramsOf(c)).toContain('device-A')
    }
  })

  it('scopes cash-refund queries to this shift via shift_id', async () => {
    const { compute } = useZReport()
    await compute(shift, 0, 0)
    const returnCalls = vi.mocked(db.getOptional).mock.calls
      .filter(c => /FROM returns\b/.test(sqlOf(c)))
    expect(returnCalls.length).toBeGreaterThan(0)
    for (const c of returnCalls) {
      expect(sqlOf(c)).toMatch(/shift_id\s*=\s*\?/)
      expect(paramsOf(c)).toContain('shift-1')
    }
  })

  it('counts only cash credit-payments (method = cash)', async () => {
    const { compute } = useZReport()
    await compute(shift, 0, 0)
    const cpCalls = vi.mocked(db.getOptional).mock.calls
      .filter(c => /FROM customer_payments\b/.test(sqlOf(c)))
    expect(cpCalls.length).toBe(2)  // one per currency
    for (const c of cpCalls) {
      expect(sqlOf(c)).toMatch(/method\s*=\s*'cash'/)
    }
  })

  it('groups the shift sales by operator into byOperator, leaving variance shift-level', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ total: 0, count: 0 } as any)
    vi.mocked(db.getAll).mockResolvedValue([
      { staffId: 's1', name: 'سامي', salesCount: 3, totalUsd: 120 },
      { staffId: 's2', name: 'أحمد', salesCount: 2, totalUsd: 80 },
    ] as any)

    const { compute } = useZReport()
    // Closing = opening (100) since all mocked sales/cash totals are 0 → variance 0.
    const m = await compute(shift, 100, 0)

    expect(m.byOperator).toHaveLength(2)
    expect(m.byOperator[0]).toMatchObject({ staffId: 's1', name: 'سامي', salesCount: 3, totalUsd: 120 })
    expect(m.byOperator[1]).toMatchObject({ staffId: 's2', name: 'أحمد', salesCount: 2, totalUsd: 80 })
    // The breakdown must not disturb the single shift-level cash variance.
    expect(m.varianceUsd).toBe(0)
  })

  it('queries byOperator grouped by staff_id, scoped to device + time window', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ total: 0, count: 0 } as any)
    vi.mocked(db.getAll).mockResolvedValue([])

    const { compute } = useZReport()
    await compute(shift, 0, 0)

    const call = vi.mocked(db.getAll).mock.calls.find(
      c => /FROM sales\b/.test(sqlOf(c)) && /GROUP BY/.test(sqlOf(c)),
    )
    expect(call).toBeTruthy()
    expect(sqlOf(call!)).toMatch(/staff_id/)
    expect(sqlOf(call!)).toMatch(/device_id\s*=\s*\?/)
    expect(paramsOf(call!)).toContain('device-A')
  })

  it('adds cash credit-payments to expected cash in each currency', async () => {
    // Resolve: 0s for all the standard rows, then USD credit cash = 40, SYP = 100000.
    // Queries run via Promise.all in declaration order; credit-payment queries are last.
    vi.mocked(db.getOptional).mockImplementation(async (sql: string) => {
      if (/FROM customer_payments/.test(sql) && /currency\s*=\s*'USD'/.test(sql)) return { total: 40 } as any
      if (/FROM customer_payments/.test(sql) && /currency\s*=\s*'SYP'/.test(sql)) return { total: 100_000 } as any
      return { total: 0, count: 0 } as any
    })
    const { compute } = useZReport()
    // openingCashUsd = 100 (from shift). expectedUsd = 100 + 0 sales + 40 credit = 140
    const m = await compute(shift, 140, 100_000)
    expect(m.expectedUsd).toBe(140)
    expect(m.varianceUsd).toBe(0)
    expect(m.expectedSyp).toBe(100_000)
    expect(m.varianceSyp).toBe(0)
  })

  it('includes mid-shift pay-ins/pay-outs in the reconciliation', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ total: 0, count: 0 } as any)
    // Movements query (db.getAll, matched by SQL) returns one $80 pay-out (USD) and
    // one 300,000 SYP drop; the byOperator query (also db.getAll) returns [].
    vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
      if (/FROM cash_movements/.test(sql)) {
        return [
          { direction: 'out', currency: 'USD', total: 80 },
          { direction: 'out', currency: 'SYP', total: 300_000 },
        ] as any
      }
      return [] as any
    })
    const { compute } = useZReport()
    const m = await compute(shift, 0, 0)
    expect(m.cashPayOutsUsd).toBe(80)
    expect(m.cashPayOutsSyp).toBe(300_000)
    // Baseline expectedUsd = openingCashUsd (100); the $80 pay-out lowers it to 20.
    expect(m.expectedUsd).toBe(100 - 80)
  })

  it('scopes the movements query to this shift via shift_id', async () => {
    const { compute } = useZReport()
    await compute(shift, 0, 0)
    const mvCall = vi.mocked(db.getAll).mock.calls.find(c => /FROM cash_movements/.test(sqlOf(c)))
    expect(mvCall).toBeTruthy()
    expect(sqlOf(mvCall!)).toMatch(/shift_id\s*=\s*\?/)
    expect(paramsOf(mvCall!)).toContain('shift-1')
  })
})
