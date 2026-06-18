import { ref } from 'vue'
import { registerSW } from 'virtual:pwa-register'

/**
 * Wraps the service-worker registration and exposes its lifecycle as reactive
 * refs the app shell renders UI from. `needRefresh`/`applyUpdate` only do
 * anything once vite.config uses registerType 'prompt' (Phase 3); under
 * 'autoUpdate' only `offlineReady` fires.
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
