import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UpdateType } from '@powersync/web'

// runOp (inside dead-letter retry) talks to Supabase — drive its result per test.
let nextError: { code: string; message: string } | null = null
const upsert = vi.fn(() => ({ error: nextError }))
const update = vi.fn(() => ({ eq: () => ({ error: nextError }) }))
const del    = vi.fn(() => ({ eq: () => ({ error: nextError }) }))
vi.mock('@/data/supabase/client', () => ({
  supabase: { from: () => ({ upsert, update, delete: del }) },
}))

// WAFI-148: spy on the shared health counter helper so quarantineOp's
// counter side effect can be asserted without a real db.
const incrementLocalHealthCounter = vi.fn(async () => {})
const getShopLocalToday = vi.fn(async () => '2026-08-21')
vi.mock('../healthCounters', () => ({
  incrementLocalHealthCounter: (...a: any[]) => incrementLocalHealthCounter(...a),
  getShopLocalToday: (...a: any[]) => getShopLocalToday(...a),
}))
vi.mock('@/store/device.store', () => ({
  useDeviceStore: () => ({ shopId: 'shop-1' }),
}))

import {
  quarantineOp,
  countDeadLetter,
  listDeadLetter,
  retryDeadLetterOp,
  discardDeadLetterOp,
} from '../dead-letter'

/** Faithful in-memory stand-in for the local sync_dead_letter table. Interprets
 *  exactly the statements dead-letter.ts issues — enough to exercise real logic
 *  (JSON round-trip, idempotency check, delete-on-success) without WASM SQLite. */
class FakeDb {
  rows = new Map<string, Record<string, any>>()

  async execute(sql: string, params: any[] = []) {
    if (/^INSERT INTO sync_dead_letter/i.test(sql)) {
      const [id, client_id, op_type, table_name, row_id, op_data, error_code, error_message, failed_at] = params
      this.rows.set(id, { id, client_id, op_type, table_name, row_id, op_data, error_code, error_message, failed_at })
    } else if (/^DELETE FROM sync_dead_letter/i.test(sql)) {
      this.rows.delete(params[0])
    } else if (/^UPDATE sync_dead_letter/i.test(sql)) {
      const [error_code, error_message, failed_at, id] = params
      const r = this.rows.get(id)
      if (r) Object.assign(r, { error_code, error_message, failed_at })
    }
    return { rows: { _array: [] } }
  }

  async getOptional<T>(sql: string, params: any[] = []): Promise<T | null> {
    if (/WHERE client_id = \?/.test(sql)) {
      for (const r of this.rows.values()) if (r.client_id === params[0]) return r as T
      return null
    }
    if (/WHERE id = \?/.test(sql)) return (this.rows.get(params[0]) as T) ?? null
    return null
  }

  async getAll<T>(sql: string): Promise<T[]> {
    if (/count\(\*\)/i.test(sql)) return [{ n: this.rows.size } as unknown as T]
    return [...this.rows.values()] as T[]
  }
}

const crudOp = (over: Partial<{ clientId: number; op: UpdateType; table: string; id: string; opData: any }> = {}) =>
  ({ clientId: 1, op: UpdateType.PUT, table: 'sales', id: 's1', opData: { total_usd: 10 }, ...over }) as any

const pgErr = (code: string, message = 'boom') => ({ code, message, details: '', hint: '', name: 'PostgrestError' }) as any

describe('dead-letter quarantine holding', () => {
  let db: FakeDb
  beforeEach(() => {
    db = new FakeDb()
    nextError = null
    vi.clearAllMocks()
  })

  it('quarantineOp preserves the full op (type/table/id/data) so it can be replayed', async () => {
    await quarantineOp(db as any, crudOp(), pgErr('23505', 'duplicate key'))

    const [row] = await listDeadLetter(db as any)
    expect(row).toMatchObject({
      client_id: 1, op_type: UpdateType.PUT, table_name: 'sales', row_id: 's1',
      error_code: '23505', error_message: 'duplicate key',
    })
    expect(JSON.parse(row.op_data!)).toEqual({ total_usd: 10 })
    expect(await countDeadLetter(db as any)).toBe(1)
  })

  it('quarantineOp is idempotent — reprocessing the same uncompleted op does not duplicate it', async () => {
    await quarantineOp(db as any, crudOp({ clientId: 7 }), pgErr('42501'))
    await quarantineOp(db as any, crudOp({ clientId: 7 }), pgErr('42501'))
    expect(await countDeadLetter(db as any)).toBe(1)
  })

  it('WAFI-148: quarantineOp counts both sync_failure_terminal and sync_terminal_total', async () => {
    await quarantineOp(db as any, crudOp(), pgErr('23505'))
    expect(incrementLocalHealthCounter).toHaveBeenCalledWith('sync_failure_terminal', '2026-08-21')
    expect(incrementLocalHealthCounter).toHaveBeenCalledWith('sync_terminal_total', '2026-08-21')
    expect(incrementLocalHealthCounter).toHaveBeenCalledTimes(2)
  })

  it('WAFI-148: re-quarantining the same op (idempotent path) does not double-count', async () => {
    await quarantineOp(db as any, crudOp({ clientId: 7 }), pgErr('42501'))
    await quarantineOp(db as any, crudOp({ clientId: 7 }), pgErr('42501'))
    expect(incrementLocalHealthCounter).toHaveBeenCalledTimes(2) // only the first call counted
  })

  it('retry that now succeeds removes the op from the holding (recovered)', async () => {
    await quarantineOp(db as any, crudOp(), pgErr('23505'))
    const [row] = await listDeadLetter(db as any)

    nextError = null // server accepts it this time
    const result = await retryDeadLetterOp(db as any, row.id)

    expect(result.status).toBe('recovered')
    expect(await countDeadLetter(db as any)).toBe(0)
  })

  it('retry that fails permanently again keeps it held and refreshes the recorded cause', async () => {
    await quarantineOp(db as any, crudOp(), pgErr('23505', 'old'))
    const [row] = await listDeadLetter(db as any)

    nextError = pgErr('23503', 'fk violation')
    const result = await retryDeadLetterOp(db as any, row.id)

    expect(result.status).toBe('still-blocked')
    expect(await countDeadLetter(db as any)).toBe(1)
    const [after] = await listDeadLetter(db as any)
    expect(after.error_message).toBe('fk violation') // cause updated, not lost
  })

  it('retry while offline (transient) keeps the op held without dropping it', async () => {
    await quarantineOp(db as any, crudOp(), pgErr('23505'))
    const [row] = await listDeadLetter(db as any)

    nextError = pgErr('', 'Failed to fetch') // network failure: empty code
    const result = await retryDeadLetterOp(db as any, row.id)

    expect(result.status).toBe('transient')
    expect(await countDeadLetter(db as any)).toBe(1) // never dropped
  })

  it('discard removes the held op', async () => {
    await quarantineOp(db as any, crudOp(), pgErr('23505'))
    const [row] = await listDeadLetter(db as any)
    await discardDeadLetterOp(db as any, row.id)
    expect(await countDeadLetter(db as any)).toBe(0)
  })
})
