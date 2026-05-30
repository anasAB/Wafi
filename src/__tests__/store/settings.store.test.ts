import { describe, it, expect, beforeEach } from 'vitest'
import { createApp } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { useSettingsStore } from '@/features/settings'

function makePinia() {
  const pinia = createPinia()
  // Force flush:'sync' on $subscribe so persistence writes land synchronously in tests
  pinia.use(({ store }) => {
    const orig = store.$subscribe.bind(store)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store.$subscribe = (cb: any, opts: any = {}) => orig(cb, { flush: 'sync', ...opts })
  })
  pinia.use(piniaPluginPersistedstate)
  createApp({}).use(pinia) // activates the plugin
  return pinia
}

describe('useSettingsStore', () => {
  beforeEach(() => {
    localStorage.clear()            // clear storage first
    setActivePinia(makePinia())     // then create fresh Pinia over empty storage
  })

  it('has correct defaults', () => {
    const store = useSettingsStore()
    expect(store.language).toBe('ar')
    expect(store.theme).toBe('auto')
    expect(store.textSize).toBe('default')
  })

  it('language can be updated', () => {
    const store = useSettingsStore()
    store.language = 'en'
    expect(store.language).toBe('en')
  })

  it('theme can be updated', () => {
    const store = useSettingsStore()
    store.theme = 'dark'
    expect(store.theme).toBe('dark')
  })

  it('textSize can be updated', () => {
    const store = useSettingsStore()
    store.textSize = 'large'
    expect(store.textSize).toBe('large')
  })

  it('persists language to localStorage', () => {
    const store = useSettingsStore()
    store.language = 'en'
    const saved = JSON.parse(localStorage.getItem('settings') ?? '{}')
    expect(saved.language).toBe('en')
  })

  it('restores persisted values on next mount', () => {
    const store = useSettingsStore()
    store.language = 'en'
    store.theme = 'dark'
    store.textSize = 'xlarge'

    // Simulate app restart: new pinia, same localStorage
    setActivePinia(makePinia())
    const restored = useSettingsStore()
    expect(restored.language).toBe('en')
    expect(restored.theme).toBe('dark')
    expect(restored.textSize).toBe('xlarge')
  })
})
