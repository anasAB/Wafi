import { computed, onMounted, onUnmounted } from 'vue'
import { useSyncStore } from '@/store/sync.store'
import { db } from '@/data/powersync/db'

export function useSync() {
  const syncStore = useSyncStore()

  const isStale = computed(() => {
    if (!syncStore.lastSyncedAt) return false
    return Date.now() - syncStore.lastSyncedAt.getTime() > 24 * 60 * 60 * 1000
  })

  function bindPowerSync() {
    const unsubscribe = db.status?.onChange?.((status: any) => {
      if (status.connected) {
        syncStore.setStatus('online')
        syncStore.setLastSynced(new Date())
      } else if (status.dataFlowStatus?.downloading || status.dataFlowStatus?.uploading) {
        syncStore.setStatus('syncing')
      } else {
        syncStore.setStatus('offline')
      }
    })
    return unsubscribe
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
  }
}
