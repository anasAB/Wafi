import { PowerSyncDatabase } from '@powersync/web'
import { AppSchema } from './schema'
import { SupabaseConnector } from './connector'

export const db = new PowerSyncDatabase({
  schema: AppSchema,
  database: { dbFilename: 'wafi.db' },
})

// Epic 1: connect only when VITE_POWERSYNC_URL is configured.
// Without it, db operates as offline-only local SQLite — all reads/writes work.
const psUrl = import.meta.env.VITE_POWERSYNC_URL as string
if (psUrl) {
  db.connect(new SupabaseConnector()).catch((err: Error) => {
    console.warn('[PowerSync] Connection failed; offline mode:', err.message)
  })
}
