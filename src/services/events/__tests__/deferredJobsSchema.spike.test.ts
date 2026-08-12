import { describe, it, expect } from 'vitest'
import { createRealSqliteDb } from '@/__tests__/helpers/realSqliteDb'
import { initLocalDeferredJobsSchema } from '@/services/events/deferredJobsSchema'

describe('WAFI-154 spike: local_deferred_jobs unique index + structured error code', () => {
  it('rejects a second queued row with the same (job_type, dedupe_key, shop_id) via a structured constraint code', async () => {
    const database = createRealSqliteDb()
    await initLocalDeferredJobsSchema(database)
    await database.execute(
      `INSERT INTO local_deferred_jobs (id, job_type, shop_id, dedupe_key, status, attempts, enqueued_at)
       VALUES ('row1', 'test.sleep', 'shop1', 'dedupe-1', 'queued', 0, '2026-08-12T00:00:00.000Z')`,
    )

    let caught: any
    try {
      await database.execute(
        `INSERT INTO local_deferred_jobs (id, job_type, shop_id, dedupe_key, status, attempts, enqueued_at)
         VALUES ('row2', 'test.sleep', 'shop1', 'dedupe-1', 'queued', 0, '2026-08-12T00:00:01.000Z')`,
      )
    } catch (err) {
      caught = err
    }

    expect(caught).toBeDefined()
    // node:sqlite (like every SQLite binding) exposes a structured error code on the
    // thrown error, not just a message string -- this assertion is what proves the
    // "never string-match" implementation constraint from the design spec is actually
    // satisfiable against this project's real SQLite layer.
    expect(caught.code).toBe('ERR_SQLITE_ERROR')
    expect([19, 2067]).toContain(caught.errcode) // the underlying sqlite3 result code (SQLITE_CONSTRAINT=19 or SQLITE_CONSTRAINT_UNIQUE=2067)
    database.close()
  })

  it('allows the same (job_type, dedupe_key) once the first row is no longer queued/running', async () => {
    const database = createRealSqliteDb()
    await initLocalDeferredJobsSchema(database)
    await database.execute(
      `INSERT INTO local_deferred_jobs (id, job_type, shop_id, dedupe_key, status, attempts, enqueued_at, finished_at)
       VALUES ('row1', 'test.sleep', 'shop1', 'dedupe-1', 'completed', 1, '2026-08-12T00:00:00.000Z', '2026-08-12T00:01:00.000Z')`,
    )
    await expect(
      database.execute(
        `INSERT INTO local_deferred_jobs (id, job_type, shop_id, dedupe_key, status, attempts, enqueued_at)
         VALUES ('row2', 'test.sleep', 'shop1', 'dedupe-1', 'queued', 0, '2026-08-12T00:02:00.000Z')`,
      ),
    ).resolves.toBeDefined()
    database.close()
  })

  it('does NOT dedupe across shops: two different shops with the same (job_type, dedupe_key) both succeed as independent rows', async () => {
    const database = createRealSqliteDb()
    await initLocalDeferredJobsSchema(database)
    await database.execute(
      `INSERT INTO local_deferred_jobs (id, job_type, shop_id, dedupe_key, status, attempts, enqueued_at)
       VALUES ('row1', 'test.sleep', 'shopA', 'dedupe-1', 'queued', 0, '2026-08-12T00:00:00.000Z')`,
    )
    // Cross-shop, same (job_type, dedupe_key): must NOT collide against shopA's row.
    await expect(
      database.execute(
        `INSERT INTO local_deferred_jobs (id, job_type, shop_id, dedupe_key, status, attempts, enqueued_at)
         VALUES ('row2', 'test.sleep', 'shopB', 'dedupe-1', 'queued', 0, '2026-08-12T00:00:01.000Z')`,
      ),
    ).resolves.toBeDefined()

    // Genuine same-shop duplicate against shopA must still be rejected.
    let caught: any
    try {
      await database.execute(
        `INSERT INTO local_deferred_jobs (id, job_type, shop_id, dedupe_key, status, attempts, enqueued_at)
         VALUES ('row3', 'test.sleep', 'shopA', 'dedupe-1', 'queued', 0, '2026-08-12T00:00:02.000Z')`,
      )
    } catch (err) {
      caught = err
    }
    expect(caught).toBeDefined()
    expect(caught.code).toBe('ERR_SQLITE_ERROR')

    const rows = await database.getAll<any>(`SELECT id, shop_id FROM local_deferred_jobs WHERE dedupe_key = 'dedupe-1'`)
    expect(rows.map((r: any) => r.shop_id).sort()).toEqual(['shopA', 'shopB'])
    database.close()
  })
})
