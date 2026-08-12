import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRealSqliteDb } from '@/__tests__/helpers/realSqliteDb'
import { initLocalDeferredJobsSchema } from '@/services/events/deferredJobsSchema'

describe('local_deferred_jobs survives a real connection close/reopen', () => {
  it('a queued row is intact after closing and reopening the same on-disk database', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wafi154-'))
    const path = join(dir, 'test.sqlite')
    try {
      const first = createRealSqliteDb(path)
      await initLocalDeferredJobsSchema(first)
      await first.execute(
        `INSERT INTO local_deferred_jobs (id, job_type, shop_id, payload, priority, requires_network, status, attempts, enqueued_at)
         VALUES ('row1', 'test.a', 'shop1', '{"n":1}', 'normal', 0, 'queued', 0, '2026-08-12T00:00:00.000Z')`,
      )
      first.close() // genuinely closes this connection -- not a second in-process handle sharing state

      const second = createRealSqliteDb(path) // reopens the SAME on-disk file
      const row = await second.getOptional<any>(`SELECT * FROM local_deferred_jobs WHERE id = 'row1'`)
      expect(row).toBeDefined()
      expect(row.status).toBe('queued')
      expect(JSON.parse(row.payload).n).toBe(1)
      second.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
