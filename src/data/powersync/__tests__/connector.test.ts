import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UpdateType } from '@powersync/web'

// Drive runOp's result by row id: rows in `permanentRows` get a constraint
// reject, rows in `transientRows` get a network-style (empty-code) error, the
// rest succeed.
const permanentRows = new Set<string>()
const transientRows = new Set<string>()
const resultFor = (id: string) =>
  permanentRows.has(id) ? { code: '23505', message: 'duplicate key' }
  : transientRows.has(id) ? { code: '', message: 'Failed to fetch' }
  : null

const upsert = vi.fn((payload: any) => ({ error: resultFor(payload.id) }))
const update = vi.fn((_d: any) => ({ eq: (_c: string, id: string) => ({ error: resultFor(id) }) }))
const del    = vi.fn(() => ({ eq: (_c: string, id: string) => ({ error: resultFor(id) }) }))
vi.mock('@/data/supabase/client', () => ({
  supabase: { from: () => ({ upsert, update, delete: del }) },
}))

// Spy on quarantine so we assert poison ops are preserved without needing a DB.
const quarantineOp = vi.fn(async () => {})
vi.mock('../dead-letter', () => ({ quarantineOp: (...a: any[]) => quarantineOp(...a) }))

// WAFI-148: spy on the shared health counter helper so we can assert the
// success path counts toward sync_terminal_total without a real db.
const incrementLocalHealthCounter = vi.fn(async () => {})
const getShopLocalToday = vi.fn(async () => '2026-08-21')
vi.mock('../healthCounters', () => ({
  incrementLocalHealthCounter: (...a: any[]) => incrementLocalHealthCounter(...a),
  getShopLocalToday: (...a: any[]) => getShopLocalToday(...a),
}))
vi.mock('@/store/device.store', () => ({
  useDeviceStore: () => ({ shopId: 'shop-1' }),
}))

import { SupabaseConnector } from '../connector'

const op = (id: string, clientId: number, type = UpdateType.PUT) =>
  ({ clientId, op: type, table: 'sales', id, opData: { total_usd: 1 } }) as any

/** A fresh batch whose crud list is the given ops; complete() is a spy. The same
 *  ops reappear on every call until the test completes the batch — mirroring how
 *  PowerSync re-queues an uncompleted batch. */
const batchOf = (...ops: any[]) => ({ crud: ops, complete: vi.fn(async () => {}) })

const dbReturning = (batch: any) => ({ getCrudBatch: vi.fn(async () => batch) }) as any

describe('SupabaseConnector.uploadData — poison-op quarantine', () => {
  beforeEach(() => {
    permanentRows.clear()
    transientRows.clear()
    vi.clearAllMocks()
  })

  it('completes the batch and quarantines nothing when every op succeeds', async () => {
    const c = new SupabaseConnector()
    const batch = batchOf(op('a', 1), op('b', 2))
    await c.uploadData(dbReturning(batch))

    expect(batch.complete).toHaveBeenCalledOnce()
    expect(quarantineOp).not.toHaveBeenCalled()
  })

  it('WAFI-148: counts sync_terminal_total once per successful op', async () => {
    const c = new SupabaseConnector()
    const batch = batchOf(op('a', 1), op('b', 2))
    await c.uploadData(dbReturning(batch))

    expect(incrementLocalHealthCounter).toHaveBeenCalledTimes(2)
    expect(incrementLocalHealthCounter).toHaveBeenCalledWith('sync_terminal_total', '2026-08-21')
  })

  it('WAFI-148: does not re-count an already-succeeded op re-processed by a later retry pass', async () => {
    transientRows.add('laggy')
    const c = new SupabaseConnector()
    const batch = batchOf(op('a', 1), op('laggy', 2))

    // 'a' succeeds every pass but the batch stays open because 'laggy' keeps
    // throwing transiently -- 'a' must only be counted once, not once per pass.
    await expect(c.uploadData(dbReturning(batch))).rejects.toThrow()
    await expect(c.uploadData(dbReturning(batch))).rejects.toThrow()

    const successCalls = incrementLocalHealthCounter.mock.calls.filter(([key]) => key === 'sync_terminal_total')
    expect(successCalls).toHaveLength(1)
  })

  it('leaves the batch uncompleted and never quarantines on a transient error', async () => {
    transientRows.add('a')
    const c = new SupabaseConnector()
    const batch = batchOf(op('a', 1))

    for (let i = 0; i < 5; i++) {
      await expect(c.uploadData(dbReturning(batch))).rejects.toThrow()
    }
    expect(batch.complete).not.toHaveBeenCalled()
    expect(quarantineOp).not.toHaveBeenCalled() // transient must retry forever
  })

  it('retries a permanent error a few times before quarantining (absorbs a misclassified blip)', async () => {
    permanentRows.add('a')
    const c = new SupabaseConnector()
    const batch = batchOf(op('a', 1))

    // First two attempts: still retrying — no quarantine, batch held.
    await expect(c.uploadData(dbReturning(batch))).rejects.toThrow()
    await expect(c.uploadData(dbReturning(batch))).rejects.toThrow()
    expect(quarantineOp).not.toHaveBeenCalled()
    expect(batch.complete).not.toHaveBeenCalled()

    // Third attempt: quarantine and let the batch complete.
    await c.uploadData(dbReturning(batch))
    expect(quarantineOp).toHaveBeenCalledOnce()
    expect(batch.complete).toHaveBeenCalledOnce()
  })

  it('a poison op does not block an unrelated queued write from syncing', async () => {
    permanentRows.add('poison')
    const c = new SupabaseConnector()
    const batch = batchOf(op('poison', 1), op('good', 2))

    // Burn through the retry buffer for the poison op.
    await expect(c.uploadData(dbReturning(batch))).rejects.toThrow()
    await expect(c.uploadData(dbReturning(batch))).rejects.toThrow()
    await c.uploadData(dbReturning(batch))

    // Poison quarantined, good write uploaded, batch drained.
    expect(quarantineOp).toHaveBeenCalledOnce()
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'good' }))
    expect(batch.complete).toHaveBeenCalledOnce()
  })

  it('does not re-attempt or re-quarantine an already-quarantined op when a later op stays transient', async () => {
    permanentRows.add('poison')
    transientRows.add('laggy')
    const c = new SupabaseConnector()
    const batch = batchOf(op('poison', 1), op('laggy', 2))

    // 3 attempts → poison quarantined; then 'laggy' throws so the batch never completes.
    for (let i = 0; i < 4; i++) {
      await expect(c.uploadData(dbReturning(batch))).rejects.toThrow()
    }
    expect(quarantineOp).toHaveBeenCalledOnce() // not re-quarantined each round
    expect(batch.complete).not.toHaveBeenCalled()

    // After quarantine, the poison row is skipped entirely (runOp not re-issued for it).
    const poisonAttempts = upsert.mock.calls.filter(([p]) => p.id === 'poison').length
    expect(poisonAttempts).toBe(3) // only the 3 attempts before quarantine
  })
})
