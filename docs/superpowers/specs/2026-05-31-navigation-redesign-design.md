# Navigation Redesign — Design Spec

**Date:** 2026-05-31  
**Status:** Approved  
**Scope:** Replace the broken dual-nav system (AppHeader icons + AppSidebar) with a bottom tab bar (mobile) + persistent sidebar (desktop). Fix all related routing bugs found in audit.

---

## Problem Summary

The audit identified these concrete failures:

1. Desktop shows two nav systems at once (AppSidebar + BackOfficePage tiles = same links twice)
2. Mobile has zero persistent navigation — only unlabelled icon buttons in the header
3. `SaleHistoryScreen` back button navigates to `/home` which is not a route
4. `ProductsPage` back button hardcodes `/back-office` instead of `router.back()`
5. `SettingsPage` shows a back-office grid icon (the prop default was never overridden)
6. `SaleHistoryScreen` shows three header controls simultaneously (back + back-office + gear)
7. `AppSidebar` has `dir="rtl"` hardcoded — breaks in English mode
8. No path from sidebar back to the home dashboard (`/`)
9. `/history` triggers the sidebar but has no active item in it
10. `AppHeader` gear and grid icons use different styling token systems

---

## Architecture

### Mobile (< `lg`, < 1024px)

- **AppBottomNav** fixed at the bottom of the viewport — always visible except on focused screens
- **AppHeader** simplified — title + optional back button only. No gear. No grid.
- Navigation is exclusively through the bottom tab bar + back button in header for sub-pages

### Desktop (≥ `lg`, ≥ 1024px)

- **AppSidebar** persistent on the left (inline-start) — visible on all pages except POS
- **AppHeader** inside each page's content area — title + optional back button only
- Bottom nav is hidden (`lg:hidden`)
- `BackOfficePage` tile launcher redirects to `/products` on desktop — the sidebar already covers management navigation

---

## New Component: `AppBottomNav.vue`

**Location:** `src/components/layout/AppBottomNav.vue`

**Behaviour:**
- Fixed bottom bar, `z-50`
- 4 tabs with icon + Arabic label:

| Icon | Label | Route | Active condition |
|---|---|---|---|
| Home SVG | الرئيسية | `/` | `route.path === '/'` |
| Cash SVG | بيع | `/pos` | `route.path.startsWith('/pos')` |
| List SVG | المبيعات | `/history` | `route.path === '/history'` |
| Grid SVG | الإدارة | `/back-office` | path starts with `/back-office`, `/products`, or `/settings` |

**Active state:** gold text (`text-gold-primary`) + small gold dot above the icon  
**Inactive state:** `text-text-muted`  
**Background:** `bg-bg-void` with `border-t border-border-glass`  
**Height:** `56px` + `env(safe-area-inset-bottom)` padding for iOS notch compatibility  
**RTL:** respects the app's `dir` attribute — no hardcoded direction  

**Hidden on these routes** (focused task screens — no navigation distraction):
- `/pos` and `/pos/confirmation`
- `/products/add`
- `/products/:id/edit` (matched via regex)

**Shown on all other routes**, including `/products`, `/settings`, `/settings/personal`, `/history`, `/back-office`, `/`

---

## Modified: `AppSidebar.vue`

**Changes:**
1. Remove `dir="rtl"` hardcoded attribute — the parent `App.vue` sets `dir` on `#app`
2. Brand link: `to="/back-office"` → `to="/"`
3. Replace `mainNav` array with expanded list:
   - الرئيسية → `/` (enabled)
   - المبيعات → `/history` (enabled)
   - المنتجات → `/products` (enabled)
   - التقارير → `null` (disabled, "قريباً")
   - المصاريف → `null` (disabled, "قريباً")
   - الكاشيرات → `null` (disabled, "قريباً")
   - العملاء → `null` (disabled, "قريباً")
4. Settings link at the bottom stays as-is

**Active state logic:** unchanged — `isActive(href)` already works correctly  
**Visibility:** controlled by `App.vue` — sidebar now shows on all pages except `/pos`

---

## Modified: `AppHeader.vue`

**Remove entirely:**
- `showBackOffice` prop and the grid icon it renders
- `showSettings` prop and the gear icon it renders

**Keep:**
- `title` prop
- `showBack` prop (default `false`) — back button emits `@back`
- `showExchangeRate` prop — exchange rate widget slot
- Sync indicator (always shown)

**Result:** AppHeader becomes a simple page context bar — title, optional back arrow, optional exchange rate. Nothing else. All navigation is in the bottom nav or sidebar.

**Styling fix:** the back button and any remaining elements must use design tokens (`text-text-muted`, `hover:text-gold-primary`, `hover:bg-surface-glass`) consistently — no raw Tailwind `gray-*` classes.

---

## Modified: `App.vue`

```ts
// Sidebar: show everywhere except POS screens
const showSidebar = computed(() =>
  !route.path.startsWith('/pos')
)

// Bottom nav: show everywhere except POS screens and focused form screens
const showBottomNav = computed(() => {
  if (route.path.startsWith('/pos')) return false
  if (route.path === '/products/add') return false
  if (/^\/products\/[^/]+\/edit$/.test(route.path)) return false
  return true
})
```

Template structure:
```html
<div id="app" ...>
  <AppSidebar v-if="showSidebar" class="hidden lg:flex" />
  <div class="flex-1 min-w-0 flex flex-col">
    <RouterView />
    <AppBottomNav v-if="showBottomNav" class="lg:hidden" />
  </div>
</div>
```

`AppBottomNav` is placed inside the content column (not alongside the sidebar) so it sits below the page content, not below the sidebar.

---

## Modified: `BackOfficePage.vue`

**Mobile:** Keep the existing tile grid. Below both the active modules grid and the "coming soon" section, add a slim Settings row (full-width, icon + "الإعدادات" label + chevron, same style as the sidebar settings link) that navigates to `/settings`. This makes settings reachable from the Manage tab on mobile without requiring a header icon. Remove the now-deleted `showBackOffice` prop from the `AppHeader` call.

**Desktop redirect:** In `onMounted`, if `window.matchMedia('(min-width: 1024px)').matches`, call `router.replace('/products')`. This fires once on mount — no reactive listener needed.

---

## Modified: `HomePage.vue`

- Remove the `fixed bottom-0 inset-x-0` "بيع جديد" button wrapper
- Add a full-width "بيع جديد" button **inline** in the page's scrollable content, placed after the metric cards
- Keep the `canStartSale` computed and `disabled` state on the button
- Add `pb-20` to the `<main>` element so content doesn't get clipped behind the bottom nav

---

## Bug Fixes (all pages)

| File | Fix |
|---|---|
| `SaleHistoryScreen.vue` | `router.push('/home')` → `router.back()`. Remove `showBack` from AppHeader (history is a root tab). Remove deleted `showBackOffice`/`showSettings` props. |
| `ProductsPage.vue` | `@back="router.push('/back-office')"` → `@back="router.back()"`. Move FAB from `bottom-6` to `bottom-20` on mobile to clear the new bottom nav bar. |
| `SettingsPage.vue` | Keep `showBack` and `@back="router.back()"` — settings is a sub-page reached via BackOfficePage on mobile, not a root tab. Only remove the now-deleted `showBackOffice`/`showSettings` prop calls. |
| `AddProductPage.vue` | Verify AppHeader only uses `showBack` — remove any `showBackOffice`/`showSettings` props |
| `EditProductPage.vue` | Same as AddProductPage |
| `POSSaleScreen.vue` | Remove `showBackOffice`/`showSettings` if present — POS hides the nav entirely |

---

## What Does NOT Change

- Route definitions in `router/index.ts` — no new routes, no removed routes
- POS flow (`/pos`, `/pos/confirmation`) — fully isolated, no nav shown
- Exchange rate widget logic
- Sync indicator
- AppDialog, AppToast — unaffected
- Any page's content below the header

---

## Responsive Behaviour Summary

| Screen | Nav type | AppHeader |
|---|---|---|
| Mobile (< 1024px), non-POS | Bottom tab bar | Title + optional back only |
| Mobile (< 1024px), POS | Nothing | POS controls only |
| Desktop (≥ 1024px), non-POS | Left sidebar | Title + optional back only |
| Desktop (≥ 1024px), POS | Nothing | POS controls only |

---

## Out of Scope

- POS screen internal navigation (unchanged)
- Settings page content (unchanged)
- Any new feature beyond navigation plumbing
- i18n strings for new tab labels (use Arabic hardcoded strings same as rest of sidebar — i18n pass is a separate task)
