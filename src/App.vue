<script setup lang="ts">
import { watch, onMounted, onBeforeUnmount, computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSettingsStore } from '@/features/settings'
import { useThemePalette } from '@/composables/useThemePalette'
import { i18n } from '@/i18n'
import type { Theme } from '@/features/settings'
import AppSidebar   from '@/components/layout/AppSidebar.vue'
import AppBottomNav from '@/components/layout/AppBottomNav.vue'
import AppToast from '@/components/ui/AppToast.vue'
import { usePwaLifecycle } from '@/composables/usePwaLifecycle'
import { useShiftStore } from '@/features/shifts/shift.store'
import { useShift }      from '@/features/shifts/composables/useShift'
import { useStaff }      from '@/features/staff/composables/useStaff'
import LockScreen        from '@/features/shifts/components/LockScreen.vue'
import IdleLockOverlay   from '@/features/shifts/components/IdleLockOverlay.vue'
import { useIdleLock }   from '@/composables/useIdleLock'
import { db }            from '@/data/powersync/db'
import { useSaleStore }  from '@/store/sale.store'

const { offlineReady, dismissOfflineReady, needRefresh, applyUpdate, dismissNeedRefresh } = usePwaLifecycle()

const route    = useRoute()
const router   = useRouter()
const settings = useSettingsStore()
useThemePalette()

const shiftStore   = useShiftStore()
const { loadActiveShift } = useShift()
const { hasAnyStaff }     = useStaff()
// WAFI-062: idle auto-lock. `locked` only flips while a shift is open (see
// useIdleLock), so the overlay never collides with the login gate.
const { locked: idleLocked, unlock: unlockIdle } = useIdleLock()
const appReady  = ref(false)
const hasStaff  = ref(false)

const showSidebar = computed(() => true)

const showBottomNav = computed(() => {
  if (route.path === '/pos/confirmation')                  return false
  if (route.path === '/products/add')                      return false
  if (/^\/products\/[^/]+\/edit$/.test(route.path))       return false
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
onMounted(async () => {
  mq.addEventListener('change', onSystemThemeChange)

  // A freshly-provisioned device starts with an empty local DB: the owner's
  // staff row arrives via the first sync. Decide "no owner → setup wizard" only
  // AFTER that sync has had a chance to land, or we'd wrongly send a provisioned
  // device into /setup-owner on its first launch. Bounded by a timeout so a bad
  // token / slow network never hangs startup; skipped offline (local is then the
  // source of truth) and resolves instantly on warm starts (sync already done).
  if (import.meta.env.VITE_POWERSYNC_URL && navigator.onLine) {
    await Promise.race([
      db.waitForFirstSync(),
      new Promise(resolve => setTimeout(resolve, 8000)),
    ]).catch(() => { /* offline/error — fall back to local state */ })
  }

  // Durably seed the receipt counter from already-synced sales, so a cache clear
  // / PWA reinstall / new device can't re-issue a receipt number that already
  // exists (which would jam sync on uq_sale_number_per_shop).
  await useSaleStore().reconcileSequenceFromDb()

  const staffExist = await hasAnyStaff()
  hasStaff.value = staffExist
  if (!staffExist) {
    router.push('/setup-owner')
    appReady.value = true
    return
  }
  if (shiftStore.activeShiftId) {
    await loadActiveShift()  // validates and clears store if shift was closed
  }
  appReady.value = true
})
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
  <AppToast
    v-if="offlineReady"
    type="success"
    message="التطبيق جاهز للعمل بدون إنترنت"
    @dismiss="dismissOfflineReady"
  />
  <AppToast
    v-if="needRefresh"
    type="info"
    message="تحديث متاح"
    action-label="تحديث"
    :auto-dismiss="false"
    @action="applyUpdate"
    @dismiss="dismissNeedRefresh"
  />

  <!-- Branded loading splash (BUG-001) -->
  <div
    v-if="!appReady"
    class="fixed inset-0 bg-[#06090F] flex flex-col items-center justify-center gap-6"
    role="status"
    aria-live="polite"
    aria-label="جاري تحميل وافي"
  >
    <!-- App wordmark -->
    <h1
      class="text-5xl font-bold leading-none"
      style="font-family: var(--font-display-ar); color: var(--color-gold-primary)"
    >وافي</h1>
    <!-- Spinner (brand-colored arc) -->
    <div
      class="w-9 h-9 rounded-full border-2 border-white/10 animate-spin"
      style="border-top-color: var(--color-gold-primary)"
      aria-hidden="true"
    ></div>
    <span class="text-[#637285] text-sm">جاري التحميل...</span>
  </div>

  <template v-else>
    <!-- Single login gate: pick staff → PIN → opening cash opens the shift and
         establishes the session identity (audit + permissions) in one step. -->
    <LockScreen v-if="hasStaff && !shiftStore.isShiftOpen" />

    <!-- Normal app shell -->
    <div
      v-else
      id="app"
      :dir="settings.language === 'ar' ? 'rtl' : 'ltr'"
      :lang="settings.language"
      class="h-dvh bg-bg-void text-text-primary flex overflow-hidden"
    >
      <div class="sidebar-wrap">
        <AppSidebar v-if="showSidebar" />
      </div>
      <div class="flex-1 min-w-0 flex flex-col overflow-hidden">
        <div class="flex-1 overflow-y-auto">
          <RouterView />
        </div>
        <div class="bottomnav-wrap">
          <AppBottomNav v-if="showBottomNav" />
        </div>
      </div>

      <!-- Idle lock: dims the shell and requires PIN re-entry; the shift stays
           open underneath (WAFI-062). -->
      <IdleLockOverlay v-if="idleLocked" @unlock="unlockIdle" />
    </div>
  </template>
</template>

<style scoped>
/* Sidebar: hidden on mobile, flex on desktop */
.sidebar-wrap {
  display: none;
}
@media (min-width: 1024px) {
  .sidebar-wrap {
    display: flex;
  }
}

/* Bottom nav: flex on mobile, hidden on desktop */
.bottomnav-wrap {
  display: flex;
  flex-direction: column;
}
@media (min-width: 1024px) {
  .bottomnav-wrap {
    display: none;
  }
}
</style>
