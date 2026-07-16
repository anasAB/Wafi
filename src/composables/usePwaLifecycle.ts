import { ref } from 'vue'
import { registerSW } from 'virtual:pwa-register'

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000

/**
 * Wraps the service-worker registration and exposes its lifecycle as reactive
 * refs the app shell renders UI from. With registerType 'prompt' (vite.config),
 * `needRefresh` drives the update toast and `applyUpdate()` reloads to the new
 * SW; `offlineReady` fires once the app is cached for offline use.
 *
 * A browser only re-checks sw.js for free on navigation, so an idle tab left
 * open across a deploy would never see `needRefresh` flip. The interval below
 * polls registration.update() to catch that case — it only refreshes the
 * waiting worker, it never activates or reloads on its own, so the no-mid-sale
 * -reload guarantee (ADR-006) still holds.
 */
export function usePwaLifecycle() {
  const offlineReady = ref(false)
  const needRefresh  = ref(false)

  const updateServiceWorker = registerSW({
    immediate: true,
    onOfflineReady() { offlineReady.value = true },
    onNeedRefresh()  { needRefresh.value = true },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return
      setInterval(() => { void registration.update() }, UPDATE_CHECK_INTERVAL_MS)
    },
  })

  function applyUpdate() { void updateServiceWorker(true) }
  function dismissOfflineReady() { offlineReady.value = false }
  function dismissNeedRefresh()  { needRefresh.value = false }

  return { offlineReady, needRefresh, applyUpdate, dismissOfflineReady, dismissNeedRefresh }
}
