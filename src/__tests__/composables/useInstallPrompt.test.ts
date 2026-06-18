import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'

function fireBeforeInstallPrompt() {
  const e = new Event('beforeinstallprompt') as any
  e.prompt = vi.fn().mockResolvedValue(undefined)
  e.userChoice = Promise.resolve({ outcome: 'accepted' })
  window.dispatchEvent(e)
  return e
}

async function freshComposable() {
  vi.resetModules()
  const mod = await import('@/composables/useInstallPrompt')
  return mod.useInstallPrompt
}

beforeEach(() => vi.resetModules())

describe('useInstallPrompt', () => {
  it('canInstall is false until beforeinstallprompt fires', async () => {
    const useInstallPrompt = await freshComposable()
    const Harness = { setup: () => useInstallPrompt(), template: '<span>{{ canInstall }}</span>' }
    const w = mount(Harness)
    expect(w.text()).toBe('false')
  })

  it('captures beforeinstallprompt and promptInstall resolves to the outcome', async () => {
    const useInstallPrompt = await freshComposable()
    const evt = fireBeforeInstallPrompt()
    const api = useInstallPrompt()
    expect(api.canInstall.value).toBe(true)

    const outcome = await api.promptInstall()
    expect(evt.prompt).toHaveBeenCalled()
    expect(outcome).toBe('accepted')
    expect(api.canInstall.value).toBe(false)
  })

  it('promptInstall returns "unavailable" with no stashed event', async () => {
    const useInstallPrompt = await freshComposable()
    const api = useInstallPrompt()
    expect(await api.promptInstall()).toBe('unavailable')
  })
})
