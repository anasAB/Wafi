import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { Language, Theme, TextSize, LuxuryTheme, IdleTimeout } from './settings.types'

export const useSettingsStore = defineStore('settings', () => {
  const language        = ref<Language>('ar')
  const theme           = ref<Theme>('auto')
  const textSize        = ref<TextSize>('default')
  const luxuryTheme     = ref<LuxuryTheme>('dark-luxury')
  // WAFI-062: idle minutes before PIN re-entry; default 15.
  const idleTimeout     = ref<IdleTimeout>(15)

  return { language, theme, textSize, luxuryTheme, idleTimeout }
}, {
  persist: true,
})
