<script setup lang="ts">
import { watch, onMounted, onBeforeUnmount } from 'vue'
import { useSettingsStore } from '@/features/settings'
import { i18n } from '@/i18n'
import type { Theme } from '@/features/settings'

const settings = useSettingsStore()

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
    class="min-h-dvh bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white"
  >
    <RouterView />
  </div>
</template>
