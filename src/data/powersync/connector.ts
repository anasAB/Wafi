import { AbstractPowerSyncDatabase, UpdateType } from '@powersync/web'
import type { PowerSyncBackendConnector } from '@powersync/common'
import type { PostgrestError } from '@supabase/supabase-js'
import { supabase } from '@/data/supabase/client'

/** Apply one CRUD op to Supabase, returning the PostgrestError (or null on success). */
async function runOp(
  type: UpdateType,
  table: string,
  id: string,
  opData: Record<string, unknown> | undefined,
): Promise<PostgrestError | null> {
  switch (type) {
    case UpdateType.PUT:
      return (await supabase.from(table).upsert({ id, ...opData })).error
    case UpdateType.PATCH:
      return (await supabase.from(table).update(opData!).eq('id', id)).error
    case UpdateType.DELETE:
      return (await supabase.from(table).delete().eq('id', id)).error
    default:
      return null
  }
}

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

    for (const op of batch.crud) {
      const error = await runOp(op.op, op.table, op.id, op.opData)
      if (error) {
        // Never drop a write — it may be a sale. On ANY rejection we leave the
        // batch uncompleted so PowerSync keeps it queued and retries. A
        // server-side reject (RLS / constraint) therefore PAUSES sync until the
        // server is fixed, rather than silently losing data. PowerSync exposes
        // the thrown error via status.dataFlowStatus.uploadError, which useSync
        // surfaces to the UI so a stuck queue is visible, not silent.
        throw new Error(`[PowerSync upload][${op.op}] ${op.table}/${op.id}: ${error.message}`)
      }
    }

    await batch.complete()
  }
}
