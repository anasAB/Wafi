import { describe, it, expect, vi, beforeEach } from 'vitest'
import { markDeviceActiveForDay } from '../composables/useDeviceActivity'

// Models the real local_health_metrics table's read-then-insert-or-update
// behavior (it's a PowerSync localOnly SQLite view -- ON CONFLICT against it
// is rejected, so the implementation must SELECT first). Keyed by
// (metric_key, period_start), same as the real unique lookup.
interface Row { id: string; metric_key: string; period_start: string; value: number; updated_at: string }

const executed: Array<{ sql: string; params: unknown[] }> = []
const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    execute: vi.fn(async (_sql: string, _params: unknown[] = []) => {}),
    getOptional: vi.fn(async (_sql: string, _params: unknown[] = []): Promise<unknown> => null),
    getAll: vi.fn(async () => []),
  },
}))

vi.mock('@/data/powersync/db', () => ({ db: mockDb }))

let store: Row[] = []

function wireMockDbToStore() {
  mockDb.execute.mockImplementation(async (sql: string, params: unknown[] = []) => {
    executed.push({ sql, params })
    if (/^INSERT/i.test(sql)) {
      const [id, metric_key, period_start, updated_at] = params as [string, string, string, string]
      store.push({ id, metric_key, period_start, value: 1, updated_at })
    } else if (/^UPDATE/i.test(sql)) {
      const [updated_at, id] = params as [string, string]
      const row = store.find((r) => r.id === id)
      if (row) {
        row.value = 1
        row.updated_at = updated_at
      }
    }
  })
  mockDb.getOptional.mockImplementation(async (sql: string, params: unknown[] = []) => {
    const [metric_key, period_start] = params as [string, string]
    return store.find((r) => r.metric_key === metric_key && r.period_start === period_start) ?? null
  })
}

describe('WAFI-148 markDeviceActiveForDay', () => {
  beforeEach(() => {
    executed.length = 0
    store = []
    mockDb.execute.mockClear()
    mockDb.getOptional.mockClear()
    wireMockDbToStore()
  })

  it('upserts active_device_day = 1 for the shop-local calendar day', async () => {
    const fixedNow = new Date('2026-08-21T10:00:00Z') // 13:00 Asia/Damascus
    await markDeviceActiveForDay('Asia/Damascus', fixedNow)

    expect(executed).toHaveLength(1)
    expect(executed[0].sql).toContain('local_health_metrics')
    expect(executed[0].params).toContain('active_device_day')
    expect(executed[0].params).toContain('2026-08-21')
    expect(store).toHaveLength(1)
    expect(store[0]).toMatchObject({ metric_key: 'active_device_day', period_start: '2026-08-21', value: 1 })
  })

  it('is idempotent -- calling twice in the same day does not double-write', async () => {
    const fixedNow = new Date('2026-08-21T10:00:00Z')
    await markDeviceActiveForDay('Asia/Damascus', fixedNow)
    await markDeviceActiveForDay('Asia/Damascus', fixedNow)

    // Both calls execute the same idempotent write path (value stays 1, never incremented) --
    // asserting the SQL never uses an additive increment.
    expect(executed[0].sql).not.toMatch(/value\s*\+\s*1/)
    expect(executed[1].sql).not.toMatch(/value\s*\+\s*1/)
  })

  it('is idempotent against a modeled real key-value store -- second call updates, not inserts, and no duplicate row is created', async () => {
    const fixedNow = new Date('2026-08-21T10:00:00Z')

    await markDeviceActiveForDay('Asia/Damascus', fixedNow)
    expect(store).toHaveLength(1)
    expect(executed[0].sql).toMatch(/^INSERT/i)

    await expect(markDeviceActiveForDay('Asia/Damascus', fixedNow)).resolves.not.toThrow()

    // Exactly one row still exists -- no duplicate, no error.
    expect(store).toHaveLength(1)
    expect(store[0].value).toBe(1)
    // The second call took the UPDATE path (row already existed), never a second INSERT.
    expect(executed[1].sql).toMatch(/^UPDATE/i)
  })
})
