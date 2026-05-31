import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { Language, Theme, TextSize, LuxuryTheme } from './settings.types'

export const useSettingsStore = defineStore('settings', () => {
  const language     = ref<Language>('ar')
  const theme        = ref<Theme>('auto')
  const textSize     = ref<TextSize>('default')
  const luxuryTheme  = ref<LuxuryTheme>('dark-luxury')

  return { language, theme, textSize, luxuryTheme }
}, {
  persist: true,
})
