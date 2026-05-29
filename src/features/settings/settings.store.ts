import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { Language, Theme, TextSize } from './settings.types'

const STORAGE_KEY = 'settings'

function loadFromStorage(): Partial<{ language: Language; theme: Theme; textSize: TextSize }> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const saved = loadFromStorage()

  const language = ref<Language>(saved.language ?? 'ar')
  const theme    = ref<Theme>(saved.theme ?? 'auto')
  const textSize = ref<TextSize>(saved.textSize ?? 'default')

  // Persist to localStorage synchronously whenever any setting changes
  watch(
    [language, theme, textSize],
    ([lang, th, ts]) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ language: lang, theme: th, textSize: ts }))
      } catch {
        // ignore storage errors
      }
    },
    { flush: 'sync' },
  )

  return { language, theme, textSize }
})
