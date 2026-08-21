import { describe, it, expect, vi, beforeEach } from 'vitest'
import { incrementLocalHealthCounter, shopLocalDateString, getShopLocalToday } from '../healthCounters'

// local_health_metrics is a PowerSync localOnly table (SQLite view backed by
// CRUD-queue triggers) -- ON CONFLICT against it fails at runtime (no local
// unique-index conflict target), per the established read-then-insert-or-update
// pattern in dailyEventCountsProjection.ts/profitCacheProjection.ts. This mock
// models that: getOptional returns existing rows by (metric_key, period_start).
//
// vi.mock factories are hoisted above all imports/top-level const declarations,
// so the map and mock fns referenced inside the factory must themselves be
// declared via vi.hoisted (a plain top-level const here throws "Cannot access
// 'mockDb' before initialization").
const { rows, mockDb } = vi.hoisted(() => {
  const rows = new Map<string, { id: string; value: number }>()
  const mockDb = {
    getOptional: vi.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes('shops')) {
        const shopId = params[0]
        return shopId === 'shop-with-tz'
          ? { timezone: 'Asia/Damascus', timezone_confirmed_at: '2026-08-21T10:00:00Z' }
          : { timezone: 'UTC', timezone_confirmed_at: null }
      }
      const key = `${params[0]}|${params[1]}`
      return rows.get(key) ?? null
    }),
    execute: vi.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes('INSERT')) {
        const [id, metricKey, periodStart, value] = params as [string, string, string, number]
        rows.set(`${metricKey}|${periodStart}`, { id, value })
      } else if (sql.includes('UPDATE')) {
        // 3 bound params in execution order: [value, updated_at, id] (the real
        // SQL is `SET value = ?, updated_at = ? WHERE id = ?`) -- the id is the
        // last param, not the second.
        const [value, , id] = params as [number, string, string]
        for (const row of rows.values()) if (row.id === id) row.value = value
      }
    }),
  }
  return { rows, mockDb }
})
vi.mock('@/data/powersync/db', () => ({ db: mockDb }))

describe('WAFI-148 incrementLocalHealthCounter', () => {
  beforeEach(() => {
    rows.clear()
    mockDb.execute.mockClear()
    mockDb.getOptional.mockClear()
  })

  it('inserts a new row with the given amount when none exists yet', async () => {
    await incrementLocalHealthCounter('sync_failure_terminal', '2026-08-21')
    expect(rows.get('sync_failure_terminal|2026-08-21')?.value).toBe(1)
  })

  it('additively increments an existing row rather than overwriting it', async () => {
    await incrementLocalHealthCounter('sync_failure_terminal', '2026-08-21')
    await incrementLocalHealthCounter('sync_failure_terminal', '2026-08-21')
    await incrementLocalHealthCounter('sync_failure_terminal', '2026-08-21', 3)
    expect(rows.get('sync_failure_terminal|2026-08-21')?.value).toBe(5) // 1 + 1 + 3
  })

  it('never issues an ON CONFLICT statement against local_health_metrics', async () => {
    await incrementLocalHealthCounter('sync_failure_terminal', '2026-08-21')
    for (const call of mockDb.execute.mock.calls) {
      expect(call[0]).not.toMatch(/ON CONFLICT/i)
    }
  })
})

describe('WAFI-148 shopLocalDateString', () => {
  it('formats a shop-local calendar date, not the UTC date', () => {
    // 2026-08-21T22:00:00Z is 2026-08-22 01:00 in Asia/Damascus (UTC+3) --
    // the shop-local date must roll over even though UTC hasn't.
    const utcDate = new Date('2026-08-21T22:00:00Z')
    expect(shopLocalDateString('Asia/Damascus', utcDate)).toBe('2026-08-22')
  })
})

describe('WAFI-148 getShopLocalToday', () => {
  it('resolves the shop-local date when the shop has a configured timezone', async () => {
    const result = await getShopLocalToday('shop-with-tz')
    expect(result).not.toBeNull()
  })

  it('returns null when the shop has no configured timezone', async () => {
    const result = await getShopLocalToday('shop-without-tz')
    expect(result).toBeNull()
  })
})
