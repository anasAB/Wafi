import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const mockGetOptional = vi.fn()
const mockExecute     = vi.fn()

vi.mock('@/data/powersync/db', () => ({
  db: {
    getOptional: (...args: unknown[]) => mockGetOptional(...args),
    execute:     (...args: unknown[]) => mockExecute(...args),
  },
}))

vi.mock('@/store/device.store', () => ({
  useDeviceStore: () => ({ shopId: 'shop-1' }),
}))

import { useDiscountCaps } from '@/features/pos/useDiscountCaps'

beforeEach(() => {
  setActivePinia(createPinia())
  mockGetOptional.mockReset()
  mockExecute.mockReset()
})

describe('useDiscountCaps', () => {
  it('loads caps from the synced shops row', async () => {
    mockGetOptional.mockResolvedValue({ cashier_discount_cap_pct: 5, manager_discount_cap_pct: 15 })
    const caps = useDiscountCaps()
    await caps.load()
    expect(caps.cashierPct.value).toBe(5)
    expect(caps.managerPct.value).toBe(15)
    expect(caps.loaded.value).toBe(true)
  })

  it('defaults to 0/15 when the shop row has no caps yet', async () => {
    mockGetOptional.mockResolvedValue(undefined)
    const caps = useDiscountCaps()
    await caps.load()
    expect(caps.cashierPct.value).toBe(0)
    expect(caps.managerPct.value).toBe(15)
  })

  it('save() writes both caps to the shops row', async () => {
    mockGetOptional.mockResolvedValue({ cashier_discount_cap_pct: 0, manager_discount_cap_pct: 15 })
    const caps = useDiscountCaps()
    await caps.load()
    await caps.save({ cashierPct: 10, managerPct: 20 })
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE shops SET cashier_discount_cap_pct'),
      [10, 20, 'shop-1'],
    )
    expect(caps.cashierPct.value).toBe(10)
    expect(caps.managerPct.value).toBe(20)
  })
})
