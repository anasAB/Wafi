import { db as appDb } from '@/data/powersync/db'
import { getJobTypePolicy, getRegisteredJobTypes } from '@/services/events/jobTypeRegistry'

type DbLike = Pick<typeof appDb, 'execute' | 'getAll' | 'getOptional' | 'writeTransaction'>

export interface DrainOptions {
  isConnected?: () => boolean
  isForegrounded?: () => boolean
  workerId?: string
}

async function claimNext(database: DbLike, shopId: string, connected: boolean): Promise<any | null> {
  const registeredTypes = getRegisteredJobTypes()
  if (registeredTypes.length === 0) return null
  const placeholders = registeredTypes.map(() => '?').join(',')
  const rows = await database.getAll<any>(
    `SELECT * FROM local_deferred_jobs
     WHERE shop_id = ?
       AND status = 'queued'
       AND job_type IN (${placeholders})
       AND (next_retry_at IS NULL OR next_retry_at <= ?)
       AND (requires_network = 0 OR ? = 1)
     ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END ASC, enqueued_at ASC
     LIMIT 1`,
    [shopId, ...registeredTypes, new Date().toISOString(), connected ? 1 : 0],
  )
  return rows[0] ?? null
}

export async function drainDeferredJobs(shopId: string, opts: DrainOptions = {}, database: DbLike = appDb): Promise<void> {
  const isConnected = opts.isConnected ?? (() => true)
  const isForegrounded = opts.isForegrounded ?? (() => true)

  while (true) {
    const row = await claimNext(database, shopId, isConnected())
    if (!row) return

    const policy = getJobTypePolicy(row.job_type)
    if (!policy) continue // structurally shouldn't happen (claimNext already filters), defensive only

    await database.execute(`UPDATE local_deferred_jobs SET status = 'running' WHERE id = ?`, [row.id])
    try {
      await policy.handler({ id: row.id, payload: JSON.parse(row.payload) })
      await database.execute(`UPDATE local_deferred_jobs SET status = 'completed', finished_at = ? WHERE id = ?`, [
        new Date().toISOString(), row.id,
      ])
    } catch {
      // Retry/lease/attempts-count semantics land in Task 5 -- this step only proves
      // selection/ordering/execution work; a bare failure here is refined next.
      await database.execute(`UPDATE local_deferred_jobs SET status = 'completed', finished_at = ? WHERE id = ?`, [
        new Date().toISOString(), row.id,
      ])
    }

    if (!isForegrounded()) return
  }
}
