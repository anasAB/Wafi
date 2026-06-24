export type SyncStatus = 'online' | 'offline' | 'syncing'

export interface SyncState {
  status:       SyncStatus
  pendingCount: number   // writes still in the upload queue (ps_crud)
  blockedCount: number   // poison ops quarantined in the dead-letter holding
  lastSyncedAt: Date | null
  errorMessage: string | null
  isStale:      boolean  // true when offline > 24h
}
