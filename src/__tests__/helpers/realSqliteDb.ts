import { DatabaseSync } from 'node:sqlite'

/** Declared (user-facing) columns of the `local_deferred_jobs` PowerSync localOnly
 *  table, excluding `id` which PowerSync always keeps as a first-class primary key
 *  column on the internal table (not packed into the JSON blob). Keep this in sync
 *  with the `Table` DSL definition in src/data/powersync/schema.ts. */
const DEFERRED_JOB_COLUMNS = [
  'job_type', 'shop_id', 'payload', 'priority', 'requires_network', 'dedupe_key',
  'status', 'attempts', 'last_error', 'next_retry_at', 'worker_id', 'started_at',
  'lease_expires_at', 'enqueued_at', 'finished_at',
] as const

/** A `db`-shaped object backed by a REAL SQLite database (Node's built-in node:sqlite),
 *  not a mock. Existing client-side tests mock `db` entirely (see
 *  src/__tests__/__mocks__/db.ts) -- that cannot validate real UNIQUE-constraint
 *  enforcement, real transaction atomicity, or real structured SQLite error codes, all
 *  of which WAFI-154's design depends on. `path` defaults to in-memory; pass a real
 *  file path to simulate a process restart against the same on-disk file (see the
 *  "offline job survives restart" test).
 *
 *  IMPORTANT (final-review fix for WAFI-154): a PowerSync `localOnly` table is NOT a
 *  plain SQLite table in production -- see deferredJobsSchema.ts's docstring for the
 *  full explanation. To make this harness faithful to that storage model (and catch
 *  DDL that would silently fail against a real PowerSync database, such as `CREATE
 *  INDEX` against a view), `local_deferred_jobs` here is built the same way: a real
 *  internal table (`ps_data_local__local_deferred_jobs`) storing every declared column
 *  packed into a single JSON `data` blob, a SQL VIEW named `local_deferred_jobs` that
 *  projects that JSON via `json_extract`, and INSTEAD OF INSERT/UPDATE/DELETE triggers
 *  that make the view transparently writable -- the standard SQLite "updatable view"
 *  pattern. This relies on documented SQLite behavior: inside an INSTEAD OF UPDATE
 *  trigger, `NEW.<col>` for any column NOT touched by the UPDATE's SET clause is
 *  already equal to `OLD.<col>` (SQLite fills it in before the trigger body runs), so
 *  the trigger can safely rebuild the full JSON blob from `NEW.*` on every UPDATE
 *  without needing to know which columns the caller actually set. */
export function createRealSqliteDb(path = ':memory:') {
  const conn = new DatabaseSync(path)
  let txQueue: Promise<any> = Promise.resolve()

  conn.exec(`
    CREATE TABLE IF NOT EXISTS ps_data_local__local_deferred_jobs (
      id TEXT PRIMARY KEY,
      data TEXT
    )
  `)

  const viewProjection = DEFERRED_JOB_COLUMNS
    .map((c) => `json_extract(data, '$.${c}') AS ${c}`)
    .join(',\n      ')

  conn.exec(`
    CREATE VIEW IF NOT EXISTS local_deferred_jobs AS
    SELECT
      id,
      ${viewProjection}
    FROM ps_data_local__local_deferred_jobs
  `)

  const jsonObjectArgs = DEFERRED_JOB_COLUMNS
    .map((c) => `'${c}', NEW.${c}`)
    .join(',\n        ')

  conn.exec(`
    CREATE TRIGGER IF NOT EXISTS local_deferred_jobs_insert
    INSTEAD OF INSERT ON local_deferred_jobs
    BEGIN
      INSERT INTO ps_data_local__local_deferred_jobs (id, data)
      VALUES (
        NEW.id,
        json_object(
          ${jsonObjectArgs}
        )
      );
    END
  `)

  conn.exec(`
    CREATE TRIGGER IF NOT EXISTS local_deferred_jobs_update
    INSTEAD OF UPDATE ON local_deferred_jobs
    BEGIN
      UPDATE ps_data_local__local_deferred_jobs
      SET data = json_object(
        ${jsonObjectArgs}
      )
      WHERE id = OLD.id;
    END
  `)

  conn.exec(`
    CREATE TRIGGER IF NOT EXISTS local_deferred_jobs_delete
    INSTEAD OF DELETE ON local_deferred_jobs
    BEGIN
      DELETE FROM ps_data_local__local_deferred_jobs WHERE id = OLD.id;
    END
  `)

  return {
    execute: async (sql: string, params: unknown[] = []) => {
      const stmt = conn.prepare(sql)
      const isSelect = /^\s*select/i.test(sql)
      if (isSelect) return { rows: { _array: stmt.all(...(params as any[])) } }
      stmt.run(...(params as any[]))
      return { rows: { _array: [] } }
    },
    getAll: async <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
      conn.prepare(sql).all(...(params as any[])) as T[],
    getOptional: async <T>(sql: string, params: unknown[] = []): Promise<T | null> =>
      (conn.prepare(sql).get(...(params as any[])) as T) ?? null,
    writeTransaction: async <T>(fn: (tx: { execute: (sql: string, params?: unknown[]) => Promise<any> }) => Promise<T>): Promise<T> => {
      const runTransaction = async () => {
        conn.exec('BEGIN')
        try {
          const result = await fn({
            execute: async (sql: string, params: unknown[] = []) => {
              const stmt = conn.prepare(sql)
              const isSelect = /^\s*select/i.test(sql)
              if (isSelect) return { rows: { _array: stmt.all(...(params as any[])) } }
              stmt.run(...(params as any[]))
              return { rows: { _array: [] } }
            },
          })
          conn.exec('COMMIT')
          return result
        } catch (err) {
          conn.exec('ROLLBACK')
          throw err
        }
      }
      return (txQueue = txQueue.then(runTransaction, runTransaction))
    },
    close: () => conn.close(),
    _raw: conn,
  }
}
