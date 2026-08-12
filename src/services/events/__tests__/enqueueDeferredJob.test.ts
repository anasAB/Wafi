import { describe, it, expect, beforeEach } from 'vitest'
import { createRealSqliteDb } from '@/__tests__/helpers/realSqliteDb'
import { initLocalDeferredJobsSchema } from '@/services/events/deferredJobsSchema'
import { enqueueDeferredJob } from '@/services/events/enqueueDeferredJob'
import { registerJobHandler, resetJobTypeRegistry } from '@/services/events/jobTypeRegistry'

async function freshDb() {
  const database = createRealSqliteDb()
  await initLocalDeferredJobsSchema(database)
  return database
}

describe('enqueueDeferredJob', () => {
  beforeEach(() => resetJobTypeRegistry())

  it('stamps priority/requires_network from the registered job type policy, not from the caller', async () => {
    const database = await freshDb()
    registerJobHandler({ jobType: 'test.a', handler: async () => {}, priority: 'critical', requiresNetwork: true, maxQueuedJobs: 200 })
    await enqueueDeferredJob({ jobType: 'test.a', shopId: 'shop1', payload: { x: 1 } }, database)
    const row = await database.getOptional<any>(`SELECT * FROM local_deferred_jobs WHERE job_type = 'test.a'`)
    expect(row.priority).toBe('critical')
    expect(row.requires_network).toBe(1)
    expect(row.status).toBe('queued')
    expect(row.attempts).toBe(0)
  })

  it('dedupe: a colliding dedupeKey resolves successfully as a no-op, no second row created', async () => {
    const database = await freshDb()
    registerJobHandler({ jobType: 'test.a', handler: async () => {}, priority: 'normal', requiresNetwork: false, maxQueuedJobs: 200 })
    await enqueueDeferredJob({ jobType: 'test.a', shopId: 'shop1', payload: {}, dedupeKey: 'k1' }, database)
    await expect(
      enqueueDeferredJob({ jobType: 'test.a', shopId: 'shop1', payload: {}, dedupeKey: 'k1' }, database),
    ).resolves.toEqual({ deduped: true })
    const rows = await database.getAll<any>(`SELECT * FROM local_deferred_jobs WHERE job_type = 'test.a'`)
    expect(rows.length).toBe(1)
  })

  it('dedupe race: two concurrent enqueues with the same key both resolve without throwing, and exactly one "racing" row exists', async () => {
    const database = await freshDb()
    registerJobHandler({ jobType: 'test.a', handler: async () => {}, priority: 'normal', requiresNetwork: false, maxQueuedJobs: 1 })
    // Fill the type's quota (maxQueuedJobs=1) with one legitimate, unrelated row first.
    await enqueueDeferredJob({ jobType: 'test.a', shopId: 'shop1', payload: {}, dedupeKey: 'unrelated' }, database)

    const [r1, r2] = await Promise.all([
      enqueueDeferredJob({ jobType: 'test.a', shopId: 'shop1', payload: {}, dedupeKey: 'racing' }, database),
      enqueueDeferredJob({ jobType: 'test.a', shopId: 'shop1', payload: {}, dedupeKey: 'racing' }, database),
    ])
    // One of the two concurrent calls succeeds, the other is rejected as a duplicate.
    expect([r1.deduped, r2.deduped].sort()).toEqual([false, true])

    // Exactly one row exists with the racing dedupe key.
    const racingRows = await database.getAll<any>(`SELECT * FROM local_deferred_jobs WHERE dedupe_key = 'racing'`)
    expect(racingRows.length).toBe(1)

    // Note: when the first racing insert succeeds, the queue temporarily has 2 rows
    // (unrelated + racing) but quota is only 1 (maxQueuedJobs=1). Per the quota
    // enforcement semantics tested separately in the per-type-quota test, the oldest
    // evictable row is then evicted. This is correct behavior, not evidence of an
    // eviction caused specifically by the duplicate/rejected insert.
  })

  it('per-type quota: exceeding maxQueuedJobs evicts the oldest evictable row of THAT type only', async () => {
    const database = await freshDb()
    registerJobHandler({ jobType: 'test.a', handler: async () => {}, priority: 'normal', requiresNetwork: false, maxQueuedJobs: 2 })
    registerJobHandler({ jobType: 'test.b', handler: async () => {}, priority: 'normal', requiresNetwork: false, maxQueuedJobs: 200 })
    await enqueueDeferredJob({ jobType: 'test.b', shopId: 'shop1', payload: {} }, database) // unrelated type, must survive
    await enqueueDeferredJob({ jobType: 'test.a', shopId: 'shop1', payload: { n: 1 } }, database)
    await enqueueDeferredJob({ jobType: 'test.a', shopId: 'shop1', payload: { n: 2 } }, database)
    await enqueueDeferredJob({ jobType: 'test.a', shopId: 'shop1', payload: { n: 3 } }, database)

    const aRows = await database.getAll<any>(`SELECT * FROM local_deferred_jobs WHERE job_type = 'test.a' ORDER BY enqueued_at`)
    const queuedA = aRows.filter((r) => r.status === 'queued')
    expect(queuedA.length).toBe(2)
    expect(JSON.parse(queuedA[0].payload).n).toBe(2) // n=1 evicted (oldest)
    expect(JSON.parse(queuedA[1].payload).n).toBe(3)
    const evictedA = aRows.find((r) => r.status === 'evicted')
    expect(evictedA).toBeDefined()
    expect(JSON.parse(evictedA.payload).n).toBe(1)

    const bRow = await database.getOptional<any>(`SELECT status FROM local_deferred_jobs WHERE job_type = 'test.b'`)
    expect(bRow.status).toBe('queued') // unrelated type untouched
  })

  it('global ceiling enforced independently of per-type quotas', async () => {
    const database = await freshDb()
    registerJobHandler({ jobType: 'test.a', handler: async () => {}, priority: 'low', requiresNetwork: false, maxQueuedJobs: 200 })
    registerJobHandler({ jobType: 'test.b', handler: async () => {}, priority: 'low', requiresNetwork: false, maxQueuedJobs: 200 })
    // Manually seed the queue right up to the global ceiling (1000) split across two
    // types, each well under its own 200 quota, so only the global check should fire.
    for (let i = 0; i < 500; i++) {
      await database.execute(
        `INSERT INTO local_deferred_jobs (id, job_type, shop_id, payload, priority, requires_network, status, attempts, enqueued_at)
         VALUES (?, 'test.a', 'shop1', '{}', 'low', 0, 'queued', 0, ?)`,
        [`a${i}`, `2026-08-12T00:00:${String(i % 60).padStart(2, '0')}.000Z`],
      )
    }
    for (let i = 0; i < 500; i++) {
      await database.execute(
        `INSERT INTO local_deferred_jobs (id, job_type, shop_id, payload, priority, requires_network, status, attempts, enqueued_at)
         VALUES (?, 'test.b', 'shop1', '{}', 'low', 0, 'queued', 0, ?)`,
        [`b${i}`, `2026-08-12T00:01:${String(i % 60).padStart(2, '0')}.000Z`],
      )
    }
    await enqueueDeferredJob({ jobType: 'test.a', shopId: 'shop1', payload: { marker: 'over-ceiling' } }, database)
    const evictedCount = await database.getOptional<{ c: number }>(`SELECT COUNT(*) AS c FROM local_deferred_jobs WHERE status = 'evicted'`)
    expect(evictedCount!.c).toBeGreaterThanOrEqual(1)
  })

  it('eviction picks lowest priority first, then oldest within that priority', async () => {
    const database = await freshDb()
    registerJobHandler({ jobType: 'test.a', handler: async () => {}, priority: 'normal', requiresNetwork: false, maxQueuedJobs: 2 })
    await database.execute(
      `INSERT INTO local_deferred_jobs (id, job_type, shop_id, payload, priority, requires_network, status, attempts, enqueued_at)
       VALUES ('low1', 'test.a', 'shop1', '{}', 'low', 0, 'queued', 0, '2026-08-12T00:00:00.000Z')`,
    )
    await database.execute(
      `INSERT INTO local_deferred_jobs (id, job_type, shop_id, payload, priority, requires_network, status, attempts, enqueued_at)
       VALUES ('normal1', 'test.a', 'shop1', '{}', 'normal', 0, 'queued', 0, '2026-08-12T00:00:01.000Z')`,
    )
    await enqueueDeferredJob({ jobType: 'test.a', shopId: 'shop1', payload: { marker: 'newest' } }, database)
    const low1 = await database.getOptional<any>(`SELECT status FROM local_deferred_jobs WHERE id = 'low1'`)
    const normal1 = await database.getOptional<any>(`SELECT status FROM local_deferred_jobs WHERE id = 'normal1'`)
    expect(low1.status).toBe('evicted') // lowest priority evicted first, even though normal1 is older
    expect(normal1.status).toBe('queued')
  })

  it('critical jobs are never evicted: enqueue throws when no evictable candidate exists', async () => {
    const database = await freshDb()
    registerJobHandler({ jobType: 'test.a', handler: async () => {}, priority: 'critical', requiresNetwork: false, maxQueuedJobs: 1 })
    await enqueueDeferredJob({ jobType: 'test.a', shopId: 'shop1', payload: { n: 1 } }, database)
    await expect(enqueueDeferredJob({ jobType: 'test.a', shopId: 'shop1', payload: { n: 2 } }, database)).rejects.toThrow()
    const rows = await database.getAll<any>(`SELECT status FROM local_deferred_jobs WHERE job_type = 'test.a'`)
    expect(rows.every((r) => r.status === 'queued')).toBe(true) // the failed enqueue's own insert was rolled back too
    expect(rows.length).toBe(1)
  })

  it('a dedupeKey is reusable once the prior row is no longer queued/running', async () => {
    const database = await freshDb()
    registerJobHandler({ jobType: 'test.a', handler: async () => {}, priority: 'normal', requiresNetwork: false, maxQueuedJobs: 200 })
    await enqueueDeferredJob({ jobType: 'test.a', shopId: 'shop1', payload: { n: 1 }, dedupeKey: 'daily-summary:2026-08-12' }, database)
    const firstRow = await database.getOptional<any>(`SELECT id FROM local_deferred_jobs WHERE job_type = 'test.a'`)
    await database.execute(`UPDATE local_deferred_jobs SET status = 'completed', finished_at = ? WHERE id = ?`, [
      new Date().toISOString(), firstRow.id,
    ])
    const result = await enqueueDeferredJob({ jobType: 'test.a', shopId: 'shop1', payload: { n: 2 }, dedupeKey: 'daily-summary:2026-08-12' }, database)
    expect(result.deduped).toBe(false) // a genuinely new row, not deduped against the completed one
    const rows = await database.getAll<any>(`SELECT * FROM local_deferred_jobs WHERE job_type = 'test.a' AND dedupe_key = 'daily-summary:2026-08-12'`)
    expect(rows.length).toBe(2) // the old completed row plus the new queued one both exist
    expect(rows.filter((r) => r.status === 'queued').length).toBe(1)
  })
})
