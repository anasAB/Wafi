import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useSyncStore } from '@/store/sync.store'
import { useDeviceStore } from '@/store/device.store'
import { useSessionStore } from '@/store/session.store'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'
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
  const session    = useSessionStore()
  const audit      = useAuditLog()

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

  // WAFI-135: dead-letter actions are data-recovery controls, not sync plumbing.
  // Retry re-issues a rejected write (owner/manager judgment call); discard
  // permanently drops one — possibly a sale — so it is a data-loss decision
  // reserved for the owner. The checks live HERE, not only in the UI, so a
  // hidden button can never be the only line of defense.
  const canRetryBlocked = computed(() => {
    const role = session.activeStaff?.role
    return role === 'owner' || role === 'manager'
  })
  const canDiscardBlocked = computed(() => session.activeStaff?.role === 'owner')

  async function retryBlocked(id: string): Promise<RetryResult> {
    if (!canRetryBlocked.value) {
      throw new Error('إعادة محاولة المعاملات المتوقفة متاحة للمالك أو المدير فقط')
    }
    const result = await retryDeadLetterOp(db, id)
    await refreshDeadLetter()
    await refreshCounts()
    return result
  }

  async function discardBlocked(id: string): Promise<void> {
    if (!canDiscardBlocked.value) {
      throw new Error('حذف المعاملات المتوقفة متاح للمالك فقط')
    }
    // Snapshot the entry before deletion so the audit trail records WHAT was
    // dropped. Summary fields only — never op_data (the raw payload).
    const entry = deadLetter.value.find(e => e.id === id)
      ?? (await listDeadLetter(db)).find(e => e.id === id)

    await discardDeadLetterOp(db, id)
    await audit.logDeadLetterDiscarded(id, entry ? {
      op_type:       entry.op_type,
      table_name:    entry.table_name,
      row_id:        entry.row_id,
      error_code:    entry.error_code,
      error_message: entry.error_message,
      failed_at:     entry.failed_at,
    } : {})
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

  // A ticking clock so isStale re-evaluates as time passes, not only when sync
  // state changes — otherwise a device left untouched would never cross the
  // threshold in the UI. One minute is ample resolution for a 24h check.
  const STALE_AFTER_MS = 24 * 60 * 60 * 1000
  const now = ref(Date.now())
  let staleTimer: ReturnType<typeof setInterval> | undefined

  const isStale = computed(() => {
    if (!syncStore.lastSyncedAt) {
      // Never synced: that's only a problem if there are writes stuck locally
      // with nowhere to go yet — then it's a genuine stale-data warning.
      return syncStore.pendingCount > 0
    }
    return now.value - syncStore.lastSyncedAt.getTime() > STALE_AFTER_MS
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
        const downloadError = status.dataFlowStatus?.downloadError

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
        } else if (downloadError && navigator.onLine) {
          // Network is up but the server refused the download — commonly the sync
          // rules / auth rejected the request. This is a real problem the owner
          // must see, distinct from plain offline (a calm, supported state shown
          // silently). When the device is actually offline we fall through and
          // stay silent — navigator.onLine separates "server said no" from "no
          // network", since PowerSync reports both as a downloadError.
          syncStore.setStatus('offline')
          syncStore.setError(`تعذّرت مزامنة البيانات من الخادم (قد تكون قواعد المزامنة رفضت الطلب): ${downloadError.message}`)
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

  onMounted(() => {
    unbind = bindPowerSync()
    void refreshCounts()
    staleTimer = setInterval(() => { now.value = Date.now() }, 60_000)
  })
  onUnmounted(() => {
    unbind?.()
    if (staleTimer) clearInterval(staleTimer)
  })

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
    canRetryBlocked,
    canDiscardBlocked,
  }
}
