import { describe, it, expect } from 'vitest'
import { computeOpeningDefaults } from '@/features/shifts/composables/openingDefaults'
import type { CashierShift } from '@/features/shifts/shift.types'

function closedShift(over: Partial<CashierShift> = {}): CashierShift {
  return {
    id: 'sh-1', shopId: 'shop1', staffId: 'st-1', staffName: 'خالد',
    deviceId: 'dev-1', openedAt: '2026-07-17T08:00:00Z', closedAt: '2026-07-17T20:00:00Z',
    openingCashUsd: 10, openingCashSyp: 100_000,
    closingCashUsd: 42.5, closingCashSyp: 350_000,
    varianceUsd: 0, varianceSyp: 0, closeNote: null, forceClosedBy: null,
    zReportData: null, status: 'closed',
    ...over,
  } as CashierShift
}

describe('computeOpeningDefaults (WAFI-129)', () => {
  it('returns the previous close per currency as editable string defaults', () => {
    expect(computeOpeningDefaults(closedShift())).toEqual({ syp: '350000', usd: '42.5' })
  })

  it('no previous shift → no defaults (first-ever / new device keeps blank behavior)', () => {
    expect(computeOpeningDefaults(null)).toBeNull()
  })

  it('force-closed previous shift → no defaults (counted without the cashier)', () => {
    expect(computeOpeningDefaults(closedShift({ forceClosedBy: 'owner-1' }))).toBeNull()
  })

  it('missing counted amounts → no defaults', () => {
    expect(computeOpeningDefaults(closedShift({ closingCashSyp: null }))).toBeNull()
    expect(computeOpeningDefaults(closedShift({ closingCashUsd: null }))).toBeNull()
  })

  it('zero close is a valid default (empty drawer ≠ missing count)', () => {
    expect(computeOpeningDefaults(closedShift({ closingCashSyp: 0, closingCashUsd: 0 })))
      .toEqual({ syp: '0', usd: '0' })
  })
})
