import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createRealSqliteDb } from '@/__tests__/helpers/realSqliteDb'
import { initLocalDeferredJobsSchema } from '@/services/events/deferredJobsSchema'
import { drainDeferredJobs } from '@/services/events/drainDeferredJobs'
import { registerJobHandler, resetJobTypeRegistry } from '@/services/events/jobTypeRegistry'

async function freshDb() {
  const database = createRealSqliteDb()
  await initLocalDeferredJobsSchema(database)
  return database
}
async function seed(database: any, row: Partial<Record<string, unknown>>) {
  const defaults = {
    id: crypto.randomUUID(), job_type: 'test.a', shop_id: 'shop1', payload: '{}',
    priority: 'normal', requires_network: 0, status: 'queued', attempts: 0,
    enqueued_at: new Date().toISOString(),
  }
  const merged = { ...defaults, ...row }
  const cols = Object.keys(merged)
  await database.execute(
    `INSERT INTO local_deferred_jobs (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
    Object.values(merged),
  )
  return merged
}

describe('drainDeferredJobs', () => {
  beforeEach(() => resetJobTypeRegistry())

  it('claims and completes an offline-capable job while offline', async () => {
    const database = createRealSqliteDb() // note: drainDeferredJobs is written against the real `db` import in Task 7; this task's tests exercise the pure query/ordering logic via an injectable db param added alongside opts (see Step 3's `database` param)
    await initLocalDeferredJobsSchema(database)
    const handler = vi.fn().mockResolvedValue(undefined)
    registerJobHandler({ jobType: 'test.a', handler, priority: 'normal', requiresNetwork: false, maxQueuedJobs: 200 })
    await seed(database, { requires_network: 0 })
    await drainDeferredJobs('shop1', { isConnected: () => false, isForegrounded: () => true }, database)
    expect(handler).toHaveBeenCalledTimes(1)
    const row = await database.getOptional<any>(`SELECT status FROM local_deferred_jobs WHERE job_type = 'test.a'`)
    expect(row.status).toBe('completed')
  })

  it('does not select a requires_network job while offline', async () => {
    const database = await freshDb()
    const handler = vi.fn().mockResolvedValue(undefined)
    registerJobHandler({ jobType: 'test.net', handler, priority: 'normal', requiresNetwork: true, maxQueuedJobs: 200 })
    await seed(database, { job_type: 'test.net', requires_network: 1 })
    await drainDeferredJobs('shop1', { isConnected: () => false, isForegrounded: () => true }, database)
    expect(handler).not.toHaveBeenCalled()
    const row = await database.getOptional<any>(`SELECT status FROM local_deferred_jobs WHERE job_type = 'test.net'`)
    expect(row.status).toBe('queued')
  })

  it('selects a requires_network job once connected', async () => {
    const database = await freshDb()
    const handler = vi.fn().mockResolvedValue(undefined)
    registerJobHandler({ jobType: 'test.net', handler, priority: 'normal', requiresNetwork: true, maxQueuedJobs: 200 })
    await seed(database, { job_type: 'test.net', requires_network: 1 })
    await drainDeferredJobs('shop1', { isConnected: () => true, isForegrounded: () => true }, database)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('processes critical before normal, FIFO within the same priority across different job types', async () => {
    const database = await freshDb()
    const order: string[] = []
    registerJobHandler({ jobType: 'test.a', handler: async (j) => { order.push(`a:${(j.payload as any).n}`) }, priority: 'normal', requiresNetwork: false, maxQueuedJobs: 200 })
    registerJobHandler({ jobType: 'test.b', handler: async (j) => { order.push(`b:${(j.payload as any).n}`) }, priority: 'normal', requiresNetwork: false, maxQueuedJobs: 200 })
    registerJobHandler({ jobType: 'test.crit', handler: async () => { order.push('crit') }, priority: 'critical', requiresNetwork: false, maxQueuedJobs: 200 })
    await seed(database, { job_type: 'test.a', payload: '{"n":1}', enqueued_at: '2026-08-12T00:00:00.000Z' })
    await seed(database, { job_type: 'test.b', payload: '{"n":1}', enqueued_at: '2026-08-12T00:00:01.000Z' })
    await seed(database, { job_type: 'test.a', payload: '{"n":2}', enqueued_at: '2026-08-12T00:00:02.000Z' })
    await seed(database, { job_type: 'test.crit', priority: 'critical', enqueued_at: '2026-08-12T00:00:03.000Z' })
    await drainDeferredJobs('shop1', { isConnected: () => true, isForegrounded: () => true }, database)
    expect(order).toEqual(['crit', 'a:1', 'b:1', 'a:2']) // critical first, then strict FIFO across a/b regardless of type
  })

  it('never selects a row whose job type has no registered handler, and does not block other rows', async () => {
    const database = await freshDb()
    const handler = vi.fn().mockResolvedValue(undefined)
    registerJobHandler({ jobType: 'test.known', handler, priority: 'normal', requiresNetwork: false, maxQueuedJobs: 200 })
    await seed(database, { job_type: 'test.unknown', enqueued_at: '2026-08-12T00:00:00.000Z' })
    await seed(database, { job_type: 'test.known', enqueued_at: '2026-08-12T00:00:01.000Z' })
    await drainDeferredJobs('shop1', { isConnected: () => true, isForegrounded: () => true }, database)
    expect(handler).toHaveBeenCalledTimes(1)
    const unknownRow = await database.getOptional<any>(`SELECT status FROM local_deferred_jobs WHERE job_type = 'test.unknown'`)
    expect(unknownRow.status).toBe('queued') // untouched, never claimed
  })

  it('reclaims a stale running row (expired lease) before claiming new work', async () => {
    const database = await freshDb()
    const handler = vi.fn().mockResolvedValue(undefined)
    registerJobHandler({ jobType: 'test.a', handler, priority: 'normal', requiresNetwork: false, maxQueuedJobs: 200 })
    const staleId = crypto.randomUUID()
    await database.execute(
      `INSERT INTO local_deferred_jobs (id, job_type, shop_id, payload, priority, requires_network, status, attempts, worker_id, started_at, lease_expires_at, enqueued_at)
       VALUES (?, 'test.a', 'shop1', '{}', 'normal', 0, 'running', 1, 'old-worker', '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:01.000Z', '2026-08-12T00:00:00.000Z')`,
      [staleId],
    )
    await drainDeferredJobs('shop1', { isConnected: () => true, isForegrounded: () => true }, database)
    expect(handler).toHaveBeenCalledTimes(1)
    const row = await database.getOptional<any>(`SELECT status, worker_id FROM local_deferred_jobs WHERE id = ?`, [staleId])
    expect(row.status).toBe('completed') // reclaimed to queued, then claimed and run to completion
  })

  it('a transient failure returns the row to queued with next_retry_at on the shared backoff schedule', async () => {
    const database = await freshDb()
    const handler = vi.fn().mockRejectedValue(new Error('database is locked'))
    registerJobHandler({ jobType: 'test.a', handler, priority: 'normal', requiresNetwork: false, maxQueuedJobs: 200 })
    await seed(database, {})
    const before = new Date()
    await drainDeferredJobs('shop1', { isConnected: () => true, isForegrounded: () => true }, database)
    const row = await database.getOptional<any>(`SELECT status, attempts, next_retry_at FROM local_deferred_jobs WHERE job_type = 'test.a'`)
    expect(row.status).toBe('queued')
    expect(row.attempts).toBe(1)
    const retryAt = new Date(row.next_retry_at)
    expect(retryAt.getTime()).toBeGreaterThan(before.getTime()) // roughly ~1 minute out per BACKOFF_MINUTES[0], jittered
  })

  it('a permanent failure moves straight to dead after the current (already-counted) attempt', async () => {
    const database = await freshDb()
    const handler = vi.fn().mockRejectedValue(new Error('malformed payload'))
    registerJobHandler({ jobType: 'test.a', handler, priority: 'normal', requiresNetwork: false, maxQueuedJobs: 200 })
    await seed(database, {})
    await drainDeferredJobs('shop1', { isConnected: () => true, isForegrounded: () => true }, database)
    const row = await database.getOptional<any>(`SELECT status, attempts, next_retry_at FROM local_deferred_jobs WHERE job_type = 'test.a'`)
    expect(row.status).toBe('dead')
    expect(row.attempts).toBe(1)
    expect(row.next_retry_at).toBeNull()
  })

  it('a job that fails MAX_ATTEMPTS times transiently ends up dead, not retried a 6th time', async () => {
    const database = await freshDb()
    const handler = vi.fn().mockRejectedValue(new Error('database is locked'))
    registerJobHandler({ jobType: 'test.a', handler, priority: 'normal', requiresNetwork: false, maxQueuedJobs: 200 })
    await seed(database, {})
    for (let i = 0; i < 5; i++) {
      // Force next_retry_at into the past between rounds so claimNext picks the row up again immediately.
      await database.execute(`UPDATE local_deferred_jobs SET next_retry_at = '2020-01-01T00:00:00.000Z' WHERE job_type = 'test.a'`)
      await drainDeferredJobs('shop1', { isConnected: () => true, isForegrounded: () => true }, database)
    }
    expect(handler).toHaveBeenCalledTimes(5) // exactly MAX_ATTEMPTS real executions, the 5th claim still ran the handler
    const row = await database.getOptional<any>(`SELECT status, attempts, next_retry_at FROM local_deferred_jobs WHERE job_type = 'test.a'`)
    expect(row.status).toBe('dead')
    expect(row.attempts).toBe(5)
    expect(row.next_retry_at).toBeNull()
  })

  it('yields via a macrotask between jobs and stops immediately once backgrounded', async () => {
    const database = await freshDb()
    const executionOrder: number[] = []
    let backgroundedAfter = 0
    registerJobHandler({
      jobType: 'test.a',
      handler: async (j) => { executionOrder.push((j.payload as any).n) },
      priority: 'normal', requiresNetwork: false, maxQueuedJobs: 200,
    })
    await seed(database, { payload: '{"n":1}', enqueued_at: '2026-08-12T00:00:00.000Z' })
    await seed(database, { payload: '{"n":2}', enqueued_at: '2026-08-12T00:00:01.000Z' })
    await seed(database, { payload: '{"n":3}', enqueued_at: '2026-08-12T00:00:02.000Z' })

    let calls = 0
    await drainDeferredJobs('shop1', {
      isConnected: () => true,
      isForegrounded: () => { calls += 1; return calls <= 1 }, // foregrounded for job 1's post-check only
    }, database)

    expect(executionOrder).toEqual([1]) // stopped after the first job, never reached 2 or 3
    const remaining = await database.getAll<any>(`SELECT status FROM local_deferred_jobs WHERE status = 'queued'`)
    expect(remaining.length).toBe(2)
  })

  it('single-flight: a second concurrent drain call reuses the first in-flight drain rather than claiming independently', async () => {
    const database = await freshDb()
    let resolveFirst: () => void
    const gate = new Promise<void>((resolve) => { resolveFirst = resolve })
    let handlerCalls = 0
    registerJobHandler({
      jobType: 'test.a',
      handler: async () => { handlerCalls += 1; await gate },
      priority: 'normal', requiresNetwork: false, maxQueuedJobs: 200,
    })
    await seed(database, {})

    const first = drainDeferredJobs('shop1', { isConnected: () => true, isForegrounded: () => true }, database)
    const second = drainDeferredJobs('shop1', { isConnected: () => true, isForegrounded: () => true }, database)
    resolveFirst!()
    await Promise.all([first, second])

    expect(handlerCalls).toBe(1) // only ever claimed and ran once, not twice
  })

  it('purges completed/dead/evicted rows past the retention window at the end of a drain pass', async () => {
    const database = await freshDb()
    registerJobHandler({ jobType: 'test.a', handler: async () => {}, priority: 'normal', requiresNetwork: false, maxQueuedJobs: 200 })
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() // 8 days ago
    const recent = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString() // 1 day ago
    await seed(database, { id: 'old-completed', status: 'completed', finished_at: old })
    await seed(database, { id: 'old-dead', status: 'dead', finished_at: old })
    await seed(database, { id: 'old-evicted', status: 'evicted', finished_at: old })
    await seed(database, { id: 'recent-completed', status: 'completed', finished_at: recent })

    await drainDeferredJobs('shop1', { isConnected: () => true, isForegrounded: () => true }, database)

    const remainingIds = (await database.getAll<any>(`SELECT id FROM local_deferred_jobs`)).map((r: any) => r.id)
    expect(remainingIds).not.toContain('old-completed')
    expect(remainingIds).not.toContain('old-dead')
    expect(remainingIds).not.toContain('old-evicted')
    expect(remainingIds).toContain('recent-completed')
  })
})
