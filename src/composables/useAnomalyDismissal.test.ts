import { describe, it, expect, beforeEach, vi } from 'vitest'
import { isDismissed, dismiss } from './useAnomalyDismissal'

describe('useAnomalyDismissal', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('is not dismissed before dismiss() is called', () => {
    expect(isDismissed('shop-1', 'today', 'HIGH_EXPENSES_RATIO')).toBe(false)
  })

  it('is dismissed immediately after dismiss() for the same shop/period/code', () => {
    dismiss('shop-1', 'today', 'HIGH_EXPENSES_RATIO')
    expect(isDismissed('shop-1', 'today', 'HIGH_EXPENSES_RATIO')).toBe(true)
  })

  it('does not carry a dismissal across a different periodKey', () => {
    dismiss('shop-1', 'today', 'HIGH_EXPENSES_RATIO')
    expect(isDismissed('shop-1', '7d', 'HIGH_EXPENSES_RATIO')).toBe(false)
  })

  it('does not carry a dismissal across a different shop', () => {
    dismiss('shop-1', 'today', 'HIGH_EXPENSES_RATIO')
    expect(isDismissed('shop-2', 'today', 'HIGH_EXPENSES_RATIO')).toBe(false)
  })

  it('does not carry a dismissal across a different code', () => {
    dismiss('shop-1', 'today', 'HIGH_EXPENSES_RATIO')
    expect(isDismissed('shop-1', 'today', 'HIGH_RETURNS_RATIO')).toBe(false)
  })

  it('reappears on a different date (mocked) because the key is date-scoped', () => {
    const realDate = Date
    // @ts-expect-error partial mock for a fixed "today"
    global.Date = class extends realDate {
      constructor() { super('2026-07-30T10:00:00Z') }
      static now() { return new realDate('2026-07-30T10:00:00Z').getTime() }
    }
    dismiss('shop-1', 'today', 'HIGH_EXPENSES_RATIO')
    expect(isDismissed('shop-1', 'today', 'HIGH_EXPENSES_RATIO')).toBe(true)

    // @ts-expect-error advance the mocked "today"
    global.Date = class extends realDate {
      constructor() { super('2026-07-31T10:00:00Z') }
      static now() { return new realDate('2026-07-31T10:00:00Z').getTime() }
    }
    expect(isDismissed('shop-1', 'today', 'HIGH_EXPENSES_RATIO')).toBe(false)
    global.Date = realDate
  })

  it('uses local wall-clock date, not UTC date, for the dismissal key expiry', () => {
    // This test verifies the timezone bug fix: dismissalKey must use local date
    // (getFullYear/getMonth/getDate), not UTC date (toISOString), so that dismissals
    // expire at local midnight, not UTC midnight. Example: at 00:30 local time on day N+1
    // (UTC+3), UTC time is still 21:30 on day N — dismissal should key against local day N+1.
    const realDate = Date
    const getFullYearSpy = vi.spyOn(realDate.prototype, 'getFullYear').mockReturnValue(2026)
    const getMonthSpy = vi.spyOn(realDate.prototype, 'getMonth').mockReturnValue(6) // July (0-indexed)
    const getDateSpy = vi.spyOn(realDate.prototype, 'getDate').mockReturnValue(31) // Local date is 31st

    dismiss('shop-1', 'today', 'HIGH_EXPENSES_RATIO')
    expect(isDismissed('shop-1', 'today', 'HIGH_EXPENSES_RATIO')).toBe(true)

    // Change the mocked local date to the 30th
    getDateSpy.mockReturnValue(30)

    // Because the dismissal key is based on local date, it should not be found
    // when the local date changes (this proves we're using local date, not UTC)
    expect(isDismissed('shop-1', 'today', 'HIGH_EXPENSES_RATIO')).toBe(false)

    // Change back to 31st — dismissal should be found again
    getDateSpy.mockReturnValue(31)
    expect(isDismissed('shop-1', 'today', 'HIGH_EXPENSES_RATIO')).toBe(true)

    getFullYearSpy.mockRestore()
    getMonthSpy.mockRestore()
    getDateSpy.mockRestore()
  })
})
