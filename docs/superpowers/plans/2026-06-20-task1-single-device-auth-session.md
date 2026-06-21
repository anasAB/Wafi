# Task 1 — Single-Device Authenticated Session (PWA: browser + installed)

> Date: 2026-06-20
> Owner: CTO (dev)
> Priority: **P0** — blocks the customer #0 (brother) trip rollout.
> Goal of the trip: brother opens Wafi, is already signed in, rings real sales daily, sales sync to the cloud and survive going offline.

---

## Problem

A production build has no authentication. `bootstrapDevAuth()` hard-returns on
`import.meta.env.PROD`, so a prod build mints no Supabase session → the PowerSync
connector's `fetchCredentials()` returns `null` → **nothing syncs**. The
`/login` & `/signup` pages are mockups not wired into the router and do not
authenticate; they are out of scope here.

Wafi is a **PWA**: the same codebase runs in a browser tab *and* as an installed
app, on phone, tablet, or laptop. The Supabase session persists in browser
storage; synced data persists in IndexedDB (PowerSync). Both must survive reloads
and offline use.

## Scope

Make a production build authenticate for **one trusted device/origin** (the
brother's), gated behind an explicit env flag, so the app opens already signed in
with no login screen. A real login route / self-serve signup is a later
sub-project and is NOT part of this task.

---

## User Story

**As** the brother (customer #0) opening Wafi on his device — whether in a browser
tab or as the installed PWA,
**I want** the app to already be signed in when it loads,
**so that** I can ring sales and have them sync to the cloud without ever seeing
a login screen.

---

## Acceptance Criteria

1. **First load, online (browser tab OR installed PWA):** signs in with the
   configured account, connects PowerSync, lands on Home already authenticated —
   no login/onboarding screen.
2. **Reload / reopen with a valid session:** reuses the persisted session (no
   re-sign-in call), works offline immediately. Applies to a browser refresh,
   closing/reopening the tab, and relaunching the installed PWA.
3. **Offline open (prior successful sign-in exists):** opens on the persisted
   session via the cached app shell; POS usable, sales queue locally. No crash,
   no auth error.
4. **Offline open (no session ever stored):** does not crash; stays usable
   local-only and signs in automatically on the next online load.
5. **Token expiry:** access token refreshes silently; user is never bounced to a
   login.
6. **Multiple browser tabs, same origin:** all tabs share the one session;
   opening a second tab does not duplicate-connect, conflict, or sign the user
   out.
7. **Installed PWA and browser tab on the same device/origin:** behave
   identically — same session, same data.
8. **Flag OFF (normal prod build):** with `VITE_DEV_AUTO_SIGNIN` unset,
   auto-sign-in does not run and no credentials are embedded.
9. **Safety signal:** when auto-sign-in runs in a production build, a console
   warning states credentials are embedded / single-device only.
10. **Missing/invalid credentials:** logs a clear warning, stays usable
    local-only — must not crash or hang on a spinner.
11. **PowerSync URL absent:** still signs in (or stays local) without attempting
    to connect; no unhandled error.
12. **Isolation holds:** once signed in, syncs only the brother's shop rows; a
    different account sees none of his data.

## Edge Cases to Cover (do not skip)

- Valid session already present on load → skip the sign-in call.
- Network drops mid-connect → retry transparently; never block the UI.
- **Browser data/storage cleared, incognito/private window, or a different
  browser** → no persisted session → behaves as first load (AC 1): needs network
  to re-sign-in. Document this so it isn't mistaken for a bug.
- Tab killed mid-sale then reopened offline → session restored, draft/sale intact.
- Flag accidentally left on in a public/multi-tenant build → the warning (AC 9)
  is the guardrail; public builds must leave it off.

## Out of Scope

Phone-number login, SMS/OTP, the `/login` & `/signup` mockup pages, sign-out UI,
self-serve signup, multi-device/multi-account on one origin.

---

## Implementation Note for the Dev (the core change)

The blocker lives in `src/data/supabase/bootstrapDevAuth()` (`src/data/supabase/devAuth.ts`):

```
if (import.meta.env.PROD) return   // <-- this is why a prod build never authenticates
```

**What to change:**
- Remove the blanket "return on PROD" so a production build CAN auto-sign-in,
  but ONLY when `VITE_DEV_AUTO_SIGNIN` is explicitly set (it already gates the
  dev path — reuse the same flag as the single opt-in switch).
- When auto-sign-in runs in a production build, emit a clear `console.warn` that
  account credentials are embedded in the build and this is single-device use
  only (AC 9).
- Leave the existing dev behaviour, the credential reads, the sign-in/sign-up
  logic, and the PowerSync `connect()` call as-is — only the PROD guard and the
  warning change.
- Verify the rest of the chain still holds: with no flag set, nothing runs
  (AC 8); the connector's `fetchCredentials()` already returns `null` cleanly
  when there is no session (offline / local-only path — AC 4, 11).

> The dev owns the exact code. This note only fixes the one guard that blocks a
> production session; do not expand scope into a login route.

## Required Configuration (for the dev to document + set on the brother's build)

| Env var | Purpose |
|---|---|
| `VITE_DEV_AUTO_SIGNIN` | Master opt-in. Unset = no auto-sign-in (normal builds). |
| `VITE_DEV_SUPABASE_EMAIL` | Brother's provisioned account email. |
| `VITE_DEV_SUPABASE_PASSWORD` | Brother's account password. |
| `VITE_SUPABASE_URL` | Supabase project URL. |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key. |
| `VITE_POWERSYNC_URL` | PowerSync instance URL. |

> Depends on Task 2 (provision the brother's account + link `shops.owner_user_id`)
> for AC 1 and AC 12 to pass end-to-end.

---

## Definition of Done

- [ ] Prod build, in a browser tab AND as installed PWA, opens signed in and
      syncs (AC 1, 7).
- [ ] Reload / reopen reuses the session; offline open works on persisted
      session (AC 2–3).
- [ ] Multiple tabs share one session cleanly (AC 6).
- [ ] Flag-off prod build performs no auto-sign-in (AC 8).
- [ ] Invalid creds / no network / cleared storage degrade gracefully, never
      crash (AC 4, 10, 11).
- [ ] Verified: a second test account sees none of his rows (AC 12).
- [ ] Config documented in the repo (table above).
