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
})
