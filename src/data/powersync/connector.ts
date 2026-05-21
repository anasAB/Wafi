import { AbstractPowerSyncDatabase, PowerSyncBackendConnector, UpdateType } from '@powersync/web'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(supabaseUrl, supabaseKey)

export class SupabaseConnector implements PowerSyncBackendConnector {
  async fetchCredentials() {
    const psUrl = import.meta.env.VITE_POWERSYNC_URL as string
    if (!psUrl) {
      // Epic 1: no PowerSync service configured — stay offline
      throw new Error('VITE_POWERSYNC_URL not set; running in offline-only mode')
    }
    const { data, error } = await supabase.auth.getSession()
    if (error || !data.session) throw new Error('Not authenticated')
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
