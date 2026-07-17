# Epic — Real Auth, Self-Serve Onboarding & Device Registration

> Date: 2026-06-20
> Status: **Wiring shipped 2026-07-17 on branch `worktree-real-auth-wiring`** (`docs/superpowers/plans/2026-07-16-real-auth-wiring.md`, Tasks 1-9 complete, task-reviewed, full automated suite green). SMS/OTP remains explicitly out of scope per Decision 1. **Not yet done:** end-to-end verification against a real second pilot account (DoD's last item) — this requires a live Supabase session and browser interaction that wasn't performed in this pass; do this before closing the epic. No new billable features should start until this (pending manual verification) and the Server-Side Role Enforcement epic ship.
> Pack: **Core** — foundational, not a billable add-on.
> Owner: CTO (dev)
> Sacred Rules touched: Offline-first (1), Arabic + dual currency (2).

> **Reconciliation note (2026-07-16), 4 weeks after drafting:** most of the epic's assumptions still hold, but three things shipped since that change the "surfaces the dev will touch" list below:
> - **Migration `021_provision_shop_on_signup.sql` already implements Decision 2's atomic shop-provisioning trigger** (fires on `auth.users` insert: creates the `shops` row + `owner_user_id` link only — the migration's own comment is explicit that the owner `staff` row + PIN are deliberately **not** created here; that stays the existing `/setup-owner` flow's job). The trigger reads `raw_user_meta_data ->> 'shop_name'/'business_type'/'country'`, so `supabase.auth.signUp()` must pass those three as `options.data` for the shop to get a real name/type/country instead of the `'متجري'` fallback. The remaining work is wiring `SignupPage.vue` to call real `supabase.auth.signUp()` with that metadata, then route to `/setup-owner` (not straight to `/onboarding`) — not building the trigger itself.
> - **`src/data/supabase/auth.ts` already implements Decision 1 in full**, not just a spike: `signUpOwner()`/`signIn()`/`signOut()`/`verifyAccountPassword()`, phone → synthetic-email mapping (`phoneToEmail()`, domain `wafi.app`), and structured `AuthOutcome`/`AuthFailureReason` error classification (duplicate/offline/invalid_credentials/weak_password). **It is currently used only by `PinRecovery.vue`** (for `verifyAccountPassword`, a different flow — PIN reset, not account signup/login). `signUpOwner`/`signIn`/`signOut` have **zero callers** — `SignupPage.vue`'s `finish()` and `LoginPage.vue`'s `submit()` still just `await new Promise(r => setTimeout(...))` and navigate, and Settings' sign-out button is `disabled` with a "coming soon" badge (`PersonalPreferencesScreen.vue:161-167`). **The remaining Real Auth work is wiring existing service functions into UI + router, not designing or building the auth backend** — `src/data/supabase/devAuth.ts` (the separate single-device dev-auto-signin helper) is unrelated legacy and should not be confused with `auth.ts`.
> - Also unaddressed: no `router.beforeEach` checks for an authenticated Supabase session at all today (the existing guard only checks staff-PIN permission + open-shift state); no PowerSync local-DB clear happens on `SIGNED_OUT`/account switch (`device.store.ts`'s `onAuthStateChange` only resets `shopId`, never calls `db.disconnectAndClear()` or equivalent) — confirms the "account-switch data bleed" edge case is live, not hypothetical.
> - **Bug to fix as part of this epic, not a new discovery:** `shops` is queried directly via `db.getOptional('SELECT id FROM shops WHERE owner_user_id = ?')` in `device.store.ts:38`, but `shops` is **not declared in the PowerSync client `AppSchema`** (`src/data/powersync/schema.ts`). Confirm this table is actually reachable through PowerSync's local SQLite (it may only work today because of a stub/dev fallback) before building signup on top of it — this could be silently broken for any non-stub account.
> - `staff.pin_hash`/`staff.pin_salt` still sync to every client verbatim (`schema.ts:162-166`) — the epic's stated problem (device stub, no real login) is unchanged, but this specific PIN-hash-exposure detail is really the Server-Side Role Enforcement epic's problem (its A2) — don't duplicate the fix here.

---

## Thesis

Today the product can hold exactly **one** shop, provisioned by hand. There is no
working signup, no working login (both pages are unrouted mockups), and device
identity is a hardcoded stub shared by every install. This epic is the gate
between "one shop we set up by hand" and "the pilots from the Syria trip can
onboard themselves and run on more than one device." Until it ships, every new
shop is manual labour and every multi-device shop silently breaks. After it
ships, a shop owner signs up, gets an isolated shop, signs in on any device, and
each device rings sales without colliding.

It builds directly on Task 1 (single-device session) and Task 2 (manual
provisioning) — it **generalises** both: the manual `owner_user_id` link becomes
automatic at signup, and the hardcoded `device_id` becomes a real per-install
registration.

---

## Surfaces the dev will touch (orientation, not instructions)

- `src/pages/SignupPage.vue`, `LoginPage.vue`, `OnboardingPage.vue` — exist as
  mockups; wire to real logic instead of building UI from scratch.
- `src/router/index.ts` — add an auth guard (today it only checks staff PIN).
- `src/data/supabase/devAuth.ts` — auto-sign-in becomes a single-device
  convenience only; real login is the general path.
- `src/store/device.store.ts` — `deviceId`/`deviceCode` stop being env stubs.
- `supabase/migrations/*` — shop auto-provisioning + device allocation.
- `powersync.yaml`, migration 015 (`auth_shop_id()`) — unchanged; they already
  scope on `owner_user_id`.

---

## Key Decisions (PO recommendation — dev confirms feasibility)

1. **Auth identifier = phone number + password, NO SMS OTP for v1.**
   Syrian SMS delivery is unreliable and an SMS provider is a cost/sanctions
   problem we don't want at €100–200/mo. Use phone-as-username with a password
   (Supabase phone provider with confirmation off, or phone keyed via a synthetic
   email — dev's call after a short spike). Email is an **optional** field for
   recovery only. *Reconsider OTP at scale.*
2. **Provisioning is server-side and atomic.** A new account must **never** exist
   without a linked shop (that state silently locks the owner out — see Task 2).
   Recommended: a Postgres trigger on new-user creation that inserts the `shops`
   row, sets `owner_user_id`, and creates the default Owner `staff` record. One
   account = one shop (the unique index already enforces it).
3. **Device codes: server-allocated permanent (A, B, C…), temporary offline
   (T-xxxx), reconciled on sync.** Matches the Epic 1 design. Prevents two devices
   ever sharing a code (which would collide sale numbers).
4. **Password recovery = assisted reset for v1** (owner contacts the helper, who
   resets in the dashboard). Acceptable at 5–15 pilots; note it bends Rule #9
   ("no feature should require calling the customer") and must be revisited before
   self-serve scale.

---

## User Stories & Acceptance Criteria

### A — Signup & Provisioning

**A1. As a new shop owner, I can create my account and shop in one flow.**
- Reuses the existing 3-step signup mockup (account → business → start goal).
- Requires identifier + password + shop name + business type + country.
- On success I am signed in and land in the app, ready to use.

**A2. My shop is provisioned automatically and atomically.**
- A `shops` row is created, `owner_user_id` set to my account, a default Owner
  `staff` record created — server-side, in one unit of work.
- I am **never** left with an account but no shop (no silent-lockout state).
- If provisioning fails, signup reports a clear error and does not strand a
  half-created account.

**A3. Onboarding sets up the minimum to start selling.**
- Shop name saved; Owner staff + PIN created so the PIN layer works.
- Sensible defaults applied (e.g. no exchange rate yet → Home prompts to set it,
  per existing Epic 1 behaviour).

### B — Login & Session

**B1. As a returning owner, I can sign in with identifier + password on any
device or browser.**
- Successful sign-in lands on Home with my shop's data syncing.

**B2. My session persists and works offline.**
- Survives reload, tab close/reopen, and PWA relaunch; offline opens on the
  persisted session. (Same behaviour proven in Task 1 AC 2–3 — reference, do not
  rebuild.)

**B3. As a user, I can sign out.**
- Sign-out clears my session and local shop binding and returns me to login.
- **If unsynced sales are queued, sign-out warns me and does not silently drop
  the queue.**

**B4. Forgot password (assisted, v1).**
- A "forgot password" path tells me how to get it reset (assisted flow), in
  Arabic. No dead end.

**B5. Auth guard.**
- An unauthenticated user cannot reach the POS/app screens; they are routed to
  login/signup.
- An already-authenticated user never sees login on open.

**B6. Wrong / missing credentials.**
- Clear Arabic error; no crash, no infinite spinner; I can retry.

### C — Device Registration

**C1. Each device that signs in registers itself and gets a unique code.**
- On first authenticated run, a `devices` row is created (shop, code,
  registered_at) and the real `device_id` replaces the stub.
- Codes are unique per shop (A, B, C…) so sale numbers never collide across
  devices.

**C2. Device identity persists locally.**
- `device_id`/`device_code` survive reload, offline, and PWA relaunch; no env
  stub remains in the running path.

**C3. A second device on the same shop gets a distinct code automatically.**
- No manual setup; device B does not reuse device A's code or sequence.

**C4. Offline first-run does not block the cashier.**
- If a device can't reach the server to claim a permanent code, it uses a unique
  temporary code (T-xxxx) and rings sales immediately; it reconciles to a
  permanent code on next sync without losing or duplicating any sale.

---

## Edge Cases (do not skip)

- **Duplicate signup** (identifier already exists) → clear "account already
  exists — sign in" message, not a generic error.
- **Account exists but has no shop** (interrupted older signup) → on next login,
  detect and complete provisioning (or route to onboarding); never leave the
  owner locked out.
- **Offline signup attempt** → signup needs the server; show "signup needs
  internet," don't fake success.
- **Account switch on the same device/browser** → previous shop's locally-synced
  data must not bleed into the new account; the local DB is re-scoped/cleared on
  account change.
- **Sign-out with pending unsynced writes** → warn; never drop the queue (B3).
- **Two devices register offline at the same time** → temp codes are unique;
  server reconciles to distinct permanent codes; zero sale-number collisions.
- **Token expiry mid-use** → silent refresh; no bounce to login.
- **Staff PIN vs account password** → distinct concepts; never conflate. The
  account password is the shop's cloud login; the PIN is per-operator at the
  register.
- **Multiple shops on one account** → not supported; blocked by the unique index;
  surface a clean message if attempted.

---

## What This Epic Does NOT Include

- SMS / OTP verification (deferred — see Decision 1).
- Multiple shops / branches per account (Warehouse module, v1.5).
- Staff invitations / `shop_members` (the `staff` + PIN layer stays the model).
- Per-device permissions, device naming/management UI (keep registration
  invisible; a management screen is a later nicety).
- Social / Google login.

---

## How It Should Look

- **Signup/login:** the existing mockups, restyled-as-needed, phone-first, Arabic,
  plain language. Strip the fabricated testimonial ("restaurant chain, Jeddah") —
  wrong vertical, wrong country.
- **Onboarding:** the existing 3-step flow, now actually creating the shop.
- **Device registration:** invisible to the user. It just works; the owner never
  thinks about device codes.

---

## Definition of Done

- [x] A brand-new owner can sign up, gets an isolated shop, and rings a sale —
      with **zero** manual provisioning (A1–A3). *(SignupPage wired to
      `signUpOwner()`, routes to `/setup-owner`; migration 021's trigger
      already provisions the shop atomically. Verified by automated tests,
      not yet by a live signup.)*
- [x] No signup path can leave an account without a shop (A2 + edge cases).
      *(Duplicate-account path shows a clear message with a link to
      `/login`, per migration 021 + `auth.ts`'s existing classification;
      unit-tested.)*
- [ ] Returning owner signs in on a fresh device/browser and syncs (B1–B2).
      *(LoginPage wired to `signIn()`, routes to `/`; unit-tested only —
      not yet verified against a live second device/browser.)*
- [x] Sign-out works and protects unsynced data (B3). *(Enabled with an
      unsynced-writes warning via `getUploadQueueStats()`; unit-tested.)*
- [x] Auth guard blocks unauthenticated access; authenticated users skip login
      (B5). *(Session-based `router.beforeEach` guard; unit-tested.)*
- [x] Two devices on one shop ring sales with distinct codes, including one
      registered offline, with no sale-number collision (C1–C4).
      *(`useDeviceRegistration()` + `devices` table/migration 037; permanent
      letter codes via `allocate_device_code`, temp `T-xxxx` fallback offline;
      unit-tested including the concurrent-registration guard. Not yet
      verified with two simultaneous real devices.)*
- [x] Account switch on one browser shows no data bleed between shops.
      *(`device.store.ts`'s `SIGNED_IN` handler calls `disconnectAndClear()` +
      reconnects on a genuine account change; a TOCTOU race between this and
      concurrent `refreshShopId()` calls was found in review and fixed with
      an in-flight guard, plus a discriminating regression test. One
      disclosed, narrower residual gap remains: a `SIGNED_OUT` event racing
      an in-flight `SIGNED_IN` could still reset the switch-detection state
      — recommend a follow-up ticket, not blocking.)*
- [ ] Verified end-to-end against a real second pilot account (not just the
      brother's). **Not done in this pass** — requires `npm run dev` and a
      real throwaway phone number/Supabase session; see Task 10 Step 3 of
      the wiring plan for the exact walkthrough.

---

## Risks

- **Auth-method spike (Decision 1).** Confirm the no-OTP phone+password mechanism
  in Supabase early — it shapes the whole signup flow. Timebox to a day; fall back
  to email+password if phone-as-username proves fiddly.
- **Provisioning atomicity.** A trigger that half-runs is the silent-lockout bug
  in disguise. Test the failure path explicitly.
- **Offline device-code reconciliation.** The temp→permanent handoff is the
  subtle part; prove it with two devices both starting offline.
- **Account-switch data bleed.** PowerSync's local DB persists synced rows; on
  account change it must be cleared, or shop A's data shows under shop B. This is
  a correctness/privacy bug, not cosmetic — test it.
