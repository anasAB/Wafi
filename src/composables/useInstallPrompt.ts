import { ref, computed } from 'vue'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// Module-scoped so the event is captured even when it fires before the
// component using this composable mounts.
const deferredPrompt = ref<BeforeInstallPromptEvent | null>(null)
const installed = ref(false)

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt.value = e as BeforeInstallPromptEvent
  })
  window.addEventListener('appinstalled', () => {
    installed.value = true
    deferredPrompt.value = null
  })
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
}

function detectIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) && /WebKit/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)
}

export function useInstallPrompt() {
  const canInstall  = computed(() => deferredPrompt.value !== null && !installed.value)
  const isInstalled = computed(() => installed.value || isStandalone())
  const isIosSafari = detectIosSafari() && !isStandalone()

  async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    const evt = deferredPrompt.value
    if (!evt) return 'unavailable'
    await evt.prompt()
    const { outcome } = await evt.userChoice
    deferredPrompt.value = null
    return outcome
  }

  return { canInstall, isInstalled, isIosSafari, promptInstall }
}
