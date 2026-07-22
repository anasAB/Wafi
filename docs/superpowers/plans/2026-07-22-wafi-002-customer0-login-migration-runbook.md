# Runbook: Migrate Customer #0 (Brother's Shop) Off the devAuth Stub

**Audience:** whoever has access to the brother's device and/or its deployment config.
**Precondition:** Tasks 1–3 of the WAFI-002 auth gap-closing plan are merged
and deployed — `devAuth.ts` is deleted, so no build can silently
auto-sign-in anymore. This runbook is the human-executed step that must
happen *before or at the same time as* that deploy reaches his device,
otherwise he'll be logged out with no way back in.

## Before touching the device

1. Find the values currently set for `VITE_DEV_SUPABASE_EMAIL` and
   `VITE_DEV_SUPABASE_PASSWORD` in whatever `.env` / deployment config
   builds his device's app (not in this repo — check the actual deployment
   pipeline or hosting config used for his build).
2. Confirm these are real, working Supabase Auth credentials — e.g. by
   testing `supabase.auth.signInWithPassword({ email, password })` against
   the production project from a scratch script, or by checking the
   Supabase Auth dashboard for that user's account status (not disabled,
   email confirmed if confirmation is required).

## Migration steps

3. Deploy the build with `devAuth.ts` removed (Tasks 1–3 above) to his
   device.
4. On first load after the deploy, the app should land on `/welcome` (no
   auto sign-in) since nothing signs him in automatically anymore.
   Navigate to `/login`.
5. Sign in using the credentials confirmed in step 2, through the real
   `LoginPage.vue` form.
6. Confirm the shop and its data appear as expected — `device.store.ts`
   resolves `shopId` from `shops.owner_user_id = auth.uid()` for the
   signed-in account, so this is the same account and same shop row; no
   data migration should be needed. Check that:
   - The shop name/products/customers he already has are visible.
   - A test sale can be rung up and appears in sale history.
   - The device's existing device code (visible in
     Settings → Devices) is unchanged — confirms this is recognized as
     the same registered device, not a fresh one.

## Rollback

If sign-in fails (e.g. the credentials found in step 1 don't match what's
actually stored for that account — wrong password, account since
disabled/changed):

- Do **not** deploy the `devAuth.ts`-removed build further until this is
  resolved — keep the previous build (with the stub intact) as the
  fallback so his shop is never left unable to log in.
- Investigate the credential mismatch (e.g. reset the password via the
  Supabase Auth dashboard, then retry from step 4 with the new password).

## Done criteria

- He can sign in via `/login` with his real credentials whenever the app
  is opened fresh (session persists across normal use per Supabase's
  default session persistence, so this should be rare in practice).
- No build anywhere still sets `VITE_DEV_AUTO_SIGNIN=true`.
