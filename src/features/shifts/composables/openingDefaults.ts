import type { CashierShift } from '@/features/shifts/shift.types'

/**
 * WAFI-129: opening-cash defaults from the previous close on this device.
 *
 * The common case is an untouched overnight drawer — retyping yesterday's
 * numbers is friction, and a typo manufactures a full day of false variance.
 * Returns null (no defaults, blank fields) when there is no reliable baseline:
 * no previous shift, a force-closed previous shift (counted without the
 * cashier), or missing counted amounts.
 */
export function computeOpeningDefaults(
  lastClosed: CashierShift | null,
): { syp: string; usd: string } | null {
  if (!lastClosed) return null
  if (lastClosed.forceClosedBy) return null
  if (lastClosed.closingCashSyp == null || lastClosed.closingCashUsd == null) return null
  return {
    syp: String(lastClosed.closingCashSyp),
    usd: String(lastClosed.closingCashUsd),
  }
}
