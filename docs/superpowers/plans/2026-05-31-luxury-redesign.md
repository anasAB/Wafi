# Wafi Luxury Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign Wafi with a dark-luxury aesthetic — liquid glass effects on ambient screens, selective glass on POS, plus a new 7-section marketing landing page.

**Architecture:** Tailwind v4 CSS custom properties (`@theme`) drive the token system; four luxury themes are switchable via `data-luxury-theme` on `<html>`, watched by `useThemePalette`. The landing page is a new route `/`; the app home moves to `/home`.

**Tech Stack:** Vue 3, Tailwind v4, Vitest, Vue Test Utils, Pinia

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `src/style.css` | Design tokens, glass utilities, button utilities, keyframes |
| Modify | `index.html` | Add Cormorant Garant + Amiri Google Fonts |
| Modify | `src/features/settings/settings.types.ts` | Add `LuxuryTheme` type |
| Modify | `src/features/settings/settings.store.ts` | Add `luxuryTheme` ref + persist |
| Create | `src/composables/useThemePalette.ts` | Watch store → apply `data-luxury-theme` on `<html>` |
| Modify | `src/App.vue` | Call `useThemePalette()` |
| Modify | `src/router/index.ts` | `/` → LandingPage, `/home` → HomePage |
| Create | `src/pages/LandingPage.vue` | Full 7-section landing page |
| Modify | `src/components/ui/AppHeader.vue` | Gold-glass styling |
| Modify | `src/pages/HomePage.vue` | Luxury ambient treatment |
| Modify | `src/features/pos/POSSaleScreen.vue` | Selective glass (header/modal only) |
| Modify | `src/features/sale-history/SaleHistoryScreen.vue` | Luxury ambient treatment |
| Create | `src/features/settings/screens/ThemePickerScreen.vue` | 4-swatch theme picker |
| Modify | `src/features/settings/screens/PersonalPreferencesScreen.vue` | Add ThemePickerScreen |
| Modify | `src/features/settings/SettingsPage.vue` | Luxury glass treatment |

---

## Task 1: Design System CSS

**Files:**
- Modify: `src/style.css`

- [ ] **Step 1: Replace style.css entirely**

```css
@import "tailwindcss";

/* Class-based dark mode for Tailwind v4 */
@custom-variant dark (&:where(.dark, .dark *));

/* ─── Design Tokens ─────────────────────────────────── */
@theme {
  /* Colors */
  --color-gold-primary:   #C9A84C;
  --color-gold-to:        #A07830;
  --color-gold-subtle:    rgb(201 168 76 / 0.25);
  --color-platinum:       #E8E8E8;
  --color-text-primary:   #F5F0E8;
  --color-text-muted:     #8A8070;
  --color-bg-void:        #05080F;
  --color-surface-glass:  rgb(255 255 255 / 0.06);
  --color-surface-raised: rgb(255 255 255 / 0.10);
  --color-border-glass:   rgb(255 255 255 / 0.12);
  --color-border-gold:    rgb(201 168 76 / 0.30);

  /* Typography */
  --font-display:    'Cormorant Garant', Georgia, serif;
  --font-display-ar: 'Amiri', serif;
  --font-body:       'Inter', system-ui, sans-serif;
}

/* ─── Theme Overrides ────────────────────────────────── */
[data-luxury-theme="light-ivory"] {
  --color-gold-primary:   #B8965A;
  --color-gold-to:        #8B6914;
  --color-gold-subtle:    rgb(184 150 90 / 0.25);
  --color-bg-void:        #FAF8F4;
  --color-surface-glass:  rgb(0 0 0 / 0.04);
  --color-surface-raised: rgb(0 0 0 / 0.07);
  --color-border-glass:   rgb(0 0 0 / 0.10);
  --color-border-gold:    rgb(184 150 90 / 0.30);
  --color-text-primary:   #1A1410;
  --color-text-muted:     #6B5A4A;
}

[data-luxury-theme="deep-jewel"] {
  --color-gold-primary: #2ECC8F;
  --color-gold-to:      #1EA870;
  --color-gold-subtle:  rgb(46 204 143 / 0.20);
  --color-bg-void:      #080D1A;
  --color-border-gold:  rgb(46 204 143 / 0.30);
}

[data-luxury-theme="sapphire"] {
  --color-gold-primary: #3B7FFF;
  --color-gold-to:      #1A56DB;
  --color-gold-subtle:  rgb(59 127 255 / 0.20);
  --color-bg-void:      #05080F;
  --color-border-gold:  rgb(59 127 255 / 0.30);
}

/* ─── Global Reset ───────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body   { margin: 0; background: #05080F; }
#app   { min-height: 100svh; }
html                           { font-size: 16px; }
html[data-text-size="small"]   { font-size: 14px; }
html[data-text-size="default"] { font-size: 16px; }
html[data-text-size="large"]   { font-size: 18px; }
html[data-text-size="xlarge"]  { font-size: 20px; }
html.dark { color-scheme: dark; }

/* ─── Glass Utilities ────────────────────────────────── */
@utility glass-sm {
  backdrop-filter: blur(12px) saturate(160%);
  background-color: rgb(255 255 255 / 0.06);
  border: 1px solid rgb(255 255 255 / 0.12);
  border-radius: 1rem;
}
@utility glass-md {
  backdrop-filter: blur(20px) saturate(180%);
  background-color: rgb(255 255 255 / 0.06);
  border: 1px solid rgb(255 255 255 / 0.12);
  border-radius: 1rem;
}
@utility glass-lg {
  backdrop-filter: blur(32px) saturate(200%);
  background-color: rgb(255 255 255 / 0.06);
  border: 1px solid rgb(255 255 255 / 0.12);
  border-radius: 1rem;
}

/* ─── Button Utilities ───────────────────────────────── */
@utility btn-gold {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 3.5rem;
  padding-inline: 2rem;
  border-radius: 1rem;
  font-size: 1rem;
  font-weight: 600;
  color: #05080F;
  background: linear-gradient(135deg, var(--color-gold-primary), var(--color-gold-to));
  box-shadow: 0 0 24px var(--color-gold-subtle);
  border: none;
  cursor: pointer;
  text-decoration: none;
  transition: opacity 0.2s ease, transform 0.15s ease;
}
@utility btn-ghost {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 3.5rem;
  padding-inline: 2rem;
  border-radius: 1rem;
  font-size: 1rem;
  font-weight: 500;
  color: var(--color-platinum);
  background: transparent;
  border: 1px solid rgb(255 255 255 / 0.20);
  cursor: pointer;
  text-decoration: none;
  transition: background 0.2s ease;
}

/* ─── Animations ─────────────────────────────────────── */
@keyframes breathe {
  0%, 100% { opacity: 0.5; transform: scale(1); }
  50%       { opacity: 0.9; transform: scale(1.15); }
}
@keyframes shimmer {
  0%   { background-position: -200% center; }
  100% { background-position:  200% center; }
}
@keyframes float {
  0%, 100% { transform: translateY(0px); }
  50%       { transform: translateY(-8px); }
}

.animate-breathe { animation: breathe 8s ease-in-out infinite; }
.animate-shimmer {
  animation: shimmer 3s linear infinite;
  background-size: 200% 100%;
}
.animate-float { animation: float 4s ease-in-out infinite; }

@media (prefers-reduced-motion: reduce) {
  .animate-breathe,
  .animate-shimmer,
  .animate-float,
  .animate-bounce { animation: none !important; }
}
```

- [ ] **Step 2: Run dev server, verify no CSS errors**

```
npm run dev
```

Expected: Server starts, browser shows dark void background (`#05080F`). No console errors.

- [ ] **Step 3: Commit**

```bash
git add src/style.css
git commit -m "feat(design): add luxury design system tokens, glass utilities, and animation keyframes"
```

---

## Task 2: Add Display Fonts

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Replace the Google Fonts link**

Current link: `https://fonts.googleapis.com/css2?family=Tajawal:wght@300;400;500;700;800;900&display=swap`

Replace with:
```html
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@300;400;500;700;800;900&family=Cormorant+Garant:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Amiri:ital,wght@0,400;0,700;1,400&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet" />
```

- [ ] **Step 2: Verify fonts load in browser**

```
npm run dev
```

Open browser DevTools → Network tab → filter "fonts.gstatic.com". Confirm Cormorant+Garant, Amiri, and Inter requests return 200.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(design): add Cormorant Garant, Amiri, and Inter font imports"
```

---

## Task 3: LuxuryTheme Type + Settings Store

**Files:**
- Modify: `src/features/settings/settings.types.ts`
- Modify: `src/features/settings/settings.store.ts`
- Test: `src/__tests__/store/settings.store.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the bottom of `src/__tests__/store/settings.store.test.ts`:
```typescript
describe('luxuryTheme', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(makePinia())
  })

  it('defaults to dark-luxury', () => {
    const store = useSettingsStore()
    expect(store.luxuryTheme).toBe('dark-luxury')
  })

  it('can be updated to light-ivory', () => {
    const store = useSettingsStore()
    store.luxuryTheme = 'light-ivory'
    expect(store.luxuryTheme).toBe('light-ivory')
  })

  it('persists luxuryTheme to localStorage', () => {
    const store = useSettingsStore()
    store.luxuryTheme = 'deep-jewel'
    const saved = JSON.parse(localStorage.getItem('settings') ?? '{}')
    expect(saved.luxuryTheme).toBe('deep-jewel')
  })

  it('restores luxuryTheme on next mount', () => {
    const store = useSettingsStore()
    store.luxuryTheme = 'sapphire'
    setActivePinia(makePinia())
    const restored = useSettingsStore()
    expect(restored.luxuryTheme).toBe('sapphire')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
npm run test -- --reporter=verbose src/__tests__/store/settings.store.test.ts
```

Expected: FAIL — `store.luxuryTheme` is `undefined`.

- [ ] **Step 3: Add LuxuryTheme type**

`src/features/settings/settings.types.ts`:
```typescript
export type Language     = 'ar' | 'en'
export type Theme        = 'light' | 'dark' | 'auto'
export type TextSize     = 'small' | 'default' | 'large' | 'xlarge'
export type LuxuryTheme  = 'dark-luxury' | 'light-ivory' | 'deep-jewel' | 'sapphire'
```

- [ ] **Step 4: Add luxuryTheme to store**

`src/features/settings/settings.store.ts`:
```typescript
import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { Language, Theme, TextSize, LuxuryTheme } from './settings.types'

export const useSettingsStore = defineStore('settings', () => {
  const language     = ref<Language>('ar')
  const theme        = ref<Theme>('auto')
  const textSize     = ref<TextSize>('default')
  const luxuryTheme  = ref<LuxuryTheme>('dark-luxury')

  return { language, theme, textSize, luxuryTheme }
}, {
  persist: true,
})
```

- [ ] **Step 5: Run test to verify it passes**

```
npm run test -- --reporter=verbose src/__tests__/store/settings.store.test.ts
```

Expected: All tests PASS including the 4 new `luxuryTheme` tests.

- [ ] **Step 6: Update the settings feature index export**

Check `src/features/settings/index.ts` — add `LuxuryTheme` to its export if the file re-exports types:
```typescript
export type { Language, Theme, TextSize, LuxuryTheme } from './settings.types'
```

- [ ] **Step 7: Commit**

```bash
git add src/features/settings/settings.types.ts src/features/settings/settings.store.ts src/features/settings/index.ts src/__tests__/store/settings.store.test.ts
git commit -m "feat(settings): add LuxuryTheme type and luxuryTheme store field with persistence"
```

---

## Task 4: useThemePalette Composable

**Files:**
- Create: `src/composables/useThemePalette.ts`
- Create: `src/__tests__/composables/useThemePalette.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/composables/useThemePalette.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { createApp, nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { useSettingsStore } from '@/features/settings'
import { applyThemePalette } from '@/composables/useThemePalette'
import type { LuxuryTheme } from '@/features/settings'

function makePinia() {
  const pinia = createPinia()
  pinia.use(piniaPluginPersistedstate)
  createApp({}).use(pinia)
  return pinia
}

describe('applyThemePalette', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(makePinia())
    delete document.documentElement.dataset.luxuryTheme
  })

  it('sets data-luxury-theme on documentElement', () => {
    applyThemePalette('dark-luxury')
    expect(document.documentElement.dataset.luxuryTheme).toBe('dark-luxury')
  })

  it('updates attribute when called with a different theme', () => {
    applyThemePalette('dark-luxury')
    applyThemePalette('light-ivory')
    expect(document.documentElement.dataset.luxuryTheme).toBe('light-ivory')
  })

  it('handles all four themes without throwing', () => {
    const themes: LuxuryTheme[] = ['dark-luxury', 'light-ivory', 'deep-jewel', 'sapphire']
    themes.forEach(t => {
      expect(() => applyThemePalette(t)).not.toThrow()
      expect(document.documentElement.dataset.luxuryTheme).toBe(t)
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
npm run test -- --reporter=verbose src/__tests__/composables/useThemePalette.test.ts
```

Expected: FAIL — `applyThemePalette` is not a function.

- [ ] **Step 3: Create the composable**

Create `src/composables/useThemePalette.ts`:
```typescript
import { watch } from 'vue'
import { useSettingsStore } from '@/features/settings'
import type { LuxuryTheme } from '@/features/settings'

export function applyThemePalette(theme: LuxuryTheme): void {
  document.documentElement.dataset.luxuryTheme = theme
}

export function useThemePalette(): void {
  const settings = useSettingsStore()
  watch(() => settings.luxuryTheme, applyThemePalette, { immediate: true })
}
```

- [ ] **Step 4: Run test to verify it passes**

```
npm run test -- --reporter=verbose src/__tests__/composables/useThemePalette.test.ts
```

Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/composables/useThemePalette.ts src/__tests__/composables/useThemePalette.test.ts
git commit -m "feat(design): add useThemePalette composable for luxury theme switching"
```

---

## Task 5: Wire useThemePalette in App.vue

**Files:**
- Modify: `src/App.vue`

- [ ] **Step 1: Import and call useThemePalette**

`src/App.vue` `<script setup>` — add import and call after the existing imports:
```typescript
import { watch, onMounted, onBeforeUnmount } from 'vue'
import { useSettingsStore } from '@/features/settings'
import { useThemePalette } from '@/composables/useThemePalette'
import { i18n } from '@/i18n'
import type { Theme } from '@/features/settings'

const settings = useSettingsStore()
useThemePalette()                       // ← add this line

// --- Theme (light/dark/auto) ---
const mq = window.matchMedia('(prefers-color-scheme: dark)')
// ... rest of file unchanged
```

- [ ] **Step 2: Verify in browser**

```
npm run dev
```

Open DevTools → Elements → `<html>`. Confirm `data-luxury-theme="dark-luxury"` attribute is present.

- [ ] **Step 3: Commit**

```bash
git add src/App.vue
git commit -m "feat(design): wire useThemePalette in App root to apply luxury theme on load"
```

---

## Task 6: Router Update

**Files:**
- Modify: `src/router/index.ts`

- [ ] **Step 1: Update routes**

`src/router/index.ts`:
```typescript
import { createRouter, createWebHistory } from 'vue-router'

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/',                 component: () => import('@/pages/LandingPage.vue') },
    { path: '/home',             component: () => import('@/pages/HomePage.vue') },
    { path: '/pos',              component: () => import('@/pages/PosPage.vue') },
    { path: '/pos/confirmation', component: () => import('@/features/pos/SaleConfirmationScreen.vue') },
    { path: '/history',          component: () => import('@/features/sale-history/SaleHistoryScreen.vue') },
    {
      path: '/settings',
      component: () => import('@/pages/SettingsPage.vue'),
      children: [
        {
          path: 'personal',
          component: () => import('@/features/settings/screens/PersonalPreferencesScreen.vue'),
        },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/home' },
  ],
  scrollBehavior: () => ({ top: 0 }),
})
```

- [ ] **Step 2: Update back-navigation in POSSaleScreen**

In `src/features/pos/POSSaleScreen.vue`, find:
```html
<AppHeader title="بيع جديد" :show-exchange-rate="true" :show-back="true" @back="router.push('/')" />
```
Change to:
```html
<AppHeader title="بيع جديد" :show-exchange-rate="true" :show-back="true" @back="router.push('/home')" />
```

- [ ] **Step 3: Update back-navigation in SaleHistoryScreen**

In `src/features/sale-history/SaleHistoryScreen.vue`, find:
```html
<AppHeader title="آخر المبيعات" :show-back="true" @back="router.push('/')" />
```
Change to:
```html
<AppHeader title="آخر المبيعات" :show-back="true" @back="router.push('/home')" />
```

- [ ] **Step 4: Verify navigation**

```
npm run dev
```

- Visit `http://localhost:5173/` → landing page placeholder (LandingPage.vue doesn't exist yet, Vite will error — that's expected; the router file itself must not have TypeScript errors)
- Visit `http://localhost:5173/home` → existing HomePage renders

- [ ] **Step 5: Commit**

```bash
git add src/router/index.ts src/features/pos/POSSaleScreen.vue src/features/sale-history/SaleHistoryScreen.vue
git commit -m "feat(router): move app home to /home, reserve / for landing page"
```

---

## Task 7: LandingPage — Hero + Three Pillars

**Files:**
- Create: `src/pages/LandingPage.vue`
- Create: `src/__tests__/pages/LandingPage.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/pages/LandingPage.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import LandingPage from '@/pages/LandingPage.vue'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: LandingPage },
      { path: '/home', component: { template: '<div>home</div>' } },
    ],
  })
}

function makePinia() {
  const p = createPinia()
  p.use(piniaPluginPersistedstate)
  return p
}

describe('LandingPage', () => {
  it('renders the hero section with headline', async () => {
    const router = makeRouter()
    await router.push('/')
    const wrapper = mount(LandingPage, {
      global: { plugins: [router, makePinia()] },
    })
    expect(wrapper.find('[data-testid="hero"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Fully in command')
  })

  it('renders three pillar cards', async () => {
    const router = makeRouter()
    await router.push('/')
    const wrapper = mount(LandingPage, {
      global: { plugins: [router, makePinia()] },
    })
    expect(wrapper.find('[data-testid="pillars"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Always On')
    expect(wrapper.text()).toContain('Speaks Your Language')
    expect(wrapper.text()).toContain('Any Device You Have')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
npm run test -- --reporter=verbose src/__tests__/pages/LandingPage.test.ts
```

Expected: FAIL — `LandingPage.vue` does not exist.

- [ ] **Step 3: Create LandingPage with Hero and Three Pillars**

Create `src/pages/LandingPage.vue`:
```vue
<script setup lang="ts">
const stats = [
  { value: '< 10s', label: 'Sale time' },
  { value: '2',     label: 'Currencies' },
  { value: '∞',     label: 'Offline time' },
  { value: '30 min', label: 'Onboarding' },
]
</script>

<template>
  <div class="min-h-dvh bg-bg-void text-text-primary overflow-x-hidden">

    <!-- ── Section 1: Hero ─────────────────────────────── -->
    <section data-testid="hero" class="relative min-h-dvh flex flex-col items-center justify-center px-6 overflow-hidden">
      <!-- Breathing radial gradient -->
      <div class="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          class="absolute inset-0 animate-breathe"
          style="background: radial-gradient(ellipse 60% 50% at 50% 40%, rgb(201 168 76 / 0.12) 0%, transparent 70%)"
        />
      </div>

      <div class="relative z-10 max-w-6xl mx-auto w-full flex flex-col lg:flex-row items-center gap-12 py-24">
        <!-- Text -->
        <div class="flex-1 text-center lg:text-start">
          <h1 class="font-display text-5xl lg:text-7xl font-light leading-[1.15] mb-6">
            Your store.<br>
            <span class="text-gold-primary">Fully in command.</span>
          </h1>
          <p class="text-text-muted text-base lg:text-lg mb-10 max-w-lg mx-auto lg:mx-0">
            The retail platform built for Syrian merchants — offline-first, Arabic-native, runs on any device you own.
          </p>
          <div class="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
            <RouterLink to="/home" class="btn-gold">ابدأ الآن / Start Now</RouterLink>
            <button type="button" class="btn-ghost">شاهد العرض / Watch Demo</button>
          </div>
        </div>

        <!-- Device mockup (placeholder grid until real screenshot is available) -->
        <div class="flex-1 flex justify-center animate-float">
          <div class="glass-md p-3 w-56 lg:w-72">
            <div class="aspect-[9/16] bg-surface-raised rounded-xl flex flex-col gap-2 p-4">
              <div class="w-full h-8 bg-surface-glass rounded-lg" />
              <div class="grid grid-cols-3 gap-1.5 flex-1">
                <div v-for="i in 9" :key="i" class="bg-surface-glass rounded-lg" />
              </div>
              <div
                class="w-full h-12 rounded-xl shrink-0"
                style="background: linear-gradient(135deg, #C9A84C, #A07830)"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Scroll chevron -->
      <div class="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
        <svg class="w-6 h-6 text-gold-primary opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 9l-7 7-7-7"/>
        </svg>
      </div>
    </section>

    <!-- ── Section 2: Three Pillars ────────────────────── -->
    <section data-testid="pillars" class="px-6 py-20 max-w-6xl mx-auto">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-5">

        <div class="glass-md p-6 flex flex-col gap-3">
          <svg class="w-6 h-6 text-gold-primary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"/>
          </svg>
          <h3 class="font-display text-xl text-text-primary">Always On</h3>
          <p class="text-text-muted text-sm">Works fully offline. Syncs when you're back.</p>
        </div>

        <div class="glass-md p-6 flex flex-col gap-3">
          <svg class="w-6 h-6 text-gold-primary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 21l5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 016-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m3.334 2.364C11.176 10.658 7.69 15.08 3 17.502m9.334-12.138c.896.061 1.785.147 2.666.257m-4.589 8.495a18.023 18.023 0 01-3.827-5.802"/>
          </svg>
          <h3 class="font-display text-xl text-text-primary">Speaks Your Language</h3>
          <p class="text-text-muted text-sm">Arabic-first. SYP + USD. Your exchange rate, your way.</p>
        </div>

        <div class="glass-md p-6 flex flex-col gap-3">
          <svg class="w-6 h-6 text-gold-primary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3"/>
          </svg>
          <h3 class="font-display text-xl text-text-primary">Any Device You Have</h3>
          <p class="text-text-muted text-sm">Phone, tablet, laptop. Install from a link. No app store.</p>
        </div>

      </div>
    </section>

  </div>
</template>
```

- [ ] **Step 4: Run test to verify it passes**

```
npm run test -- --reporter=verbose src/__tests__/pages/LandingPage.test.ts
```

Expected: Both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/LandingPage.vue src/__tests__/pages/LandingPage.test.ts
git commit -m "feat(landing): add hero section and three pillars with luxury glass design"
```

---

## Task 8: LandingPage — Product Story, Brand Values, Stats, CTA, Footer

**Files:**
- Modify: `src/pages/LandingPage.vue`
- Modify: `src/__tests__/pages/LandingPage.test.ts`

- [ ] **Step 1: Add tests for remaining sections**

Add to `src/__tests__/pages/LandingPage.test.ts`:
```typescript
it('renders product story section', async () => {
  const router = makeRouter()
  await router.push('/')
  const wrapper = mount(LandingPage, { global: { plugins: [router, makePinia()] } })
  expect(wrapper.find('[data-testid="product-story"]').exists()).toBe(true)
  expect(wrapper.text()).toContain('Ring up a sale in under 10 seconds')
})

it('renders founding CTA section', async () => {
  const router = makeRouter()
  await router.push('/')
  const wrapper = mount(LandingPage, { global: { plugins: [router, makePinia()] } })
  expect(wrapper.find('[data-testid="founding-cta"]').exists()).toBe(true)
  expect(wrapper.text()).toContain('Join the founding circle')
})

it('renders footer', async () => {
  const router = makeRouter()
  await router.push('/')
  const wrapper = mount(LandingPage, { global: { plugins: [router, makePinia()] } })
  expect(wrapper.find('[data-testid="footer"]').exists()).toBe(true)
})
```

- [ ] **Step 2: Run new tests to verify they fail**

```
npm run test -- --reporter=verbose src/__tests__/pages/LandingPage.test.ts
```

Expected: The 3 new tests FAIL, previous 2 still PASS.

- [ ] **Step 3: Add remaining sections to LandingPage.vue**

Inside the `<div class="min-h-dvh ...">` in `LandingPage.vue`, after the pillars `</section>`, append:

```vue
    <!-- ── Section 3: Product Story ───────────────────── -->
    <section data-testid="product-story" class="px-6 py-10 max-w-6xl mx-auto space-y-24">

      <div class="flex flex-col lg:flex-row items-center gap-12">
        <div class="flex-1 glass-md p-6 aspect-video flex items-center justify-center min-h-[200px]">
          <span class="text-text-muted text-sm">POS Screen</span>
        </div>
        <div class="flex-1">
          <span class="text-gold-primary text-xs font-medium tracking-widest uppercase mb-3 block">Point of Sale</span>
          <h2 class="font-display text-3xl lg:text-4xl text-text-primary mb-4 leading-tight">Ring up a sale in under 10 seconds.</h2>
          <p class="text-text-muted">Barcode scan, product tap, or search. Every second counts behind the counter.</p>
        </div>
      </div>

      <div class="flex flex-col lg:flex-row-reverse items-center gap-12">
        <div class="flex-1 glass-md p-6 aspect-video flex items-center justify-center min-h-[200px]">
          <span class="text-text-muted text-sm">Dashboard</span>
        </div>
        <div class="flex-1">
          <span class="text-gold-primary text-xs font-medium tracking-widest uppercase mb-3 block">Dashboard</span>
          <h2 class="font-display text-3xl lg:text-4xl text-text-primary mb-4 leading-tight">Know your numbers before you open the door.</h2>
          <p class="text-text-muted">Revenue today, profit this month, low stock alerts — all at a glance before the first customer walks in.</p>
        </div>
      </div>

      <div class="flex flex-col lg:flex-row items-center gap-12">
        <div class="flex-1 glass-md p-6 aspect-video flex items-center justify-center min-h-[200px]">
          <span class="text-text-muted text-sm">Sale History</span>
        </div>
        <div class="flex-1">
          <span class="text-gold-primary text-xs font-medium tracking-widest uppercase mb-3 block">History & Credit</span>
          <h2 class="font-display text-3xl lg:text-4xl text-text-primary mb-4 leading-tight">Your customers trust you. The numbers prove it.</h2>
          <p class="text-text-muted">Every sale logged. Every credit tracked. Send statements over WhatsApp in one tap.</p>
        </div>
      </div>

    </section>

    <!-- ── Section 4: Brand Values ─────────────────────── -->
    <section data-testid="brand-values" class="px-6 py-24 text-center relative overflow-hidden">
      <div
        class="absolute inset-0 pointer-events-none"
        style="background: radial-gradient(ellipse 80% 60% at 50% 50%, rgb(201 168 76 / 0.06) 0%, transparent 70%)"
      />
      <div class="relative z-10 max-w-3xl mx-auto">
        <h2 class="font-display text-4xl lg:text-6xl text-text-primary mb-8 leading-tight">
          Built for the Syrian merchant.<br>
          <span class="text-gold-primary">Engineered for the world.</span>
        </h2>
        <div class="flex flex-col items-center gap-4">
          <p class="text-text-muted">Offline when the power cuts. Online when it returns.</p>
          <div class="w-px h-5 bg-border-gold" />
          <p class="text-text-muted">Your currency, your language, your rules.</p>
          <div class="w-px h-5 bg-border-gold" />
          <p class="text-text-muted">No setup maze. No salesperson required.</p>
        </div>
      </div>
    </section>

    <!-- ── Section 5: By the Numbers ──────────────────── -->
    <section data-testid="stats" class="px-6 py-16 max-w-4xl mx-auto">
      <div class="grid grid-cols-2 md:grid-cols-4 gap-px bg-border-glass rounded-2xl overflow-hidden">
        <div v-for="stat in stats" :key="stat.label" class="bg-bg-void px-6 py-8 text-center">
          <p class="font-display text-4xl text-platinum mb-2">{{ stat.value }}</p>
          <p class="text-text-muted text-sm">{{ stat.label }}</p>
        </div>
      </div>
    </section>

    <!-- ── Section 6: Founding CTA ─────────────────────── -->
    <section data-testid="founding-cta" class="px-6 py-20 max-w-2xl mx-auto text-center">
      <div
        class="glass-lg p-10 relative overflow-hidden"
        style="border: 1px solid rgb(201 168 76 / 0.4)"
      >
        <h2 class="font-display text-4xl text-text-primary mb-4">Join the founding circle.</h2>
        <p class="text-text-muted mb-8 max-w-md mx-auto">
          First 15 merchants get 50% off — permanently. Setup handled personally. Direct line to the founders.
        </p>
        <RouterLink to="/home" class="btn-gold">احجز مكانك / Reserve Your Spot</RouterLink>
        <p class="text-text-muted text-xs mt-4">12 of 15 spots remaining.</p>
      </div>
    </section>

    <!-- ── Section 7: Footer ──────────────────────────── -->
    <footer data-testid="footer" class="px-6 py-12" style="border-top: 1px solid rgb(201 168 76 / 0.30)">
      <div class="max-w-6xl mx-auto flex flex-col md:flex-row justify-between gap-8 mb-8">
        <div>
          <p class="font-display text-xl text-text-primary mb-1">وافي</p>
          <p class="text-text-muted text-sm">نظام إدارة أعمال متكامل</p>
        </div>
        <div class="flex flex-col sm:flex-row gap-8 text-sm text-text-muted">
          <div class="flex flex-col gap-2">
            <p class="text-platinum font-medium mb-1">Product</p>
            <RouterLink to="/home" class="hover:text-gold-primary transition-colors">Dashboard</RouterLink>
            <RouterLink to="/pos"  class="hover:text-gold-primary transition-colors">Point of Sale</RouterLink>
          </div>
          <div class="flex flex-col gap-2">
            <p class="text-platinum font-medium mb-1">Company</p>
            <span>About</span>
            <span>Contact</span>
          </div>
        </div>
      </div>
      <div
        class="max-w-6xl mx-auto pt-6 flex justify-between items-center"
        style="border-top: 1px solid rgb(255 255 255 / 0.08)"
      >
        <p class="text-text-muted text-xs">© 2026 وافي. All rights reserved.</p>
        <div class="flex gap-3 text-xs text-text-muted">
          <span>USDT</span>
          <span>Wire</span>
          <span>Cash</span>
        </div>
      </div>
    </footer>

  </div>
</template>
```

- [ ] **Step 4: Run all LandingPage tests**

```
npm run test -- --reporter=verbose src/__tests__/pages/LandingPage.test.ts
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/LandingPage.vue src/__tests__/pages/LandingPage.test.ts
git commit -m "feat(landing): complete landing page with product story, brand values, stats, CTA, and footer"
```

---

## Task 9: AppHeader Luxury Redesign

**Files:**
- Modify: `src/components/ui/AppHeader.vue`

- [ ] **Step 1: Run existing AppHeader test to confirm it passes before changes**

```
npm run test -- --reporter=verbose src/__tests__/components/AppHeader.test.ts
```

Expected: All existing tests PASS. Note the count.

- [ ] **Step 2: Apply luxury glass styling to AppHeader**

Replace the `<template>` block in `src/components/ui/AppHeader.vue`:
```vue
<template>
  <header
    class="sticky top-0 z-30"
    style="background: rgb(255 255 255 / 0.05); backdrop-filter: blur(20px) saturate(180%); border-bottom: 1px solid rgb(201 168 76 / 0.25)"
  >
    <div class="flex items-center justify-between px-4 h-14 max-w-2xl mx-auto">

      <!-- Right side (RTL start): gear + back + title -->
      <div class="flex items-center gap-2">
        <RouterLink
          v-if="showSettings"
          to="/settings"
          data-testid="gear-link"
          class="text-text-muted hover:text-gold-primary hover:bg-surface-glass rounded-lg
                 min-w-[44px] min-h-[44px] flex items-center justify-center transition-colors"
          aria-label="الإعدادات"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </RouterLink>

        <button
          v-if="showBack"
          type="button"
          data-testid="back-button"
          class="text-text-muted hover:text-gold-primary min-w-[44px] min-h-[44px] flex items-center justify-center transition-colors"
          aria-label="رجوع"
          @click="emit('back')"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 rtl:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <span class="font-display text-base font-medium text-text-primary">{{ title }}</span>
      </div>

      <!-- Left side (RTL end): exchange rate + sync -->
      <div class="flex items-center gap-3">
        <ExchangeRateWidget v-if="showExchangeRate" @open-editor="editorOpen = true" />
        <SyncIndicator />
      </div>

    </div>
  </header>

  <ExchangeRateEditor v-if="editorOpen" @close="editorOpen = false" @saved="editorOpen = false" />
</template>
```

- [ ] **Step 3: Run existing AppHeader test to confirm it still passes**

```
npm run test -- --reporter=verbose src/__tests__/components/AppHeader.test.ts
```

Expected: Same count PASS as Step 1. No regressions.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/AppHeader.vue
git commit -m "feat(design): apply luxury glass styling to AppHeader"
```

---

## Task 10: HomePage Luxury Redesign

**Files:**
- Modify: `src/pages/HomePage.vue`

- [ ] **Step 1: Replace HomePage template with luxury version**

Replace the entire `<template>` block in `src/pages/HomePage.vue`:
```vue
<template>
  <div class="flex flex-col min-h-dvh bg-bg-void">
    <AppHeader title="وافي" :show-exchange-rate="true" />

    <main class="flex-1 px-4 py-6 max-w-lg mx-auto w-full">

      <!-- Date + greeting -->
      <p class="font-display-ar text-sm text-gold-subtle mb-1">{{ arabicDate }}</p>
      <h1 class="font-display text-2xl font-light text-text-primary mb-6">مرحباً</h1>

      <!-- Today sales card -->
      <div
        class="glass-md p-5 mb-4 relative overflow-hidden"
        style="border: 1px solid rgb(201 168 76 / 0.25)"
      >
        <p class="text-sm text-text-muted mb-1">مبيعات اليوم</p>
        <p v-if="todaySalesUsd !== null" class="font-display text-4xl text-text-primary">
          <span class="text-platinum">$</span>
          <span class="text-gold-primary">{{ todaySalesUsd.toFixed(2) }}</span>
        </p>
        <p v-else class="text-text-muted text-sm">جارٍ التحميل...</p>
      </div>

      <!-- No rate warning -->
      <div
        v-if="!currentRate"
        id="no-rate-warning"
        class="rounded-xl p-4 mb-4 text-sm flex gap-3 items-start"
        style="background: rgb(251 191 36 / 0.08); border: 1px solid rgb(251 191 36 / 0.30); color: rgb(253 224 132)"
      >
        <svg class="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/>
        </svg>
        <span>حدد سعر صرف الدولار من الأعلى قبل البدء في البيع.</span>
      </div>

      <!-- New sale button -->
      <button
        type="button"
        :disabled="!canStartSale"
        aria-describedby="no-rate-warning"
        class="btn-gold w-full mb-3 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
        @click="router.push('/pos')"
      >
        بيع جديد
      </button>

      <!-- History button -->
      <button
        type="button"
        class="btn-ghost w-full"
        @click="router.push('/history')"
      >
        آخر المبيعات
      </button>

    </main>
  </div>

  <!-- Draft recovery dialog (unchanged) -->
  <AppDialog
    v-if="showDraftDialog"
    title="بيع غير مكتمل"
    message="يوجد بيع لم يتم تأكيده. هل تريد المتابعة؟"
    confirm-label="متابعة"
    cancel-label="تجاهل"
    @confirm="handleRestoreDraft"
    @cancel="handleDiscardDraft"
  />
</template>
```

- [ ] **Step 2: Verify in browser**

```
npm run dev
```

Navigate to `http://localhost:5173/home`. Confirm: dark void background, glass sales card with gold number, gold gradient CTA button, ghost history button, Cormorant Garant greeting, no regressions on functionality.

- [ ] **Step 3: Commit**

```bash
git add src/pages/HomePage.vue
git commit -m "feat(design): apply luxury glass treatment to HomePage"
```

---

## Task 11: POSSaleScreen Selective Glass

**Files:**
- Modify: `src/features/pos/POSSaleScreen.vue`

- [ ] **Step 1: Apply selective glass — header and search bar only**

In `src/features/pos/POSSaleScreen.vue`, replace the search bar `<div>` and update rate notice:

Replace:
```html
<div class="px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
```
With:
```html
<div class="px-3 py-2 flex items-center gap-2" style="background: rgb(255 255 255 / 0.04); border-bottom: 1px solid rgb(255 255 255 / 0.10)">
```

Replace the search `<input>` classes:
```html
class="w-full h-10 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
```
With:
```html
class="w-full h-10 px-3 rounded-lg text-sm text-right focus:outline-none focus:ring-1 focus:ring-gold-primary text-text-primary"
style="background: rgb(255 255 255 / 0.06); border: 1px solid rgb(255 255 255 / 0.12)"
```

Replace the camera button classes:
```html
class="w-10 h-10 flex items-center justify-center rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-500 hover:text-blue-600 hover:border-blue-400 transition-colors"
```
With:
```html
class="w-10 h-10 flex items-center justify-center rounded-lg text-text-muted hover:text-gold-primary transition-colors"
style="background: rgb(255 255 255 / 0.06); border: 1px solid rgb(255 255 255 / 0.12)"
```

Replace the rate change notice classes:
```html
class="bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 text-sm px-4 py-2 border-b border-orange-200"
```
With:
```html
class="text-sm px-4 py-2"
style="background: rgb(251 146 60 / 0.10); color: rgb(253 186 116); border-bottom: 1px solid rgb(251 146 60 / 0.25)"
```

Also update the `<div class="flex-1 flex flex-col min-h-dvh">`:
```html
<div class="flex flex-col min-h-dvh bg-bg-void">
```

- [ ] **Step 2: Verify POS still works**

```
npm run dev
```

Navigate to `http://localhost:5173/pos`. Confirm: dark background, glass search bar, products still tappable, sale panel visible, pay button gold gradient. No functionality regressions.

- [ ] **Step 3: Commit**

```bash
git add src/features/pos/POSSaleScreen.vue
git commit -m "feat(design): apply selective glass to POS screen — speed-critical areas stay unblurred"
```

---

## Task 12: SaleHistoryScreen Luxury Redesign

**Files:**
- Modify: `src/features/sale-history/SaleHistoryScreen.vue`

- [ ] **Step 1: Apply luxury treatment**

Replace the `<template>` block in `src/features/sale-history/SaleHistoryScreen.vue`:
```vue
<template>
  <div class="flex flex-col min-h-dvh bg-bg-void">
    <AppHeader title="آخر المبيعات" :show-back="true" @back="router.push('/home')" />

    <main class="flex-1 px-4 py-4 max-w-lg mx-auto w-full">

      <!-- Loading -->
      <div v-if="loading" class="flex justify-center py-10">
        <div
          class="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
          style="border-color: rgb(201 168 76 / 0.6); border-top-color: transparent"
        />
      </div>

      <!-- Empty state -->
      <div
        v-else-if="sales.length === 0"
        class="flex flex-col items-center justify-center py-16 gap-3"
      >
        <svg class="w-12 h-12 text-text-muted opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z"/>
        </svg>
        <p class="font-display italic text-text-muted text-lg">لا توجد مبيعات في آخر 7 أيام</p>
        <RouterLink to="/pos" class="btn-ghost text-sm h-10 px-5">بيع جديد</RouterLink>
      </div>

      <!-- Sale list -->
      <div v-else class="space-y-2">
        <div
          v-for="sale in sales"
          :key="sale.id"
          class="glass-sm overflow-hidden"
          :style="sale.isPending ? 'border-right: 2px solid #C9A84C' : ''"
        >
          <button
            type="button"
            class="w-full flex items-center gap-3 px-4 min-h-[56px] text-right"
            @click="expandedId = expandedId === sale.id ? null : sale.id"
          >
            <span class="text-sm font-mono text-gold-primary shrink-0">{{ sale.displaySaleNumber }}</span>
            <span class="flex-1 font-display text-lg text-text-primary">${{ sale.totalUsd.toFixed(2) }}</span>
            <span
              v-if="sale.isPending"
              class="text-xs font-medium px-1.5 py-0.5 rounded shrink-0"
              style="background: rgb(201 168 76 / 0.15); color: #C9A84C"
            >في الانتظار</span>
            <span class="text-xs text-text-muted shrink-0">{{ formatDate(sale.createdAt) }}</span>
            <span class="text-sm text-text-muted shrink-0">{{ methodLabel[sale.paymentMethod] ?? '?' }}</span>
          </button>

          <div
            v-if="expandedId === sale.id"
            class="px-4 py-3"
            style="border-top: 1px solid rgb(255 255 255 / 0.08)"
          >
            <div class="flex justify-between text-xs text-text-muted mb-3">
              <span>بالليرة: {{ sale.totalSyp.toLocaleString() }} ل.س</span>
              <span>السعر: {{ sale.exchangeRateAtSale.toLocaleString() }}</span>
            </div>
            <button
              type="button"
              class="btn-ghost w-full h-9 text-sm"
              @click="handleReprint(sale.id)"
            >
              إعادة طباعة
            </button>
          </div>
        </div>
      </div>

    </main>
  </div>

  <AppToast v-if="toast" :message="toast" :type="toastType" @dismiss="toast = null" />
</template>
```

- [ ] **Step 2: Verify in browser**

```
npm run dev
```

Navigate to `http://localhost:5173/history`. Confirm: glass rows, gold sale numbers in Cormorant Garant, gold left border on pending rows, loading spinner uses gold.

- [ ] **Step 3: Commit**

```bash
git add src/features/sale-history/SaleHistoryScreen.vue
git commit -m "feat(design): apply luxury glass treatment to SaleHistoryScreen"
```

---

## Task 13: ThemePickerScreen Component

**Files:**
- Create: `src/features/settings/screens/ThemePickerScreen.vue`
- Create: `src/__tests__/features/ThemePickerScreen.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/features/ThemePickerScreen.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createApp } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { useSettingsStore } from '@/features/settings'
import ThemePickerScreen from '@/features/settings/screens/ThemePickerScreen.vue'

function makePinia() {
  const pinia = createPinia()
  pinia.use(piniaPluginPersistedstate)
  createApp({}).use(pinia)
  return pinia
}

describe('ThemePickerScreen', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(makePinia())
  })

  it('renders 4 theme swatches', () => {
    const wrapper = mount(ThemePickerScreen, {
      global: { plugins: [makePinia()] },
    })
    expect(wrapper.findAll('[data-testid="theme-swatch"]').length).toBe(4)
  })

  it('marks dark-luxury as selected by default', () => {
    const wrapper = mount(ThemePickerScreen, {
      global: { plugins: [makePinia()] },
    })
    const selected = wrapper.find('[data-testid="theme-swatch"][aria-pressed="true"]')
    expect(selected.exists()).toBe(true)
    expect(selected.attributes('data-theme')).toBe('dark-luxury')
  })

  it('updates store luxuryTheme when swatch is clicked', async () => {
    const pinia = makePinia()
    const wrapper = mount(ThemePickerScreen, {
      global: { plugins: [pinia] },
    })
    const store = useSettingsStore()
    const ivorySwatch = wrapper.find('[data-theme="light-ivory"]')
    await ivorySwatch.trigger('click')
    expect(store.luxuryTheme).toBe('light-ivory')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
npm run test -- --reporter=verbose src/__tests__/features/ThemePickerScreen.test.ts
```

Expected: FAIL — component file does not exist.

- [ ] **Step 3: Create ThemePickerScreen**

Create `src/features/settings/screens/ThemePickerScreen.vue`:
```vue
<script setup lang="ts">
import { useSettingsStore } from '@/features/settings'
import type { LuxuryTheme } from '@/features/settings'

const settings = useSettingsStore()

const themes: { value: LuxuryTheme; label: string; dot: string; bg: string }[] = [
  { value: 'dark-luxury',  label: 'Dark Luxury',  dot: '#C9A84C', bg: '#05080F' },
  { value: 'light-ivory',  label: 'Light Ivory',  dot: '#B8965A', bg: '#FAF8F4' },
  { value: 'deep-jewel',   label: 'Deep Jewel',   dot: '#2ECC8F', bg: '#080D1A' },
  { value: 'sapphire',     label: 'Sapphire',     dot: '#3B7FFF', bg: '#05080F' },
]
</script>

<template>
  <div class="grid grid-cols-2 gap-3">
    <button
      v-for="theme in themes"
      :key="theme.value"
      type="button"
      data-testid="theme-swatch"
      :data-theme="theme.value"
      :aria-pressed="settings.luxuryTheme === theme.value"
      class="flex flex-col items-start gap-2 p-4 rounded-xl transition-all text-start"
      :style="{
        background: theme.bg === '#FAF8F4' ? 'rgb(250 248 244)' : 'rgb(255 255 255 / 0.06)',
        border: settings.luxuryTheme === theme.value
          ? `2px solid ${theme.dot}`
          : '1px solid rgb(255 255 255 / 0.12)',
        color: theme.bg === '#FAF8F4' ? '#1A1410' : '#F5F0E8',
      }"
      @click="settings.luxuryTheme = theme.value"
    >
      <span class="w-4 h-4 rounded-full shrink-0" :style="{ background: theme.dot }" />
      <span class="text-xs font-medium">{{ theme.label }}</span>
    </button>
  </div>
</template>
```

- [ ] **Step 4: Run test to verify it passes**

```
npm run test -- --reporter=verbose src/__tests__/features/ThemePickerScreen.test.ts
```

Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/screens/ThemePickerScreen.vue src/__tests__/features/ThemePickerScreen.test.ts
git commit -m "feat(settings): add ThemePickerScreen component with 4 luxury theme swatches"
```

---

## Task 14: PersonalPreferencesScreen + SettingsPage Luxury Redesign

**Files:**
- Modify: `src/features/settings/screens/PersonalPreferencesScreen.vue`
- Modify: `src/pages/SettingsPage.vue`

- [ ] **Step 1: Add ThemePickerScreen to PersonalPreferencesScreen**

In `src/features/settings/screens/PersonalPreferencesScreen.vue`, add import and section. After the existing `<script setup>` imports, add:
```typescript
import ThemePickerScreen from './ThemePickerScreen.vue'
```

In the template, inside the main preferences `<div>`, add a new group **before** the language row:
```html
<!-- Luxury theme -->
<div class="px-4 py-3.5 border-b border-gray-100 dark:border-gray-700">
  <p class="text-sm text-text-muted mb-3">{{ t('personal.luxuryTheme') ?? 'Luxury Theme' }}</p>
  <ThemePickerScreen />
</div>
```

- [ ] **Step 2: Apply luxury styling to SettingsPage**

In `src/pages/SettingsPage.vue`, replace:
- `class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden mb-4"` → `class="glass-sm overflow-hidden mb-4"`
- `class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden"` → `class="glass-sm overflow-hidden"`
- `class="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 px-1"` → `class="text-xs font-medium text-text-muted mb-2 px-1 tracking-widest uppercase"`
- `class="text-sm text-gray-900 dark:text-white active:bg-gray-50 dark:active:bg-gray-700"` → `class="text-sm text-text-primary active:bg-surface-glass"`
- `class="flex-1 bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden"` → `class="flex-1 glass-sm overflow-hidden"`
- The sidebar nav div: `class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden"` → `class="glass-sm overflow-hidden"`

- [ ] **Step 3: Run full test suite**

```
npm run test
```

Expected: All tests PASS. Zero regressions.

- [ ] **Step 4: Verify theme switching in browser**

```
npm run dev
```

1. Navigate to `http://localhost:5173/home` → dark luxury look
2. Go to Settings → Personal → confirm theme picker shows 4 swatches, Dark Luxury selected with gold border
3. Click "Light Ivory" → page background changes to `#FAF8F4`, accent becomes champagne
4. Click "Sapphire" → accent becomes blue
5. Reload page → selected theme persists

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/screens/PersonalPreferencesScreen.vue src/pages/SettingsPage.vue
git commit -m "feat(settings): add luxury theme picker to personal preferences and apply glass styling to settings page"
```

---

## Final Verification

- [ ] Run full test suite: `npm run test` — all pass
- [ ] Visit `http://localhost:5173/` — full landing page renders, hero, pillars, product story, CTA, footer
- [ ] Visit `http://localhost:5173/home` — luxury dashboard with glass sales card
- [ ] Visit `http://localhost:5173/pos` — POS screen, clear + fast, no glass blur on grid
- [ ] Visit `http://localhost:5173/history` — glass rows, gold sale numbers
- [ ] Visit `http://localhost:5173/settings/personal` — theme picker present, all 4 themes switch correctly
- [ ] Test on mobile viewport (375px) — all layouts stack correctly, no horizontal scroll
- [ ] Confirm `prefers-reduced-motion` disables animations (DevTools → Rendering → Emulate)
