import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = vi.hoisted(() => ({ getOptional: vi.fn() }))
vi.mock('@/data/powersync/db', () => ({ db: mockDb }))

import { shopLocalDateString, getShopCurrentDay } from '../shopTimezone'

describe('WAFI-148 follow-up: shopTimezone.ts', () => {
  beforeEach(() => {
    mockDb.getOptional.mockReset()
  })

  it('shopLocalDateString formats a date as YYYY-MM-DD in the given IANA timezone', () => {
    const fixed = new Date('2026-08-21T22:30:00Z') // late evening UTC
    expect(shopLocalDateString('UTC', fixed)).toBe('2026-08-21')
    expect(shopLocalDateString('Asia/Damascus', fixed)).toBe('2026-08-22') // UTC+3, already past midnight locally
  })

  it('getShopCurrentDay resolves the shop-local day using shops.timezone, unconditionally (no confirmation gate)', async () => {
    mockDb.getOptional.mockResolvedValueOnce({ timezone: 'Asia/Damascus' })
    const result = await getShopCurrentDay('shop-1')
    expect(typeof result).toBe('string')
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('getShopCurrentDay falls back to UTC when the shop row has not synced yet', async () => {
    mockDb.getOptional.mockResolvedValueOnce(null)
    const result = await getShopCurrentDay('shop-unsynced')
    expect(result).toBe(shopLocalDateString('UTC'))
  })
})
