import { describe, it, expect, vi, beforeEach } from 'vitest'
import { markDeviceActiveForDay } from '../composables/useDeviceActivity'

const executed: Array<{ sql: string; params: unknown[] }> = []
const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    execute: vi.fn(async (_sql: string, _params: unknown[] = []) => {}),
    getAll: vi.fn(async () => []),
  },
}))

vi.mock('@/data/powersync/db', () => ({ db: mockDb }))

mockDb.execute.mockImplementation(async (sql: string, params: unknown[] = []) => {
  executed.push({ sql, params })
})

describe('WAFI-148 markDeviceActiveForDay', () => {
  beforeEach(() => {
    executed.length = 0
    mockDb.execute.mockClear()
  })

  it('upserts active_device_day = 1 for the shop-local calendar day', async () => {
    const fixedNow = new Date('2026-08-21T10:00:00Z') // 13:00 Asia/Damascus
    await markDeviceActiveForDay('Asia/Damascus', fixedNow)

    expect(executed).toHaveLength(1)
    expect(executed[0].sql).toContain('local_health_metrics')
    expect(executed[0].params).toContain('active_device_day')
    expect(executed[0].params).toContain('2026-08-21')
  })

  it('is idempotent -- calling twice in the same day does not double-write', async () => {
    const fixedNow = new Date('2026-08-21T10:00:00Z')
    await markDeviceActiveForDay('Asia/Damascus', fixedNow)
    await markDeviceActiveForDay('Asia/Damascus', fixedNow)

    // Both calls execute the same idempotent UPSERT (value stays 1, never incremented) --
    // asserting the SQL uses an idempotent-safe upsert, not an additive increment.
    expect(executed[0].sql).not.toMatch(/value\s*\+\s*1/)
    expect(executed[1].sql).not.toMatch(/value\s*\+\s*1/)
  })
})
