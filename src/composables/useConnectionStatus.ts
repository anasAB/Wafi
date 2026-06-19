import { computed } from 'vue'
import { useOnlineStatus } from './useOnlineStatus'
import { useSyncStore } from '@/store/sync.store'

export type ConnectionTone = 'ok' | 'busy' | 'off'

/**
 * Single, honest connection signal, combining two axes the app previously
 * conflated:
 *   - true network reachability (navigator.onLine, via useOnlineStatus)
 *   - cloud sync state (PowerSync, via the sync store)
 *
 * The LABEL answers the shop owner's question — "am I online?" — from the
 * network, so it is correct even in local-only mode (no VITE_POWERSYNC_URL),
 * where the sync layer never connects and the old sync-only badge was stuck on
 * "غير متصل". The DETAIL line tells the sync truth (syncing / synced / local).
 */
export function useConnectionStatus() {
  const { isOnline } = useOnlineStatus()
  const sync = useSyncStore()
  const syncConfigured = Boolean(import.meta.env.VITE_POWERSYNC_URL)

  const syncing = computed(() => isOnline.value && sync.status === 'syncing')

  const tone = computed<ConnectionTone>(() =>
    !isOnline.value ? 'off' : syncing.value ? 'busy' : 'ok',
  )

  const label = computed(() =>
    !isOnline.value ? 'غير متصل' : syncing.value ? 'جارٍ المزامنة' : 'متصل',
  )

  const detail = computed(() => {
    if (!isOnline.value) return 'تعمل دون إنترنت — بياناتك محفوظة محلياً وستتزامن عند عودة الاتصال'
    if (syncing.value)   return 'جارٍ مزامنة بياناتك...'
    return syncConfigured
      ? 'متصل بالإنترنت — تتم المزامنة تلقائياً'
      : 'متصل بالإنترنت — يعمل محلياً (المزامنة غير مُفعّلة)'
  })

  return { online: isOnline, syncing, syncConfigured, tone, label, detail }
}
