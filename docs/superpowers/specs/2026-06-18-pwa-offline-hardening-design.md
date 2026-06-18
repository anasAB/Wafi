# PWA & Offline Hardening — Design

- **Date:** 2026-06-18
- **Status:** Approved (brainstorm) → pending spec review
- **Project:** Wafi (Vue 3 + Vite PWA retail-ops PWA)

## Context

A prior change wired `vite-plugin-pwa` into the app: `registerType: 'autoUpdate'`,
an RTL/Arabic `manifest.webmanifest`, a single hand-authored SVG icon
(`public/pwa-icon.svg`), a branded `favicon.svg`, Workbox precache of the built
shell (incl. the PowerSync wa-sqlite WASM), and `registerSW({ immediate: true })`
in `main.ts`. The build emits `sw.js` + workbox and injects the manifest link.

Two layers of "offline" already hold:

1. **App shell** loads offline via the service-worker precache (the PWA wiring).
2. **Data** is offline-first by design: `src/data/powersync/db.ts` runs a local
   SQLite DB; all reads/writes hit it regardless of network, syncing to Supabase
   only when `VITE_POWERSYNC_URL` is set.

What's missing — and what this design covers — is the *hardening* layer: a
first-class install experience, honest network detection, service-worker
lifecycle UX, repeatable verification, real cross-platform icons, and offline
fonts.

### Relevant existing code

- **Sync UI** (`features/sync/useSync.ts`, `components/ui/SyncBadge.vue`,
  `features/dashboard/components/StalenessBar.vue`, `pages/HomePage.vue`) shows an
  "offline" state — but keyed off **PowerSync connection**, not true network.
  In local-only/demo mode (no `VITE_POWERSYNC_URL`) it reads "offline"
  permanently. This is the source of the misleading-signal problem below.
- **Toasts** (`components/ui/AppToast.vue`) are a dumb component: each page keeps
  a local `toast` ref and renders `<AppToast v-if="toast">`. There is no global
  toast service.

## Goal

Harden the PWA across three sequenced phases: **(1) nail the live demo**,
**(2) prove offline actually works**, **(3) make it production-ready**.

## Decisions (from brainstorm)

- **Structure:** Approach A — thin, isolated composables + small components, one
  responsibility each, matching the existing `composables/` + feature layout.
  (Rejected: a centralized `usePwa` grab-bag store; inlining into `App.vue`.)
- **Verification:** manual runbook only. No e2e framework (no Playwright) — keeps
  the vitest-only repo dependency-light.
- **Icons:** add `@vite-pwa/assets-generator` (dev dependency) to generate the
  PNG set from one source SVG.
- **Update UX:** switch silent `autoUpdate` → `prompt` (a POS must not reload
  mid-sale).
- **Offline banner:** ship the `useOnlineStatus` *primitive* now, but **defer the
  visible network banner** to the separate "offline-first data UX" effort, where
  the network signal and the PowerSync sync signal can be reconciled into one
  coherent indicator instead of two competing "offline" messages.

## Non-goals

- No e2e/browser-automation framework.
- No redesign of the sync/queue/conflict/last-synced UX (separate topic).
- No self-hosted font files in this effort (runtime-cache Google Fonts instead).
- No per-customer feature-flag or auth work.

## Architecture (Approach A)

Three independent units, each understandable and testable on its own:

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| `composables/useInstallPrompt.ts` | Capture install eligibility + drive install | `window`/`navigator` events |
| `composables/usePwaLifecycle.ts` | Wrap `registerSW`; expose SW lifecycle state | `virtual:pwa-register` |
| `composables/useOnlineStatus.ts` | True network connectivity primitive | `navigator.onLine`, online/offline events |

UI is kept separate from logic: `components/ui/InstallPrompt.vue` renders the
install affordance; `App.vue` renders shell-level toasts/prompts driven by
`usePwaLifecycle`.

---

## Phase 1 — Demo-critical: install + offline-load

### 1. `useInstallPrompt.ts` + `InstallPrompt.vue`

- The composable registers a `beforeinstallprompt` listener at **module load**
  (not `onMounted`) into a module-scoped ref, so the event is not missed when it
  fires before the component mounts. `preventDefault()`s and stashes the event.
- Exposes: `canInstall` (ref), `isInstalled` (`display-mode: standalone` or
  `appinstalled` fired), `isIosSafari` (UA + not standalone), `promptInstall()`.
- `promptInstall()` calls the stashed event's `prompt()`, awaits `userChoice`,
  then clears the stash and `canInstall`. No-ops if the event is gone.
- Listens for `appinstalled` → `canInstall = false`, `isInstalled = true`.
- `InstallPrompt.vue`: dismissible, branded affordance.
  - Android/Chrome (`canInstall`): a "ثبّت التطبيق" button → `promptInstall()`.
  - iOS Safari (`isIosSafari` && !standalone): a one-line hint
    "للتثبيت: اضغط مشاركة ← إضافة إلى الشاشة الرئيسية" (iOS has no prompt event).
  - Hidden when `isInstalled`.
  - **Placement:** `pages/LandingPage.vue` — the literal "install from a link"
    entry point. Dismissal is session-scoped (a local ref), no persistence.

### 2. `usePwaLifecycle.ts`

- Wraps `registerSW` from `virtual:pwa-register`; exposes `offlineReady` (ref),
  `needRefresh` (ref, used in Phase 3), and `updateServiceWorker()`.
- SW registration **moves out of `main.ts`** into this composable, called from
  `App.vue` so callbacks can drive shell-level UI via the existing
  local-`toast`-ref pattern (no new global toast store).
- Phase 1 surfaces `offlineReady` → `<AppToast>` in `App.vue`:
  "التطبيق جاهز للعمل بدون إنترنت."

### 3. `useOnlineStatus.ts`

- `isOnline` ref initialized from `navigator.onLine`; updates on `online` /
  `offline` events; listeners cleaned up on unmount; guards `window`/`navigator`
  existence. The canonical **network** primitive.
- Phase 1 ships the primitive only. No visible banner yet (see Decisions).

### Error handling
- `promptInstall()` no-ops on a missing/stale event.
- All composables guard global existence and remove listeners on unmount.

### Testing
- `useInstallPrompt`: dispatch a fake `beforeinstallprompt` → `canInstall` true;
  `appinstalled` → `isInstalled` true; `promptInstall()` calls the event.
- `useOnlineStatus`: dispatch `online`/`offline` → `isOnline` flips.
- `usePwaLifecycle`: mock the `virtual:pwa-register` module; assert
  `offlineReady`/`needRefresh` reflect the injected callbacks.

---

## Phase 2 — Prove it works: manual verification runbook

A single committed markdown runbook: `docs/pwa-offline-verification.md`. No code,
no automated tests.

### A. Offline smoke test (run before any demo)
1. `npm run build && npm run preview`; open over `localhost` (secure context —
   the SW will not run otherwise).
2. **Install:** install affordance appears + installs on Android/Chrome; iOS
   "add to home screen" hint shows on iOS Safari.
3. **Offline-ready:** first load surfaces the "جاهز للعمل بدون إنترنت" toast.
4. **Offline load:** DevTools → Network → *Offline* (or airplane mode),
   hard-reload → app boots from cache.
5. **Offline data ops:** record a sale + add an expense → both succeed; close and
   reopen while still offline → data persists (local SQLite).
6. **Recovery:** back online → if `VITE_POWERSYNC_URL` is set, sync runs and
   `pendingCount` drains.

### B. Pre-demo gotchas checklist
- First load **must** be online (SW caches on first visit).
- **Production build only** — `npm run dev` has no SW.
- **Local-only mode:** the sync badge reads "offline" by design; set
  `VITE_POWERSYNC_URL` to demo live sync.
- Fonts fall back to system offline until Phase 3 font caching lands.
- **Demo script:** the exact tap-by-tap sequence for moment #1 (install from
  link) and moment #2 (WiFi off, keep selling).

---

## Phase 3 — Production-ready

### 1. Real icons via `@vite-pwa/assets-generator`
- Add the dev dependency + `pwa-assets.config.ts` using the `minimal-2023`
  preset, sourced from one 512px master SVG (the brand storefront mark).
- Generates `favicon`, `192`/`512` PNG, `512` maskable PNG, `180` apple-touch
  PNG; the plugin auto-injects manifest `icons` + `<link>` tags.
- **Refactor:** removes the manual single-SVG `icons` entry in `vite.config.ts`
  and the hand-added `apple-touch-icon` in `index.html` to avoid duplicate
  declarations. The hand-made SVG becomes the generator's source, not a separate
  output.

### 2. Offline font caching
- Add Workbox `runtimeCaching` (CacheFirst + expiration cap) for
  `fonts.googleapis.com` and `fonts.gstatic.com`, so fonts are cached after the
  first online load. No font files vendored.
- Follow-up noted (not done here): self-hosting Tajawal is more robust (correct
  on the very first paint).

### 3. SW update UX — `autoUpdate` → `prompt`
- Change `registerType` to `'prompt'`. `App.vue` uses `usePwaLifecycle`'s
  `needRefresh` + `updateServiceWorker()` to show a dismissible
  "تحديث متاح — اضغط للتحديث" toast that reloads **only on user tap** — never
  mid-sale.

### 4. Cross-device pass
- Extend the Phase 2 runbook with an install/icon/offline matrix across iOS
  Safari, Android Chrome, and desktop Chrome/Edge.

### Error handling / testing
- Update toast is dismissible and never auto-reloads.
- `runtimeCaching` has expiration + max-entries so the cache cannot grow
  unbounded.
- Unit-test the `usePwaLifecycle` `needRefresh` path (mocked
  `virtual:pwa-register`). Icon generation is build-time, verified via the
  runbook.

---

## File-level change summary

**New**
- `src/composables/useInstallPrompt.ts`
- `src/composables/usePwaLifecycle.ts`
- `src/composables/useOnlineStatus.ts`
- `src/components/ui/InstallPrompt.vue`
- `docs/pwa-offline-verification.md` (Phase 2)
- `pwa-assets.config.ts` (Phase 3)
- Tests: `useInstallPrompt`, `useOnlineStatus`, `usePwaLifecycle`

**Modified**
- `src/main.ts` — remove bare `registerSW`; lifecycle moves to `usePwaLifecycle`.
- `src/App.vue` — call `usePwaLifecycle`; render shell `<AppToast>` only
  (offline-ready in P1, update prompt in P3). `InstallPrompt` is **not** mounted
  here — it lives on `LandingPage`.
- `src/pages/LandingPage.vue` — place `InstallPrompt.vue`.
- `vite.config.ts` — `registerType: 'prompt'` (P3); `runtimeCaching` (P3);
  `pwaAssets` + drop manual `icons` (P3).
- `index.html` — drop manual `apple-touch-icon` once the generator injects it (P3).
- `package.json` — add `@vite-pwa/assets-generator` (P3).

## Sequencing

Phase 1 → 2 → 3, each independently shippable. Phase 1 is demo-critical; Phase 2
depends on Phase 1 existing to test; Phase 3 is post-demo polish. `usePwaLifecycle`
is built in Phase 1 with the `needRefresh`/`updateServiceWorker` surface already
present, so Phase 3's update UX is a wiring + config change, not a rewrite.

## Known caveats / follow-ups

- **Offline banner reconciliation** (separate "offline-first data UX" topic):
  unify `useOnlineStatus` (true network) with the PowerSync-based sync indicators
  so the app shows one coherent offline state.
- **Self-hosted fonts** as a more robust alternative to runtime-caching.
- **iOS** install remains a manual "add to home screen" gesture (no programmatic
  prompt exists on iOS Safari) — the hint addresses this, not eliminates it.
