<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AppHeader from '@/components/ui/AppHeader.vue'

const router = useRouter()
const route  = useRoute()
const { t }  = useI18n()

const APP_VERSION = 'v0.1.0'

// Settings is a list (mobile) / sidebar + panel (desktop). The sub-screens render
// through a single <RouterView>, but it can only live in ONE branch or the child
// mounts twice. So we pick the layout reactively by breakpoint (v-if, not CSS) and
// keep exactly one RouterView active: desktop always uses the panel; mobile uses
// the list at the index and swaps to the child screen on a sub-route.
const mq = window.matchMedia('(min-width: 1024px)')
const isDesktop = ref(mq.matches)
const onMqChange = (e: MediaQueryListEvent) => { isDesktop.value = e.matches }
onMounted(() => mq.addEventListener('change', onMqChange))
onUnmounted(() => mq.removeEventListener('change', onMqChange))

const isIndex = computed(() => route.path === '/settings')
// The settings title bar is shown on desktop and at the mobile index; on a mobile
// sub-screen the child supplies its own header, so we hide this one.
const showSettingsHeader = computed(() => isDesktop.value || isIndex.value)

// Default desktop tab: when opening /settings without a selected child tab,
// route to the audit log. Mobile keeps the list view at /settings.
watch(
  [isDesktop, () => route.path],
  ([desktop, path]) => {
    if (desktop && path === '/settings') {
      router.replace('/settings/audit-log')
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="page-root" dir="rtl">
    <AppHeader
      v-if="showSettingsHeader"
      :title="t('settings.title')"
      @back="router.back()"
    />

    <!-- Mobile: the settings list (index only) -->
    <main v-if="!isDesktop && isIndex" class="mobile-main">

      <p class="section-label">{{ t('settings.personal') }}</p>
      <div class="settings-card">

        <!-- Personal preferences -->
        <button
          type="button"
          class="nav-row"
          @click="router.push('/settings/personal')"
        >
          <div class="nav-row-start">
            <span class="nav-icon-wrap">
              <svg class="nav-icon" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </span>
            <span class="nav-title">{{ t('settings.personal') }}</span>
          </div>
          <svg class="nav-arrow" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <!-- Receipt settings -->
        <button
          type="button"
          class="nav-row"
          @click="router.push('/settings/receipt')"
        >
          <div class="nav-row-start">
            <span class="nav-icon-wrap">
              <svg class="nav-icon" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
              </svg>
            </span>
            <span class="nav-title">{{ t('settings.receiptSettings') }}</span>
          </div>
          <svg class="nav-arrow" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <!-- Staff -->
        <button
          type="button"
          class="nav-row"
          @click="router.push('/settings/staff')"
        >
          <div class="nav-row-start">
            <span class="nav-icon-wrap">
              <svg class="nav-icon" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
              </svg>
            </span>
            <span class="nav-title">{{ t('settings.staff') }}</span>
          </div>
          <svg class="nav-arrow" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <!-- Recovery codes -->
        <button
          type="button"
          class="nav-row"
          @click="router.push('/settings/recovery-codes')"
        >
          <div class="nav-row-start">
            <span class="nav-icon-wrap">
              <svg class="nav-icon" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
              </svg>
            </span>
            <span class="nav-title">{{ t('settings.recoveryCodes') }}</span>
          </div>
          <svg class="nav-arrow" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <!-- Return reasons -->
        <button
          type="button"
          class="nav-row"
          @click="router.push('/settings/return-reasons')"
        >
          <div class="nav-row-start">
            <span class="nav-icon-wrap">
              <svg class="nav-icon" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
              </svg>
            </span>
            <span class="nav-title">{{ t('settings.returnReasons') }}</span>
          </div>
          <svg class="nav-arrow" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <!-- WAFI-125: scanner pairing & diagnostics -->
        <button
          type="button"
          class="nav-row"
          @click="router.push('/settings/scanner')"
        >
          <div class="nav-row-start">
            <span class="nav-icon-wrap">
              <svg class="nav-icon" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75h-.75v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75h-.75v-.75z" />
              </svg>
            </span>
            <span class="nav-title">الماسح الضوئي</span>
          </div>
          <svg class="nav-arrow" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <!-- WAFI-130: device management -->
        <button
          type="button"
          class="nav-row"
          @click="router.push('/settings/devices')"
        >
          <div class="nav-row-start">
            <span class="nav-icon-wrap">
              <svg class="nav-icon" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
              </svg>
            </span>
            <span class="nav-title">الأجهزة</span>
          </div>
          <svg class="nav-arrow" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <!-- Denomination list (WAFI-103) -->
        <button
          type="button"
          class="nav-row"
          @click="router.push('/settings/denominations')"
        >
          <div class="nav-row-start">
            <span class="nav-icon-wrap">
              <svg class="nav-icon" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </span>
            <span class="nav-title">فئات العملة</span>
          </div>
          <svg class="nav-arrow" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <!-- Audit log -->
        <button
          type="button"
          class="nav-row"
          @click="router.push('/settings/audit-log')"
        >
          <div class="nav-row-start">
            <span class="nav-icon-wrap">
              <svg class="nav-icon" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
              </svg>
            </span>
            <span class="nav-title">{{ t('settings.auditLog') }}</span>
          </div>
          <svg class="nav-arrow" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <!-- Data export -->
        <button
          type="button"
          class="nav-row"
          @click="router.push('/settings/exports')"
        >
          <div class="nav-row-start">
            <span class="nav-icon-wrap">
              <svg class="nav-icon" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
            </span>
            <span class="nav-title">{{ t('settings.dataExport') }}</span>
          </div>
          <svg class="nav-arrow" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <!-- Sign out (disabled) -->
        <button type="button" class="nav-row nav-row--danger nav-row--last" disabled>
          <div class="nav-row-start">
            <span class="nav-icon-wrap nav-icon-wrap--danger">
              <svg class="nav-icon" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
              </svg>
            </span>
            <span class="nav-title nav-title--danger">{{ t('personal.signOut') }}</span>
          </div>
          <span class="coming-soon">{{ t('common.comingSoon') }}</span>
        </button>

      </div>

      <p class="section-label">{{ t('settings.about') }}</p>
      <div class="settings-card">
        <div class="about-row">
          <span class="nav-title">{{ t('personal.aboutVersionLabel') }}</span>
          <span class="version-badge">{{ APP_VERSION }}</span>
        </div>
      </div>

    </main>

    <!-- Mobile: a sub-screen renders here (the child provides its own header) -->
    <RouterView v-if="!isDesktop && !isIndex" />

    <!-- Desktop layout (lg+): sidebar + content panel -->
    <div v-if="isDesktop" class="desktop-layout lg:flex">

      <!-- Settings nav sidebar -->
      <nav class="desktop-nav">
        <div class="settings-card">

          <RouterLink
            to="/settings/personal"
            class="desktop-nav-link"
            :class="route.path === '/settings/personal' ? 'desktop-nav-link--active' : ''"
            style="border-bottom: 1px solid rgba(26,86,219,0.14)"
          >
            <div class="nav-row-start">
              <svg class="nav-icon-sm" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>{{ t('settings.personal') }}</span>
            </div>
            <span v-if="route.path === '/settings/personal'" class="active-dot" />
          </RouterLink>

          <RouterLink
            to="/settings/receipt"
            class="desktop-nav-link"
            :class="route.path === '/settings/receipt' ? 'desktop-nav-link--active' : ''"
            style="border-bottom: 1px solid rgba(26,86,219,0.14)"
          >
            <div class="nav-row-start">
              <svg class="nav-icon-sm" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
              </svg>
              <span>{{ t('settings.receiptSettings') }}</span>
            </div>
            <span v-if="route.path === '/settings/receipt'" class="active-dot" />
          </RouterLink>

          <RouterLink
            to="/settings/staff"
            class="desktop-nav-link"
            :class="route.path === '/settings/staff' ? 'desktop-nav-link--active' : ''"
            style="border-bottom: 1px solid rgba(26,86,219,0.14)"
          >
            <div class="nav-row-start">
              <svg class="nav-icon-sm" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
              </svg>
              <span>{{ t('settings.staff') }}</span>
            </div>
            <span v-if="route.path === '/settings/staff'" class="active-dot" />
          </RouterLink>

          <RouterLink
            to="/settings/recovery-codes"
            class="desktop-nav-link"
            :class="route.path === '/settings/recovery-codes' ? 'desktop-nav-link--active' : ''"
            style="border-bottom: 1px solid rgba(26,86,219,0.14)"
          >
            <div class="nav-row-start">
              <svg class="nav-icon-sm" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
              </svg>
              <span>{{ t('settings.recoveryCodes') }}</span>
            </div>
            <span v-if="route.path === '/settings/recovery-codes'" class="active-dot" />
          </RouterLink>

          <RouterLink
            to="/settings/return-reasons"
            class="desktop-nav-link"
            :class="route.path === '/settings/return-reasons' ? 'desktop-nav-link--active' : ''"
            style="border-bottom: 1px solid rgba(26,86,219,0.14)"
          >
            <div class="nav-row-start">
              <svg class="nav-icon-sm" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
              </svg>
              <span>{{ t('settings.returnReasons') }}</span>
            </div>
            <span v-if="route.path === '/settings/return-reasons'" class="active-dot" />
          </RouterLink>

          <RouterLink
            to="/settings/scanner"
            class="desktop-nav-link"
            :class="route.path === '/settings/scanner' ? 'desktop-nav-link--active' : ''"
            style="border-bottom: 1px solid rgba(26,86,219,0.14)"
          >
            <div class="nav-row-start">
              <svg class="nav-icon-sm" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
              </svg>
              <span>الماسح الضوئي</span>
            </div>
            <span v-if="route.path === '/settings/scanner'" class="active-dot" />
          </RouterLink>

          <RouterLink
            to="/settings/devices"
            class="desktop-nav-link"
            :class="route.path === '/settings/devices' ? 'desktop-nav-link--active' : ''"
            style="border-bottom: 1px solid rgba(26,86,219,0.14)"
          >
            <div class="nav-row-start">
              <svg class="nav-icon-sm" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
              </svg>
              <span>الأجهزة</span>
            </div>
            <span v-if="route.path === '/settings/devices'" class="active-dot" />
          </RouterLink>

          <RouterLink
            to="/settings/audit-log"
            class="desktop-nav-link"
            :class="route.path === '/settings/audit-log' ? 'desktop-nav-link--active' : ''"
            style="border-bottom: 1px solid rgba(26,86,219,0.14)"
          >
            <div class="nav-row-start">
              <svg class="nav-icon-sm" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
              </svg>
              <span>{{ t('settings.auditLog') }}</span>
            </div>
            <span v-if="route.path === '/settings/audit-log'" class="active-dot" />
          </RouterLink>

          <RouterLink
            to="/settings/exports"
            class="desktop-nav-link"
            :class="route.path === '/settings/exports' ? 'desktop-nav-link--active' : ''"
          >
            <div class="nav-row-start">
              <svg class="nav-icon-sm" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              <span>{{ t('settings.dataExport') }}</span>
            </div>
            <span v-if="route.path === '/settings/exports'" class="active-dot" />
          </RouterLink>

          <!-- About row -->
          <div class="desktop-about-row">
            <span class="about-label">{{ t('settings.about') }}</span>
            <span class="version-mono">{{ APP_VERSION }}</span>
          </div>
        </div>
      </nav>

      <!-- Content panel -->
      <div class="content-panel">
        <RouterView />
        <!-- Placeholder when no section is selected -->
        <div v-if="route.path === '/settings'" class="content-placeholder">
          <svg class="placeholder-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
          </svg>
          <p class="placeholder-text">{{ t('settings.selectSection') }}</p>
        </div>
      </div>

    </div>
  </div>
</template>

<style scoped>
/* ─── Layout ─────────────────────────────────────────────── */
.page-root {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  background: #06090F;
  font-family: 'Tajawal', system-ui, sans-serif;
}

/* ─── Mobile main ─────────────────────────────────────────── */
.mobile-main {
  flex: 1;
  padding: 20px 16px;
  max-width: 512px;
  margin: 0 auto;
  width: 100%;
  padding-bottom: 80px;
}

/* ─── Section label ───────────────────────────────────────── */
.section-label {
  font-size: 11px;
  font-weight: 700;
  color: #3D4F6B;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding: 8px 4px;
  margin-bottom: 6px;
  margin-top: 16px;
}

.section-label:first-child { margin-top: 0; }

/* ─── Settings card ───────────────────────────────────────── */
.settings-card {
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.11), rgba(255, 255, 255, 0.04));
  border: 1px solid rgba(26, 86, 219, 0.28);
  border-radius: 1rem;
  box-shadow: 0 4px 20px rgba(26, 86, 219, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.07);
  overflow: hidden;
  margin-bottom: 8px;
}

/* ─── Nav rows ────────────────────────────────────────────── */
.nav-row {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  background: transparent;
  border-inline: none;
  border-top: none;
  text-align: right;
  cursor: pointer;
  transition: background 0.15s;
}

.nav-row:hover:not(:disabled) { background: rgba(26, 86, 219, 0.06); }

.nav-row--last { border-bottom: none; }

.nav-row--danger {
  cursor: not-allowed;
  opacity: 0.5;
}

/* ─── Nav row internals ───────────────────────────────────── */
.nav-row-start {
  display: flex;
  align-items: center;
  gap: 12px;
}

.nav-icon-wrap {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(26, 86, 219, 0.15);
  flex-shrink: 0;
}

.nav-icon-wrap--danger { background: rgba(239, 68, 68, 0.12); }

.nav-icon {
  width: 16px;
  height: 16px;
  color: #60A5FA;
}

.nav-icon-wrap--danger .nav-icon { color: #EF4444; }

.nav-title {
  font-size: 14px;
  color: #E8EDF5;
  font-weight: 500;
}

.nav-title--danger { color: #EF4444; }

.nav-arrow {
  width: 16px;
  height: 16px;
  color: #3D4F6B;
  /* RTL: flip chevron direction */
  transform: rotate(180deg);
}

[dir="rtl"] .nav-arrow { transform: rotate(180deg); }
[dir="ltr"] .nav-arrow { transform: none; }

/* ─── About row (mobile) ──────────────────────────────────── */
.about-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
}

.version-badge {
  font-size: 0.75rem;
  font-family: monospace;
  color: #637285;
}

/* ─── Coming soon ─────────────────────────────────────────── */
.coming-soon {
  font-size: 0.75rem;
  color: #637285;
}

/* ─── Desktop layout ──────────────────────────────────────── */
.desktop-layout {
  flex: 1;
  padding: 24px;
  gap: 24px;
}

/* ─── Desktop nav sidebar ─────────────────────────────────── */
.desktop-nav {
  width: 224px;
  flex-shrink: 0;
}

.desktop-nav-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  font-size: 0.875rem;
  color: #637285;
  text-decoration: none;
  transition: background 0.15s, color 0.15s;
}

.desktop-nav-link:hover { background: rgba(26, 86, 219, 0.06); color: #E8EDF5; }

.desktop-nav-link--active {
  color: #60A5FA;
  font-weight: 600;
  background: rgba(26, 86, 219, 0.10);
}

.nav-icon-sm {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.active-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #1A56DB;
  flex-shrink: 0;
}

/* ─── Desktop about row ───────────────────────────────────── */
.desktop-about-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-top: 1px solid rgba(26, 86, 219, 0.14);
}

.about-label {
  font-size: 0.75rem;
  color: #637285;
  opacity: 0.6;
}

.version-mono {
  font-size: 0.75rem;
  font-family: monospace;
  color: #637285;
  opacity: 0.5;
}

/* ─── Content panel ───────────────────────────────────────── */
.content-panel {
  flex: 1;
  min-width: 0;
  border-radius: 1rem;
  overflow: auto;
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.11), rgba(255, 255, 255, 0.04));
  border: 1px solid rgba(26, 86, 219, 0.28);
  box-shadow: 0 4px 20px rgba(26, 86, 219, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.07);
}

/* ─── Content placeholder ─────────────────────────────────── */
.content-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 192px;
  gap: 12px;
  color: #637285;
}

.placeholder-icon {
  width: 32px;
  height: 32px;
  opacity: 0.2;
}

.placeholder-text {
  font-size: 0.875rem;
  color: #637285;
}
</style>
