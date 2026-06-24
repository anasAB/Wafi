import { defineStore } from 'pinia'
import { ref } from 'vue'

export type SyncStatus = 'online' | 'offline' | 'syncing'

export const useSyncStore = defineStore('sync', () => {
  const status       = ref<SyncStatus>('offline')
  const pendingCount = ref(0)   // writes still in the ps_crud upload queue
  const blockedCount = ref(0)   // poison ops quarantined in the dead-letter holding
  const lastSyncedAt = ref<Date | null>(null)
  const errorMessage = ref<string | null>(null)

  function setStatus(s: SyncStatus)   { status.value = s }
  function setPendingCount(n: number) { pendingCount.value = n }
  function setBlockedCount(n: number) { blockedCount.value = n }
  function setLastSynced(d: Date)     { lastSyncedAt.value = d; errorMessage.value = null }
  function setError(msg: string)      { errorMessage.value = msg }

  return {
    status, pendingCount, blockedCount, lastSyncedAt, errorMessage,
    setStatus, setPendingCount, setBlockedCount, setLastSynced, setError,
  }
})
