import { db as appDb } from '@/data/powersync/db'
import { getJobTypePolicy, getRegisteredJobTypes } from '@/services/events/jobTypeRegistry'
import { isTransientEventFailure } from '@/services/events/isTransientEventFailure'
import { DEFERRED_JOB_LEASE_MINUTES, MAX_ATTEMPTS, BACKOFF_MINUTES, RETENTION_DAYS } from '@/services/events/deferredJob.constants'
import { reportDeferredJobDead } from '@/services/events/reportDeferredJobDead'

type DbLike = Pick<typeof appDb, 'execute' | 'getAll' | 'getOptional' | 'writeTransaction'>

export interface DrainOptions {
  isConnected?: () => boolean
  isForegrounded?: () => boolean
  workerId?: string
}

const inFlightDrains = new Map<string, Promise<void>>()

function yieldToMacrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function nextRetryAt(attempts: number): string {
  const baseMinutes = BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length - 1)]
  const jitter = 0.8 + Math.random() * 0.4
  return new Date(Date.now() + baseMinutes * 60_000 * jitter).toISOString()
}

async function reclaimStaleLeases(database: DbLike, shopId: string): Promise<void> {
  await database.execute(
    `UPDATE local_deferred_jobs
       SET status = 'queued', worker_id = NULL, started_at = NULL, lease_expires_at = NULL
     WHERE shop_id = ? AND status = 'running' AND lease_expires_at <= ?`,
    [shopId, new Date().toISOString()],
  )
}

async function purgeExpiredRows(database: DbLike, shopId: string): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
  await database.execute(
    `DELETE FROM local_deferred_jobs
     WHERE shop_id = ? AND status IN ('completed', 'dead', 'evicted') AND finished_at <= ?`,
    [shopId, cutoff],
  )
}

async function claimNext(database: DbLike, shopId: string, connected: boolean, workerId: string): Promise<any | null> {
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
  const row = rows[0]
  if (!row) return null

  const now = new Date()
  const leaseExpires = new Date(now.getTime() + DEFERRED_JOB_LEASE_MINUTES * 60_000)
  await database.execute(
    `UPDATE local_deferred_jobs
       SET status = 'running', attempts = attempts + 1, worker_id = ?, started_at = ?, lease_expires_at = ?
     WHERE id = ?`,
    [workerId, now.toISOString(), leaseExpires.toISOString(), row.id],
  )
  return { ...row, attempts: row.attempts + 1 }
}

async function runDrain(shopId: string, opts: DrainOptions, database: DbLike): Promise<void> {
  const isConnected = opts.isConnected ?? (() => true)
  const isForegrounded = opts.isForegrounded ?? (() => true)
  const workerId = opts.workerId ?? crypto.randomUUID()

  await reclaimStaleLeases(database, shopId)
  await purgeExpiredRows(database, shopId)

  while (true) {
    if (!isForegrounded()) return

    const row = await claimNext(database, shopId, isConnected(), workerId)
    if (!row) return

    const policy = getJobTypePolicy(row.job_type)
    if (!policy) continue // defensive only; claimNext already filters to registered types

    try {
      await policy.handler({ id: row.id, payload: JSON.parse(row.payload) })
      await database.execute(`UPDATE local_deferred_jobs SET status = 'completed', finished_at = ? WHERE id = ?`, [
        new Date().toISOString(), row.id,
      ])
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const transient = isTransientEventFailure(err)
      if (transient && row.attempts < MAX_ATTEMPTS) {
        await database.execute(
          `UPDATE local_deferred_jobs
             SET status = 'queued', last_error = ?, next_retry_at = ?, worker_id = NULL, started_at = NULL, lease_expires_at = NULL
           WHERE id = ?`,
          [message, nextRetryAt(row.attempts), row.id],
        )
      } else {
        await database.execute(
          `UPDATE local_deferred_jobs SET status = 'dead', last_error = ?, next_retry_at = NULL, finished_at = ? WHERE id = ?`,
          [message, new Date().toISOString(), row.id],
        )
        await reportDeferredJobDead({ ...row, last_error: message }, err instanceof Error ? err : undefined)
      }
    }

    await yieldToMacrotask()
  }
}

export async function drainDeferredJobs(shopId: string, opts: DrainOptions = {}, database: DbLike = appDb): Promise<void> {
  const existing = inFlightDrains.get(shopId)
  if (existing) return existing

  const promise = runDrain(shopId, opts, database).finally(() => {
    inFlightDrains.delete(shopId)
  })
  inFlightDrains.set(shopId, promise)
  return promise
}
