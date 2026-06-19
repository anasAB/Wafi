import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useConnectionStatus } from '@/composables/useConnectionStatus'
import { useSyncStore } from '@/store/sync.store'

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value })
}

let pinia: ReturnType<typeof createPinia>

// useOnlineStatus uses onMounted/onUnmounted, so the composable must run inside
// a mounted component. Capture its return refs via a harness.
function mountStatus(): ReturnType<typeof useConnectionStatus> {
  let api!: ReturnType<typeof useConnectionStatus>
  const Harness = { setup() { api = useConnectionStatus(); return {} }, template: '<div/>' }
  mount(Harness, { global: { plugins: [pinia] } })
  return api
}

beforeEach(() => { pinia = createPinia(); setActivePinia(pinia) })
afterEach(() => setOnline(true))

describe('useConnectionStatus', () => {
  it('offline network → غير متصل / off, regardless of sync', () => {
    setOnline(false)
    const c = mountStatus()
    expect(c.online.value).toBe(false)
    expect(c.label.value).toBe('غير متصل')
    expect(c.tone.value).toBe('off')
  })

  it('online and not syncing → متصل / ok', () => {
    setOnline(true)
    const c = mountStatus()
    expect(c.label.value).toBe('متصل')
    expect(c.tone.value).toBe('ok')
  })

  it('online while the sync store is syncing → جارٍ المزامنة / busy', () => {
    setOnline(true)
    useSyncStore().setStatus('syncing')
    const c = mountStatus()
    expect(c.label.value).toBe('جارٍ المزامنة')
    expect(c.tone.value).toBe('busy')
  })

  it('offline takes precedence over a syncing sync store', () => {
    setOnline(false)
    useSyncStore().setStatus('syncing')
    const c = mountStatus()
    expect(c.tone.value).toBe('off')
    expect(c.label.value).toBe('غير متصل')
  })
})
