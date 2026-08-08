import { describe, it, expect, vi, beforeEach } from 'vitest'
import { usePinLockout, MAX_PIN_ATTEMPTS, LOCKOUT_MINUTES } from '../usePinLockout'
import { publishEvent } from '@/services/events/publishEvent'

vi.mock('@/services/events/publishEvent', () => ({ publishEvent: vi.fn().mockResolvedValue(undefined) }))

const NOW = 1_700_000_000_000

describe('usePinLockout (WAFI-012)', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('is not locked before any failures', () => {
    const { isLockedOut } = usePinLockout()
    expect(isLockedOut('staff-1', NOW)).toBe(false)
  })

  it('locks out after MAX_PIN_ATTEMPTS wrong attempts', () => {
    const { recordFailure, isLockedOut } = usePinLockout()
    let res
    for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) res = recordFailure('staff-1', 'shop-1', NOW)
    expect(res!.locked).toBe(true)
    expect(res!.minutes).toBeGreaterThan(0)
    expect(isLockedOut('staff-1', NOW)).toBe(true)
  })

  it('lockout expires after the cooldown window', () => {
    const { recordFailure, isLockedOut } = usePinLockout()
    for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) recordFailure('staff-1', 'shop-1', NOW)
    expect(isLockedOut('staff-1', NOW)).toBe(true)
    expect(isLockedOut('staff-1', NOW + 60 * 60_000)).toBe(false)  // an hour later
  })

  it('reset clears attempts and lockout (called on a successful login)', () => {
    const { recordFailure, reset, isLockedOut } = usePinLockout()
    for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) recordFailure('staff-1', 'shop-1', NOW)
    reset('staff-1')
    expect(isLockedOut('staff-1', NOW)).toBe(false)
  })

  it('persists lockout across a reload (a fresh composable reads the same state)', () => {
    const a = usePinLockout()
    for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) a.recordFailure('staff-1', 'shop-1', NOW)
    // Simulate a page reload: brand-new composable instance, same localStorage.
    const b = usePinLockout()
    expect(b.isLockedOut('staff-1', NOW)).toBe(true)
  })

  it('tracks lockout per staff member, not globally', () => {
    const { recordFailure, isLockedOut } = usePinLockout()
    for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) recordFailure('staff-1', 'shop-1', NOW)
    expect(isLockedOut('staff-1', NOW)).toBe(true)
    expect(isLockedOut('staff-2', NOW)).toBe(false)
  })

  it('publishes staff.pin_locked_out with a fresh entityId when the lockout trips', () => {
    const { recordFailure } = usePinLockout()
    let res
    for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) res = recordFailure('staff-1', 'shop-1', NOW)
    expect(res!.locked).toBe(true)
    expect(publishEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'staff.pin_locked_out',
      payload: { staffId: 'staff-1', lockoutMinutes: LOCKOUT_MINUTES },
      shopId: 'shop-1', staffId: 'staff-1',
    }))
    const call = vi.mocked(publishEvent).mock.calls[0][0]
    expect(call.entityId).not.toBe('staff-1') // fresh occurrence id, not the staff id
  })

  it('does not publish on a non-tripping failure', () => {
    const { recordFailure } = usePinLockout()
    recordFailure('staff-2', 'shop-1', NOW)
    expect(publishEvent).not.toHaveBeenCalled()
  })
})
