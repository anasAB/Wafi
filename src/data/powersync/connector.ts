import type { AbstractPowerSyncDatabase } from '@powersync/web'
import type { PowerSyncBackendConnector } from '@powersync/common'
import { supabase } from '@/data/supabase/client'
import { runOp, isPermanentError } from './ops'
import { quarantineOp } from './dead-letter'

// Re-export so existing importers and the runOp unit tests keep one entry point.
export { runOp, isPermanentError } from './ops'

/** A permanently-rejected op gets this many upload attempts before it is moved
 *  to the dead-letter holding — enough to absorb a one-off blip that happened to
 *  surface as a 4xx, while still draining the queue quickly for a true poison op. */
export const MAX_PERMANENT_ATTEMPTS = 3

export class SupabaseConnector implements PowerSyncBackendConnector {
  // Per-op attempt counts for ops currently failing with a *permanent* error,
  // keyed by the stable ps_crud client id. Transient failures never count here.
  private permanentFailures = new Map<number, number>()
  // Ops already moved to the dead-letter holding this session — skipped on every
  // subsequent pass so a poison op can't re-block the writes queued behind it.
  private quarantined = new Set<number>()

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
      // Already dead-lettered (a later op forced a retry before the batch could
      // complete): skip it so the rest of the queue drains past it.
      if (this.quarantined.has(op.clientId)) continue

      const error = await runOp(op.op, op.table, op.id, op.opData)
      if (!error) {
        this.permanentFailures.delete(op.clientId)
        continue
      }

      if (!isPermanentError(error)) {
        // Transient (offline / 5xx / timeout): leave the batch uncompleted so
        // PowerSync re-queues and retries the WHOLE batch. Never counts toward
        // quarantine — a long outage must not poison a perfectly good sale.
        throw new Error(`[PowerSync upload][${op.op}] ${op.table}/${op.id}: ${error.message}`)
      }

      // Permanent reject (constraint / RLS / 4xx). Give it a few attempts to
      // absorb a misclassified blip; throwing re-queues the batch.
      const attempts = (this.permanentFailures.get(op.clientId) ?? 0) + 1
      if (attempts < MAX_PERMANENT_ATTEMPTS) {
        this.permanentFailures.set(op.clientId, attempts)
        throw new Error(`[PowerSync upload][${op.op}] ${op.table}/${op.id}: ${error.message}`)
      }

      // Poison op. Preserve it in the dead-letter holding BEFORE completing the
      // batch (which clears it from the queue) — never drop a write, it may be a
      // sale. The owner retries or discards it from the sync panel.
      await quarantineOp(database, op, error)
      this.permanentFailures.delete(op.clientId)
      this.quarantined.add(op.clientId)
    }

    await batch.complete()
  }
}
