# PWA & Offline Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the already-wired PWA so it installs cleanly, signals offline-readiness, exposes a true network primitive, is verifiably offline-capable, and ships production icons + offline fonts + a safe update flow.

**Architecture:** Three isolated composables (`useInstallPrompt`, `usePwaLifecycle`, `useOnlineStatus`) with one responsibility each, plus a small `InstallPrompt.vue`. UI is kept out of the composables: `App.vue` renders shell-level toasts driven by `usePwaLifecycle`; `LandingPage.vue` hosts the install affordance. Delivered in three phases (demo → verification → production).

**Tech Stack:** Vue 3 (`<script setup>` composition API), Vite + `vite-plugin-pwa` (1.3.0, already installed), Workbox (via the plugin), Vitest + `@vue/test-utils`, `@vite-pwa/assets-generator` (added in Phase 3).

## Global Constraints

- **No new runtime dependencies.** The only new dependency permitted is the dev-only `@vite-pwa/assets-generator` (Phase 3, Task 8).
- **Composition API only**, matching `src/composables/*` and `src/features/**/composables/*` patterns.
- **UI strings are hardcoded Arabic**, consistent with the rest of the not-yet-migrated app. Use the exact strings given in each task verbatim.
- **All listeners guard global existence** (`typeof window/navigator !== 'undefined'`) and are removed on unmount.
- **Tests:** Vitest + `@vue/test-utils`. The global setup (`src/__tests__/setup.ts`) already registers i18n + PrimeVue, so no per-test plugin wiring is needed.
- **Commits:** end every commit message with the trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **Verification baseline:** `npx vitest run` is green (320 tests) and `npm run build` exits 0 before this plan starts. Keep both green after every task.

---

## File Structure

**New files**
- `src/composables/useOnlineStatus.ts` — reactive `navigator.onLine` primitive.
- `src/composables/useInstallPrompt.ts` — install eligibility + `promptInstall()`.
- `src/composables/usePwaLifecycle.ts` — wraps `registerSW`, exposes SW lifecycle refs.
- `src/components/ui/InstallPrompt.vue` — install affordance UI.
- `src/__tests__/composables/useOnlineStatus.test.ts`
- `src/__tests__/composables/useInstallPrompt.test.ts`
- `src/__tests__/composables/usePwaLifecycle.test.ts`
- `src/__tests__/components/InstallPrompt.test.ts`
- `docs/pwa-offline-verification.md` — manual runbook (Phase 2).
- `pwa-assets.config.ts` — icon generation config (Phase 3).

**Modified files**
- `src/main.ts` — remove the bare `registerSW` call (moves to `usePwaLifecycle`).
- `src/App.vue` — call `usePwaLifecycle`; render shell `<AppToast>`s.
- `src/pages/LandingPage.vue` — mount `InstallPrompt.vue`.
- `src/components/ui/AppToast.vue` — add optional action button (Phase 3).
- `vite.config.ts` — `registerType: 'prompt'`, font `runtimeCaching`, `pwaAssets` (Phase 3).
- `index.html` — drop the manual `apple-touch-icon` link (Phase 3).

---

# Phase 1 — Demo-critical: install + offline-load

### Task 1: `useOnlineStatus` — true network primitive

**Files:**
- Create: `src/composables/useOnlineStatus.ts`
- Test: `src/__tests__/composables/useOnlineStatus.test.ts`

**Interfaces:**
- Produces: `useOnlineStatus(): { isOnline: Ref<boolean> }`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/composables/useOnlineStatus.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { useOnlineStatus } from '@/composables/useOnlineStatus'

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value })
}

const Harness = {
  setup() { return useOnlineStatus() },
  template: '<span>{{ isOnline }}</span>',
}

afterEach(() => setOnline(true))

describe('useOnlineStatus', () => {
  it('initializes from navigator.onLine', () => {
    setOnline(false)
    const w = mount(Harness)
    expect(w.text()).toBe('false')
  })

  it('flips to false on an offline event and back on online', async () => {
    setOnline(true)
    const w = mount(Harness)
    expect(w.text()).toBe('true')

    setOnline(false)
    window.dispatchEvent(new Event('offline'))
    await w.vm.$nextTick()
    expect(w.text()).toBe('false')

    setOnline(true)
    window.dispatchEvent(new Event('online'))
    await w.vm.$nextTick()
    expect(w.text()).toBe('true')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/composables/useOnlineStatus.test.ts`
Expected: FAIL — cannot resolve `@/composables/useOnlineStatus`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/composables/useOnlineStatus.ts
import { ref, onMounted, onUnmounted } from 'vue'

/**
 * Reactive TRUE network connectivity (navigator.onLine), deliberately distinct
 * from PowerSync sync status — which reads "offline" whenever the sync server
 * isn't connected (e.g. local-only mode), even with a live network.
 */
export function useOnlineStatus() {
  const isOnline = ref(typeof navigator !== 'undefined' ? navigator.onLine : true)

  function update() { isOnline.value = navigator.onLine }

  onMounted(() => {
    if (typeof window === 'undefined') return
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
  })
  onUnmounted(() => {
    if (typeof window === 'undefined') return
    window.removeEventListener('online', update)
    window.removeEventListener('offline', update)
  })

  return { isOnline }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/composables/useOnlineStatus.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/composables/useOnlineStatus.ts src/__tests__/composables/useOnlineStatus.test.ts
git commit -m "feat(pwa): add useOnlineStatus network primitive

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `useInstallPrompt` — install eligibility + prompt

**Files:**
- Create: `src/composables/useInstallPrompt.ts`
- Test: `src/__tests__/composables/useInstallPrompt.test.ts`

**Interfaces:**
- Produces: `useInstallPrompt(): { canInstall: ComputedRef<boolean>; isInstalled: ComputedRef<boolean>; isIosSafari: boolean; promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> }`

**Note on module-level capture:** `beforeinstallprompt` can fire before any component mounts, so the listener is registered at module load into module-scoped refs. The test isolates this with `vi.resetModules()` + dynamic `import()` per test.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/composables/useInstallPrompt.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'

function fireBeforeInstallPrompt() {
  const e = new Event('beforeinstallprompt') as any
  e.prompt = vi.fn().mockResolvedValue(undefined)
  e.userChoice = Promise.resolve({ outcome: 'accepted' })
  window.dispatchEvent(e)
  return e
}

async function freshComposable() {
  vi.resetModules()
  const mod = await import('@/composables/useInstallPrompt')
  return mod.useInstallPrompt
}

beforeEach(() => vi.resetModules())

describe('useInstallPrompt', () => {
  it('canInstall is false until beforeinstallprompt fires', async () => {
    const useInstallPrompt = await freshComposable()
    const Harness = { setup: () => useInstallPrompt(), template: '<span>{{ canInstall }}</span>' }
    const w = mount(Harness)
    expect(w.text()).toBe('false')
  })

  it('captures beforeinstallprompt and promptInstall resolves to the outcome', async () => {
    const { useInstallPrompt } = await import('@/composables/useInstallPrompt')
    const evt = fireBeforeInstallPrompt()
    const api = useInstallPrompt()
    expect(api.canInstall.value).toBe(true)

    const outcome = await api.promptInstall()
    expect(evt.prompt).toHaveBeenCalled()
    expect(outcome).toBe('accepted')
    expect(api.canInstall.value).toBe(false)
  })

  it('promptInstall returns "unavailable" with no stashed event', async () => {
    const { useInstallPrompt } = await import('@/composables/useInstallPrompt')
    const api = useInstallPrompt()
    expect(await api.promptInstall()).toBe('unavailable')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/composables/useInstallPrompt.test.ts`
Expected: FAIL — cannot resolve `@/composables/useInstallPrompt`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/composables/useInstallPrompt.ts
import { ref, computed } from 'vue'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// Module-scoped so the event is captured even when it fires before the
// component using this composable mounts.
const deferredPrompt = ref<BeforeInstallPromptEvent | null>(null)
const installed = ref(false)

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt.value = e as BeforeInstallPromptEvent
  })
  window.addEventListener('appinstalled', () => {
    installed.value = true
    deferredPrompt.value = null
  })
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
}

function detectIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) && /WebKit/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)
}

export function useInstallPrompt() {
  const canInstall  = computed(() => deferredPrompt.value !== null && !installed.value)
  const isInstalled = computed(() => installed.value || isStandalone())
  const isIosSafari = detectIosSafari() && !isStandalone()

  async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    const evt = deferredPrompt.value
    if (!evt) return 'unavailable'
    await evt.prompt()
    const { outcome } = await evt.userChoice
    deferredPrompt.value = null
    return outcome
  }

  return { canInstall, isInstalled, isIosSafari, promptInstall }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/composables/useInstallPrompt.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/composables/useInstallPrompt.ts src/__tests__/composables/useInstallPrompt.test.ts
git commit -m "feat(pwa): add useInstallPrompt composable

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `InstallPrompt.vue` + mount on the landing page

**Files:**
- Create: `src/components/ui/InstallPrompt.vue`
- Test: `src/__tests__/components/InstallPrompt.test.ts`
- Modify: `src/pages/LandingPage.vue`

**Interfaces:**
- Consumes: `useInstallPrompt()` (Task 2).
- Produces: `<InstallPrompt />` — no props, no emits.

- [ ] **Step 1: Write the failing test** (mock the composable to isolate render logic)

```ts
// src/__tests__/components/InstallPrompt.test.ts
import { describe, it, expect, vi } from 'vitest'
import { ref, computed } from 'vue'
import { mount } from '@vue/test-utils'

const state = {
  canInstall:  ref(false),
  isIosSafari: false,
  promptInstall: vi.fn().mockResolvedValue('accepted'),
}
vi.mock('@/composables/useInstallPrompt', () => ({
  useInstallPrompt: () => ({
    canInstall:  computed(() => state.canInstall.value),
    isInstalled: computed(() => false),
    isIosSafari: state.isIosSafari,
    promptInstall: state.promptInstall,
  }),
}))

import InstallPrompt from '@/components/ui/InstallPrompt.vue'

describe('InstallPrompt', () => {
  it('renders nothing when not installable and not iOS', () => {
    state.canInstall.value = false; state.isIosSafari = false
    const w = mount(InstallPrompt)
    expect(w.find('[data-testid="install-btn"]').exists()).toBe(false)
    expect(w.find('[data-testid="install-hint"]').exists()).toBe(false)
  })

  it('shows the install button and calls promptInstall on click', async () => {
    state.canInstall.value = true; state.isIosSafari = false
    const w = mount(InstallPrompt)
    await w.find('[data-testid="install-btn"]').trigger('click')
    expect(state.promptInstall).toHaveBeenCalled()
  })

  it('shows the iOS hint instead of the button on iOS Safari', () => {
    state.canInstall.value = false; state.isIosSafari = true
    const w = mount(InstallPrompt)
    expect(w.find('[data-testid="install-hint"]').exists()).toBe(true)
    expect(w.find('[data-testid="install-btn"]').exists()).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/components/InstallPrompt.test.ts`
Expected: FAIL — cannot resolve `@/components/ui/InstallPrompt.vue`.

- [ ] **Step 3: Write minimal implementation**

```vue
<!-- src/components/ui/InstallPrompt.vue -->
<script setup lang="ts">
import { ref } from 'vue'
import { useInstallPrompt } from '@/composables/useInstallPrompt'

const { canInstall, isIosSafari, promptInstall } = useInstallPrompt()
const dismissed = ref(false)

async function onInstall() {
  await promptInstall()
}
</script>

<template>
  <div v-if="!dismissed && (canInstall || isIosSafari)" class="install-prompt" dir="rtl">
    <button
      v-if="canInstall"
      type="button"
      data-testid="install-btn"
      class="install-btn"
      @click="onInstall"
    >ثبّت التطبيق</button>
    <p v-else data-testid="install-hint" class="install-hint">
      للتثبيت: اضغط مشاركة ← إضافة إلى الشاشة الرئيسية
    </p>
    <button
      type="button"
      class="install-dismiss"
      aria-label="إغلاق"
      @click="dismissed = true"
    >×</button>
  </div>
</template>

<style scoped>
.install-prompt {
  display: flex; align-items: center; gap: 10px;
  margin-top: 14px; padding: 10px 14px;
  background: rgba(26,86,219,0.10);
  border: 1px solid rgba(26,86,219,0.30);
  border-radius: 12px;
  font-family: 'Tajawal', system-ui, sans-serif;
}
.install-btn {
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  color: #fff; border: none; border-radius: 10px;
  padding: 8px 16px; font-weight: 700; font-size: 14px; cursor: pointer;
}
.install-hint { color: #C8D5E8; font-size: 13px; flex: 1; }
.install-dismiss {
  margin-inline-start: auto; background: transparent; border: none;
  color: #637285; font-size: 18px; cursor: pointer; line-height: 1;
}
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/components/InstallPrompt.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Mount on the landing page**

In `src/pages/LandingPage.vue`, add the import to `<script setup>`:

```ts
import InstallPrompt from '@/components/ui/InstallPrompt.vue'
```

Then place it directly after the hero buttons block. Find:

```html
            <button type="button" class="lp-btn-ghost">شاهد العرض / Watch Demo</button>
          </div>
```

and insert the component right after that closing `</div>`:

```html
            <button type="button" class="lp-btn-ghost">شاهد العرض / Watch Demo</button>
          </div>
          <InstallPrompt />
```

- [ ] **Step 6: Verify the landing page still renders**

Run: `npx vitest run src/__tests__/pages/LandingPage.test.ts`
Expected: PASS (all existing landing tests still green).

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/InstallPrompt.vue src/__tests__/components/InstallPrompt.test.ts src/pages/LandingPage.vue
git commit -m "feat(pwa): add InstallPrompt affordance on landing page

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `usePwaLifecycle` + offline-ready toast in the shell

**Files:**
- Create: `src/composables/usePwaLifecycle.ts`
- Test: `src/__tests__/composables/usePwaLifecycle.test.ts`
- Modify: `src/main.ts` (remove bare `registerSW`)
- Modify: `src/App.vue` (call composable, render offline-ready toast)

**Interfaces:**
- Consumes: `virtual:pwa-register` `registerSW`.
- Produces: `usePwaLifecycle(): { offlineReady: Ref<boolean>; needRefresh: Ref<boolean>; applyUpdate(): void; dismissOfflineReady(): void; dismissNeedRefresh(): void }`

- [ ] **Step 1: Write the failing test** (mock `virtual:pwa-register`, capture its callbacks)

```ts
// src/__tests__/composables/usePwaLifecycle.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const captured: { onOfflineReady?: () => void; onNeedRefresh?: () => void } = {}
const updateSpy = vi.fn()

vi.mock('virtual:pwa-register', () => ({
  registerSW: (opts: any) => {
    captured.onOfflineReady = opts.onOfflineReady
    captured.onNeedRefresh  = opts.onNeedRefresh
    return updateSpy
  },
}))

import { usePwaLifecycle } from '@/composables/usePwaLifecycle'

beforeEach(() => { updateSpy.mockClear() })

describe('usePwaLifecycle', () => {
  it('flips offlineReady when the SW reports offline-ready', () => {
    const api = usePwaLifecycle()
    expect(api.offlineReady.value).toBe(false)
    captured.onOfflineReady?.()
    expect(api.offlineReady.value).toBe(true)
    api.dismissOfflineReady()
    expect(api.offlineReady.value).toBe(false)
  })

  it('flips needRefresh and applyUpdate triggers a reloading update', () => {
    const api = usePwaLifecycle()
    captured.onNeedRefresh?.()
    expect(api.needRefresh.value).toBe(true)
    api.applyUpdate()
    expect(updateSpy).toHaveBeenCalledWith(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/composables/usePwaLifecycle.test.ts`
Expected: FAIL — cannot resolve `@/composables/usePwaLifecycle`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/composables/usePwaLifecycle.ts
import { ref } from 'vue'
import { registerSW } from 'virtual:pwa-register'

/**
 * Wraps the service-worker registration and exposes its lifecycle as reactive
 * refs the app shell renders UI from. `needRefresh`/`applyUpdate` only do
 * anything once vite.config uses registerType 'prompt' (Phase 3); under
 * 'autoUpdate' only `offlineReady` fires.
 */
export function usePwaLifecycle() {
  const offlineReady = ref(false)
  const needRefresh  = ref(false)

  const updateServiceWorker = registerSW({
    immediate: true,
    onOfflineReady() { offlineReady.value = true },
    onNeedRefresh()  { needRefresh.value = true },
  })

  function applyUpdate() { void updateServiceWorker(true) }
  function dismissOfflineReady() { offlineReady.value = false }
  function dismissNeedRefresh()  { needRefresh.value = false }

  return { offlineReady, needRefresh, applyUpdate, dismissOfflineReady, dismissNeedRefresh }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/composables/usePwaLifecycle.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Remove the bare registration from `main.ts`**

In `src/main.ts`, delete these lines (added in the prior PWA step):

```ts
import { registerSW } from 'virtual:pwa-register'
```

and:

```ts
// Register the service worker so the app is installable ("add to home screen")
// and boots offline. `immediate` registers on load; `autoUpdate` (vite.config)
// swaps in new builds without a prompt.
registerSW({ immediate: true })
```

(The registration now happens inside `usePwaLifecycle`, called from `App.vue`.)

- [ ] **Step 6: Wire the composable + offline-ready toast into `App.vue`**

In `src/App.vue` `<script setup>`, add imports and the call alongside the existing ones:

```ts
import AppToast from '@/components/ui/AppToast.vue'
import { usePwaLifecycle } from '@/composables/usePwaLifecycle'

// Destructure only what Phase 1 uses (tsconfig has noUnusedLocals: true).
// Task 6 expands this to add needRefresh/applyUpdate/dismissNeedRefresh.
const { offlineReady, dismissOfflineReady } = usePwaLifecycle()
```

In the template, add the toast as the first child inside the outer `<template>` wrapper, immediately before the `v-if="!appReady"` splash `<div>` (Vue 3 allows multiple root nodes):

```html
  <AppToast
    v-if="offlineReady"
    type="success"
    message="التطبيق جاهز للعمل بدون إنترنت"
    @dismiss="dismissOfflineReady"
  />
```

- [ ] **Step 7: Verify build + full suite**

Run: `npm run build`
Expected: exit 0 (vue-tsc clean — `virtual:pwa-register` types resolve via `src/vite-env.d.ts`).

Run: `npx vitest run`
Expected: PASS — full suite green (prior 320 + the new composable/component tests).

- [ ] **Step 8: Commit**

```bash
git add src/composables/usePwaLifecycle.ts src/__tests__/composables/usePwaLifecycle.test.ts src/main.ts src/App.vue
git commit -m "feat(pwa): surface SW offline-ready via usePwaLifecycle in shell

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

# Phase 2 — Prove it works: manual verification runbook

### Task 5: Write the offline verification runbook

**Files:**
- Create: `docs/pwa-offline-verification.md`

This task is documentation only — no code, no automated test. Its deliverable is the runbook itself.

- [ ] **Step 1: Create the runbook with this exact content**

````markdown
# PWA Offline Verification Runbook

Manual procedure to confirm the app installs and works offline. Run section A
before any demo; keep section B handy so nothing surprises you live.

## A. Offline smoke test

1. Build and serve the production bundle (the service worker does NOT run in
   `npm run dev`):
   ```bash
   npm run build && npm run preview
   ```
   Open the printed `http://localhost:<port>` URL (localhost is a secure context,
   so the SW registers).
2. **Install:**
   - Android/Chrome or desktop Chrome/Edge: the "ثبّت التطبيق" affordance appears
     on the landing page; click it → the browser install dialog appears → install.
   - iOS Safari: the "للتثبيت: اضغط مشاركة ← إضافة إلى الشاشة الرئيسية" hint
     appears (iOS has no programmatic install prompt).
3. **Offline-ready:** on the first load, the toast "التطبيق جاهز للعمل بدون
   إنترنت" appears once caching completes.
4. **Offline load:** open DevTools → Network → set **Offline** (or enable airplane
   mode). Hard-reload. The app boots from cache.
5. **Offline data ops:** record a sale and add an expense — both succeed. Close
   and reopen the tab while still offline — the data persists (local SQLite).
6. **Recovery:** set the network back **Online**. If `VITE_POWERSYNC_URL` is set,
   sync runs and the pending count drains.

## B. Pre-demo gotchas

- **First load must be online** — the SW can only cache after one successful
  online visit. A cold first launch with no network will not work.
- **Production build only** — `npm run dev` has no service worker.
- **Local-only mode** — with no `VITE_POWERSYNC_URL`, the sync badge reads
  "غير متصل" by design (it tracks the sync server, not the network). Set the URL
  to demo live sync.
- **Fonts** fall back to system fonts offline until font caching ships
  (Phase 3); the UI still works, it just isn't pixel-identical.

## C. Demo script

**Moment #1 — "install from a link":** open the link on the device → tap
"ثبّت التطبيق" (or Share → Add to Home Screen on iOS) → launch from the home
screen icon (standalone, no browser chrome).

**Moment #2 — "works without internet":** with the app open, turn off WiFi →
record a sale → it completes instantly → point out nothing failed → turn WiFi
back on.

## D. Cross-device matrix (filled in during Phase 3)

| Platform        | Install | Icon correct | Offline load | Offline sale |
|-----------------|---------|--------------|--------------|--------------|
| Android Chrome  |         |              |              |              |
| iOS Safari      |         |              |              |              |
| Desktop Chrome  |         |              |              |              |
| Desktop Edge    |         |              |              |              |
````

- [ ] **Step 2: Commit**

```bash
git add docs/pwa-offline-verification.md
git commit -m "docs(pwa): add offline verification runbook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

# Phase 3 — Production-ready

### Task 6: Safe update flow — `prompt` + update toast

**Files:**
- Modify: `src/components/ui/AppToast.vue` (add optional action button)
- Test: `src/__tests__/components/AppToastAction.test.ts`
- Modify: `vite.config.ts` (`registerType: 'autoUpdate'` → `'prompt'`)
- Modify: `src/App.vue` (expand the `usePwaLifecycle` destructure + render the update toast)

**Interfaces:**
- `AppToast` gains optional prop `actionLabel?: string` and emit `(e: 'action'): void`. Existing usages omit `actionLabel` and are unaffected.

- [ ] **Step 1: Write the failing test for the AppToast action**

```ts
// src/__tests__/components/AppToastAction.test.ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AppToast from '@/components/ui/AppToast.vue'

describe('AppToast action button', () => {
  it('renders no action button by default', () => {
    const w = mount(AppToast, { props: { message: 'hi' } })
    expect(w.find('[data-testid="toast-action"]').exists()).toBe(false)
  })

  it('renders the action button and emits "action" on click', async () => {
    const w = mount(AppToast, { props: { message: 'hi', actionLabel: 'تحديث' } })
    const btn = w.find('[data-testid="toast-action"]')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toBe('تحديث')
    await btn.trigger('click')
    expect(w.emitted('action')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/components/AppToastAction.test.ts`
Expected: FAIL — no `[data-testid="toast-action"]` element.

- [ ] **Step 3: Add the optional action to `AppToast.vue`**

Change the props/emits in `<script setup>`:

```ts
const props = defineProps<{ message: string; type?: 'info' | 'error' | 'success'; actionLabel?: string }>()
const emit  = defineEmits<{ (e: 'dismiss'): void; (e: 'action'): void }>()
```

In the template, add the action button inside `.toast-inner`, before the close button:

```html
      <button
        v-if="props.actionLabel"
        type="button"
        data-testid="toast-action"
        class="toast-action"
        @click="emit('action')"
      >{{ props.actionLabel }}</button>
      <button
        type="button"
        class="toast-close"
        aria-label="إغلاق"
        @click="emit('dismiss')"
      >×</button>
```

Add the style inside `<style scoped>`:

```css
.toast-action {
  flex-shrink: 0;
  background: rgba(255,255,255,0.12);
  border: 1px solid rgba(255,255,255,0.20);
  color: inherit;
  border-radius: 0.5rem;
  padding: 4px 12px;
  font-family: 'Tajawal', system-ui, sans-serif;
  font-size: 0.8125rem; font-weight: 700;
  cursor: pointer;
}
.toast-action:hover { background: rgba(255,255,255,0.18); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/components/AppToastAction.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Switch the SW to prompt mode**

In `vite.config.ts`, change:

```ts
      registerType: 'autoUpdate',
```

to:

```ts
      registerType: 'prompt',
```

- [ ] **Step 6: Render the update toast in `App.vue`**

Expand the Task 4 destructure to pull the update-related members:

```ts
const { offlineReady, dismissOfflineReady, needRefresh, applyUpdate, dismissNeedRefresh } = usePwaLifecycle()
```

Add the update toast right after the offline-ready toast:

```html
  <AppToast
    v-if="needRefresh"
    type="info"
    message="تحديث متاح"
    action-label="تحديث"
    @action="applyUpdate"
    @dismiss="dismissNeedRefresh"
  />
```

- [ ] **Step 7: Verify build + full suite**

Run: `npm run build`
Expected: exit 0; PWA reports `mode generateSW`.

Run: `npx vitest run`
Expected: full suite green.

- [ ] **Step 8: Commit**

```bash
git add src/components/ui/AppToast.vue src/__tests__/components/AppToastAction.test.ts vite.config.ts src/App.vue
git commit -m "feat(pwa): prompt-based SW updates with a non-blocking update toast

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Offline font caching

**Files:**
- Modify: `vite.config.ts` (add `workbox.runtimeCaching` for Google Fonts)

This task has no unit test; its deliverable is verified by inspecting the built service worker.

- [ ] **Step 1: Add runtimeCaching to the workbox config**

In `vite.config.ts`, inside the existing `workbox: { ... }` block, add a `runtimeCaching` array alongside the existing keys:

```ts
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-stylesheets',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
```

- [ ] **Step 2: Build and verify the rule is compiled into the SW**

Run: `npm run build`
Expected: exit 0.

Run: `grep -c "fonts.gstatic.com" dist/sw.js`
Expected: at least 1 match (the runtime route is present in the generated SW).

- [ ] **Step 3: Commit**

```bash
git add vite.config.ts
git commit -m "feat(pwa): runtime-cache Google Fonts for offline rendering

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Production icons via assets-generator

**Files:**
- Modify: `package.json` (add `@vite-pwa/assets-generator` dev dependency)
- Create: `pwa-assets.config.ts`
- Modify: `vite.config.ts` (add `pwaAssets`, remove manual `manifest.icons`)
- Modify: `index.html` (remove the manual `apple-touch-icon` link)

This task has no unit test; its deliverable is verified by inspecting the build output.

- [ ] **Step 1: Add the dev dependency**

Run: `npm install -D @vite-pwa/assets-generator`
Expected: installs; `package.json` `devDependencies` gains `@vite-pwa/assets-generator`.

- [ ] **Step 2: Create `pwa-assets.config.ts`**

```ts
import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// One source SVG → favicon + 192/512 PWA icons + 512 maskable + 180 apple-touch.
export default defineConfig({
  preset: minimal2023Preset,
  images: ['public/pwa-icon.svg'],
})
```

- [ ] **Step 3: Wire `pwaAssets` into VitePWA and drop the manual icons**

In `vite.config.ts`, inside the `VitePWA({ ... })` options, add:

```ts
      pwaAssets: { config: true },
```

and remove the manual `icons` array from the `manifest` block (the generator
injects the icon set). Leave every other `manifest` field unchanged. The
`manifest` block should no longer contain an `icons:` key.

- [ ] **Step 4: Remove the now-duplicated apple-touch link from `index.html`**

Delete this line (the generator injects the apple-touch-icon link):

```html
    <link rel="apple-touch-icon" href="/pwa-icon.svg" />
```

Leave the `theme-color`, `apple-mobile-web-app-*` meta, and the `favicon.svg`
icon link in place.

- [ ] **Step 5: Build and verify the icon set is generated + referenced**

Run: `npm run build`
Expected: exit 0; build log shows PWA generating assets.

Run: `ls dist | grep -E "pwa-192x192.png|pwa-512x512.png|maskable-icon-512x512.png|apple-touch-icon-180x180.png"`
Expected: all four PNGs present in `dist`.

Run: `grep -c "pwa-512x512.png" dist/manifest.webmanifest`
Expected: at least 1 match (manifest now references the generated PNG icons).

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: full suite green.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json pwa-assets.config.ts vite.config.ts index.html
git commit -m "feat(pwa): generate production PNG icon set via assets-generator

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 8: Fill in the cross-device matrix** in `docs/pwa-offline-verification.md` section D after testing on available devices/browsers; commit any notes.

---

## Notes for the implementer

- **Manual offline test is not automated** (by design). After Phase 1 and again after Phase 3, run `docs/pwa-offline-verification.md` section A.
- **Deferred (out of scope):** reconciling `useOnlineStatus` (true network) with the PowerSync-based sync indicators into one visible offline banner — that belongs to the separate "offline-first data UX" effort.
- **iOS install** stays a manual "add to home screen" gesture; the hint addresses it, it cannot be eliminated.
