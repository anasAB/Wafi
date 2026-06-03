<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AppHeader from '@/components/ui/AppHeader.vue'

const router = useRouter()
const route  = useRoute()
const { t }  = useI18n()

const APP_VERSION = 'v0.1.0'
</script>

<template>
  <div class="flex flex-col min-h-dvh bg-bg-void" dir="rtl">
    <AppHeader
      :title="t('settings.title')"
      :show-back="true"
      @back="router.back()"
    />

    <!-- Mobile layout (hidden on md+) -->
    <main class="flex-1 md:hidden px-4 py-4 max-w-lg mx-auto w-full">

      <p class="text-xs font-medium text-text-muted mb-2 px-1 tracking-widest uppercase">{{ t('settings.personal') }}</p>
      <div class="glass-sm overflow-hidden mb-4">
        <button
          type="button"
          class="w-full flex items-center justify-between px-4 py-3.5 border-b border-border-glass text-sm text-text-primary active:bg-surface-glass"
          @click="router.push('/settings/personal')"
        >
          <span>{{ t('settings.personal') }}</span>
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-text-muted rtl:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
        <button
          type="button"
          class="w-full flex items-center justify-between px-4 py-3.5 border-b border-border-glass text-sm text-text-primary active:bg-surface-glass"
          @click="router.push('/settings/receipt')"
        >
          <span>إعدادات الفاتورة</span>
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-text-muted rtl:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
        <button
          type="button"
          class="w-full flex items-center justify-between px-4 py-3.5 text-sm text-red-500 opacity-50 cursor-not-allowed"
          disabled
        >
          <span>{{ t('personal.signOut') }}</span>
          <span class="text-xs text-text-muted">{{ t('common.comingSoon') }}</span>
        </button>
      </div>

      <p class="text-xs font-medium text-text-muted mb-2 px-1 tracking-widest uppercase">{{ t('settings.about') }}</p>
      <div class="glass-sm overflow-hidden">
        <div class="flex items-center justify-between px-4 py-3.5 text-sm text-text-primary">
          <span>{{ t('personal.aboutVersionLabel') }}</span>
          <span class="text-xs text-text-muted">{{ APP_VERSION }}</span>
        </div>
      </div>

    </main>

    <!-- Desktop layout (md+): sidebar (right in RTL) + content panel (left) -->
    <div class="hidden md:flex flex-1 max-w-4xl mx-auto w-full px-6 py-6 gap-6">

      <!-- Sidebar nav — appears on RIGHT in RTL because it's first in flex-row -->
      <nav class="w-52 flex-shrink-0">
        <div class="glass-sm overflow-hidden">
          <RouterLink
            to="/settings/personal"
            class="flex items-center justify-between px-4 py-3.5 text-sm border-b border-border-glass transition-colors"
            :class="route.path === '/settings/personal'
              ? 'text-gold-primary bg-surface-raised font-semibold'
              : 'text-text-muted hover:bg-surface-glass hover:text-text-primary'"
          >
            <span>{{ t('settings.personal') }}</span>
            <span v-if="route.path === '/settings/personal'" class="w-1.5 h-1.5 rounded-full bg-gold-primary" />
          </RouterLink>
          <RouterLink
            to="/settings/receipt"
            class="flex items-center justify-between px-4 py-3.5 text-sm border-b border-border-glass transition-colors"
            :class="route.path === '/settings/receipt'
              ? 'text-gold-primary bg-surface-raised font-semibold'
              : 'text-text-muted hover:bg-surface-glass hover:text-text-primary'"
          >
            <span>إعدادات الفاتورة</span>
            <span v-if="route.path === '/settings/receipt'" class="w-1.5 h-1.5 rounded-full bg-gold-primary" />
          </RouterLink>
          <div class="flex items-center justify-between px-4 py-3.5 text-sm text-text-muted">
            <span>{{ t('settings.about') }}</span>
            <span class="text-xs opacity-50">{{ APP_VERSION }}</span>
          </div>
        </div>
      </nav>

      <!-- Content panel -->
      <div class="flex-1 glass-sm overflow-hidden min-h-0">
        <RouterView />
        <div
          v-if="route.path === '/settings'"
          class="flex flex-col items-center justify-center h-48 gap-2 text-text-muted"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-8 h-8 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
          </svg>
          <p class="text-sm">{{ t('settings.selectSection') }}</p>
        </div>
      </div>

    </div>
  </div>
</template>
