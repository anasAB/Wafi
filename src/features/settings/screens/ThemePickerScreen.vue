<script setup lang="ts">
import { useSettingsStore } from '@/features/settings'
import type { LuxuryTheme } from '@/features/settings'

const settings = useSettingsStore()

const themes: { value: LuxuryTheme; label: string; dot: string; bg: string }[] = [
  { value: 'dark-luxury',  label: 'Dark Luxury',  dot: '#C9A84C', bg: '#05080F' },
  { value: 'light-ivory',  label: 'Light Ivory',  dot: '#B8965A', bg: '#FAF8F4' },
  { value: 'deep-jewel',   label: 'Deep Jewel',   dot: '#2ECC8F', bg: '#080D1A' },
  { value: 'sapphire',     label: 'Sapphire',     dot: '#3B7FFF', bg: '#05080F' },
]
</script>

<template>
  <div class="grid grid-cols-2 gap-3">
    <button
      v-for="theme in themes"
      :key="theme.value"
      type="button"
      data-testid="theme-swatch"
      :data-theme="theme.value"
      :aria-pressed="settings.luxuryTheme === theme.value"
      class="flex flex-col items-start gap-2 p-4 rounded-xl transition-all text-start"
      :style="{
        background: theme.bg === '#FAF8F4' ? 'rgb(250 248 244)' : 'rgb(255 255 255 / 0.06)',
        border: settings.luxuryTheme === theme.value
          ? `2px solid ${theme.dot}`
          : '1px solid rgb(255 255 255 / 0.12)',
        color: theme.bg === '#FAF8F4' ? '#1A1410' : '#F5F0E8',
      }"
      @click="settings.luxuryTheme = theme.value"
    >
      <span class="w-4 h-4 rounded-full shrink-0" :style="{ background: theme.dot }" />
      <span class="text-xs font-medium">{{ theme.label }}</span>
    </button>
  </div>
</template>
