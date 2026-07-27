import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { supabase } from '@/data/supabase/client'
import {
  callBootstrapOwnerIdentity,
  BOOTSTRAP_SUCCESS,
  BOOTSTRAP_ALREADY_COMPLETE,
} from '@/data/supabase/bootstrap'
import { useBootstrapStore } from '@/features/staff/bootstrap.store'
import { useDeviceStore } from '@/store/device.store'

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

  async function finishAfterServerSuccess(staffId: string, opts: PollOptions): Promise<BootstrapOutcome> {
    await supabase.auth.refreshSession()

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

    return finishAfterServerSuccess(staffId, opts)
  }

  async function resumePendingBootstrap(opts: PollOptions = {}): Promise<ResumeOutcome> {
    const pending = bootstrapStore.pending
    if (!pending) return { status: 'nothing-pending' }

    bootstrapStore.recordAttempt()

    let result: string
    try {
      // No PIN re-entry: if the RPC already ran server-side, it returns
      // BOOTSTRAP_ALREADY_COMPLETE regardless of the PIN sent. If it never
      // ran, an empty PIN would fail -- but this path only exists for
      // resuming a bootstrap that IS pending, meaning the RPC call was
      // already attempted at least once; a fresh attempt with no PIN is
      // only ever reached here after the RPC already succeeded once
      // (design doc case 3) or the app is retrying case 2, in which case
      // the owner is prompted for the PIN again by the caller before this
      // is invoked with a real PIN -- resumePendingBootstrap itself never
      // has a PIN to send, by design (PendingBootstrap holds no pin field).
      result = await callBootstrapOwnerIdentity({
        deviceId: pending.deviceId, staffId: pending.staffId, staffName: '', pin: '',
      })
    } catch {
      return { status: 'needs-connectivity' }
    }

    if (result !== BOOTSTRAP_SUCCESS && result !== BOOTSTRAP_ALREADY_COMPLETE) {
      return { status: 'needs-connectivity' }
    }

    return finishAfterServerSuccess(pending.staffId, opts)
  }

  return { bootstrapOwner, resumePendingBootstrap }
}
