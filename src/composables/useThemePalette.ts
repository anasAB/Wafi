import { watch } from 'vue'
import { useSettingsStore } from '@/features/settings'
import type { LuxuryTheme } from '@/features/settings'

export function applyThemePalette(theme: LuxuryTheme): void {
  document.documentElement.dataset.luxuryTheme = theme
}

export function useThemePalette(): void {
  const settings = useSettingsStore()
  watch(() => settings.luxuryTheme, applyThemePalette, { immediate: true })
}
