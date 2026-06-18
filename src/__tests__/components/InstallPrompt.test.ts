import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, computed } from 'vue'
import { mount } from '@vue/test-utils'

const state = {
  canInstall:  ref(false),
  isInstalled: ref(false),
  isIosSafari: false,
  promptInstall: vi.fn().mockResolvedValue('accepted'),
}
vi.mock('@/composables/useInstallPrompt', () => ({
  useInstallPrompt: () => ({
    canInstall:  computed(() => state.canInstall.value),
    isInstalled: computed(() => state.isInstalled.value),
    isIosSafari: state.isIosSafari,
    promptInstall: state.promptInstall,
  }),
}))

import InstallPrompt from '@/components/ui/InstallPrompt.vue'

describe('InstallPrompt', () => {
  beforeEach(() => {
    state.canInstall.value = false
    state.isInstalled.value = false
    state.isIosSafari = false
    state.promptInstall.mockClear()
    state.promptInstall.mockResolvedValue('accepted')
  })

  it('renders nothing when not installable and not iOS', () => {
    state.canInstall.value = false; state.isIosSafari = false
    const w = mount(InstallPrompt)
    expect(w.find('[data-testid="install-btn"]').exists()).toBe(false)
    expect(w.find('[data-testid="install-hint"]').exists()).toBe(false)
  })

  it('shows the install button and calls promptInstall on click', async () => {
    state.canInstall.value = true; state.isIosSafari = false
    const w = mount(InstallPrompt)
    await w.find('[data-testid="install-btn"]').trigger('click')
    expect(state.promptInstall).toHaveBeenCalled()
  })

  it('shows the iOS hint instead of the button on iOS Safari', () => {
    state.canInstall.value = false; state.isIosSafari = true
    const w = mount(InstallPrompt)
    expect(w.find('[data-testid="install-hint"]').exists()).toBe(true)
    expect(w.find('[data-testid="install-btn"]').exists()).toBe(false)
  })

  it('hides the affordance after an accepted install', async () => {
    state.canInstall.value = true
    const w = mount(InstallPrompt)
    await w.find('[data-testid="install-btn"]').trigger('click')
    await w.vm.$nextTick()
    expect(w.find('[data-testid="install-btn"]').exists()).toBe(false)
  })

  it('renders nothing when the app is already installed', () => {
    state.canInstall.value = true
    state.isInstalled.value = true
    const w = mount(InstallPrompt)
    expect(w.find('[data-testid="install-btn"]').exists()).toBe(false)
    expect(w.find('[data-testid="install-hint"]').exists()).toBe(false)
  })
})
