import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useShift } from '../useShift'
import { db } from '@/data/powersync/db'
import type { ZReportMetrics } from '../../shift.types'

function sqlOf(call: any[]): string { return call[0] as string }
function paramsOf(call: any[]): unknown[] { return call[1] as unknown[] }

const snapshot: ZReportMetrics = {
  invoiceCount: 4, totalRevenueUsd: 200, cashUsdSales: 120, cashSypSalesRaw: 500_000,
  cardSales: 50, creditSales: 30, cashExpensesUsd: 10, cashExpensesSyp: 0,
  cashRefundsUsd: 0, cashRefundsSyp: 0, cashCreditPaymentsUsd: 0, cashCreditPaymentsSyp: 0,
  cashPayInsUsd: 0, cashPayInsSyp: 0, cashPayOutsUsd: 0, cashPayOutsSyp: 0,
  expectedUsd: 210, actualUsd: 195, varianceUsd: -15,
  expectedSyp: 500_000, actualSyp: 500_000, varianceSyp: 0,
  durationMinutes: 480, byOperator: [],
}

describe('useShift — WAFI-060 immutable close evidence', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
  })

  it('closeShift persists variance, note, and the Z-report snapshot', async () => {
    const { closeShift } = useShift()
    await closeShift({
      closingCashUsd: 195,
      closingCashSyp: 500_000,
      shiftId:        'shift-7',
      varianceUsd:    -15,
      varianceSyp:    0,
      closeNote:      'سلفة موظف',
      zReport:        snapshot,
    })

    const update = vi.mocked(db.execute).mock.calls.find(c =>
      /UPDATE cashier_shifts/.test(sqlOf(c)) && /z_report_data/.test(sqlOf(c))
    )
    expect(update).toBeDefined()
    const params = paramsOf(update!)
    expect(params).toContain(-15)            // variance_usd
    expect(params).toContain('سلفة موظف')    // close_note
    // z_report_data is the serialized snapshot — round-trips to the same figures.
    const jsonParam = params.find(p => typeof p === 'string' && p.includes('totalRevenueUsd')) as string
    expect(jsonParam).toBeDefined()
    expect(JSON.parse(jsonParam).varianceUsd).toBe(-15)
  })

  it('loadShiftById parses the stored snapshot back into zReportData (read = snapshot, not recompute)', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({
      id: 'shift-7', shop_id: 's', device_id: 'd', staff_id: 'st',
      opened_at: '2026-06-19T06:00:00Z', closed_at: '2026-06-19T14:00:00Z',
      opening_cash_usd: 100, opening_cash_syp: 50_000,
      closing_cash_usd: 195, closing_cash_syp: 500_000,
      variance_usd: -15, variance_syp: 0, close_note: 'سلفة موظف',
      force_closed_by: null, z_report_data: JSON.stringify(snapshot), status: 'closed',
    } as any)

    const { loadShiftById } = useShift()
    const shift = await loadShiftById('shift-7')
    expect(shift?.varianceUsd).toBe(-15)
    expect(shift?.closeNote).toBe('سلفة موظف')
    expect(shift?.zReportData?.totalRevenueUsd).toBe(200)
    expect(shift?.openingCashSyp).toBe(50_000)
  })
})
