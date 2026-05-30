<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'

const router = useRouter()
const route  = useRoute()
</script>

<template>
  <div class="flex flex-col min-h-dvh">
    <AppHeader
      title="الإعدادات"
      :show-back="true"
      :show-settings="false"
      @back="router.back()"
    />

    <!-- Mobile layout (hidden on md+): full-screen grouped list -->
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
          class="w-full flex items-center justify-between px-4 py-3.5 text-sm text-red-500 opacity-60 cursor-not-allowed"
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

    <!-- Desktop layout (md+): sidebar + content panel -->
    <div class="hidden md:flex flex-1 max-w-2xl mx-auto w-full px-6 py-6 gap-6">

      <!-- Sidebar nav -->
      <nav class="w-44 flex-shrink-0">
        <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden">
          <RouterLink
            to="/settings/personal"
            class="block px-4 py-3 text-sm border-b border-gray-100 dark:border-gray-700"
            :class="route.path === '/settings/personal'
              ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 font-medium'
              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'"
          >
            شخصي
          </RouterLink>
          <div class="px-4 py-3 text-sm text-gray-400 dark:text-gray-500">
            حول التطبيق
            <span class="text-xs mr-1 text-gray-300 dark:text-gray-600">v0.1.0</span>
          </div>
        </div>
      </nav>

      <!-- Content panel: sub-screens render here via RouterView on desktop -->
      <div class="flex-1 bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden">
        <RouterView />
        <div
          v-if="route.path === '/settings'"
          class="flex items-center justify-center h-48 text-sm text-gray-400 dark:text-gray-500"
        >
          اختر قسماً من القائمة
        </div>
      </div>

    </div>
  </div>
</template>
