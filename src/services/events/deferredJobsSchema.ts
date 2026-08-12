import type { db as DbType } from '@/data/powersync/db'

type DbLike = Pick<typeof DbType, 'execute'>

/** Raw DDL, deliberately bypassing PowerSync's Table/Index schema DSL -- see Task 1's
 *  rationale in the WAFI-154 implementation plan: the DSL cannot declare a UNIQUE
 *  constraint at all, but local_deferred_jobs is localOnly (never synced), so nothing
 *  prevents running real SQLite DDL directly against its storage.
 *
 *  CRITICAL (final-review fix, verified against node_modules/@powersync/common's
 *  compiled bundle, bundle.mjs:243-245 and :12403): a PowerSync `localOnly` table
 *  declared via the Table/schema DSL is NOT a plain SQLite table at runtime. PowerSync
 *  applies the schema by creating a real internal table named
 *  `ps_data_local__<tableName>` with just two physical columns, `id` and `data`, where
 *  `data` is a single JSON blob holding every declared column packed together. The
 *  user-facing name (`local_deferred_jobs`) is a SQL VIEW over that internal table,
 *  with generated INSTEAD OF triggers that project/unproject the JSON so ordinary
 *  INSERT/UPDATE/DELETE/SELECT statements against the view keep working. Column access
 *  inside the view is `json_extract(data, '$.<col>')`.
 *
 *  You cannot `CREATE INDEX` (or CREATE UNIQUE INDEX) on a SQL VIEW -- SQLite rejects
 *  it outright. The original version of this file ran its DDL against
 *  `local_deferred_jobs` directly, which is exactly that mistake: it would throw
 *  against a real PowerSync database, even though it passed every test here, because
 *  this task's test harness (src/__tests__/helpers/realSqliteDb.ts) originally built
 *  `local_deferred_jobs` as a genuine plain table. The harness has since been rewritten
 *  to faithfully reproduce PowerSync's view-over-JSON-blob storage model (see that
 *  file's docstring), so the DDL below is now written against what PowerSync will
 *  actually give us: the internal `ps_data_local__local_deferred_jobs` table, indexing
 *  `json_extract(data, '$.<col>')` expressions instead of plain columns.
 *
 *  This also folds in the shop_id-scoping fix from the same review pass: the dedupe
 *  unique index's key was originally `(job_type, dedupe_key)` with no shop
 *  boundary, which meant two different shops enqueuing the same `(job_type,
 *  dedupe_key)` pair would collide against each other -- a tenant-isolation
 *  violation. `shop_id` is now part of the unique key, and enqueueDeferredJob.ts's
 *  quota/eviction queries were scoped to match (see that file's comments).
 *
 *  *** REMAINING RISK: UNVERIFIED AGAINST A REAL POWERSYNC/BROWSER RUNTIME ***
 *  This sandbox has no browser or real PowerSync client available to run against, so
 *  none of this -- neither the original bug nor this fix -- has been confirmed against
 *  an actual compiled PowerSync SQLite extension. The `ps_data_local__<name>` internal
 *  table's exact column names/types (just `id TEXT PRIMARY KEY, data TEXT`, per the
 *  bundle.mjs source read) are inferred from PowerSync's JS source, not observed live.
 *  The harness in realSqliteDb.ts is our best-effort structural model of that reality,
 *  validated with a throwaway node:sqlite spike script (not checked in) confirming
 *  INSERT/UPDATE/DELETE round-trip correctly through the view+trigger pattern and that
 *  the shop-scoped partial unique index behaves as intended. A live-device/browser
 *  confirmation against a real PowerSync build is still required before this DDL is
 *  treated as production-proven -- this widens the plan's existing "Outstanding manual
 *  steps" caveat to explicitly cover DDL *structural* correctness, not just the
 *  error-code shape the original spike tested. */
const INTERNAL_TABLE = 'ps_data_local__local_deferred_jobs'

function col(name: string): string {
  return `json_extract(data, '$.${name}')`
}

export async function initLocalDeferredJobsSchema(database: DbLike): Promise<void> {
  await database.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS local_deferred_jobs_dedupe
       ON ${INTERNAL_TABLE} (${col('job_type')}, ${col('dedupe_key')}, ${col('shop_id')})
       WHERE ${col('dedupe_key')} IS NOT NULL AND ${col('status')} IN ('queued', 'running')`,
  )
  await database.execute(
    `CREATE INDEX IF NOT EXISTS local_deferred_jobs_selection
       ON ${INTERNAL_TABLE} (${col('shop_id')}, ${col('status')}, ${col('priority')}, ${col('enqueued_at')})`,
  )
}
