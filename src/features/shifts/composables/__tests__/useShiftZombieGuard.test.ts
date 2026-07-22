import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

vi.mock('@/data/supabase/client', () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    auth: {
      refreshSession: vi.fn().mockResolvedValue({ data: {}, error: null }),
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'h.eyJzZXNzaW9uX2lkIjoic2Vzc2lvbi14In0.s' } },
        error: null,
      }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}))

import { useShift } from '../useShift'
import { db } from '@/data/powersync/db'
import { useShiftStore } from '../../shift.store'
import { useSessionStore } from '@/store/session.store'
import { isLongOpen, LONG_OPEN_HOURS } from '../../shift.types'
import type { Staff } from '@/features/staff/staff.types'
import type { CashierShift, ZReportMetrics } from '../../shift.types'

function sqlOf(call: any[]): string { return call[0] as string }
function paramsOf(call: any[]): unknown[] { return call[1] as unknown[] }

const staffA = { id: 'staff-A', name: 'محمد', role: 'cashier', permissions: {} } as unknown as Staff
const owner  = { id: 'owner-1', name: 'المالك', role: 'owner',  permissions: {} } as unknown as Staff

function openRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'existing-1', shop_id: 's', device_id: 'd', staff_id: 'staff-A',
    opened_at: '2026-06-24T06:00:00Z', closed_at: null,
    opening_cash_usd: 100, opening_cash_syp: 50_000,
    closing_cash_usd: null, closing_cash_syp: null,
    variance_usd: null, variance_syp: null, close_note: null,
    force_closed_by: null, z_report_data: null, status: 'open',
    ...overrides,
  }
}

const snapshot: ZReportMetrics = {
  invoiceCount: 2, totalRevenueUsd: 80, cashUsdSales: 60, cashSypSalesRaw: 0,
  cardSales: 0, creditSales: 20, cashExpensesUsd: 0, cashExpensesSyp: 0,
  cashRefundsUsd: 0, cashRefundsSyp: 0, cashCreditPaymentsUsd: 0, cashCreditPaymentsSyp: 0,
  cashPayInsUsd: 0, cashPayInsSyp: 0, cashPayOutsUsd: 0, cashPayOutsSyp: 0,
  expectedUsd: 160, actualUsd: 160, varianceUsd: 0,
  expectedSyp: 50_000, actualSyp: 50_000, varianceSyp: 0,
  durationMinutes: 1200, byOperator: [],
}

const insertShiftCall = (c: any[]) => /INSERT INTO cashier_shifts/.test(sqlOf(c))

describe('WAFI-065 — one open shift per device (openShift guard)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
  })

  it('opens a fresh shift when none is open on the device', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce(null)  // findOpenShiftForDevice → none
    const { openShift } = useShift()
    const res = await openShift(staffA, 10, 20, '1234')
    expect(res.status).toBe('opened')
    expect(vi.mocked(db.execute).mock.calls.some(insertShiftCall)).toBe(true)
  })

  it('does NOT open a new shift when identity establishment is blocked (offline, new operator)', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce(null)  // findOpenShiftForDevice → none
    const { supabase } = await import('@/data/supabase/client')
    vi.mocked(supabase.rpc).mockRejectedValueOnce(new Error('network error'))

    const { openShift } = useShift()
    const res = await openShift(staffA, 10, 20, '1234')

    expect(res.status).toBe('identity-unconfirmed')
    expect(vi.mocked(db.execute).mock.calls.some(insertShiftCall)).toBe(false)
  })

  it('resumes the SAME operator\'s existing open shift — no second row', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce(openRow({ staff_id: 'staff-A' }) as any)
    const { openShift } = useShift()
    const res = await openShift(staffA, 10, 20, '1234')
    expect(res).toEqual({ status: 'resumed', shiftId: 'existing-1' })
    // No INSERT — the existing shift is re-attached, not duplicated.
    expect(vi.mocked(db.execute).mock.calls.some(insertShiftCall)).toBe(false)
    // Store + session point at the resumed shift.
    expect(useShiftStore().activeShiftId).toBe('existing-1')
    expect(useSessionStore().activeStaff?.id).toBe('staff-A')
  })

  it('reports a conflict when a DIFFERENT operator holds the device\'s open shift', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce(openRow({ staff_id: 'staff-A' }) as any)
    const { openShift } = useShift()
    const res = await openShift(owner, 10, 20, '1234')
    expect(res.status).toBe('conflict')
    if (res.status === 'conflict') expect(res.shift.staffId).toBe('staff-A')
    expect(vi.mocked(db.execute).mock.calls.some(insertShiftCall)).toBe(false)
  })
})

describe('WAFI-065 — owner force-close', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
  })

  it('persists force_closed_by, the snapshot, and a force_closed audit entry', async () => {
    const { forceCloseShift } = useShift()
    await forceCloseShift({
      shiftId: 'zombie-9', forcedBy: owner,
      closingCashUsd: 160, closingCashSyp: 50_000,
      varianceUsd: 0, varianceSyp: 0,
      closeNote: 'إغلاق إجباري', zReport: snapshot,
    })

    const update = vi.mocked(db.execute).mock.calls.find(c =>
      /UPDATE cashier_shifts/.test(sqlOf(c)) && /force_closed_by/.test(sqlOf(c)))
    expect(update).toBeDefined()
    expect(paramsOf(update!)).toContain('owner-1')          // force_closed_by = owner
    const json = paramsOf(update!).find(p => typeof p === 'string' && p.includes('totalRevenueUsd')) as string
    expect(JSON.parse(json).expectedUsd).toBe(160)          // snapshot stored

    const audit = vi.mocked(db.execute).mock.calls.find(c =>
      /INSERT INTO audit_log/.test(sqlOf(c)) &&
      (paramsOf(c).some(p => p === 'shift.force_closed')))
    expect(audit).toBeDefined()
    const meta = paramsOf(audit!).find(p => typeof p === 'string' && p.includes('actor_id')) as string
    expect(JSON.parse(meta).actor_id).toBe('owner-1')
  })

  it('does NOT clear the live session when force-closing a DIFFERENT shift', async () => {
    useShiftStore().openShift('active-mine', owner)   // owner's own active shift
    const { forceCloseShift } = useShift()
    await forceCloseShift({
      shiftId: 'zombie-9', forcedBy: owner,
      closingCashUsd: 0, closingCashSyp: 0, varianceUsd: 0, varianceSyp: 0,
      closeNote: 'x', zReport: snapshot,
    })
    expect(useShiftStore().activeShiftId).toBe('active-mine')  // untouched
  })

  it('clears the session when force-closing THIS device\'s active shift', async () => {
    useShiftStore().openShift('active-mine', owner)
    const { forceCloseShift } = useShift()
    await forceCloseShift({
      shiftId: 'active-mine', forcedBy: owner,
      closingCashUsd: 0, closingCashSyp: 0, varianceUsd: 0, varianceSyp: 0,
      closeNote: 'x', zReport: snapshot,
    })
    expect(useShiftStore().activeShiftId).toBeNull()
  })
})

describe('WAFI-065 — isLongOpen', () => {
  const base = { status: 'open', openedAt: '2026-06-24T00:00:00Z' } as CashierShift
  const opened = new Date(base.openedAt).getTime()

  it('is false for a shift open less than the threshold', () => {
    expect(isLongOpen(base, opened + (LONG_OPEN_HOURS - 1) * 3_600_000)).toBe(false)
  })
  it('is true once open past the threshold', () => {
    expect(isLongOpen(base, opened + (LONG_OPEN_HOURS + 1) * 3_600_000)).toBe(true)
  })
  it('is never long-open for a closed or abandoned shift', () => {
    const far = opened + 1000 * 3_600_000
    expect(isLongOpen({ ...base, status: 'closed' } as CashierShift, far)).toBe(false)
    expect(isLongOpen({ ...base, status: 'abandoned' } as CashierShift, far)).toBe(false)
  })
})
