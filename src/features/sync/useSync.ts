import { computed, onMounted, onUnmounted } from 'vue'
import { useSyncStore } from '@/store/sync.store'
import { db } from '@/data/powersync/db'
import { SupabaseConnector } from '@/data/powersync/connector'
import { supabase } from '@/data/supabase/client'

export function useSync() {
  const syncStore = useSyncStore()

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

        if (status.connected) {
          syncStore.setStatus('online')
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

  onMounted(() => { unbind = bindPowerSync() })
  onUnmounted(() => { unbind?.() })

  return {
    status:       computed(() => syncStore.status),
    pendingCount: computed(() => syncStore.pendingCount),
    lastSyncedAt: computed(() => syncStore.lastSyncedAt),
    errorMessage: computed(() => syncStore.errorMessage),
    isStale,
    syncNow,
  }
}
