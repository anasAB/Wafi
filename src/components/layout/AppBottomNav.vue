<script setup lang="ts">
import { useRoute, RouterLink } from 'vue-router'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSessionStore } from '@/store/session.store'

const route = useRoute()
const { t }  = useI18n()
const session = useSessionStore()

// Labels are i18n keys (resolved in the template) and reuse the shared `nav`
// namespace, so the bar relabels on a language switch with no rebuild.
// `permission` gates a tab: null = always shown.
const allTabs = [
  { key: 'home',      labelKey: 'nav.home',      to: '/',           permission: 'can_view_reports' as const },
  { key: 'sell',      labelKey: 'nav.posShort',  to: '/pos',        permission: null },
  { key: 'products',  labelKey: 'nav.products',  to: '/products',   permission: null },
  { key: 'customers', labelKey: 'nav.customers', to: '/customers',  permission: null },
  { key: 'manage',    labelKey: 'nav.more',      to: '/back-office', permission: null },
]

// Hide the dashboard (home) tab for staff without can_view_reports so an
// ungranted operator never taps into a financial screen that just bounces them
// back (WAFI-058). Owners hold every permission.
const tabs = computed(() => {
  const perms   = session.permissions
  const isOwner = session.activeStaff?.role === 'owner'
  if (!perms || isOwner) return allTabs
  return allTabs.filter(tab => !tab.permission || (perms as any)[tab.permission])
})

function isActive(key: string): boolean {
  switch (key) {
    case 'home':      return route.path === '/'
    case 'sell':      return route.path.startsWith('/pos')
    case 'products':  return route.path.startsWith('/products')
    case 'customers': return route.path.startsWith('/customers')
    case 'manage':    return (
      route.path.startsWith('/back-office') ||
      route.path.startsWith('/history')    ||
      route.path.startsWith('/expenses')   ||
      route.path.startsWith('/shifts')     ||
      route.path.startsWith('/settings')
    )
    default: return false
  }
}
</script>

<template>
  <nav
    class="flex flex-shrink-0"
    style="
      background: linear-gradient(135deg, rgba(26,86,219,0.12), rgba(7,11,20,0.97));
      backdrop-filter: blur(20px) saturate(180%);
      border-top: 1px solid rgba(26,86,219,0.25);
      box-shadow: 0 -4px 24px rgba(26,86,219,0.14);
      padding-bottom: env(safe-area-inset-bottom);
    "
    dir="auto"
  >
    <RouterLink
      v-for="tab in tabs"
      :key="tab.key"
      :to="tab.to"
      class="flex-1 flex flex-col items-center justify-center py-2 gap-1 transition-all no-underline min-h-[56px] relative"
      :style="isActive(tab.key)
        ? 'color: #60A5FA;'
        : 'color: #3D4F6B'"
    >
      <!-- Active pill background -->
      <span
        v-if="isActive(tab.key)"
        class="absolute inset-x-1 inset-y-1 rounded-xl pointer-events-none"
        style="background: linear-gradient(135deg, rgba(26,86,219,0.22), rgba(26,86,219,0.10)); border: 1px solid rgba(26,86,219,0.30);"
      />

      <!-- Icons -->
      <svg v-if="tab.key === 'home'" class="w-[20px] h-[20px] relative z-10" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
      </svg>

      <svg v-if="tab.key === 'sell'" class="w-[20px] h-[20px] relative z-10" :fill="isActive('sell') ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
      </svg>

      <svg v-if="tab.key === 'customers'" class="w-[20px] h-[20px] relative z-10" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
      </svg>

      <svg v-if="tab.key === 'products'" class="w-[20px] h-[20px] relative z-10" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
      </svg>

      <svg v-if="tab.key === 'manage'" class="w-[20px] h-[20px] relative z-10" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
      </svg>

      <span
        class="relative z-10 leading-none font-semibold"
        :style="{
          fontSize: '10px',
          letterSpacing: tab.key === 'sell' ? '0.04em' : '0',
          color: isActive(tab.key) ? '#60A5FA' : '#3D4F6B',
          fontWeight: isActive(tab.key) ? '700' : '500',
        }"
      >{{ t(tab.labelKey) }}</span>
    </RouterLink>
  </nav>
</template>
