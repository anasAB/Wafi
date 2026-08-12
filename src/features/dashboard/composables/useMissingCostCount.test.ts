import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useMissingCostCount } from './useMissingCostCount'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

vi.mock('@/data/powersync/db')
vi.mock('@/store/device.store')

describe('useMissingCostCount', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(useDeviceStore).mockReturnValue({ shopId: 'shop-1' } as any)
  })

  it('loads the count of active products with no/zero cost price', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ count: 3 } as any)
    const { missingCostCount, load } = useMissingCostCount()
    await load()
    expect(missingCostCount.value).toBe(3)
  })
})
