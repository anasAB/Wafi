<script setup lang="ts">
import { useRoute, RouterLink } from 'vue-router'
import { useShiftStore } from '@/features/shifts/shift.store'
import { computed } from 'vue'

const route      = useRoute()
const shiftStore = useShiftStore()

const allTabs = [
  { key: 'home',    label: 'الرئيسية', to: '/'           },
  { key: 'sell',    label: 'بيع',      to: '/pos'         },
  { key: 'history', label: 'المبيعات', to: '/history'     },
  { key: 'manage',  label: 'الإدارة',  to: '/back-office' },
]

const tabs = computed(() => allTabs)

function isActive(key: string): boolean {
  switch (key) {
    case 'home':    return route.path === '/'
    case 'sell':    return route.path.startsWith('/pos')
    case 'history': return route.path.startsWith('/history')
    case 'manage':  return (
      route.path.startsWith('/back-office') ||
      route.path.startsWith('/products')   ||
      route.path.startsWith('/settings')   ||
      route.path.startsWith('/customers')  ||
      route.path.startsWith('/expenses')   ||
      route.path.startsWith('/shifts')
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
      box-shadow: 0 -4px 20px rgba(26,86,219,0.12);
      padding-bottom: env(safe-area-inset-bottom);
    "
    dir="auto"
  >
    <RouterLink
      v-for="tab in tabs"
      :key="tab.key"
      :to="tab.to"
      class="flex-1 flex flex-col items-center justify-center pt-2 pb-1.5 gap-0.5 transition-colors no-underline min-h-[56px]"
      :style="isActive(tab.key)
        ? 'color: #60A5FA; background: linear-gradient(135deg, rgba(26,86,219,0.20), rgba(26,86,219,0.08)); border-radius: 0.75rem; margin: 4px 2px;'
        : 'color: #3D4F6B'"
    >
      <!-- Home -->
      <svg v-if="tab.key === 'home'" class="w-[22px] h-[22px]" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
      </svg>
      <!-- Sell — filled when active -->
      <svg v-if="tab.key === 'sell'" class="w-[22px] h-[22px]" :fill="isActive('sell') ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
      </svg>
      <!-- History -->
      <svg v-if="tab.key === 'history'" class="w-[22px] h-[22px]" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
      </svg>
      <!-- Manage -->
      <svg v-if="tab.key === 'manage'" class="w-[22px] h-[22px]" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
      </svg>

      <span
        class="text-[10px] font-semibold leading-none"
        :style="isActive(tab.key) ? 'color: #60A5FA' : 'color: #3D4F6B'"
      >{{ tab.label }}</span>

      <!-- Active indicator dot -->
      <span
        v-if="isActive(tab.key)"
        class="w-1 h-1 rounded-full mt-0.5"
        style="background: #60A5FA; box-shadow: 0 0 6px rgba(96,165,250,0.7);"
      ></span>
    </RouterLink>
  </nav>
</template>
