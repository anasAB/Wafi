// src/composables/insights/__tests__/revenueUpToTimestamp.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getRevenueUsdUpToTimestamp } from '../revenueUpToTimestamp'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

vi.mock('@/data/powersync/db', () => ({
  db: { getOptional: vi.fn() },
}))

describe('getRevenueUsdUpToTimestamp', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useDeviceStore().shopId = 'shop-1'
    vi.mocked(db.getOptional).mockReset()
  })

  it('returns sales total minus refunds, both bounded by the cutoff timestamp', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ total: 510 })  // sales query
      .mockResolvedValueOnce({ total: 10 })   // refunds query
    const result = await getRevenueUsdUpToTimestamp('2026-08-05', '2026-08-05T14:30:45.000Z')
    expect(result).toBe(500)
    expect(db.getOptional).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('FROM sales'),
      ['shop-1', '2026-08-05', '2026-08-05T14:30:45.000Z'],
    )
    expect(db.getOptional).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('FROM returns'),
      ['shop-1', '2026-08-05', '2026-08-05T14:30:45.000Z'],
    )
  })

  it('treats missing rows as zero', async () => {
    vi.mocked(db.getOptional).mockResolvedValue(undefined)
    expect(await getRevenueUsdUpToTimestamp('2026-08-05', '2026-08-05T14:30:45.000Z')).toBe(0)
  })
})
