import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createApp } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { useSettingsStore } from '@/features/settings'
import ThemePickerScreen from '@/features/settings/screens/ThemePickerScreen.vue'

function makePinia() {
  const pinia = createPinia()
  pinia.use(piniaPluginPersistedstate)
  createApp({}).use(pinia)
  return pinia
}

describe('ThemePickerScreen', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(makePinia())
  })

  it('renders 4 theme swatches', () => {
    const wrapper = mount(ThemePickerScreen, {
      global: { plugins: [makePinia()] },
    })
    expect(wrapper.findAll('[data-testid="theme-swatch"]').length).toBe(4)
  })

  it('marks dark-luxury as selected by default', () => {
    const wrapper = mount(ThemePickerScreen, {
      global: { plugins: [makePinia()] },
    })
    const selected = wrapper.find('[data-testid="theme-swatch"][aria-pressed="true"]')
    expect(selected.exists()).toBe(true)
    expect(selected.attributes('data-theme')).toBe('dark-luxury')
  })

  it('updates store luxuryTheme when swatch is clicked', async () => {
    const pinia = makePinia()
    const wrapper = mount(ThemePickerScreen, {
      global: { plugins: [pinia] },
    })
    const store = useSettingsStore()
    const ivorySwatch = wrapper.find('[data-theme="light-ivory"]')
    await ivorySwatch.trigger('click')
    expect(store.luxuryTheme).toBe('light-ivory')
  })
})
