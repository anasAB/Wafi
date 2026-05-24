export type SyncStatus = 'online' | 'offline' | 'syncing'

export interface SyncState {
  status:       SyncStatus
  pendingCount: number
  lastSyncedAt: Date | null
  errorMessage: string | null
  isStale:      boolean  // true when offline > 24h
}
