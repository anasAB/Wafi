import { v4 as uuidv4 } from 'uuid'
import { db, reconnectPowerSync } from '@/data/powersync/db'
import { supabase } from '@/data/supabase/client'
import {
  callBootstrapOwnerIdentity,
  BOOTSTRAP_SUCCESS,
  BOOTSTRAP_ALREADY_COMPLETE,
  BOOTSTRAP_INVALID_STATE,
} from '@/data/supabase/bootstrap'
import { useBootstrapStore } from '@/features/staff/bootstrap.store'
import { useDeviceStore } from '@/store/device.store'
import { decodeSessionIdClaim } from '@/features/staff/composables/useOperatorSwitch'

export type BootstrapOutcome =
  | { status: 'done' }
  | { status: 'timeout' }
  | { status: 'needs-connectivity' }

export type ResumeOutcome = BootstrapOutcome | { status: 'nothing-pending' }

type PollOptions = { pollIntervalMs?: number; pollTimeoutMs?: number }

const DEFAULT_POLL_INTERVAL_MS = 500
const DEFAULT_POLL_TIMEOUT_MS = 10_000

async function pollForLocalStaffRow(staffId: string, opts: PollOptions): Promise<boolean> {
  const intervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const timeoutMs   = opts.pollTimeoutMs  ?? DEFAULT_POLL_TIMEOUT_MS
  const deadline    = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const row = await db.getOptional<{ id: string }>('SELECT id FROM staff WHERE id = ?', [staffId])
    if (row) return true
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return false
}

/**
 * Owner-bootstrap flow (design doc §"Client-side change"): calls the
 * bootstrap_owner_identity RPC directly (mirroring establishOperatorIdentity's
 * existing RPC-call pattern) instead of relying on PowerSync's normal upload
 * queue, which can never carry the owner's own first staff/devices rows up
 * (see the design doc's root-cause section for why).
 */
export function useOwnerBootstrap() {
  const bootstrapStore = useBootstrapStore()
  const deviceStore    = useDeviceStore()

  async function finishAfterServerSuccess(deviceId: string, staffId: string, opts: PollOptions): Promise<BootstrapOutcome> {
    // Found live (2026-07-29): ensureDeviceRegistered() (device.store.ts) fires
    // on SIGNED_IN, racing ahead of this bootstrap flow, and generates its OWN
    // deviceId for a plain client-side `INSERT INTO devices` that fails RLS
    // for a not-yet-bootstrapped shop (auth_role() isn't 'owner' yet). That
    // race is a separate, pre-existing bug this doesn't fix, but its
    // side-effect must be undone here regardless of whether it fired: this
    // RPC call (bootstrap_owner_identity) is the one that ACTUALLY created a
    // valid devices row server-side, using THIS deviceId — so this device's
    // local identity must point at it, not at whatever ensureDeviceRegistered()
    // left behind (a different, non-existent-server-side id). Without this,
    // every subsequent switch_active_operator call looks up a device that was
    // never actually created, and fails exactly like a wrong PIN would.
    try {
      const { data } = await supabase.from('devices').select('code').eq('id', deviceId).maybeSingle()
      if (data) {
        deviceStore.deviceId = deviceId
        if (data.code) deviceStore.deviceCode = data.code
      }
      // else: this deviceId was never created server-side (e.g. the
      // 'already_bootstrapped' path returns before the devices INSERT) -- do
      // NOT adopt it into deviceStore, or every subsequent
      // switch_active_operator call will look up a device that doesn't
      // exist, indistinguishable from a wrong PIN. Leaving deviceStore.deviceId
      // as whatever it was before is closer to correct than clobbering it.
    } catch (err) {
      // Could not confirm the device row exists -- do not adopt an
      // unconfirmed id either; that's exactly the bug this guards against.
      console.warn('[useOwnerBootstrap] devices lookup failed:', err)
    }

    // The custom access-token hook (migration 048) resolves the JWT's
    // `active_role` claim by looking up device_sessions WHERE session_id =
    // <this token's own session_id claim> — NOT by device_id. But
    // bootstrap_owner_identity's INSERT (migration 069) never sets
    // session_id on the row it creates (it only sets active_role='owner').
    // A NULL session_id can never match any lookup, so the hook falls back
    // to 'cashier' forever for this row, no matter how many times the
    // session gets refreshed afterward. Found live (2026-07-29): every
    // owner-gated write (devices, denomination_configs, exchange_rates,
    // audit_log, ...) kept failing RLS minutes after a successful bootstrap,
    // with no PIN or device-identity problem in sight — this is why.
    //
    // device.store.ts separately has a record_device_session_id call
    // (refreshShopId's one-shot `sessionIdRecorded` guard), but it can fire
    // before deviceStore.deviceId is corrected above (it's triggered
    // independently, off SIGNED_IN) — stamping session_id onto the WRONG
    // device row and then never retrying, since it only ever runs once per
    // app session. This bootstrap flow must stamp it directly onto the
    // correct row itself, unconditionally, rather than depending on that
    // one-shot mechanism having landed correctly.
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData?.session?.access_token
      const sessionId = accessToken ? decodeSessionIdClaim(accessToken) : null
      if (sessionId) {
        await supabase.rpc('record_device_session_id', { p_device_id: deviceId, p_session_id: sessionId })
      }
    } catch (err) {
      // Best-effort — if this fails, the subsequent refreshSession() below
      // will simply carry the same stale 'cashier' claim it would have
      // without this fix, no worse than before.
      console.warn('[useOwnerBootstrap] record_device_session_id failed:', err)
    }

    // Must run AFTER the session_id stamp above: the hook resolves
    // `active_role` at token-issuance time, so a refresh before the row is
    // findable by session_id would still mint a 'cashier'-defaulted token.
    await supabase.auth.refreshSession()

    // The refreshed session carries claims PowerSync's existing connection was
    // opened without (e.g. the new device_sessions row this RPC just created).
    // Re-calling connect() forces fetchCredentials() to run again with the
    // fresh token instead of relying on the SDK to notice on its own — found
    // live: without this, a brand-new device's first sync could sit waiting
    // indefinitely (or past the poll window below) for rows that already
    // exist server-side. Swallow a failure here the same way db.ts's initial
    // connect() does — offline/unreachable should fall through to the normal
    // poll-timeout path, not throw out of the bootstrap flow.
    await reconnectPowerSync()

    const arrived = await pollForLocalStaffRow(staffId, opts)
    if (!arrived) {
      // Per design doc's "Timeout behavior": leave the pending record in
      // place -- do NOT clear it and do NOT proceed as if the row exists.
      return { status: 'timeout' }
    }

    deviceStore.lastConfirmedOperatorId = staffId
    bootstrapStore.clear()
    return { status: 'done' }
  }

  async function bootstrapOwner(
    name: string,
    pin: string,
    opts: PollOptions = {},
  ): Promise<BootstrapOutcome> {
    const deviceId = uuidv4()
    const staffId  = uuidv4()
    bootstrapStore.start(deviceId, staffId)

    let result: string
    try {
      result = await callBootstrapOwnerIdentity({ deviceId, staffId, staffName: name, pin })
    } catch {
      // Per design doc: needs connectivity, do not fall back to a local-only
      // write. Pending record stays -- a retry reuses the same ids.
      return { status: 'needs-connectivity' }
    }

    if (result !== BOOTSTRAP_SUCCESS && result !== BOOTSTRAP_ALREADY_COMPLETE) {
      // BOOTSTRAP_INVALID_STATE -- should not happen post the WAFI-001
      // provisioning-trigger fix; surfaced the same as a connectivity
      // failure since there is nothing more specific the UI can do here.
      return { status: 'needs-connectivity' }
    }

    return finishAfterServerSuccess(deviceId, staffId, opts)
  }

  async function resumePendingBootstrap(opts: PollOptions = {}): Promise<ResumeOutcome> {
    const pending = bootstrapStore.pending
    if (!pending) return { status: 'nothing-pending' }

    bootstrapStore.recordAttempt()

    let result: string
    try {
      // No PIN re-entry: if the RPC already ran server-side, it returns
      // BOOTSTRAP_ALREADY_COMPLETE regardless of the PIN sent. If it never
      // ran, the server's invalid_state guard (migration 069) rejects the
      // blank name/PIN rather than silently creating a bricked owner --
      // handled below by clearing the stale pending record.
      result = await callBootstrapOwnerIdentity({
        deviceId: pending.deviceId, staffId: pending.staffId, staffName: '', pin: '',
      })
    } catch {
      // Found in final whole-branch review: an invalid_state/thrown result
      // here means the RPC never actually completed server-side for this
      // pending record and never can via this blank-credential resume path
      // -- it genuinely needs a human to re-enter a PIN. Clear the stale
      // record so the owner-setup screen falls back to its normal
      // no-pending state and re-prompts from scratch, instead of retrying
      // an unrecoverable resume forever on every future boot.
      bootstrapStore.clear()
      return { status: 'needs-connectivity' }
    }

    if (result === BOOTSTRAP_INVALID_STATE) {
      bootstrapStore.clear()
      return { status: 'needs-connectivity' }
    }

    if (result !== BOOTSTRAP_SUCCESS && result !== BOOTSTRAP_ALREADY_COMPLETE) {
      return { status: 'needs-connectivity' }
    }

    return finishAfterServerSuccess(pending.deviceId, pending.staffId, opts)
  }

  return { bootstrapOwner, resumePendingBootstrap }
}
