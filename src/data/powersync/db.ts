import { PowerSyncDatabase } from '@powersync/web'
import { AppSchema } from './schema'
import { SupabaseConnector } from './connector'

export const db = new PowerSyncDatabase({
  schema: AppSchema,
  database: { dbFilename: 'wafi.db' },
})

// Single shared connector instance — reused by both the initial connect below
// and reconnectPowerSync() so per-op bookkeeping (permanentFailures/quarantined
// in SupabaseConnector) isn't discarded and re-started by every reconnect.
const connector = new SupabaseConnector()

// Epic 1: connect only when VITE_POWERSYNC_URL is configured.
// Without it, db operates as offline-only local SQLite — all reads/writes work.
const psUrl = import.meta.env.VITE_POWERSYNC_URL as string
if (psUrl) {
  db.connect(connector).catch((err: Error) => {
    console.warn('[PowerSync] Connection failed; offline mode:', err.message)
  })
}

/**
 * Force PowerSync to re-run fetchCredentials() against the shared connector
 * instance (e.g. after a token refresh mints new claims an already-open
 * connection wouldn't otherwise notice). Reuses the single connector instance
 * above rather than constructing a new one, so in-flight upload bookkeeping
 * isn't silently duplicated/reset. Swallows failure the same way the initial
 * connect() above does — offline/unreachable should fall through to whatever
 * poll-timeout the caller has, not throw.
 */
export async function reconnectPowerSync(): Promise<void> {
  try {
    await db.connect(connector)
  } catch (err) {
    console.warn('[PowerSync] Reconnect failed; offline mode:', err)
  }
}
