import type { db as DbType } from '@/data/powersync/db'

type DbLike = Pick<typeof DbType, 'execute'>

/** Raw DDL, deliberately bypassing PowerSync's Table/Index schema DSL -- see Task 1's
 *  rationale in the WAFI-154 implementation plan: the DSL cannot declare a UNIQUE
 *  constraint at all, but local_deferred_jobs is localOnly (never synced), so nothing
 *  prevents running real SQLite DDL directly against it via db.execute. */
export async function initLocalDeferredJobsSchema(database: DbLike): Promise<void> {
  await database.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS local_deferred_jobs_dedupe
       ON local_deferred_jobs (job_type, dedupe_key)
       WHERE dedupe_key IS NOT NULL AND status IN ('queued', 'running')`,
  )
  await database.execute(
    `CREATE INDEX IF NOT EXISTS local_deferred_jobs_selection
       ON local_deferred_jobs (shop_id, status, priority, enqueued_at)`,
  )
}
