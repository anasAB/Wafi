import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock factories are hoisted above all imports/top-level const declarations,
// so anything they reference must itself be declared via vi.hoisted.
const { mockDb, mockRpc } = vi.hoisted(() => ({
  mockDb: { getOptional: vi.fn() },
  mockRpc: vi.fn(),
}))
vi.mock('@/data/powersync/db', () => ({ db: mockDb }))
vi.mock('@/data/supabase/client', () => ({ supabase: { rpc: mockRpc } }))
vi.mock('@/store/device.store', () => ({
  useDeviceStore: () => ({ shopId: 'shop-1' }),
}))

import { useShopTimezone, suggestedTimezoneForCountry } from '../useShopTimezone'

describe('WAFI-148 useShopTimezone', () => {
  beforeEach(() => {
    mockDb.getOptional.mockReset()
    mockRpc.mockReset()
  })

  it('loads the current timezone and confirmation state from the synced shops row', async () => {
    mockDb.getOptional.mockResolvedValueOnce({ timezone: 'Asia/Damascus', timezone_confirmed_at: '2026-08-21T10:00:00Z' })
    const { currentTimezone, isConfirmed, load } = useShopTimezone()
    await load()
    expect(currentTimezone.value).toBe('Asia/Damascus')
    expect(isConfirmed.value).toBe(true)
  })

  it('reports isConfirmed=false for a shop whose timezone was never explicitly confirmed', async () => {
    mockDb.getOptional.mockResolvedValueOnce({ timezone: 'UTC', timezone_confirmed_at: null })
    const { currentTimezone, isConfirmed, load } = useShopTimezone()
    await load()
    expect(currentTimezone.value).toBe('UTC')
    expect(isConfirmed.value).toBe(false)
  })

  it('confirmTimezone calls the RPC and updates local state on success', async () => {
    mockRpc.mockResolvedValueOnce({ data: 'ok', error: null })
    const { currentTimezone, isConfirmed, confirmTimezone } = useShopTimezone()
    const result = await confirmTimezone('Asia/Damascus')
    expect(mockRpc).toHaveBeenCalledWith('confirm_shop_timezone', { p_timezone: 'Asia/Damascus' })
    expect(result).toBe('ok')
    expect(currentTimezone.value).toBe('Asia/Damascus')
    expect(isConfirmed.value).toBe(true)
  })

  it('confirmTimezone surfaces a forbidden result without mutating local state', async () => {
    mockRpc.mockResolvedValueOnce({ data: 'forbidden', error: null })
    const { currentTimezone, isConfirmed, confirmTimezone } = useShopTimezone()
    const result = await confirmTimezone('Asia/Damascus')
    expect(result).toBe('forbidden')
    expect(currentTimezone.value).toBeNull()
    expect(isConfirmed.value).toBe(false)
  })

  it('confirmTimezone surfaces an invalid_timezone result', async () => {
    mockRpc.mockResolvedValueOnce({ data: 'invalid_timezone', error: null })
    const { confirmTimezone } = useShopTimezone()
    const result = await confirmTimezone('UTC+2')
    expect(result).toBe('invalid_timezone')
  })

  it('confirmTimezone returns error and sets the error message on an RPC failure', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'network down' } })
    const { error, confirmTimezone } = useShopTimezone()
    const result = await confirmTimezone('Asia/Damascus')
    expect(result).toBe('error')
    expect(error.value).toBe('network down')
  })

  it('suggestedTimezoneForCountry maps known country codes and falls back to UTC', () => {
    expect(suggestedTimezoneForCountry('SY')).toBe('Asia/Damascus')
    expect(suggestedTimezoneForCountry('XX')).toBe('UTC')
  })
})
