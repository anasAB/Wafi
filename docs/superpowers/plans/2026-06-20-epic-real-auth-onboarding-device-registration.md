# Epic — Real Auth, Self-Serve Onboarding & Device Registration

> Date: 2026-06-20
> Status: **Next epic — sequencing confirmed 2026-07-16, before any further premium-pack feature work** (see `2026-07-16-platform-gaps-followups.md` WAFI-068). No new billable features should start until this and the Server-Side Role Enforcement epic ship.
> Pack: **Core** — foundational, not a billable add-on.
> Owner: CTO (dev)
> Sacred Rules touched: Offline-first (1), Arabic + dual currency (2).

> **Reconciliation note (2026-07-16), 4 weeks after drafting:** most of the epic's assumptions still hold, but three things shipped since that change the "surfaces the dev will touch" list below:
> - **Migration `021_provision_shop_on_signup.sql` already implements Decision 2's atomic shop-provisioning trigger** (fires on `auth.users` insert: creates the `shops` row + `owner_user_id` link + default Owner `staff` record). The remaining work is wiring `SignupPage.vue` to real `supabase.auth.signUp` so the trigger actually fires from a UI flow — not building the trigger itself.
> - **`src/data/supabase/devAuth.ts` already calls real `supabase.auth.signInWithPassword`/`signUp`**, gated behind `VITE_DEV_AUTO_SIGNIN`/`VITE_DEV_AUTO_SIGNUP` dev-only flags. The auth-method spike (Decision 1) may be substantially settled already — verify phone-vs-email-as-identifier against what's there before re-spiking from scratch.
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

- [ ] A brand-new owner can sign up, gets an isolated shop, and rings a sale —
      with **zero** manual provisioning (A1–A3).
- [ ] No signup path can leave an account without a shop (A2 + edge cases).
- [ ] Returning owner signs in on a fresh device/browser and syncs (B1–B2).
- [ ] Sign-out works and protects unsynced data (B3).
- [ ] Auth guard blocks unauthenticated access; authenticated users skip login
      (B5).
- [ ] Two devices on one shop ring sales with distinct codes, including one
      registered offline, with no sale-number collision (C1–C4).
- [ ] Account switch on one browser shows no data bleed between shops.
- [ ] Verified end-to-end against a real second pilot account (not just the
      brother's).

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
