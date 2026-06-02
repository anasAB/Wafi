<script setup lang="ts">
import { watch, onMounted, onBeforeUnmount, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useSettingsStore } from '@/features/settings'
import { useThemePalette } from '@/composables/useThemePalette'
import { i18n } from '@/i18n'
import type { Theme } from '@/features/settings'
import AppSidebar   from '@/components/layout/AppSidebar.vue'
import AppBottomNav from '@/components/layout/AppBottomNav.vue'

const route    = useRoute()
const settings = useSettingsStore()
useThemePalette()

const showSidebar = computed(() =>
  !route.path.startsWith('/pos')
)

const showBottomNav = computed(() => {
  if (route.path.startsWith('/pos'))                       return false
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
