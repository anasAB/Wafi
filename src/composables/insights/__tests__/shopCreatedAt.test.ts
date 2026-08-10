import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getShopCreatedAt } from '../shopCreatedAt'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

vi.mock('@/data/powersync/db', () => ({
  db: { getOptional: vi.fn() },
}))

describe('getShopCreatedAt', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(db.getOptional).mockReset()
  })

  it('returns the shop\'s created_at when a row exists', async () => {
    useDeviceStore().shopId = 'shop-1'
    vi.mocked(db.getOptional).mockResolvedValue({ created_at: '2026-01-15T08:00:00.000Z' })
    const result = await getShopCreatedAt()
    expect(result).toBe('2026-01-15T08:00:00.000Z')
    expect(db.getOptional).toHaveBeenCalledWith(
      expect.stringContaining('FROM shops'),
      ['shop-1'],
    )
  })

  it('returns null when no shop row is found', async () => {
    useDeviceStore().shopId = 'shop-1'
    vi.mocked(db.getOptional).mockResolvedValue(undefined)
    expect(await getShopCreatedAt()).toBeNull()
  })
})
