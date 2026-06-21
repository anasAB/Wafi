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

  /** Record one wrong PIN. Returns whether this attempt tripped the lockout. */
  function recordFailure(
    staffId: string,
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
