import { DatabaseSync } from 'node:sqlite'

/** A `db`-shaped object backed by a REAL SQLite database (Node's built-in node:sqlite),
 *  not a mock. Existing client-side tests mock `db` entirely (see
 *  src/__tests__/__mocks__/db.ts) -- that cannot validate real UNIQUE-constraint
 *  enforcement, real transaction atomicity, or real structured SQLite error codes, all
 *  of which WAFI-154's design depends on. `path` defaults to in-memory; pass a real
 *  file path to simulate a process restart against the same on-disk file (see the
 *  "offline job survives restart" test). */
export function createRealSqliteDb(path = ':memory:') {
  const conn = new DatabaseSync(path)
  let txQueue: Promise<any> = Promise.resolve()

  conn.exec(`
    CREATE TABLE IF NOT EXISTS local_deferred_jobs (
      id TEXT PRIMARY KEY, job_type TEXT, shop_id TEXT, payload TEXT, priority TEXT,
      requires_network INTEGER, dedupe_key TEXT, status TEXT, attempts INTEGER,
      last_error TEXT, next_retry_at TEXT, worker_id TEXT, started_at TEXT,
      lease_expires_at TEXT, enqueued_at TEXT, finished_at TEXT
    )
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
      return (txQueue = txQueue.then(async () => {
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
      }))
    },
    close: () => conn.close(),
    _raw: conn,
  }
}
