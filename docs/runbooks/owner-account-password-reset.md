# Runbook — Owner account-password reset (last resort)

Use ONLY when an owner is locked out of owner-level access AND has no working
recovery path: forgot the operator-PIN, has no unused recovery codes, and
cannot sign in with the account password. The shop keeps operating in the
meantime — managers and cashiers still log in with their own PINs; only
owner-level functions (settings, staff, owner PIN) are blocked.

## 1. Verify shop ownership (out-of-band — do NOT skip)
Confirm at least TWO of:
- The `recovery_email` on file (Supabase → Auth → user metadata) matches the
  email the requester controls (send a value to it, have them read it back).
- Shop facts only the owner would know: shop name, phone, approximate signup
  date, recent sales/staff names.
- For pilots: a known founder vouches for the person (brother / CEO contact).

Record who verified, when, and which facts matched.

## 2. Reset the password
Run the script (operator workstation, never committed env):

    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
      node scripts/admin/reset-owner-password.mjs --phone "+963944123456"

It prints a temporary password. Share it over a channel the owner controls,
and tell them to change it immediately after signing in.

## 3. After reset
- Owner signs in with the temp password, then sets a new account password.
- Owner re-enters the app and resets their operator-PIN normally (or uses the
  account-password path in "Forgot PIN?").
- Have the owner generate a fresh set of recovery codes (Settings → Recovery
  codes) so this never recurs.
- Confirm an audit entry exists; note the reset in the support log.
