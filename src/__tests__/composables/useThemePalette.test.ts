import { describe, it, expect, beforeEach } from 'vitest'
import { createApp } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { applyThemePalette } from '@/composables/useThemePalette'
import type { LuxuryTheme } from '@/features/settings'

function makePinia() {
  const pinia = createPinia()
  pinia.use(piniaPluginPersistedstate)
  createApp({}).use(pinia)
  return pinia
}

describe('applyThemePalette', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(makePinia())
    delete document.documentElement.dataset.luxuryTheme
  })

  it('sets data-luxury-theme on documentElement', () => {
    applyThemePalette('dark-luxury')
    expect(document.documentElement.dataset.luxuryTheme).toBe('dark-luxury')
  })

  it('updates attribute when called with a different theme', () => {
    applyThemePalette('dark-luxury')
    applyThemePalette('light-ivory')
    expect(document.documentElement.dataset.luxuryTheme).toBe('light-ivory')
  })

  it('handles all four themes without throwing', () => {
    const themes: LuxuryTheme[] = ['dark-luxury', 'light-ivory', 'deep-jewel', 'sapphire']
    themes.forEach(t => {
      expect(() => applyThemePalette(t)).not.toThrow()
      expect(document.documentElement.dataset.luxuryTheme).toBe(t)
    })
  })
})
