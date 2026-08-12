import { db as appDb } from '@/data/powersync/db'
import { getJobTypePolicy } from '@/services/events/jobTypeRegistry'
import { DEFAULT_MAX_QUEUED_JOBS_PER_TYPE, GLOBAL_QUEUE_CEILING } from '@/services/events/deferredJob.constants'

type DbLike = Pick<typeof appDb, 'execute' | 'getAll' | 'getOptional' | 'writeTransaction'>

interface Tx {
  execute: (sql: string, params?: unknown[]) => Promise<any>
}

/** Structured-error check per the design spec's implementation constraint: never
 *  string-match. node:sqlite (and every real SQLite binding this app could ship with)
 *  sets `.code = 'ERR_SQLITE_ERROR'` with the underlying result code on `.errcode` --
 *  verified directly in Task 1's spike. `errcode` for a UNIQUE violation is in the
 *  SQLITE_CONSTRAINT family (raw code 19, or 2067 for the UNIQUE-specific extended code). */
function isUniqueConstraintViolation(err: unknown): boolean {
  const e = err as { code?: string; errcode?: number }
  if (e?.code !== 'ERR_SQLITE_ERROR') return false
  return e.errcode === 19 || e.errcode === 2067
}

async function evictOne(tx: Tx, where: string, params: unknown[]): Promise<boolean> {
  const result = await tx.execute(
    `SELECT id FROM local_deferred_jobs WHERE ${where}
       AND priority != 'critical'
     ORDER BY CASE priority WHEN 'low' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END ASC, enqueued_at ASC
     LIMIT 1`,
    params,
  )
  const candidate = result.rows._array[0]
  if (!candidate) return false
  await tx.execute(`UPDATE local_deferred_jobs SET status = 'evicted', finished_at = ? WHERE id = ?`, [
    new Date().toISOString(),
    candidate.id,
  ])
  return true
}

export async function enqueueDeferredJob(
  opts: { jobType: string; shopId: string; payload: unknown; dedupeKey?: string },
  database: DbLike = appDb,
): Promise<{ deduped: boolean }> {
  const policy = getJobTypePolicy(opts.jobType)
  if (!policy) throw new Error(`enqueueDeferredJob: no registerJobHandler policy for job type "${opts.jobType}"`)

  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  try {
    await database.writeTransaction(async (tx: Tx) => {
      await tx.execute(
        `INSERT INTO local_deferred_jobs
           (id, job_type, shop_id, payload, priority, requires_network, dedupe_key, status, attempts, enqueued_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?)`,
        [id, opts.jobType, opts.shopId, JSON.stringify(opts.payload), policy.priority, policy.requiresNetwork ? 1 : 0, opts.dedupeKey ?? null, now],
      )

      const maxForType = policy.maxQueuedJobs ?? DEFAULT_MAX_QUEUED_JOBS_PER_TYPE
      const typeCountResult = await tx.execute(
        `SELECT COUNT(*) AS c FROM local_deferred_jobs WHERE job_type = ? AND status = 'queued'`,
        [opts.jobType],
      )
      const typeCount = typeCountResult.rows._array[0]?.c ?? 0
      if (typeCount > maxForType) {
        const evicted = await evictOne(tx, `job_type = ? AND status = 'queued' AND id != ?`, [opts.jobType, id])
        if (!evicted) throw new Error(`enqueueDeferredJob: per-type quota exhausted for "${opts.jobType}" with no evictable candidate`)
      }

      const globalCountResult = await tx.execute(`SELECT COUNT(*) AS c FROM local_deferred_jobs WHERE status = 'queued'`)
      const globalCount = globalCountResult.rows._array[0]?.c ?? 0
      if (globalCount > GLOBAL_QUEUE_CEILING) {
        const evicted = await evictOne(tx, `status = 'queued' AND id != ?`, [id])
        if (!evicted) throw new Error('enqueueDeferredJob: global queue ceiling exhausted with no evictable candidate')
      }
    })
    return { deduped: false }
  } catch (err) {
    if (isUniqueConstraintViolation(err)) return { deduped: true }
    throw err
  }
}
