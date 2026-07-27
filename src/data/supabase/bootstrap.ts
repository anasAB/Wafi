import { supabase } from './client'

// Named constants per the design doc's "Return type: named constants"
// section -- never compare against these raw string literals at a call
// site; always import and reference these.
export const BOOTSTRAP_SUCCESS = 'success' as const
export const BOOTSTRAP_ALREADY_COMPLETE = 'already_bootstrapped' as const
export const BOOTSTRAP_INVALID_STATE = 'invalid_state' as const

export type BootstrapResult =
  | typeof BOOTSTRAP_SUCCESS
  | typeof BOOTSTRAP_ALREADY_COMPLETE
  | typeof BOOTSTRAP_INVALID_STATE

export type BootstrapOwnerIdentityInput = {
  deviceId:  string
  staffId:   string
  staffName: string
  pin:       string
}

/**
 * Calls the bootstrap_owner_identity() RPC (migration 069) -- the only
 * server-side path that can create a brand-new shop's first devices/staff/
 * device_sessions rows, breaking the circular auth_role()='owner' bootstrap
 * lockout. Role, permissions, device code, and pin hash/salt are never sent
 * -- all computed server-side. See
 * docs/superpowers/specs/2026-07-26-owner-bootstrap-rpc-design.md.
 */
export async function callBootstrapOwnerIdentity(
  input: BootstrapOwnerIdentityInput
): Promise<BootstrapResult> {
  const { data, error } = await supabase.rpc('bootstrap_owner_identity', {
    p_device_id:   input.deviceId,
    p_staff_id:    input.staffId,
    p_staff_name:  input.staffName,
    p_pin:         input.pin,
  })
  if (error) throw new Error(error.message)
  return data as BootstrapResult
}
