import { describe, it, expect, vi } from 'vitest'
import { ref, computed } from 'vue'
import { mount } from '@vue/test-utils'

// Drive the pill's render states by mocking the composable (isolates the UI).
const state = {
  tone:  ref<'ok' | 'busy' | 'off'>('ok'),
  label: ref('متصل'),
}
vi.mock('@/composables/useConnectionStatus', () => ({
  useConnectionStatus: () => ({
    tone:   computed(() => state.tone.value),
    label:  computed(() => state.label.value),
    detail: computed(() => 'detail'),
    online: computed(() => state.tone.value !== 'off'),
    syncing: computed(() => state.tone.value === 'busy'),
    syncConfigured: false,
  }),
}))

import ConnectionPill from '@/components/ui/ConnectionPill.vue'

describe('ConnectionPill', () => {
  it('renders the connected label with a green dot', () => {
    state.tone.value = 'ok'; state.label.value = 'متصل'
    const w = mount(ConnectionPill)
    expect(w.find('[data-testid="connection-pill"]').exists()).toBe(true)
    expect(w.text()).toContain('متصل')
    expect(w.text()).not.toContain('غير')
    expect(w.find('.bg-green-500').exists()).toBe(true)
  })

  it('renders offline with a muted dot', () => {
    state.tone.value = 'off'; state.label.value = 'غير متصل'
    const w = mount(ConnectionPill)
    expect(w.text()).toContain('غير متصل')
    expect(w.find('.bg-text-muted').exists()).toBe(true)
  })

  it('renders syncing with a pulsing amber dot', () => {
    state.tone.value = 'busy'; state.label.value = 'جارٍ المزامنة'
    const w = mount(ConnectionPill)
    expect(w.text()).toContain('جارٍ المزامنة')
    expect(w.find('.bg-yellow-400').exists()).toBe(true)
  })
})
