import { supabase } from '@/data/supabase/client'
import { useDeviceStore } from '@/store/device.store'
import { useSessionStore } from '@/store/session.store'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'
import type { Staff } from '@/features/staff/staff.types'

/**
 * Decode the `session_id` claim out of a Supabase access-token JWT's payload.
 *
 * This does NOT verify the token's signature — it doesn't need to. The token
 * came straight out of our own authenticated SDK session; we are reading a
 * claim off it, not re-authenticating with it. `@supabase/supabase-js`'s
 * `Session` object has no top-level `session_id` field (checked against the
 * installed `@supabase/auth-js` types: `Session` exposes `access_token`/
 * `refresh_token`/etc. but not `session_id`), even though `session_id` is a
 * real claim Supabase stamps into every JWT payload by default (see the
 * `JWTClaims`/`RequiredClaims` types in the same package). So the client must
 * pull it out of the JWT itself. See ADR-009's Design Correction.
 */
export function decodeSessionIdClaim(accessToken: string): string | null {
  try {
    const payloadSegment = accessToken.split('.')[1]
    if (!payloadSegment) return null
    // base64url -> base64
    const base64 = payloadSegment.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
    const json = decodeURIComponent(
      atob(padded)
        .split('')
        .map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(''),
    )
    const payload = JSON.parse(json) as { session_id?: string }
    return payload.session_id ?? null
  } catch {
    return null
  }
}

/** Thrown by `switchTo` when a genuinely new identity is attempted while
 *  offline. The caller should show `message` and leave the previous
 *  operator active — nothing local has changed. */
export class OperatorSwitchBlockedError extends Error {}

export type EstablishIdentityResult =
  | { status: 'confirmed' }
  | { status: 'offline-same-identity' }
  | { status: 'blocked'; reason: string }

const NEEDS_CONNECTIVITY_MESSAGE = 'تحتاج إلى اتصال بالإنترنت لتأكيد هويتك — حاول مرة أخرى'

/**
 * Establish `staff` as this device's server-confirmed active operator.
 *
 * WAFI-203: the JWT's `staff_id` claim and the locally-active operator must
 * never diverge. If `staff` is already this device's last-confirmed
 * identity, the JWT already carries their id from an earlier confirmation —
 * safe to proceed with no network call. Otherwise this is a genuinely NEW
 * identity for this device: it is only adopted once
 * switch_active_operator + refreshSession have both succeeded. On any
 * offline/network failure for a new identity, this returns `blocked` rather
 * than applying anything locally — the caller must not set the active
 * operator in that case.
 */
export async function establishOperatorIdentity(
  staff: Staff,
  pin: string,
): Promise<EstablishIdentityResult> {
  const device = useDeviceStore()

  if (device.lastConfirmedOperatorId === staff.id) {
    return { status: 'offline-same-identity' }
  }

  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData?.session?.access_token
  const sessionId = accessToken ? decodeSessionIdClaim(accessToken) : null

  if (sessionId === null) {
    // No genuine session_id to hand the RPC — see decodeSessionIdClaim's own
    // header comment for why this must never be passed through as a value.
    return { status: 'blocked', reason: NEEDS_CONNECTIVITY_MESSAGE }
  }

  try {
    const { data: ok, error } = await supabase.rpc('switch_active_operator', {
      p_device_id:  device.deviceId,
      p_session_id: sessionId,
      p_staff_id:   staff.id,
      p_pin:        pin,
    })

    if (error) {
      return { status: 'blocked', reason: NEEDS_CONNECTIVITY_MESSAGE }
    }
    if (!ok) {
      throw new Error('server-side PIN verification failed')
    }

    await supabase.auth.refreshSession()
    device.lastConfirmedOperatorId = staff.id
    return { status: 'confirmed' }
  } catch (e) {
    if (e instanceof Error && /pin/i.test(e.message)) throw e
    return { status: 'blocked', reason: NEEDS_CONNECTIVITY_MESSAGE }
  }
}

/**
 * Switch the active operator without touching the cash shift.
 *
 * Switching is identity-only: it re-points the single active-operator source
 * (`sessionStore`, WAFI-011) so route guards and nav re-scope immediately, and
 * records an `operator.switched` audit row. It deliberately never opens or
 * closes a shift — the drawer is counted once per working session, not per
 * operator (see switch-operator design, decision 1).
 *
 * WAFI-122: also calls the server-side `switch_active_operator` RPC (which
 * re-verifies the PIN and stamps `device_sessions.active_role`, keyed on this
 * session's `session_id` — see ADR-009 and migration
 * 048_session_id_active_role.sql), then forces a token refresh so the new
 * `active_role` JWT claim is live within one sync cycle.
 *
 * WAFI-203: this is offline-safe only for re-entering the device's already
 * last-confirmed identity (`establishOperatorIdentity`'s `offline-same-identity`
 * path) — no network call is made and the switch proceeds locally. For a
 * genuinely new identity, the RPC + `refreshSession` must both succeed before
 * the switch is adopted; on failure (including offline), `switchTo` throws
 * `OperatorSwitchBlockedError` rather than silently proceeding, so the JWT's
 * `staff_id` claim and the locally-active operator never diverge. See
 * `establishOperatorIdentity`'s doc comment above for the full rationale.
 */
export function useOperatorSwitch() {
  const session = useSessionStore()
  const { logOperatorSwitched } = useAuditLog()

  async function switchTo(staff: Staff, pin: string): Promise<void> {
    const from = session.activeStaff
    if (from?.id === staff.id) return // no-op: same operator, nothing to record

    const result = await establishOperatorIdentity(staff, pin)
    if (result.status === 'blocked') {
      throw new OperatorSwitchBlockedError(result.reason)
    }

    session.setActiveStaff(staff) // shift state is intentionally untouched
    await logOperatorSwitched(from?.id ?? null, from?.name ?? null, staff.id, staff.name)
  }

  return { switchTo }
}
