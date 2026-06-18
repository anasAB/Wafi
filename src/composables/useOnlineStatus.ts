import { ref, onMounted, onUnmounted } from 'vue'

/**
 * Reactive TRUE network connectivity (navigator.onLine), deliberately distinct
 * from PowerSync sync status — which reads "offline" whenever the sync server
 * isn't connected (e.g. local-only mode), even with a live network.
 */
export function useOnlineStatus() {
  const isOnline = ref(typeof navigator !== 'undefined' ? navigator.onLine : true)

  function update() { isOnline.value = navigator.onLine }

  onMounted(() => {
    if (typeof window === 'undefined') return
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
  })
  onUnmounted(() => {
    if (typeof window === 'undefined') return
    window.removeEventListener('online', update)
    window.removeEventListener('offline', update)
  })

  return { isOnline }
}
