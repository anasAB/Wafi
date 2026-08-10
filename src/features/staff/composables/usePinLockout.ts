// PIN brute-force lockout (WAFI-012).
//
// State is per-staff and persisted in localStorage so it survives a page reload
// AND works fully offline (no network round-trip — the PIN gate must work with
// no connection). This is a per-DEVICE defense: it rate-limits guessing at the
// register, the realistic threat for a 4-digit PIN. It is NOT tamper-proof
// against an attacker who can clear browser storage — server-coordinated lockout
// is WAFI-010 (deferred). Pairs with salted hashing in usePinAuth.

export const MAX_PIN_ATTEMPTS = 5
export const LOCKOUT_MINUTES = 5

import { publishEvent } from '@/services/events/publishEvent'
import { StaffEventType } from '@/services/events/domainEvent.types'
import type { PinLockedOutPayload } from '@/services/events/domainEvent.types'

const STORAGE_KEY = 'wafi.pin_lockout'

type Entry = { attempts: number; lockedUntil: number }
type State = Record<string, Entry>

function read(): State {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as State }
  catch { return {} }
}

function write(state: State): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch { /* storage full/blocked — fail open */ }
}

export function usePinLockout() {
  function isLockedOut(staffId: string, now: number = Date.now()): boolean {
    const e = read()[staffId]
    return !!e && e.lockedUntil > now
  }

  function remainingMs(staffId: string, now: number = Date.now()): number {
    const e = read()[staffId]
    return e ? Math.max(0, e.lockedUntil - now) : 0
  }

  /** Record one wrong PIN. Returns whether this attempt tripped the lockout.
   *  shopId is required so a tripped lockout can publish staff.pin_locked_out --
   *  entityId is a freshly-generated id for THIS lockout occurrence, not staffId:
   *  lockout state is per-device (WAFI-012), so the same staff member can
   *  independently trip a lockout on two different devices, and those must not
   *  collide on entity identity (WAFI-145 design spec). */
  function recordFailure(
    staffId: string,
    shopId: string,
    now: number = Date.now(),
  ): { locked: boolean; minutes: number } {
    const state = read()
    const e = state[staffId] ?? { attempts: 0, lockedUntil: 0 }
    e.attempts += 1
    let locked = false
    if (e.attempts >= MAX_PIN_ATTEMPTS) {
      e.lockedUntil = now + LOCKOUT_MINUTES * 60_000
      e.attempts = 0  // start a fresh count after the cooldown elapses
      locked = true
    }
    state[staffId] = e
    write(state)

    if (locked) {
      // Bespoke publish (mirrors useDeviceRegistration.ts's own justification): this
      // is a client-local-only PIN lockout with no DB write to wrap -- state lives in
      // localStorage, not a synced table -- so there is no local-write to pair with
      // an audit entry via executeBusinessOperation.
      void publishEvent<PinLockedOutPayload>({
        type: StaffEventType.PinLockedOut,
        entityId: crypto.randomUUID(),
        payload: { staffId, lockoutMinutes: LOCKOUT_MINUTES },
        payloadVersion: 1,
        staffId,
        shopId,
        occurredAt: new Date(now).toISOString(),
      }).catch(() => {})
    }

    return { locked, minutes: LOCKOUT_MINUTES }
  }

  /** Clear all lockout state for a staff member (call on a successful login). */
  function reset(staffId: string): void {
    const state = read()
    delete state[staffId]
    write(state)
  }

  return { isLockedOut, remainingMs, recordFailure, reset }
}
