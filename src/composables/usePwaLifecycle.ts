import { ref } from 'vue'
import { registerSW } from 'virtual:pwa-register'

/**
 * Wraps the service-worker registration and exposes its lifecycle as reactive
 * refs the app shell renders UI from. With registerType 'prompt' (vite.config),
 * `needRefresh` drives the update toast and `applyUpdate()` reloads to the new
 * SW; `offlineReady` fires once the app is cached for offline use.
 */
export function usePwaLifecycle() {
  const offlineReady = ref(false)
  const needRefresh  = ref(false)

  const updateServiceWorker = registerSW({
    immediate: true,
    onOfflineReady() { offlineReady.value = true },
    onNeedRefresh()  { needRefresh.value = true },
  })

  function applyUpdate() { void updateServiceWorker(true) }
  function dismissOfflineReady() { offlineReady.value = false }
  function dismissNeedRefresh()  { needRefresh.value = false }

  return { offlineReady, needRefresh, applyUpdate, dismissOfflineReady, dismissNeedRefresh }
}
