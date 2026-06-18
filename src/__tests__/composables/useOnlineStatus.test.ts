import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { useOnlineStatus } from '@/composables/useOnlineStatus'

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value })
}

const Harness = {
  setup() { return useOnlineStatus() },
  template: '<span>{{ isOnline }}</span>',
}

afterEach(() => setOnline(true))

describe('useOnlineStatus', () => {
  it('initializes from navigator.onLine', () => {
    setOnline(false)
    const w = mount(Harness)
    expect(w.text()).toBe('false')
  })

  it('flips to false on an offline event and back on online', async () => {
    setOnline(true)
    const w = mount(Harness)
    expect(w.text()).toBe('true')

    setOnline(false)
    window.dispatchEvent(new Event('offline'))
    await w.vm.$nextTick()
    expect(w.text()).toBe('false')

    setOnline(true)
    window.dispatchEvent(new Event('online'))
    await w.vm.$nextTick()
    expect(w.text()).toBe('true')
  })
})
