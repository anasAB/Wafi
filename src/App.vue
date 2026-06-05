<script setup lang="ts">
import { watch, onMounted, onBeforeUnmount, computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSettingsStore } from '@/features/settings'
import { useThemePalette } from '@/composables/useThemePalette'
import { i18n } from '@/i18n'
import type { Theme } from '@/features/settings'
import AppSidebar   from '@/components/layout/AppSidebar.vue'
import AppBottomNav from '@/components/layout/AppBottomNav.vue'
import { useShiftStore } from '@/features/shifts/shift.store'
import { useShift }      from '@/features/shifts/composables/useShift'
import { useStaff }      from '@/features/staff/composables/useStaff'
import LockScreen        from '@/features/shifts/components/LockScreen.vue'

const route    = useRoute()
const router   = useRouter()
const settings = useSettingsStore()
useThemePalette()

const shiftStore = useShiftStore()
const { loadActiveShift } = useShift()
const { hasAnyStaff }     = useStaff()
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
  <!-- Loading splash -->
  <div v-if="!appReady" class="fixed inset-0 bg-[#06090F] flex items-center justify-center">
    <span class="text-[#637285] text-sm">جاري التحميل...</span>
  </div>

  <template v-else>
    <!-- Shift gate — blocks the whole app when no shift is open -->
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
