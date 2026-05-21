import { AbstractPowerSyncDatabase, PowerSyncBackendConnector, UpdateType } from '@powersync/web'
import { supabase } from '@/data/supabase/client'

export class SupabaseConnector implements PowerSyncBackendConnector {
  async fetchCredentials() {
    const psUrl = import.meta.env.VITE_POWERSYNC_URL as string
    // db.ts only calls connect() when VITE_POWERSYNC_URL is set, so this path
    // is defensive only. Return null signals "not authenticated" to PowerSync
    // (clean stop), while throwing signals a transient error (retries).
    if (!psUrl) return null
    const { data, error } = await supabase.auth.getSession()
    if (error || !data.session) return null
    return { endpoint: psUrl, token: data.session.access_token }
  }

  async uploadData(database: AbstractPowerSyncDatabase) {
    const batch = await database.getCrudBatch(100)
    if (!batch) return
    try {
      for (const op of batch.crud) {
        const { table, id, opData } = op
        switch (op.op) {
          case UpdateType.PUT:
            await supabase.from(table).upsert({ id, ...opData })
            break
          case UpdateType.PATCH:
            await supabase.from(table).update(opData!).eq('id', id)
            break
          case UpdateType.DELETE:
            await supabase.from(table).delete().eq('id', id)
            break
        }
      }
      await batch.complete()
    } catch (err) {
      // Do not call batch.complete() on error — let PowerSync retry the batch
      throw err
    }
  }
}
