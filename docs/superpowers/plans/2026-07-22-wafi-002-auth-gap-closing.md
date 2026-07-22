# WAFI-002 Auth Gap-Closing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the `devAuth.ts` production auto-sign-in stub now that real signup/login exists, and produce a runbook for migrating the one live customer (the brother's shop) who currently depends on it.

**Architecture:** This is a deletion, not a build. Remove `src/data/supabase/devAuth.ts` and its call site in `main.ts`, delete its test file, strip the now-dead env vars from `.env.local.example`, and write a standalone runbook document for the manual, human-executed device migration. No new runtime code is introduced.

**Tech Stack:** Vue 3, Vitest, Supabase Auth (`@supabase/supabase-js`).

## Global Constraints

- Never remove or touch `VITE_STUB_SHOP_ID` / `VITE_STUB_DEVICE_ID` / `VITE_STUB_DEVICE_CODE` — these are a separate, still-valid developer-machine fallback in `src/store/device.store.ts`, unrelated to this ticket.
- Do not modify `LoginPage.vue`, `SignupPage.vue`, or any RLS/migration — the spec confirmed these already work correctly; this plan only removes the now-redundant stub around them.
- Every step that changes code must be followed by running the affected test file(s) — this repo's full suite is `npm test` (`vitest run`); prefer scoping to the specific file while iterating.
- Per the design doc (`docs/superpowers/specs/2026-07-22-wafi-002-auth-gap-closing-design.md`), the actual on-device migration of the brother's shop is a manual, human-supervised action — this plan produces the runbook for that, not an automated migration.

---

### Task 1: Remove `bootstrapDevAuth` call from `main.ts`

**Files:**
- Modify: `src/main.ts:11,16`

**Interfaces:**
- Consumes: nothing new.
- Produces: `main.ts` no longer imports or calls `bootstrapDevAuth` — Task 2 deletes the function it would have called.

- [ ] **Step 1: Remove the import and call**

In `src/main.ts`, delete line 11 (`import { bootstrapDevAuth } from './data/supabase/devAuth'`) and line 16 (`void bootstrapDevAuth()`), plus the now-blank line left behind so spacing matches the surrounding style. The file should read:

```ts
import { createApp }   from 'vue'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import PrimeVue from 'primevue/config'
import Aura from '@primeuix/themes/aura'
import { i18n } from './i18n'
import './style.css'
import 'primeicons/primeicons.css'
import App    from './App.vue'
import router from './router'

const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)

createApp(App)
  .use(pinia)
  .use(router)
  .use(i18n)
  .use(PrimeVue, {
    // RTL is wired at the app root via the `dir="rtl"` attribute; PrimeVue
    // components inherit it. No PrimeVue-specific RTL flag is needed in v4.
    theme: {
      preset: Aura,
      options: {
        // Match the app's existing class-based dark mode (`.dark` on <html>)
        // instead of PrimeVue's default `system` so it stays in sync with the
        // app's theme toggle and the `@custom-variant dark` in style.css.
        darkModeSelector: '.dark',
        // Emit PrimeVue's styled-mode CSS into a `primevue` layer ordered
        // before Tailwind's utilities, so Tailwind utility classes can always
        // override component styles.
        cssLayer: {
          name: 'primevue',
          order: 'theme, base, primevue',
        },
      },
    },
  })
  .mount('#app')
```

- [ ] **Step 2: Verify the app still builds/type-checks**

Run: `npm run build` (this repo's `build` script is `vue-tsc -b && vite build` — there is no separate app-level `type-check` script, only `type-check:test` for the test tree)
Expected: no errors referencing `devAuth` or `bootstrapDevAuth`.

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "refactor(wafi-002): remove bootstrapDevAuth call from main.ts"
```

---

### Task 2: Delete `devAuth.ts` and its test file

**Files:**
- Delete: `src/data/supabase/devAuth.ts`
- Delete: `src/__tests__/data/devAuth.test.ts`

**Interfaces:**
- Consumes: Task 1 already removed the only call site, so this file is dead code.
- Produces: nothing — this is a pure deletion. No other file imports from `devAuth.ts` (verified via grep in Task 3below runs after, but confirm here first).

- [ ] **Step 1: Confirm no remaining references**

Run: `grep -rn "devAuth" src/ --include="*.ts" --include="*.vue"`
Expected: no output (Task 1 already removed the only production call site; this confirms nothing else references it before deleting).

- [ ] **Step 2: Delete both files**

```bash
git rm src/data/supabase/devAuth.ts src/__tests__/data/devAuth.test.ts
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS, with the `devAuth` test suite no longer listed (it's deleted, not skipped).

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(wafi-002): delete devAuth.ts stub and its tests

Self-serve login (LoginPage.vue) is proven and covers the sign-in path
this stub used to bypass. No production build has a remaining need for
an auto-sign-in stub once the brother's shop (the one build that relied
on it) migrates to real login — see the WAFI-002 runbook."
```

---

### Task 3: Strip the dead env vars from `.env.local.example`

**Files:**
- Modify: `.env.local.example`

**Interfaces:**
- Consumes: nothing.
- Produces: a documentation-only change — no runtime code reads these vars anymore after Task 2.

- [ ] **Step 1: Remove the dead var block**

In `.env.local.example`, delete this block (currently lines 7–19):

```
# Single-device auto sign-in (Task 1). Master opt-in: when set, the app signs in
# with the account below on load — in dev AND in a production build — so the
# device opens already authenticated with no login screen. This EMBEDS the
# credentials in the build, so enable it ONLY on one trusted, dedicated device
# (e.g. customer #0's). A production build with this ON logs a console warning.
# Leave UNSET/false for every normal or public/multi-tenant build.
VITE_DEV_AUTO_SIGNIN=false
# Optional: if sign-in fails with invalid-credentials, auto-create the account.
VITE_DEV_AUTO_SIGNUP=false
# The provisioned account that the device signs in as (see Task 2 — the account
# must own a shops row via shops.owner_user_id for sync + isolation to work).
VITE_DEV_SUPABASE_EMAIL=
VITE_DEV_SUPABASE_PASSWORD=

```

The file's remaining content (comment header, `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`, `VITE_POWERSYNC_URL`, and the `VITE_STUB_*` block) stays exactly as-is:

```
# Copy to .env.local and fill in values from your Supabase + PowerSync dashboards.
# NEVER commit .env.local to git.

VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

# PowerSync instance URL. Required for the device to sync to the cloud; leave
# blank to run offline-only against local SQLite (the app still signs in).
VITE_POWERSYNC_URL=

# Epic 1 stub identity — replaced by real auth in a later epic
VITE_STUB_SHOP_ID=00000000-0000-0000-0000-000000000001
VITE_STUB_DEVICE_ID=00000000-0000-0000-0000-000000000002
VITE_STUB_DEVICE_CODE=A
```

- [ ] **Step 2: Confirm no other doc references the removed vars**

Run: `grep -rln "VITE_DEV_AUTO_SIGNIN\|VITE_DEV_AUTO_SIGNUP\|VITE_DEV_SUPABASE_EMAIL\|VITE_DEV_SUPABASE_PASSWORD" --include="*.md" --include="*.example" .`
Expected: no output other than this plan and the design doc themselves (which document history, not live config — leave those untouched).

- [ ] **Step 3: Commit**

```bash
git add .env.local.example
git commit -m "docs(wafi-002): remove dead VITE_DEV_AUTO_SIGNIN env vars"
```

---

### Task 4: Write the customer #0 migration runbook

**Files:**
- Create: `docs/superpowers/plans/2026-07-22-wafi-002-customer0-login-migration-runbook.md`

**Interfaces:**
- Consumes: nothing — this is a standalone operational document, not code.
- Produces: the step-by-step human runbook referenced by the design doc's "Rollout runbook" section.

- [ ] **Step 1: Write the runbook**

Create `docs/superpowers/plans/2026-07-22-wafi-002-customer0-login-migration-runbook.md` with this content:

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-07-22-wafi-002-customer0-login-migration-runbook.md
git commit -m "docs(wafi-002): add customer #0 login migration runbook"
```

---

### Task 5: Final verification pass

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS, no failures, no reference to `devAuth` anywhere in the output.

- [ ] **Step 2: Run the type checker**

Run: `npm run build` (app build, includes `vue-tsc -b`) and `npm run type-check:test` (test-tree type-check).
Expected: both exit 0, no errors.

- [ ] **Step 3: Confirm the stub is fully gone from the tree**

Run: `grep -rn "devAuth\|VITE_DEV_AUTO_SIGNIN\|VITE_DEV_AUTO_SIGNUP\|VITE_DEV_SUPABASE" src/ .env.local.example`
Expected: no output.

- [ ] **Step 4: No commit needed** — this task is verification only; if any check fails, return to the relevant earlier task and fix it there.
