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
})
