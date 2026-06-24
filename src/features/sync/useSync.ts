import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useSyncStore } from '@/store/sync.store'
import { useDeviceStore } from '@/store/device.store'
import { db } from '@/data/powersync/db'
import { SupabaseConnector } from '@/data/powersync/connector'
import {
  countDeadLetter, listDeadLetter, retryDeadLetterOp, discardDeadLetterOp,
  type DeadLetterEntry, type RetryResult,
} from '@/data/powersync/dead-letter'
import { supabase } from '@/data/supabase/client'

export function useSync() {
  const syncStore  = useSyncStore()
  const deviceStore = useDeviceStore()

  // Ops the server permanently rejected, held locally for owner recovery.
  const deadLetter = ref<DeadLetterEntry[]>([])

  // Refresh the two queue depths the UI shows: pendingCount = writes still
  // waiting in PowerSync's upload queue (ps_crud); blockedCount = poison ops
  // parked in the dead-letter holding. Best-effort — never throw into the
  // status listener that drives it.
  async function refreshCounts() {
    try {
      const [pending] = await db.getAll<{ n: number }>('SELECT count(*) AS n FROM ps_crud')
      syncStore.setPendingCount(pending?.n ?? 0)
      syncStore.setBlockedCount(await countDeadLetter(db))
    } catch {
      /* counts are advisory UI; a transient read failure must not break sync */
    }
  }

  async function refreshDeadLetter() {
    deadLetter.value = await listDeadLetter(db)
    syncStore.setBlockedCount(deadLetter.value.length)
  }

  async function retryBlocked(id: string): Promise<RetryResult> {
    const result = await retryDeadLetterOp(db, id)
    await refreshDeadLetter()
    await refreshCounts()
    return result
  }

  async function discardBlocked(id: string): Promise<void> {
    await discardDeadLetterOp(db, id)
    await refreshDeadLetter()
    await refreshCounts()
  }

  function waitForConnected(timeoutMs = 8000): Promise<boolean> {
    if (db.currentStatus?.connected) return Promise.resolve(true)

    return new Promise((resolve) => {
      let settled = false
      let unbind: (() => void) | undefined

      const finish = (ok: boolean) => {
        if (settled) return
        settled = true
        if (unbind) unbind()
        resolve(ok)
      }

      const timer = setTimeout(() => finish(false), timeoutMs)

      unbind = db.registerListener?.({
        statusChanged: (status) => {
          if (status.connected) {
            clearTimeout(timer)
            finish(true)
          }
        },
      })
    })
  }

  const isStale = computed(() => {
    if (!syncStore.lastSyncedAt) return false
    return Date.now() - syncStore.lastSyncedAt.getTime() > 24 * 60 * 60 * 1000
  })

  function bindPowerSync() {
    // PowerSync exposes status via registerListener({ statusChanged }) and the
    // current snapshot via db.currentStatus — not db.status.onChange (which
    // didn't exist, so this binding was silently a no-op and the app read as
    // permanently offline).
    const unsubscribe = db.registerListener?.({
      statusChanged: (status) => {
        // The connector throws (never drops) when the server rejects an upload,
        // so the queue pauses and retries. Surface that error so a stuck queue
        // is visible instead of silent. PowerSync clears uploadError on the next
        // successful upload, so this self-resolves once the server is fixed.
        const uploadError = status.dataFlowStatus?.uploadError

        // Keep the queue-depth indicators live: each status change (upload
        // start/stop) is when ps_crud drains or a poison op gets parked.
        void refreshCounts()

        if (status.connected) {
          syncStore.setStatus('online')
          // Once connected, the owner's `shops` row is (or soon will be) synced
          // locally — resolve shopId from it. This is what makes the app's
          // shop_id available without a JWT claim/access-token hook.
          void deviceStore.refreshShopId()
          // setLastSynced also clears the error banner — only do so once uploads
          // are actually flowing again.
          if (uploadError) syncStore.setError(`فشل رفع التغييرات إلى الخادم: ${uploadError.message}`)
          else syncStore.setLastSynced(new Date())
        } else if (status.dataFlowStatus?.downloading || status.dataFlowStatus?.uploading) {
          syncStore.setStatus('syncing')
        } else {
          syncStore.setStatus('offline')
        }
      },
    })
    return unsubscribe
  }

  async function syncNow() {
    const psUrl = (import.meta.env.VITE_POWERSYNC_URL as string | undefined)?.trim()
    if (!psUrl) {
      syncStore.setStatus('offline')
      syncStore.setError('عنوان PowerSync غير مضبوط في البيئة (VITE_POWERSYNC_URL).')
      return
    }

    const sessionRes = await supabase.auth.getSession()
    if (sessionRes.error) {
      syncStore.setStatus('offline')
      syncStore.setError(`تعذر قراءة جلسة Supabase: ${sessionRes.error.message}`)
      return
    }
    if (!sessionRes.data.session) {
      syncStore.setStatus('offline')
      syncStore.setError('لا توجد جلسة تسجيل دخول صالحة. أعد تسجيل الدخول للحساب التجريبي ثم حاول مرة أخرى.')
      return
    }

    try {
      syncStore.setStatus('syncing')
      await db.connect(new SupabaseConnector())

      // connect() may resolve before the async status transition is emitted,
      // so wait briefly for the connected signal before declaring failure.
      const connected = await waitForConnected()
      if (!connected) {
        syncStore.setStatus('offline')
        syncStore.setError(`تمت محاولة المزامنة لكن الاتصال بـ PowerSync لم يكتمل. endpoint الحالي: ${psUrl}`)
        return
      }

      syncStore.setStatus('online')
      syncStore.setLastSynced(new Date())
    } catch (err) {
      syncStore.setStatus('offline')
      syncStore.setError(err instanceof Error ? err.message : 'فشل الاتصال')
    }
  }

  let unbind: (() => void) | undefined

  onMounted(() => { unbind = bindPowerSync(); void refreshCounts() })
  onUnmounted(() => { unbind?.() })

  return {
    status:       computed(() => syncStore.status),
    pendingCount: computed(() => syncStore.pendingCount),
    blockedCount: computed(() => syncStore.blockedCount),
    lastSyncedAt: computed(() => syncStore.lastSyncedAt),
    errorMessage: computed(() => syncStore.errorMessage),
    isStale,
    syncNow,
    deadLetter,
    refreshDeadLetter,
    retryBlocked,
    discardBlocked,
  }
}
