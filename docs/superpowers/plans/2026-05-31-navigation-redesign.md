# Navigation Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken dual-nav system with a bottom tab bar (mobile) + persistent sidebar (desktop), and fix all routing bugs found in the audit.

**Architecture:** A new `AppBottomNav` component sits at the bottom of the flex column in `App.vue`; the existing `AppSidebar` expands to cover all pages on desktop. `AppHeader` is stripped to title + back button only — all navigation moves to the persistent nav layer. `App.vue` wraps `RouterView` in a scrollable container so the bottom nav never overlaps page content without requiring per-page padding.

**Tech Stack:** Vue 3 + TypeScript, Vue Router, Tailwind CSS, design tokens (`text-gold-primary`, `text-text-muted`, `bg-bg-void`, `border-border-glass`)

---

## File Map

| Action | File | What changes |
|---|---|---|
| **Create** | `src/components/layout/AppBottomNav.vue` | New 4-tab bottom nav component |
| **Modify** | `src/components/ui/AppHeader.vue` | Remove `showBackOffice` + `showSettings` props/icons |
| **Modify** | `src/components/layout/AppSidebar.vue` | Remove hardcoded `dir`, add Home + History links, fix brand link |
| **Modify** | `src/App.vue` | New `showSidebar`/`showBottomNav` computeds, scrollable RouterView wrapper |
| **Modify** | `src/features/sale-history/SaleHistoryScreen.vue` | Fix `/home` route bug, remove showBack |
| **Modify** | `src/features/products/ProductsPage.vue` | Fix hardcoded back route |
| **Modify** | `src/pages/SettingsPage.vue` | Remove deleted props |
| **Modify** | `src/features/products/AddProductPage.vue` | Remove deleted prop, fix back route |
| **Modify** | `src/features/products/EditProductPage.vue` | Remove deleted prop, fix back route |
| **Modify** | `src/features/pos/POSSaleScreen.vue` | Fix `/home` route bug |
| **Modify** | `src/features/products/BackOfficePage.vue` | Desktop redirect to `/products`, add Settings tile |
| **Modify** | `src/pages/HomePage.vue` | Move "بيع جديد" inline, remove fixed bottom button |

---

## Task 1: Create `AppBottomNav.vue`

**Files:**
- Create: `src/components/layout/AppBottomNav.vue`

- [ ] **Create the file with this exact content:**

```vue
<script setup lang="ts">
import { useRoute, RouterLink } from 'vue-router'

const route = useRoute()

const tabs = [
  { key: 'home',    label: 'الرئيسية', to: '/'           },
  { key: 'sell',    label: 'بيع',      to: '/pos'         },
  { key: 'history', label: 'المبيعات', to: '/history'     },
  { key: 'manage',  label: 'الإدارة',  to: '/back-office' },
]

function isActive(key: string): boolean {
  switch (key) {
    case 'home':    return route.path === '/'
    case 'sell':    return route.path.startsWith('/pos')
    case 'history': return route.path === '/history'
    case 'manage':  return (
      route.path.startsWith('/back-office') ||
      route.path.startsWith('/products') ||
      route.path.startsWith('/settings')
    )
    default: return false
  }
}
</script>

<template>
  <nav
    class="flex bg-bg-void border-t border-border-glass flex-shrink-0"
    style="padding-bottom: env(safe-area-inset-bottom)"
    dir="auto"
  >
    <RouterLink
      v-for="tab in tabs"
      :key="tab.key"
      :to="tab.to"
      class="flex-1 flex flex-col items-center justify-center h-14 gap-0.5 transition-colors no-underline"
      :class="isActive(tab.key) ? 'text-gold-primary' : 'text-text-muted'"
    >
      <!-- Home -->
      <svg v-if="tab.key === 'home'" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
      </svg>
      <!-- Sell -->
      <svg v-if="tab.key === 'sell'" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
      </svg>
      <!-- History -->
      <svg v-if="tab.key === 'history'" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
      </svg>
      <!-- Manage -->
      <svg v-if="tab.key === 'manage'" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
      </svg>

      <span class="text-[10px] font-medium leading-none mt-0.5">{{ tab.label }}</span>
    </RouterLink>
  </nav>
</template>
```

- [ ] **Commit:**
```bash
git add src/components/layout/AppBottomNav.vue
git commit -m "feat(nav): add AppBottomNav component with 4 tabs"
```

---

## Task 2: Simplify `AppHeader.vue`

**Files:**
- Modify: `src/components/ui/AppHeader.vue`

The current file has `showSettings` (gear icon) and `showBackOffice` (grid icon) props. Both are removed. The back button styling is also inconsistent — the grid icon uses raw `gray-*` classes; we unify everything to design tokens.

- [ ] **Replace the entire file with:**

```vue
<script setup lang="ts">
import SyncIndicator      from '@/features/sync/SyncIndicator.vue'
import ExchangeRateWidget from '@/features/exchange-rate/ExchangeRateWidget.vue'
import ExchangeRateEditor from '@/features/exchange-rate/ExchangeRateEditor.vue'
import { ref } from 'vue'

withDefaults(defineProps<{
  title:             string
  showExchangeRate?: boolean
  showBack?:         boolean
}>(), {
  showExchangeRate: false,
  showBack:         false,
})

const emit = defineEmits<{ (e: 'back'): void }>()
const editorOpen = ref(false)
</script>

<template>
  <header
    class="sticky top-0 z-30 flex-shrink-0"
    style="background: rgb(255 255 255 / 0.05); backdrop-filter: blur(20px) saturate(180%); border-bottom: 1px solid rgb(201 168 76 / 0.25)"
  >
    <div class="flex items-center justify-between px-4 h-14 max-w-2xl mx-auto">

      <!-- Start side: back button + title -->
      <div class="flex items-center gap-2">
        <button
          v-if="showBack"
          type="button"
          data-testid="back-button"
          class="text-text-muted hover:text-gold-primary hover:bg-surface-glass rounded-lg
                 min-w-[44px] min-h-[44px] flex items-center justify-center transition-colors"
          aria-label="رجوع"
          @click="emit('back')"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 rtl:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span class="font-display text-base font-medium text-text-primary">{{ title }}</span>
      </div>

      <!-- End side: exchange rate + sync -->
      <div class="flex items-center gap-3">
        <ExchangeRateWidget v-if="showExchangeRate" @open-editor="editorOpen = true" />
        <SyncIndicator />
      </div>

    </div>
  </header>

  <ExchangeRateEditor v-if="editorOpen" @close="editorOpen = false" @saved="editorOpen = false" />
</template>
```

- [ ] **Commit:**
```bash
git add src/components/ui/AppHeader.vue
git commit -m "refactor(AppHeader): remove showBackOffice and showSettings props"
```

---

## Task 3: Update `AppSidebar.vue`

**Files:**
- Modify: `src/components/layout/AppSidebar.vue`

Changes: remove hardcoded `dir="rtl"`, brand link goes to `/`, nav list expands to include Home and History, active detection covers the new routes.

- [ ] **Replace the entire file with:**

```vue
<script setup lang="ts">
import { useRoute, RouterLink } from 'vue-router'

const route = useRoute()

interface NavItem {
  key:     string
  label:   string
  href:    string | null
  enabled: boolean
}

const mainNav: NavItem[] = [
  { key: 'home',      label: 'الرئيسية',  href: '/',         enabled: true  },
  { key: 'history',   label: 'المبيعات',  href: '/history',  enabled: true  },
  { key: 'products',  label: 'المنتجات',  href: '/products', enabled: true  },
  { key: 'reports',   label: 'التقارير',  href: null,        enabled: false },
  { key: 'expenses',  label: 'المصاريف',  href: null,        enabled: false },
  { key: 'shifts',    label: 'الكاشيرات', href: null,        enabled: false },
  { key: 'customers', label: 'العملاء',   href: null,        enabled: false },
]

function isActive(href: string | null): boolean {
  if (!href) return false
  if (href === '/') return route.path === '/'
  return route.path === href || route.path.startsWith(href + '/')
}
</script>

<template>
  <aside
    class="flex-col w-56 flex-shrink-0 sticky top-0 h-screen overflow-y-auto border-e border-border-glass"
  >
    <!-- Brand -->
    <RouterLink
      to="/"
      class="flex items-center gap-2 px-5 h-14 border-b border-border-glass hover:bg-surface-glass transition-colors flex-shrink-0"
    >
      <span class="font-display text-xl text-gold-primary font-semibold tracking-wide">وافي</span>
      <span class="text-xs text-text-muted">الإدارة</span>
    </RouterLink>

    <!-- Main nav -->
    <nav class="flex-1 p-2 flex flex-col gap-0.5">
      <component
        v-for="item in mainNav"
        :key="item.key"
        :is="item.href && item.enabled ? RouterLink : 'div'"
        v-bind="item.href && item.enabled ? { to: item.href } : {}"
        class="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm transition-all"
        :class="[
          isActive(item.href)
            ? 'bg-surface-raised text-gold-primary font-semibold'
            : item.enabled
              ? 'text-text-muted hover:bg-surface-glass hover:text-text-primary cursor-pointer'
              : 'text-text-muted opacity-30 cursor-not-allowed',
        ]"
      >
        <!-- Home -->
        <svg v-if="item.key === 'home'" xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
        </svg>
        <!-- History -->
        <svg v-if="item.key === 'history'" xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
        </svg>
        <!-- Products -->
        <svg v-if="item.key === 'products'" xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
        </svg>
        <!-- Reports -->
        <svg v-if="item.key === 'reports'" xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
        </svg>
        <!-- Expenses -->
        <svg v-if="item.key === 'expenses'" xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
        </svg>
        <!-- Shifts -->
        <svg v-if="item.key === 'shifts'" xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
        </svg>
        <!-- Customers -->
        <svg v-if="item.key === 'customers'" xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
        </svg>

        <span class="flex-1">{{ item.label }}</span>
        <span v-if="!item.enabled" class="text-xs opacity-50 flex-shrink-0">قريباً</span>
        <span v-if="isActive(item.href)" class="w-1.5 h-1.5 rounded-full bg-gold-primary flex-shrink-0" />
      </component>
    </nav>

    <!-- Settings -->
    <div class="p-2 border-t border-border-glass flex-shrink-0">
      <RouterLink
        to="/settings"
        class="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm transition-all"
        :class="route.path.startsWith('/settings')
          ? 'bg-surface-raised text-gold-primary font-semibold'
          : 'text-text-muted hover:bg-surface-glass hover:text-text-primary'"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <span>الإعدادات</span>
      </RouterLink>
    </div>
  </aside>
</template>
```

- [ ] **Commit:**
```bash
git add src/components/layout/AppSidebar.vue
git commit -m "feat(AppSidebar): add Home+History links, fix brand link, remove hardcoded dir"
```

---

## Task 4: Update `App.vue`

**Files:**
- Modify: `src/App.vue`

Key change: `#app` becomes `h-dvh overflow-hidden`; RouterView is wrapped in `flex-1 overflow-y-auto` so the bottom nav never overlaps content. `showSidebar` now covers all pages except POS. `showBottomNav` is new — hidden on POS and focused form screens.

- [ ] **Replace the entire file with:**

```vue
<script setup lang="ts">
import { watch, onMounted, onBeforeUnmount, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useSettingsStore } from '@/features/settings'
import { useThemePalette } from '@/composables/useThemePalette'
import { i18n } from '@/i18n'
import type { Theme } from '@/features/settings'
import AppSidebar    from '@/components/layout/AppSidebar.vue'
import AppBottomNav  from '@/components/layout/AppBottomNav.vue'

const route    = useRoute()
const settings = useSettingsStore()
useThemePalette()

const showSidebar = computed(() =>
  !route.path.startsWith('/pos')
)

const showBottomNav = computed(() => {
  if (route.path.startsWith('/pos'))                         return false
  if (route.path === '/products/add')                        return false
  if (/^\/products\/[^/]+\/edit$/.test(route.path))         return false
  return true
})

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
    class="h-dvh bg-bg-void text-text-primary flex overflow-hidden"
  >
    <!-- Persistent sidebar — desktop only -->
    <AppSidebar v-if="showSidebar" class="hidden lg:flex" />

    <!-- Content column -->
    <div class="flex-1 min-w-0 flex flex-col overflow-hidden">
      <!-- Scrollable page area -->
      <div class="flex-1 overflow-y-auto">
        <RouterView />
      </div>
      <!-- Bottom tab bar — mobile only -->
      <AppBottomNav v-if="showBottomNav" class="lg:hidden" />
    </div>
  </div>
</template>
```

- [ ] **Start the dev server and confirm the app loads without errors:**
```bash
npm run dev
```
Open `http://localhost:5173` (or whichever port Vite picks). You should see the home screen with a bottom tab bar on mobile viewport. No console errors.

- [ ] **Commit:**
```bash
git add src/App.vue
git commit -m "feat(App): add AppBottomNav, scrollable RouterView container, fix showSidebar"
```

---

## Task 5: Fix `SaleHistoryScreen.vue`

**Files:**
- Modify: `src/features/sale-history/SaleHistoryScreen.vue`

Two bugs: `router.push('/home')` is not a route; the history page is a root tab and should not show a back button.

- [ ] **In `SaleHistoryScreen.vue` line 38, replace:**
```vue
<AppHeader title="آخر المبيعات" :show-back="true" @back="router.push('/home')" />
```
**with:**
```vue
<AppHeader title="آخر المبيعات" />
```

- [ ] **Commit:**
```bash
git add src/features/sale-history/SaleHistoryScreen.vue
git commit -m "fix(history): remove invalid /home route, drop back button on root tab"
```

---

## Task 6: Fix `ProductsPage.vue`

**Files:**
- Modify: `src/features/products/ProductsPage.vue`

Two changes: back button uses `router.back()` instead of hardcoded `/back-office`; the FAB (`fixed bottom-6`) overlaps the new 56px bottom nav bar on mobile, so move it to `bottom-20`.

- [ ] **In `ProductsPage.vue`, find the AppHeader and replace:**
```vue
<AppHeader
  title="المنتجات"
  :show-back="true"
  :show-back-office="false"
  @back="router.push('/back-office')"
/>
```
**with:**
```vue
<AppHeader
  title="المنتجات"
  :show-back="true"
  @back="router.back()"
/>
```

- [ ] **In `ProductsPage.vue`, find the mobile FAB and replace `bottom-6` with `bottom-20`:**
```vue
<button
  type="button"
  data-testid="add-fab"
  class="lg:hidden fixed bottom-20 start-6 w-14 h-14 rounded-full text-bg-void text-2xl shadow-lg
         active:scale-95 transition-all flex items-center justify-center z-20"
  style="background: linear-gradient(135deg, var(--color-gold-primary), var(--color-gold-to)); box-shadow: 0 0 24px var(--color-gold-subtle)"
  aria-label="إضافة منتج"
  @click="router.push('/products/add')"
>+</button>
```

- [ ] **Commit:**
```bash
git add src/features/products/ProductsPage.vue
git commit -m "fix(products): use router.back(), raise FAB above bottom nav"
```

---

## Task 7: Fix `SettingsPage.vue`

**Files:**
- Modify: `src/pages/SettingsPage.vue`

The `showBackOffice` prop no longer exists on AppHeader. Also `showSettings` is gone. The `showBack` and `@back="router.back()"` stay — settings is a sub-page reached from BackOfficePage on mobile.

- [ ] **In `SettingsPage.vue`, find the AppHeader call and replace:**
```vue
<AppHeader
  :title="t('settings.title')"
  :show-back="true"
  :show-settings="false"
  @back="router.back()"
/>
```
**with:**
```vue
<AppHeader
  :title="t('settings.title')"
  :show-back="true"
  @back="router.back()"
/>
```

- [ ] **Commit:**
```bash
git add src/pages/SettingsPage.vue
git commit -m "fix(settings): remove deleted showSettings prop from AppHeader call"
```

---

## Task 8: Fix `AddProductPage.vue`, `EditProductPage.vue`, `POSSaleScreen.vue`

**Files:**
- Modify: `src/features/products/AddProductPage.vue`
- Modify: `src/features/products/EditProductPage.vue`
- Modify: `src/features/pos/POSSaleScreen.vue`

All three pass the now-deleted `showBackOffice` prop. `AddProductPage` and `EditProductPage` also hardcode their back destination. `POSSaleScreen` navigates to `/home` (not a route) — change to `/`.

- [ ] **In `AddProductPage.vue`, replace the AppHeader call:**
```vue
<AppHeader
  title="إضافة منتج"
  :show-back="true"
  :show-back-office="false"
  @back="router.push('/products')"
/>
```
**with:**
```vue
<AppHeader
  title="إضافة منتج"
  :show-back="true"
  @back="router.back()"
/>
```

- [ ] **In `EditProductPage.vue`, replace the AppHeader call:**
```vue
<AppHeader
  title="تعديل المنتج"
  :show-back="true"
  :show-back-office="false"
  @back="router.push('/products')"
/>
```
**with:**
```vue
<AppHeader
  title="تعديل المنتج"
  :show-back="true"
  @back="router.back()"
/>
```

- [ ] **In `POSSaleScreen.vue` line 93, replace:**
```vue
<AppHeader title="بيع جديد" :show-exchange-rate="true" :show-back="true" @back="router.push('/home')" />
```
**with:**
```vue
<AppHeader title="بيع جديد" :show-exchange-rate="true" :show-back="true" @back="router.push('/')" />
```

- [ ] **Commit:**
```bash
git add src/features/products/AddProductPage.vue src/features/products/EditProductPage.vue src/features/pos/POSSaleScreen.vue
git commit -m "fix: remove deleted AppHeader props, fix /home invalid route in POS and add/edit pages"
```

---

## Task 9: Update `BackOfficePage.vue`

**Files:**
- Modify: `src/features/products/BackOfficePage.vue`

Two changes:
1. On desktop (≥ 1024px) redirect to `/products` on mount — the sidebar makes the tile launcher redundant.
2. Add a Settings row at the bottom of the page on mobile so settings is reachable from the Manage tab.

- [ ] **Replace the entire file with:**

```vue
<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'

const router = useRouter()

onMounted(() => {
  if (window.matchMedia('(min-width: 1024px)').matches) {
    router.replace('/products')
  }
})

const modules = [
  { key: 'products', label: 'المنتجات', description: 'إدارة المخزون والأسعار', route: '/products', active: true },
  { key: 'reports',  label: 'التقارير',  description: 'الأرباح والمبيعات',       route: null,       active: false },
  { key: 'expenses', label: 'المصاريف', description: 'تتبع مصاريف المحل',       route: null,       active: false },
  { key: 'shifts',   label: 'الكاشيرات', description: 'الورديات والصلاحيات',     route: null,       active: false },
]

function handleTile(mod: typeof modules[number]) {
  if (mod.route) router.push(mod.route)
}
</script>

<template>
  <div class="flex flex-col min-h-dvh bg-bg-void" dir="rtl">
    <AppHeader title="الإدارة" />

    <main class="flex-1 px-4 py-8 max-w-4xl mx-auto w-full">

      <!-- Active modules -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <button
          v-for="mod in modules.filter(m => m.active)"
          :key="mod.key"
          type="button"
          :data-testid="`tile-${mod.key}`"
          class="glass-md p-6 flex items-center gap-4 text-right cursor-pointer active:scale-[0.98] hover:bg-surface-raised transition-all rounded-2xl"
          style="border-color: var(--color-border-gold)"
          @click="handleTile(mod)"
        >
          <div class="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
               style="background: rgb(201 168 76 / 0.12)">
            <svg v-if="mod.key === 'products'" xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-gold-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
            </svg>
          </div>
          <div>
            <p class="text-base font-semibold text-text-primary">{{ mod.label }}</p>
            <p class="text-xs text-text-muted mt-0.5">{{ mod.description }}</p>
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-text-muted mr-auto rtl:ml-auto rtl:mr-0 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </div>

      <!-- Coming soon -->
      <div class="mb-8">
        <p class="text-xs font-semibold text-text-muted uppercase tracking-widest mb-3 px-1">قريباً</p>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div
            v-for="mod in modules.filter(m => !m.active)"
            :key="mod.key"
            :data-testid="`tile-${mod.key}`"
            class="glass-sm p-4 flex items-center gap-3 opacity-40 rounded-2xl"
          >
            <div class="w-9 h-9 rounded-lg bg-surface-raised flex items-center justify-center flex-shrink-0">
              <svg v-if="mod.key === 'reports'" xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
              </svg>
              <svg v-if="mod.key === 'expenses'" xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
              </svg>
              <svg v-if="mod.key === 'shifts'" xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
              </svg>
            </div>
            <span class="text-sm text-text-muted">{{ mod.label }}</span>
          </div>
        </div>
      </div>

      <!-- Settings row (mobile only — desktop reaches settings via sidebar) -->
      <button
        type="button"
        class="w-full flex items-center gap-3 px-4 py-3.5 glass-sm rounded-2xl text-sm text-text-muted hover:bg-surface-glass hover:text-text-primary transition-all"
        @click="router.push('/settings')"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <span class="flex-1 text-right">الإعدادات</span>
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 flex-shrink-0 rtl:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>

    </main>
  </div>
</template>
```

- [ ] **Commit:**
```bash
git add src/features/products/BackOfficePage.vue
git commit -m "feat(back-office): redirect to /products on desktop, add settings row for mobile"
```

---

## Task 10: Update `HomePage.vue`

**Files:**
- Modify: `src/pages/HomePage.vue`

Remove the `fixed bottom-0` "بيع جديد" button — it conflicts with the bottom nav bar. Replace with an inline full-width button placed after the metric cards in the scrollable content.

- [ ] **In `HomePage.vue`, remove the entire fixed bottom button block** (lines 202–212 approximately):
```vue
<!-- DELETE THIS ENTIRE BLOCK -->
<div class="fixed bottom-0 inset-x-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 px-4 py-3 z-10">
  <button
    type="button"
    :disabled="!canStartSale"
    aria-describedby="no-rate-warning"
    class="w-full h-12 rounded-2xl text-base font-bold text-white bg-blue-600
           hover:bg-blue-700 active:scale-95 transition-all
           disabled:opacity-40 disabled:cursor-not-allowed"
    @click="router.push('/pos')"
  >بيع جديد</button>
</div>
```

- [ ] **In `HomePage.vue`, add the inline sell button directly after the `<!-- Add expense inline button -->` block and before `<!-- Best sellers -->`:**

```vue
<!-- Sell button -->
<button
  type="button"
  :disabled="!canStartSale"
  aria-describedby="no-rate-warning"
  class="w-full h-12 rounded-2xl text-base font-bold text-white mb-4
         bg-blue-600 hover:bg-blue-700 active:scale-95 transition-all
         disabled:opacity-40 disabled:cursor-not-allowed"
  @click="router.push('/pos')"
>بيع جديد</button>
```

- [ ] **Change the `<main>` padding from `pb-24` to `pb-6`** (the fixed button is gone, bottom nav lives outside this scroll area):

```vue
<main class="flex-1 px-4 py-4 max-w-lg mx-auto w-full pb-6" dir="rtl">
```

- [ ] **Commit:**
```bash
git add src/pages/HomePage.vue
git commit -m "feat(home): move sell CTA inline, remove fixed bottom button"
```

---

## Task 11: Final Verification

- [ ] **Run the dev server:**
```bash
npm run dev
```

- [ ] **Mobile viewport (390×844) — check each tab:**
  - `/` — Home tab active (gold), bottom nav visible, "بيع جديد" button inline in content, no overlap with nav
  - Tap "بيع" tab → goes to `/pos`, bottom nav hidden, back button in header → goes to `/`
  - Tap "المبيعات" tab → `/history`, History tab active, no back button in header
  - Tap "الإدارة" tab → `/back-office`, Manage tab active, tiles visible, Settings row at bottom
  - Tap Settings row → `/settings`, Manage tab still active (correct), back button present → goes back to back-office
  - Tap المنتجات tile → `/products`, Manage tab active, back button → `router.back()` returns to `/back-office`
  - Tap + FAB on products → `/products/add`, bottom nav hidden, back button → returns to `/products`

- [ ] **Desktop viewport (1280×800) — check sidebar:**
  - `/` — sidebar visible, "الرئيسية" active
  - `/back-office` — immediately redirects to `/products`, "المنتجات" active in sidebar
  - `/products` — sidebar visible, "المنتجات" active, no back-office tile duplication
  - `/history` — sidebar visible, "المبيعات" active (previously broken — no active item)
  - `/settings` — sidebar visible, "الإعدادات" active at bottom
  - "وافي" brand link → goes to `/` (was `/back-office`)

- [ ] **Take screenshots to confirm (optional but recommended):**
```bash
npx playwright screenshot --browser chromium --viewport-size "390,844" --wait-for-timeout 3000 http://localhost:5173/ C:/tmp/verify_home_mobile.png
npx playwright screenshot --browser chromium --viewport-size "1280,800" --wait-for-timeout 3000 http://localhost:5173/products C:/tmp/verify_products_desktop.png
```

- [ ] **Commit verification notes or screenshots as appropriate.**
