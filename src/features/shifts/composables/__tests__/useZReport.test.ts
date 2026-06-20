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
})
