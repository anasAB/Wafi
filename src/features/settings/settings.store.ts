import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { Language, Theme, TextSize } from './settings.types'

export const useSettingsStore = defineStore('settings', () => {
  const language = ref<Language>('ar')
  const theme    = ref<Theme>('auto')
  const textSize = ref<TextSize>('default')

  return { language, theme, textSize }
}, {
  persist: true,
})
