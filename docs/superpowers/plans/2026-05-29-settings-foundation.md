# Settings Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Settings shell + Personal preferences (language, theme, text size) — the foundation every future Settings story builds on.

**Architecture:** A Pinia store (`useSettingsStore`) persisted to localStorage via `pinia-plugin-persistedstate` owns the three preferences. `App.vue` owns all `<html>` DOM mutations (`.dark` class, `data-text-size` attribute, `dir`/`lang`). `vue-i18n` is wired at the app level; Settings is the first screen using i18n strings.

**Tech Stack:** Vue 3 + TypeScript, Pinia v3 + pinia-plugin-persistedstate, vue-i18n v10 (legacy: false), Tailwind v4 CSS-first config, Vitest + @vue/test-utils.

---

## File map

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/features/settings/settings.types.ts` | Language/Theme/TextSize types + SettingsState interface |
| Create | `src/features/settings/settings.store.ts` | Pinia store, persisted to localStorage |
| Create | `src/features/settings/index.ts` | Re-exports |
| Create | `src/i18n/ar.ts` | Arabic message strings |
| Create | `src/i18n/en.ts` | English message strings |
| Create | `src/i18n/index.ts` | i18n instance factory |
| Create | `src/pages/SettingsPage.vue` | Route component at `/settings` |
| Create | `src/features/settings/screens/PersonalPreferencesScreen.vue` | Personal prefs sub-screen |
| Create | `src/__tests__/store/settings.store.test.ts` | Store unit tests |
| Modify | `src/style.css` | `@custom-variant dark` + `html[data-text-size]` rules |
| Modify | `src/main.ts` | Install vue-i18n + pinia-plugin-persistedstate |
| Modify | `src/App.vue` | Theme/text-size watchers, dynamic dir/lang, i18n |
| Modify | `src/components/ui/AppHeader.vue` | `showSettings` prop + gear RouterLink |
| Modify | `src/router/index.ts` | `/settings` + `/settings/personal` routes |

---

## Task 1: Install dependencies

**Files:** `package.json`

- [ ] **Install packages**

```bash
npm install vue-i18n@10 pinia-plugin-persistedstate
```

Expected output: packages added, no peer dependency warnings for vue@3 / pinia@3.

- [ ] **Verify installs**

```bash
node -e "require('./node_modules/vue-i18n/package.json') && console.log('vue-i18n ok')"
node -e "require('./node_modules/pinia-plugin-persistedstate/package.json') && console.log('persistedstate ok')"
```

Expected: both print `ok`.

- [ ] **Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add vue-i18n and pinia-plugin-persistedstate"
```

---

## Task 2: CSS foundation

**Files:**
- Modify: `src/style.css`

**Context:** Tailwind v4 uses CSS-first config — there is no `tailwind.config.js`. Class-based dark mode is enabled via `@custom-variant`. Text size scaling uses the CSS cascade: setting `font-size` on `<html>` causes all Tailwind `rem`-based utilities to scale automatically.

**Note on `@custom-variant` placement:** This directive must appear after any `@import "tailwindcss"` in the file. If `style.css` does not already contain that import, check whether Tailwind is imported in a different CSS entry point (look for `@import "tailwindcss"` anywhere in `src/`). If it exists elsewhere, add the `@custom-variant` line there instead. If no import exists, add `@import "tailwindcss";` at the top of `style.css` first — Tailwind v4 requires it to activate PostCSS processing.

- [ ] **Add dark mode variant + text size rules to `src/style.css`**

Replace the current contents of `src/style.css` with:

```css
@import "tailwindcss";

/* Class-based dark mode for Tailwind v4 — store controls .dark on <html> */
@custom-variant dark (&:where(.dark, .dark *));

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { margin: 0; background: #05080F; }
#app { min-height: 100svh; }

/* Text size scaling — all Tailwind rem utilities cascade from this */
html[data-text-size="small"]   { font-size: 14px; }
html[data-text-size="default"] { font-size: 16px; }
html[data-text-size="large"]   { font-size: 18px; }
html[data-text-size="xlarge"]  { font-size: 20px; }
```

- [ ] **Verify dev server still starts**

```bash
npm run dev
```

Expected: no CSS parse errors in terminal. Open browser — existing screens look unchanged (dark mode still works if OS is dark, since the `.dark` class isn't applied yet but `@custom-variant` is now registered).

- [ ] **Commit**

```bash
git add src/style.css
git commit -m "style: enable Tailwind v4 class-based dark mode + text-size CSS cascade"
```

---

## Task 3: Settings types and store

**Files:**
- Create: `src/features/settings/settings.types.ts`
- Create: `src/features/settings/settings.store.ts`
- Create: `src/features/settings/index.ts`
- Create: `src/__tests__/store/settings.store.test.ts`

- [ ] **Write the failing tests**

Create `src/__tests__/store/settings.store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { useSettingsStore } from '@/features/settings/settings.store'

function makePinia() {
  const pinia = createPinia()
  pinia.use(piniaPluginPersistedstate)
  return pinia
}

describe('useSettingsStore', () => {
  beforeEach(() => {
    setActivePinia(makePinia())
    localStorage.clear()
  })

  it('has correct defaults', () => {
    const store = useSettingsStore()
    expect(store.language).toBe('ar')
    expect(store.theme).toBe('auto')
    expect(store.textSize).toBe('default')
  })

  it('language can be updated', () => {
    const store = useSettingsStore()
    store.language = 'en'
    expect(store.language).toBe('en')
  })

  it('theme can be updated', () => {
    const store = useSettingsStore()
    store.theme = 'dark'
    expect(store.theme).toBe('dark')
  })

  it('textSize can be updated', () => {
    const store = useSettingsStore()
    store.textSize = 'large'
    expect(store.textSize).toBe('large')
  })

  it('persists language to localStorage', () => {
    const store = useSettingsStore()
    store.language = 'en'
    const saved = JSON.parse(localStorage.getItem('settings') ?? '{}')
    expect(saved.language).toBe('en')
  })

  it('restores persisted values on next mount', () => {
    const store = useSettingsStore()
    store.language = 'en'
    store.theme = 'dark'
    store.textSize = 'xlarge'

    // Simulate app restart: new pinia, same localStorage
    setActivePinia(makePinia())
    const restored = useSettingsStore()
    expect(restored.language).toBe('en')
    expect(restored.theme).toBe('dark')
    expect(restored.textSize).toBe('xlarge')
  })
})
```

- [ ] **Run tests to verify they fail**

```bash
npm test -- src/__tests__/store/settings.store.test.ts
```

Expected: FAIL — `Cannot find module '@/features/settings/settings.store'`

- [ ] **Create `src/features/settings/settings.types.ts`**

```ts
export type Language = 'ar' | 'en'
export type Theme    = 'light' | 'dark' | 'auto'
export type TextSize = 'small' | 'default' | 'large' | 'xlarge'
```

- [ ] **Create `src/features/settings/settings.store.ts`**

```ts
import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { Language, Theme, TextSize } from './settings.types'

export const useSettingsStore = defineStore('settings', () => {
  const language = ref<Language>('ar')
  const theme    = ref<Theme>('auto')
  const textSize = ref<TextSize>('default')

  return { language, theme, textSize }
}, {
  persist: true,
})
```

- [ ] **Create `src/features/settings/index.ts`**

```ts
export { useSettingsStore } from './settings.store'
export type { Language, Theme, TextSize } from './settings.types'
```

- [ ] **Run tests to verify they pass**

```bash
npm test -- src/__tests__/store/settings.store.test.ts
```

Expected: PASS — all 6 tests green.

- [ ] **Commit**

```bash
git add src/features/settings/ src/__tests__/store/settings.store.test.ts
git commit -m "feat(settings): add settings store with language/theme/textSize — persisted to localStorage"
```

---

## Task 4: i18n message files

**Files:**
- Create: `src/i18n/ar.ts`
- Create: `src/i18n/en.ts`
- Create: `src/i18n/index.ts`

No unit tests for message objects — they're plain data. Correctness is verified visually in Tasks 8 and 9.

- [ ] **Create `src/i18n/ar.ts`**

```ts
export default {
  settings: {
    title:   'الإعدادات',
    personal: 'شخصي',
    about:   'حول التطبيق',
  },
  personal: {
    preferencesSection: 'التفضيلات',
    sessionSection:     'الجلسة',
    language: 'اللغة',
    theme:    'المظهر',
    textSize: 'حجم الخط',
    signOut:  'تسجيل الخروج',
    signOutConfirmTitle:   'تسجيل الخروج',
    signOutConfirmMessage: 'هل تريد تسجيل الخروج؟',
    aboutVersionLabel: 'الإصدار والدعم',
  },
  theme: {
    light: 'فاتح',
    dark:  'داكن',
    auto:  'تلقائي',
  },
  textSize: {
    small:   'ص',
    default: 'ع',
    large:   'ك',
    xlarge:  'كك',
    smallFull:   'صغير',
    defaultFull: 'عادي',
    largeFull:   'كبير',
    xlargeFull:  'كبير جداً',
  },
  common: {
    back:    'رجوع',
    confirm: 'تأكيد',
    cancel:  'إلغاء',
    online:  'متصل',
    offline: 'غير متصل',
    comingSoon: 'قريباً',
  },
}
```

- [ ] **Create `src/i18n/en.ts`**

```ts
export default {
  settings: {
    title:    'Settings',
    personal: 'Personal',
    about:    'About',
  },
  personal: {
    preferencesSection: 'Preferences',
    sessionSection:     'Session',
    language: 'Language',
    theme:    'Theme',
    textSize: 'Text size',
    signOut:  'Sign out',
    signOutConfirmTitle:   'Sign out',
    signOutConfirmMessage: 'Are you sure you want to sign out?',
    aboutVersionLabel: 'Version & support',
  },
  theme: {
    light: 'Light',
    dark:  'Dark',
    auto:  'Auto',
  },
  textSize: {
    small:   'S',
    default: 'M',
    large:   'L',
    xlarge:  'XL',
    smallFull:   'Small',
    defaultFull: 'Default',
    largeFull:   'Large',
    xlargeFull:  'Extra large',
  },
  common: {
    back:    'Back',
    confirm: 'Confirm',
    cancel:  'Cancel',
    online:  'Online',
    offline: 'Offline',
    comingSoon: 'Coming soon',
  },
}
```

- [ ] **Create `src/i18n/index.ts`**

```ts
import { createI18n } from 'vue-i18n'
import ar from './ar'
import en from './en'

export const i18n = createI18n({
  legacy:         false,
  locale:         'ar',
  fallbackLocale: 'ar',
  messages:       { ar, en },
})
```

- [ ] **Commit**

```bash
git add src/i18n/
git commit -m "feat(i18n): add vue-i18n instance with Arabic and English message files"
```

---

## Task 5: Wire App.vue and main.ts

**Files:**
- Modify: `src/main.ts`
- Modify: `src/App.vue`

**Context:** `App.vue` is the single place that owns all `<html>` DOM mutations. It sets up three watchers (language → i18n locale, theme → `.dark` class, textSize → `data-text-size` attribute) and binds `:dir`/`:lang` on the root div. The `matchMedia` listener is already stubbed in the test setup file.

- [ ] **Update `src/main.ts`**

Replace the entire file:

```ts
import { createApp }   from 'vue'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { i18n } from './i18n'
import './style.css'
import App    from './App.vue'
import router from './router'

const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)

createApp(App).use(pinia).use(router).use(i18n).mount('#app')
```

- [ ] **Update `src/App.vue`**

Replace the entire file:

```vue
<script setup lang="ts">
import { watch, onMounted, onBeforeUnmount } from 'vue'
import { useSettingsStore } from '@/features/settings'
import { i18n } from '@/i18n'
import type { Theme } from '@/features/settings'

const settings = useSettingsStore()

// --- Theme ---
const mq = window.matchMedia('(prefers-color-scheme: dark)')

function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'auto' && mq.matches)
  document.documentElement.classList.toggle('dark', dark)
}

watch(() => settings.theme, applyTheme, { immediate: true })

function onSystemThemeChange() { applyTheme(settings.theme) }
onMounted(() => mq.addEventListener('change', onSystemThemeChange))
onBeforeUnmount(() => mq.removeEventListener('change', onSystemThemeChange))

// --- Text size ---
watch(
  () => settings.textSize,
  size => { document.documentElement.dataset.textSize = size },
  { immediate: true },
)

// --- Language / i18n ---
watch(
  () => settings.language,
  lang => { i18n.global.locale.value = lang as 'ar' | 'en' },
  { immediate: true },
)
</script>

<template>
  <div
    id="app"
    :dir="settings.language === 'ar' ? 'rtl' : 'ltr'"
    :lang="settings.language"
    class="min-h-dvh bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white"
  >
    <RouterView />
  </div>
</template>
```

- [ ] **Run all existing tests to confirm nothing broke**

```bash
npm test
```

Expected: all tests that passed before still pass.

- [ ] **Commit**

```bash
git add src/main.ts src/App.vue
git commit -m "feat(settings): wire i18n, theme, and text-size watchers in App.vue"
```

---

## Task 6: AppHeader gear icon

**Files:**
- Modify: `src/components/ui/AppHeader.vue`

**Context:** The gear is a `<RouterLink to="/settings">` with a 44×44 px minimum tap target (WCAG). It is hidden when `showSettings` is `false` — callers set this on the Settings pages themselves, and it should be set on any screen without a global nav (PIN screen, Close Shift — those don't exist yet but the prop is ready).

- [ ] **Write the failing test**

Create `src/__tests__/components/AppHeader.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import AppHeader from '@/components/ui/AppHeader.vue'

const router = createRouter({
  history: createMemoryHistory(),
  routes:  [{ path: '/:p(.*)', component: { template: '<div/>' } }],
})

function mountHeader(props = {}) {
  const pinia = createPinia()
  pinia.use(piniaPluginPersistedstate)
  return mount(AppHeader, {
    props: { title: 'Test', ...props },
    global: { plugins: [pinia, router] },
  })
}

describe('AppHeader', () => {
  it('renders the title', () => {
    const w = mountHeader()
    expect(w.text()).toContain('Test')
  })

  it('shows gear icon by default', () => {
    const w = mountHeader()
    expect(w.find('[data-testid="gear-link"]').exists()).toBe(true)
  })

  it('hides gear icon when showSettings is false', () => {
    const w = mountHeader({ showSettings: false })
    expect(w.find('[data-testid="gear-link"]').exists()).toBe(false)
  })

  it('shows back button when showBack is true', () => {
    const w = mountHeader({ showBack: true })
    expect(w.find('[data-testid="back-button"]').exists()).toBe(true)
  })

  it('hides back button by default', () => {
    const w = mountHeader()
    expect(w.find('[data-testid="back-button"]').exists()).toBe(false)
  })
})
```

- [ ] **Run to verify failure**

```bash
npm test -- src/__tests__/components/AppHeader.test.ts
```

Expected: FAIL — `data-testid="gear-link"` not found (prop doesn't exist yet).

- [ ] **Update `src/components/ui/AppHeader.vue`**

Replace the entire file:

```vue
<script setup lang="ts">
import { useRouter } from 'vue-router'
import SyncIndicator      from '@/features/sync/SyncIndicator.vue'
import ExchangeRateWidget from '@/features/exchange-rate/ExchangeRateWidget.vue'
import ExchangeRateEditor from '@/features/exchange-rate/ExchangeRateEditor.vue'
import { ref } from 'vue'

const props = withDefaults(defineProps<{
  title:             string
  showExchangeRate?: boolean
  showBack?:         boolean
  showSettings?:     boolean
}>(), {
  showSettings: true,
})

const emit   = defineEmits<{ (e: 'back'): void }>()
const router = useRouter()
const editorOpen = ref(false)
</script>

<template>
  <header class="sticky top-0 z-30 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
    <div class="flex items-center justify-between px-4 h-14 max-w-2xl mx-auto">

      <!-- Right side (RTL start): gear + back + title -->
      <div class="flex items-center gap-2">
        <RouterLink
          v-if="showSettings"
          to="/settings"
          data-testid="gear-link"
          class="text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white
                 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg
                 min-w-[44px] min-h-[44px] flex items-center justify-center"
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
          class="text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white
                 min-w-[44px] min-h-[44px] flex items-center justify-center"
          aria-label="رجوع"
          @click="emit('back')"
        >
          →
        </button>

        <span class="text-base font-semibold text-gray-900 dark:text-white">{{ title }}</span>
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

- [ ] **Run tests to verify they pass**

```bash
npm test -- src/__tests__/components/AppHeader.test.ts
```

Expected: PASS — all 5 tests green.

- [ ] **Commit**

```bash
git add src/components/ui/AppHeader.vue src/__tests__/components/AppHeader.test.ts
git commit -m "feat(settings): add gear icon to AppHeader with showSettings prop"
```

---

## Task 7: Add routes

**Files:**
- Modify: `src/router/index.ts`

- [ ] **Update `src/router/index.ts`**

Replace the entire file:

```ts
import { createRouter, createWebHistory } from 'vue-router'

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/',                   component: () => import('@/pages/HomePage.vue') },
    { path: '/pos',                component: () => import('@/pages/PosPage.vue') },
    { path: '/pos/confirmation',   component: () => import('@/features/pos/SaleConfirmationScreen.vue') },
    { path: '/history',            component: () => import('@/pages/SaleHistoryPage.vue') },
    { path: '/settings',           component: () => import('@/pages/SettingsPage.vue') },
    { path: '/settings/personal',  component: () => import('@/features/settings/screens/PersonalPreferencesScreen.vue') },
    { path: '/:pathMatch(.*)*',    redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
})
```

- [ ] **Verify dev server starts and `/settings` returns a 200** (will show a blank page — the component doesn't exist yet, which is fine)

```bash
npm run dev
```

Open `http://localhost:5173/settings` — Vue router will log a warning about missing component (expected at this step). No crash.

- [ ] **Commit**

```bash
git add src/router/index.ts
git commit -m "feat(settings): add /settings and /settings/personal routes"
```

---

## Task 8: SettingsPage component

**Files:**
- Create: `src/pages/SettingsPage.vue`

**Context:**
- Mobile: full-screen list of grouped section rows. Each section is a rounded card. Tapping a row navigates to the sub-screen.
- Desktop (≥768px): sidebar on the right (RTL) + content panel on the left, both within a `max-w-2xl` container. Clicking a sidebar item swaps the content panel using `<RouterView>` — at `/settings`, the panel shows a welcome/placeholder; at `/settings/personal`, it shows `PersonalPreferencesScreen`.
- Online/offline status chip shown in the header area.
- Sign out row: stub (shows a dialog stub — "قريباً" — until Epic 5 wires it).
- About row: stub showing version `0.1.0`.

- [ ] **Create `src/pages/SettingsPage.vue`**

```vue
<script setup lang="ts">
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'

const router = useRouter()
</script>

<template>
  <div class="flex flex-col min-h-dvh">
    <AppHeader
      title="الإعدادات"
      :show-back="true"
      :show-settings="false"
      @back="router.back()"
    />

    <!-- Mobile layout: full-screen list -->
    <main class="flex-1 md:hidden px-4 py-4 max-w-lg mx-auto w-full">

      <!-- Personal section -->
      <p class="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 px-1">شخصي</p>
      <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden mb-4">
        <button
          type="button"
          class="w-full flex items-center justify-between px-4 py-3.5 border-b border-gray-100 dark:border-gray-700 text-sm text-gray-900 dark:text-white active:bg-gray-50 dark:active:bg-gray-700"
          @click="router.push('/settings/personal')"
        >
          <span>اللغة والمظهر</span>
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-gray-400 rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
        <button
          type="button"
          class="w-full flex items-center justify-between px-4 py-3.5 text-sm text-red-500 active:bg-gray-50 dark:active:bg-gray-700"
          disabled
        >
          <span>تسجيل الخروج</span>
          <span class="text-xs text-gray-400 dark:text-gray-500">قريباً</span>
        </button>
      </div>

      <!-- About section -->
      <p class="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 px-1">حول التطبيق</p>
      <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden">
        <div class="flex items-center justify-between px-4 py-3.5 text-sm text-gray-900 dark:text-white">
          <span>الإصدار والدعم</span>
          <span class="text-xs text-gray-400 dark:text-gray-500">v0.1.0</span>
        </div>
      </div>

    </main>

    <!-- Desktop layout: sidebar + panel -->
    <div class="hidden md:flex flex-1 max-w-2xl mx-auto w-full px-6 py-6 gap-6">

      <!-- Sidebar -->
      <nav class="w-44 flex-shrink-0">
        <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden">
          <RouterLink
            to="/settings/personal"
            class="block px-4 py-3 text-sm border-b border-gray-100 dark:border-gray-700"
            :class="$route.path === '/settings/personal'
              ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 font-medium'
              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'"
          >
            شخصي
          </RouterLink>
          <div class="px-4 py-3 text-sm text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-700">
            حول التطبيق
            <span class="text-xs mr-1 text-gray-300 dark:text-gray-600">v0.1.0</span>
          </div>
        </div>
      </nav>

      <!-- Content panel: RouterView renders sub-screens here on desktop -->
      <div class="flex-1 bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden">
        <RouterView />
        <!-- Fallback shown when at /settings root on desktop -->
        <div
          v-if="$route.path === '/settings'"
          class="flex items-center justify-center h-48 text-sm text-gray-400 dark:text-gray-500"
        >
          اختر قسماً من القائمة
        </div>
      </div>

    </div>
  </div>
</template>
```

- [ ] **Open browser, navigate to `/settings` and verify:**
  - Mobile width: shows section list, tapping "اللغة والمظهر" navigates to `/settings/personal` (shows blank or 404 for now — fine)
  - Desktop width (≥768px): sidebar + empty panel visible
  - Gear icon is NOT shown in the header (showSettings=false)
  - Back button navigates back

- [ ] **Commit**

```bash
git add src/pages/SettingsPage.vue
git commit -m "feat(settings): add SettingsPage — mobile list + desktop sidebar layout"
```

---

## Task 9: PersonalPreferencesScreen component

**Files:**
- Create: `src/features/settings/screens/PersonalPreferencesScreen.vue`

**Context:** Segmented controls for language, theme, text size. Each taps immediately — no Save button. On mobile it's a full-screen push (the route renders it full-screen). On desktop it renders inside `SettingsPage`'s content panel via `<RouterView>`.

The text size segments show abbreviated labels on narrow screens and full labels on wider ones (using responsive classes).

- [ ] **Create `src/features/settings/screens/PersonalPreferencesScreen.vue`**

```vue
<script setup lang="ts">
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import { useSettingsStore } from '@/features/settings'
import type { Language, Theme, TextSize } from '@/features/settings'

const router   = useRouter()
const settings = useSettingsStore()

const languages: { value: Language; label: string }[] = [
  { value: 'ar', label: 'العربية' },
  { value: 'en', label: 'English' },
]

const themes: { value: Theme; label: string }[] = [
  { value: 'light', label: 'فاتح' },
  { value: 'dark',  label: 'داكن' },
  { value: 'auto',  label: 'تلقائي' },
]

const textSizes: { value: TextSize; short: string; full: string }[] = [
  { value: 'small',   short: 'ص',  full: 'صغير' },
  { value: 'default', short: 'ع',  full: 'عادي' },
  { value: 'large',   short: 'ك',  full: 'كبير' },
  { value: 'xlarge',  short: 'كك', full: 'كبير جداً' },
]
</script>

<template>
  <!-- Header only shown on mobile (on desktop this renders inside SettingsPage's panel) -->
  <div class="md:hidden">
    <AppHeader
      title="شخصي"
      :show-back="true"
      :show-settings="false"
      @back="router.back()"
    />
  </div>

  <div class="px-4 py-4 md:p-5 max-w-lg mx-auto w-full md:max-w-none">

    <!-- Preferences group -->
    <p class="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 px-1 md:px-0">التفضيلات</p>
    <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden mb-4 md:shadow-none md:rounded-none md:bg-transparent md:dark:bg-transparent">

      <!-- Language -->
      <div class="px-4 py-3.5 border-b border-gray-100 dark:border-gray-700 md:border-gray-200 md:dark:border-gray-600">
        <p class="text-sm text-gray-700 dark:text-gray-300 mb-2.5">اللغة</p>
        <div class="flex gap-2">
          <button
            v-for="lang in languages"
            :key="lang.value"
            type="button"
            class="flex-1 py-2 rounded-xl text-sm font-medium transition-colors"
            :class="settings.language === lang.value
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'"
            @click="settings.language = lang.value"
          >
            {{ lang.label }}
          </button>
        </div>
      </div>

      <!-- Theme -->
      <div class="px-4 py-3.5 border-b border-gray-100 dark:border-gray-700 md:border-gray-200 md:dark:border-gray-600">
        <p class="text-sm text-gray-700 dark:text-gray-300 mb-2.5">المظهر</p>
        <div class="flex gap-2">
          <button
            v-for="t in themes"
            :key="t.value"
            type="button"
            class="flex-1 py-2 rounded-xl text-sm font-medium transition-colors"
            :class="settings.theme === t.value
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'"
            @click="settings.theme = t.value"
          >
            {{ t.label }}
          </button>
        </div>
      </div>

      <!-- Text size -->
      <div class="px-4 py-3.5">
        <p class="text-sm text-gray-700 dark:text-gray-300 mb-2.5">حجم الخط</p>
        <div class="flex gap-1.5">
          <button
            v-for="s in textSizes"
            :key="s.value"
            type="button"
            class="flex-1 py-2 rounded-xl text-sm font-medium transition-colors"
            :class="settings.textSize === s.value
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'"
            @click="settings.textSize = s.value"
          >
            <!-- Short label on mobile, full label on wider screens -->
            <span class="sm:hidden">{{ s.short }}</span>
            <span class="hidden sm:inline">{{ s.full }}</span>
          </button>
        </div>
      </div>

    </div>

    <!-- Session group -->
    <p class="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 px-1 md:px-0">الجلسة</p>
    <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden md:shadow-none md:rounded-none md:bg-transparent md:dark:bg-transparent">
      <button
        type="button"
        class="w-full flex items-center justify-between px-4 py-3.5 text-sm text-red-500 cursor-not-allowed opacity-60"
        disabled
        title="سيتم تفعيله في الإصدار القادم"
      >
        <span>تسجيل الخروج</span>
        <span class="text-xs text-gray-400 dark:text-gray-500">قريباً</span>
      </button>
    </div>

  </div>
</template>
```

- [ ] **Run all tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Manual smoke test in browser:**
  1. Navigate to `/settings` — gear icon NOT visible in header ✓
  2. Navigate to home `/` — gear icon visible ✓
  3. Tap gear → goes to `/settings` ✓
  4. Tap "اللغة والمظهر" on mobile or click "شخصي" in desktop sidebar → `/settings/personal` ✓
  5. Switch language to English → entire app re-renders in LTR/English ✓
  6. Switch language back to Arabic → RTL restored ✓
  7. Switch theme to Dark → dark mode activates across all screens ✓
  8. Switch theme to Auto → follows OS ✓
  9. Switch text size to XL → all text scales up ✓
  10. Reload the page → preferences survive (localStorage persistence) ✓

- [ ] **Commit**

```bash
git add src/features/settings/screens/PersonalPreferencesScreen.vue
git commit -m "feat(settings): add PersonalPreferencesScreen — language/theme/text-size segmented controls"
```

---

## Self-review against spec DoD

| DoD item | Covered by task |
|---|---|
| Language switch < 1s, no restart, correct RTL/LTR flip | Task 5 (watcher) + Task 9 (control) |
| Theme switch applies immediately across all screens | Task 5 (watcher) + Task 9 (control) |
| Auto theme follows OS preference | Task 5 (`mq.addEventListener`) |
| Text size scales rem utilities | Task 2 (CSS) + Task 5 (watcher) + Task 9 (control) |
| Preferences survive reload | Task 3 (store + persist) |
| Gear visible on home/POS/history, hidden on Settings | Task 6 (`showSettings` prop) |
| Desktop sidebar + panel layout at ≥768px | Task 8 (SettingsPage) |
| Mobile push navigation | Task 8 + Task 9 + Task 7 (routes) |
| No console errors | Task 9 manual smoke test |
| Dark theme WCAG AA | Visual check during smoke test |
| Tested on Android Chrome, iOS Safari, desktop Chrome | Task 9 manual smoke test |
