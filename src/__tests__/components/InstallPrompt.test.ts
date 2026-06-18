import { describe, it, expect, vi } from 'vitest'
import { ref, computed } from 'vue'
import { mount } from '@vue/test-utils'

const state = {
  canInstall:  ref(false),
  isIosSafari: false,
  promptInstall: vi.fn().mockResolvedValue('accepted'),
}
vi.mock('@/composables/useInstallPrompt', () => ({
  useInstallPrompt: () => ({
    canInstall:  computed(() => state.canInstall.value),
    isInstalled: computed(() => false),
    isIosSafari: state.isIosSafari,
    promptInstall: state.promptInstall,
  }),
}))

import InstallPrompt from '@/components/ui/InstallPrompt.vue'

describe('InstallPrompt', () => {
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
})
