import { supabase } from './client'
import { useDeviceStore } from '@/store/device.store'

// WAFI-055 — Real auth for self-serve onboarding.
//
// Decision 1 (epic 2026-06-20): authenticate by PHONE + PASSWORD with NO SMS OTP.
// Syrian SMS delivery is unreliable and an SMS provider is a cost/sanctions problem
// at €100–200/mo. So the phone is keyed as a SYNTHETIC EMAIL behind a domain we
// never deliver to, and we use Supabase's standard email/password provider with
// email confirmation OFF. The owner only ever sees "phone"; the email is an internal
// detail. A real email (for assisted recovery) is a separate, optional field.
//
// This module is the single seam between the app and Supabase Auth. Pages call it;
// they never touch `supabase.auth` directly. Provisioning of the shop + owner_user_id
// happens SERVER-SIDE and atomically (migration: provision_shop_on_signup) from the
// metadata we attach here — never client-side, so an account can't exist without a shop.

const PHONE_EMAIL_DOMAIN = 'wafi.app'

export type SignUpInput = {
  phone:         string
  password:      string
  shopName:      string
  businessType:  string
  country:       string
  recoveryEmail?: string   // optional real email — the only assisted-recovery channel; login stays phone-based
}

export type SignInInput = {
  phone:    string
  password: string
}

export type AuthFailureReason =
  | 'duplicate'            // account already exists for this phone
  | 'offline'              // network unreachable — never fake success
  | 'invalid_credentials'  // wrong phone/password on sign-in
  | 'weak_password'        // password rejected by the server policy
  | 'unknown'              // anything else — surface a generic message

export type AuthOutcome =
  | { ok: true }
  | { ok: false; reason: AuthFailureReason; message: string }

/**
 * Map a phone number to its stable synthetic login email. Folds away all
 * human formatting (spaces, dashes, parentheses, leading +) so that the same
 * real phone always resolves to the same account regardless of how it was typed.
 */
export function phoneToEmail(phone: string): string {
  const digits = phone.replace(/\D+/g, '')
  return `${digits}@${PHONE_EMAIL_DOMAIN}`
}

function classifyAuthError(message: string): AuthFailureReason {
  const m = message.toLowerCase()
  if (m.includes('already registered') || m.includes('already exists') || m.includes('already been registered')) {
    return 'duplicate'
  }
  // Browser/Supabase network failures surface in a few shapes; treat them all as offline.
  if (m.includes('network request failed') || m.includes('failed to fetch') || m.includes('networkerror') || m.includes('fetch failed')) {
    return 'offline'
  }
  if (m.includes('invalid login credentials') || m.includes('invalid credentials')) {
    return 'invalid_credentials'
  }
  if (m.includes('password') && (m.includes('at least') || m.includes('weak') || m.includes('should be'))) {
    return 'weak_password'
  }
  return 'unknown'
}

function fail(reason: AuthFailureReason, message: string): AuthOutcome {
  return { ok: false, reason, message }
}

/**
 * Create the owner's account. Shop name / type / country ride along as user
 * metadata so the server-side provisioning trigger can create the shop atomically
 * the moment the auth user is inserted. Returns a structured outcome — the caller
 * never has to parse Supabase error strings.
 */
export async function signUpOwner(input: SignUpInput): Promise<AuthOutcome> {
  try {
    const recovery = input.recoveryEmail?.trim().toLowerCase()
    const { error } = await supabase.auth.signUp({
      email:    phoneToEmail(input.phone),
      password: input.password,
      options: {
        data: {
          shop_name:     input.shopName,
          business_type: input.businessType,
          country:       input.country,
          phone:         input.phone,
          ...(recovery ? { recovery_email: recovery } : {}),
        },
      },
    })
    if (error) return fail(classifyAuthError(error.message), error.message)
    return { ok: true }
  } catch (e) {
    // A thrown error (vs. a returned one) is almost always a transport failure.
    return fail('offline', e instanceof Error ? e.message : 'network error')
  }
}

/** Sign a returning owner in by phone + password. */
export async function signIn(input: SignInInput): Promise<AuthOutcome> {
  try {
    // WAFI-122: the device_id rides along in options.data so the Custom Access
    // Token Hook (server-side) can read it off the resulting session and stamp
    // it into the JWT claims — needed by switch_active_operator's lockout to
    // scope failed-PIN attempts per physical device, not per account.
    const device = useDeviceStore()
    const { error } = await supabase.auth.signInWithPassword({
      email:    phoneToEmail(input.phone),
      password: input.password,
      options:  { data: { device_id: device.deviceId } },
    })
    if (error) return fail(classifyAuthError(error.message), error.message)
    return { ok: true }
  } catch (e) {
    return fail('offline', e instanceof Error ? e.message : 'network error')
  }
}

/**
 * Re-verify the shop account password for the currently signed-in owner
 * (WAFI-056 owner self-recovery). Used to break the circular lock: an owner who
 * forgot their operator-PIN proves account ownership with the password, then
 * sets a new owner PIN.
 *
 * Requires connectivity — password verification is server-side, so this path
 * does NOT work offline (documented limitation; the in-person manager flow
 * cannot rescue the owner). We re-authenticate the SAME account, so the existing
 * session is preserved on success.
 */
export async function verifyAccountPassword(password: string): Promise<AuthOutcome> {
  try {
    const { data, error: userError } = await supabase.auth.getUser()
    const email = data.user?.email
    if (userError || !email) {
      // No reachable session/identity to verify against — treat as offline so
      // the UI tells the owner to reconnect rather than "wrong password".
      return fail('offline', userError?.message ?? 'no active account session')
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return fail(classifyAuthError(error.message), error.message)
    return { ok: true }
  } catch (e) {
    return fail('offline', e instanceof Error ? e.message : 'network error')
  }
}

/** Clear the cloud session. Callers handle warning about unsynced writes (B3). */
export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}
