# WAFI-002: Real Authentication System — Gap-Closing Design

**Date:** 2026-07-22
**Status:** Approved
**Ticket:** WAFI-002 (P0, originally scoped "1.5 sprints: signup, login, JWT, session, PIN, tenant isolation")

## Context

WAFI-002 was scoped as a from-scratch auth build. Investigation before this
design (see conversation log) found that's no longer accurate: signup, login,
PIN-based operator switching, JWT claims, and tenant isolation via RLS are
already implemented and working —

- `src/pages/SignupPage.vue` / `LoginPage.vue` call real
  `supabase.auth.signUp` / `signInWithPassword` (phone+password, synthetic
  email — SMS OTP was rejected for cost/sanctions reasons per prior
  decisions). Shop provisioning happens atomically server-side via the
  `provision_shop_for_new_user()` trigger (migration 021) — never
  client-side.
- `useOperatorSwitch.ts`'s `switchTo`/`establishOperatorIdentity` verifies a
  staff PIN server-side via the `switch_active_operator` RPC, then forces
  `supabase.auth.refreshSession()` so the JWT's `staff_id`/`active_role`
  claims actually change. This is genuine re-authentication of identity
  within an already-authenticated device session (WAFI-203), not cosmetic.
- Tenant isolation is enforced via `shops.owner_user_id = auth.uid()` RLS
  (migration 015) plus the domain-scoped RLS policies from migrations
  055–062, now executing for real under pgTAP (WAFI-122, WAFI-202 — see
  2026-07-22 test-infrastructure fixes).

So this ticket is **not** a build-from-scratch. It's a gap-closing pass over
three specific areas, decided in brainstorming:

1. Session refresh/expiry handling — **verified, no gap found**, so no code
   change; documented here as a checked item.
2. `ForgotPasswordPage.vue` — **verified, no gap found**; it's a deliberate
   WhatsApp-support-contact fallback (no email/SMS reset infra exists,
   consistent with "no Stripe, no SMS OTP" constraints), working as
   designed.
3. **Retire `devAuth.ts`** — the one substantive change. This also requires
   migrating a live production customer (the brother's shop, customer #0)
   off the stub and onto the real login flow, since the stub currently
   powers that shop's production sign-in by deliberate, documented design
   (see the comment in `devAuth.ts` itself).

## What's changing

### 1. Session refresh/expiry (verification only, no code change)

Read `src/router/index.ts`'s navigation guard and
`src/store/device.store.ts`'s `onAuthStateChange` handler:

- The router guard calls `supabase.auth.getSession()` on every navigation.
  supabase-js auto-refreshes an expired session using the stored refresh
  token; if that fails (revoked/expired refresh token, or genuinely no
  session), `getSession()` resolves with `session: null` and the guard
  redirects to `/welcome`. This fails closed correctly.
- `device.store.ts` already explicitly handles `SIGNED_OUT` (resets
  `shopId` to the fallback) and `SIGNED_IN` (clears/reconnects local DB
  when a different account signs in on the same device, with in-flight
  race guards documented inline) via `onAuthStateChange`.
- Offline behavior: supabase-js's default `persistSession: true` +
  `autoRefreshToken: true` means a cached, not-yet-expired session is
  returned synchronously without a network call while offline, which is
  the correct behavior for this offline-first app. A refresh attempt while
  offline fails silently without clearing the local session (supabase-js
  only clears on an explicit `invalid_grant`/refresh-token-not-found
  response, not a network failure).

**Conclusion:** no gap. No code changes for this item.

### 2. `ForgotPasswordPage.vue` (verification only, no code change)

Already routed at `/forgot-password`, already reachable from `LoginPage.vue`,
already a `PUBLIC_PATHS` entry in the router guard. Its content directs the
user to contact support via WhatsApp rather than attempting a self-serve
reset — intentional, matching the product's no-SMS/no-email-infra reality.

**Conclusion:** no gap. No code changes for this item.

### 3. Retire the dev auto-sign-in stub

**Current state** (`src/data/supabase/devAuth.ts`, called from
`src/main.ts`): when `VITE_DEV_AUTO_SIGNIN=true`, the app signs in (or signs
up) using credentials baked into the build via `VITE_DEV_SUPABASE_EMAIL` /
`VITE_DEV_SUPABASE_PASSWORD`, bypassing the login UI entirely. The code
comment is explicit that this is intentionally still live in one production
build — the brother's dedicated single-device shop (customer #0) — as a
stand-in until self-serve login existed. Self-serve login (`LoginPage.vue`)
now exists and is proven (has its own test suite), so this stand-in has no
remaining justification.

**Changes:**

- Delete `src/data/supabase/devAuth.ts`.
- Remove the `bootstrapDevAuth()` import and call from `src/main.ts`.
- Delete `src/__tests__/data/devAuth.test.ts` (tests code that no longer
  exists).
- Remove `VITE_DEV_AUTO_SIGNIN`, `VITE_DEV_AUTO_SIGNUP`,
  `VITE_DEV_SUPABASE_EMAIL`, `VITE_DEV_SUPABASE_PASSWORD` from
  `.env.local.example` (and any deployment config /
  `.env.local` the brother's build actually uses — flagged in the runbook
  below since that file isn't in this repo).
- `VITE_STUB_SHOP_ID` / `VITE_STUB_DEVICE_ID` / `VITE_STUB_DEVICE_CODE`
  stay untouched — these are a separate, still-valid developer-machine
  fallback in `device.store.ts` for local dev without a signed-in session,
  not a production auth bypass.

**Rollout runbook** (for the brother's live device — a separate,
human-executed step, not something automated here):

1. **Before touching the device:** confirm the email/password embedded in
   that build's env (`VITE_DEV_SUPABASE_EMAIL` / `_PASSWORD`) are the real
   credentials for his Supabase Auth account — these are exactly the
   credentials `LoginPage.vue` needs, just entered through the UI instead
   of an env var.
2. Ship the build with `devAuth.ts` removed (so the stub can no longer
   silently reactivate) but do **not** deploy it to his device yet if step
   3 hasn't been confirmed possible.
3. Coordinate a moment with the brother (or whoever has physical/remote
   access) to open the app, land on `/welcome` → `/login` (now reachable
   since nothing auto-signs him in), and sign in once with the confirmed
   credentials from step 1.
4. Confirm after login that `device.store.ts`'s existing device
   registration/shop resolution still finds his existing shop (it reads
   `shops.owner_user_id = auth.uid()` — same account, same row, so this is
   expected to just work with no data migration).
5. **Rollback plan:** if sign-in fails (e.g. credentials in the old build
   don't actually match what's stored in the deployed environment), keep
   the previous build (with `devAuth.ts` intact) deployable as a fallback
   until the credential mismatch is resolved — do not leave his shop
   unable to log in.

## Testing

- No new automated tests needed for items 1–2 (verification only).
- For item 3: confirm `src/__tests__/features/LoginPage.test.ts` already
  covers the sign-in path the brother's device will now depend on (read,
  don't duplicate). Delete `devAuth.test.ts` since it tests removed code.
- The runbook above **is** the test plan for the live migration — there is
  no way to unit-test a real customer's login without touching production
  credentials, so this step is manual and human-supervised by design.

## Out of scope

- Staff self-signup (owner currently provisions staff; no evidence this is
  a requirement — not raised in brainstorming, not touched here).
- Any change to `VITE_STUB_SHOP_ID` / `VITE_STUB_DEVICE_ID` (developer
  fallback, different code path, not a production auth concern).
- A real password-reset flow (explicitly out of scope per product
  constraints — WhatsApp support is the intended channel).
