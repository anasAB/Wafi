# Settings Foundation — Design Spec

**Date:** 2026-05-29
**Epic:** EPIC-06 (Settings and Account Control)
**Scope:** Foundation layer — Settings shell + Personal preferences (Stories 6.1, 6.2, 6.3)
**Status:** Approved, ready for implementation planning

---

## What this spec covers

The minimum foundation that every other Settings story builds on:

1. **Settings shell** — route, gear icon in `AppHeader`, `SettingsPage` root with role-based section list
2. **Personal preferences** — language (AR/EN), theme (light/dark/auto), text size (four steps)
3. **i18n infrastructure** — `vue-i18n` wired at app level, Settings is the first screen built with it
4. **Theme + text size mechanics** — Tailwind `class` dark mode, CSS root `font-size` scaling

Stories 6.4–6.17 are out of scope here. Each gets its own spec.

---

## Decisions made

| Question | Decision |
|---|---|
| i18n library | `vue-i18n` (legacy: false — composition API mode) |
| Settings navigation | Full-screen route at `/settings` |
| Gear icon position | Right side of header, next to the title |
| Personal prefs storage | Pinia store + `pinia-plugin-persistedstate` → localStorage |
| Dark mode strategy | Tailwind `darkMode: 'class'` — store controls `.dark` on `<html>` |
| Text size strategy | `data-text-size` attribute on `<html>` + CSS root `font-size` rules |
| Design priority | Mobile-first; desktop adapts |

---

## File structure

```
src/
├── i18n/
│   ├── index.ts              ← creates & exports the i18n instance
│   ├── ar.ts                 ← Arabic strings (Settings keys to start)
│   └── en.ts                 ← English strings
│
├── features/settings/
│   ├── settings.store.ts     ← Pinia store, persisted to localStorage
│   ├── settings.types.ts     ← SettingsState interface + enums
│   ├── index.ts              ← re-exports
│   └── screens/
│       └── PersonalPreferencesScreen.vue
│
└── pages/
    └── SettingsPage.vue      ← route component at /settings
```

**Existing files modified:**

| File | Change |
|---|---|
| `main.ts` | Install `vue-i18n` + `pinia-plugin-persistedstate` |
| `App.vue` | Dynamic `:dir`/`:lang`; watchers for theme + text size on `<html>` |
| `src/components/ui/AppHeader.vue` | Add gear icon (RouterLink) + `showSettings` prop |
| `src/router/index.ts` | Add `/settings` and `/settings/personal` routes |
| `tailwind.config.js` | `darkMode: 'class'` |
| `src/style.css` | `html[data-text-size]` font-size rules |

**Not touched:** Existing POS, home, and sale history screens keep their hardcoded Arabic strings. i18n migration of those screens is deferred — Settings is the first screen built with i18n from day one.

---

## Data model

```ts
// settings.types.ts
export type Language = 'ar' | 'en'
export type Theme    = 'light' | 'dark' | 'auto'
export type TextSize = 'small' | 'default' | 'large' | 'xlarge'

export interface SettingsState {
  language: Language
  theme:    Theme
  textSize: TextSize
}
```

```ts
// settings.store.ts
export const useSettingsStore = defineStore('settings', () => {
  const language = ref<Language>('ar')
  const theme    = ref<Theme>('auto')
  const textSize = ref<TextSize>('default')
  return { language, theme, textSize }
}, {
  persist: true  // localStorage key: 'settings'
})
```

**Defaults:** Arabic · Auto theme · Default text size — per Epic 6 CD-2 and CD-3.

**Persistence:** `pinia-plugin-persistedstate` with `persist: true` — one localStorage key, no manual read/write anywhere.

**Per-device by nature:** localStorage is never synced, so CD-1 (personal prefs are per-device) is satisfied with zero extra work.

**No employee_id scoping in v1:** Cross-user preference isolation on shared devices (e.g., two cashiers sharing a tablet) is an Epic 5 + v1.5 concern. Not in scope here.

---

## i18n setup

```ts
// src/i18n/index.ts
export const i18n = createI18n({
  legacy: false,         // composition API mode — useI18n() in <script setup>
  locale: 'ar',         // overridden immediately on app mount by settings store
  fallbackLocale: 'ar',
  messages: { ar, en },
})
```

**Initial string keys (Settings screens only):**

```ts
// ar.ts / en.ts structure
{
  settings: { title, personal, about },
  personal: { language, theme, textSize, signOut },
  theme:    { light, dark, auto },
  textSize: { small, default, large, xlarge },
}
```

**App.vue watcher:**

```ts
watch(() => settings.language, (lang) => {
  i18n.global.locale.value = lang
}, { immediate: true })
```

**App.vue root div:**

```html
<div id="app"
  :dir="settings.language === 'ar' ? 'rtl' : 'ltr'"
  :lang="settings.language"
  class="min-h-dvh bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white"
>
```

Language change takes effect immediately — no app restart, no navigation. Existing hardcoded Arabic strings on other screens are unaffected (they're data/Arabic text, not UI string keys).

---

## Theme mechanics

**tailwind.config.js:**

```js
export default {
  darkMode: 'class',  // changed from default media strategy
  // ...
}
```

**App.vue:**

```ts
const mq = window.matchMedia('(prefers-color-scheme: dark)')

function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'auto' && mq.matches)
  document.documentElement.classList.toggle('dark', dark)
}

watch(() => settings.theme, applyTheme, { immediate: true })
mq.addEventListener('change', () => applyTheme(settings.theme))
```

All existing `dark:` utility classes throughout the app continue working — no component changes needed.

---

## Text size mechanics

**style.css:**

```css
html[data-text-size="small"]   { font-size: 14px; }
html[data-text-size="default"] { font-size: 16px; }
html[data-text-size="large"]   { font-size: 18px; }
html[data-text-size="xlarge"]  { font-size: 20px; }
```

**App.vue:**

```ts
watch(() => settings.textSize, (size) => {
  document.documentElement.dataset.textSize = size
}, { immediate: true })
```

Tailwind's size utilities use `rem`, so they cascade automatically from the root `font-size`. Every screen in the app scales — zero per-component changes.

---

## AppHeader changes

**New prop:** `showSettings?: boolean` (default `true`). When `false`, the gear is hidden — used on the Settings page itself and the PIN/Close-shift screens (Epic 6 CD-4).

**Gear icon:** A `<RouterLink to="/settings">` positioned to the right of the title, with a minimum 44×44 px tap target (WCAG). On desktop: hover highlight via `hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg`.

**Back button behavior:** Unchanged. On Settings pages, the calling page passes `showBack=true` + `showSettings=false`.

**No emit needed:** The gear is a router link, not a button that emits.

---

## Screen designs

### SettingsPage — `/settings`

**Mobile layout:** Full-screen page. `AppHeader` with title "الإعدادات", `showBack=true`, `showSettings=false`, online/offline status chip. Below: vertically scrollable grouped rows.

**Desktop layout:** Sidebar (section list) + content panel side by side, `max-w-2xl` centered. Selecting a sidebar item swaps the content panel inline — no push navigation on desktop.

**Sections visible in this spec (Foundation only):**

| Section | Rows |
|---|---|
| شخصي | اللغة والمظهر → navigates to `/settings/personal` |
| شخصي | تسجيل الخروج (stub — wired in Epic 5) |
| حول التطبيق | الإصدار والدعم (stub — wired in Story 6.16) |

Future sections (shop profile, hardware, devices, billing, etc.) are hidden until their stories are implemented. The section list grows as epics ship.

---

### PersonalPreferencesScreen — `/settings/personal`

**Mobile layout:** Full-screen push from Settings root. `AppHeader` with title "شخصي", `showBack=true`, `showSettings=false`. Content: grouped rows with inline segmented controls.

**Desktop layout:** Rendered inside the Settings page content panel (no separate route push on desktop — the router still changes to `/settings/personal` but the sidebar + panel layout absorbs it).

**Controls:**

| Preference | Control | Behaviour |
|---|---|---|
| Language | 2-segment: العربية / English | Immediate — whole app re-renders (RTL↔LTR flip, all i18n strings) |
| Theme | 3-segment: فاتح / داكن / تلقائي | Immediate — `.dark` toggled on `<html>` |
| Text size | 4-segment: ص / ع / ك / كك | Immediate — `data-text-size` updated on `<html>` |

All three controls apply changes immediately on tap with no Save button. Selected segment is highlighted in brand blue (`bg-blue-600 text-white`); unselected segments are muted (`bg-gray-700 dark:bg-gray-800 text-gray-400`).

**Sign out row:** Red label, confirmation dialog ("هل تريد تسجيل الخروج؟"). Stub for now — wired in Epic 5.

---

## Routing additions

```ts
{ path: '/settings',          component: () => import('@/pages/SettingsPage.vue') },
{ path: '/settings/personal', component: () => import('@/features/settings/screens/PersonalPreferencesScreen.vue') },
```

---

## Constraints and non-goals

- **No PowerSync table for preferences** — localStorage via Pinia persist is sufficient. Cross-device personal pref sync is v1.5.
- **No i18n migration of existing screens** — POS, home, history keep hardcoded Arabic. Settings is first screen with i18n.
- **No OS-level push notifications** — out of scope per Epic 6 CD-11.
- **No biometric unlock toggle** — deferred; requires Epic 5 auth infrastructure.
- **No notification preferences screen** — Story 6.14, separate spec.
- **Sign out row is a stub** — functional wiring in Epic 5.
- **About section is a stub** — functional wiring in Story 6.16.

---

## Definition of done (Foundation layer)

- [ ] Language switch (AR ↔ EN) takes effect on every screen within 1 second, no app restart, correct RTL/LTR flip
- [ ] Theme switch applies immediately across all screens including POS
- [ ] Auto theme follows device system preference; explicit pick overrides it
- [ ] Text size changes scale all rem-based Tailwind utilities on every screen
- [ ] Preferences survive app reload (localStorage persistence confirmed)
- [ ] A second user signing in on the same device sees default preferences (not the previous user's), or at minimum preferences are not tied to a specific user's identity
- [ ] Gear icon visible on home, POS, history — hidden on Settings page itself
- [ ] Settings root shows correct sections for current role (Foundation: Personal + About for all)
- [ ] Desktop: sidebar + panel layout renders correctly at ≥768px
- [ ] Mobile: push navigation works cleanly (Settings root → Personal → back)
- [ ] No console errors during normal flows
- [ ] Dark theme WCAG AA contrast passes on all new screens
- [ ] Tested on Android Chrome (mobile), iOS Safari (PWA), desktop Chrome
