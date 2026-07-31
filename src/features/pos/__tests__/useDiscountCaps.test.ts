import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const mockExecute = vi.fn().mockResolvedValue(undefined)
const mockGetOptional = vi.fn().mockResolvedValue(null)
vi.mock('@/data/powersync/db', () => ({
  db: { execute: (...args: unknown[]) => mockExecute(...args), getOptional: (...args: unknown[]) => mockGetOptional(...args) },
}))

const mockListDeadLetter = vi.fn().mockResolvedValue([])
vi.mock('@/data/powersync/dead-letter', () => ({
  listDeadLetter: (...args: unknown[]) => mockListDeadLetter(...args),
}))

vi.mock('@/store/device.store', () => ({
  useDeviceStore: () => ({ shopId: 'shop-1' }),
}))

import { useDiscountCaps } from '../useDiscountCaps'

beforeEach(() => {
  setActivePinia(createPinia())
  mockExecute.mockClear()
  mockGetOptional.mockClear()
  mockListDeadLetter.mockClear()
})

describe('useDiscountCaps.save', () => {
  it('writes valid values and updates local refs', async () => {
    const caps = useDiscountCaps()
    await caps.save({ cashierPct: 10, managerPct: 25 })
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE shops'),
      [10, 25, 'shop-1'],
    )
    expect(caps.cashierPct.value).toBe(10)
    expect(caps.managerPct.value).toBe(25)
  })

  it('throws and does not write when cashierPct is negative', async () => {
    const caps = useDiscountCaps()
    await expect(caps.save({ cashierPct: -10, managerPct: 25 })).rejects.toThrow()
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('throws and does not write when managerPct exceeds 100', async () => {
    const caps = useDiscountCaps()
    await expect(caps.save({ cashierPct: 10, managerPct: 150 })).rejects.toThrow()
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('throws and does not write when cashierPct exceeds managerPct', async () => {
    const caps = useDiscountCaps()
    await expect(caps.save({ cashierPct: 90, managerPct: 10 })).rejects.toThrow()
    expect(mockExecute).not.toHaveBeenCalled()
  })
})

describe('useDiscountCaps.checkSaveFailed', () => {
  it('returns null when no matching dead-letter entry exists', async () => {
    mockListDeadLetter.mockResolvedValue([])
    const caps = useDiscountCaps()
    const result = await caps.checkSaveFailed('2026-07-31T00:00:00.000Z')
    expect(result).toBeNull()
  })

  it('returns the error message when a matching shops dead-letter entry exists', async () => {
    mockListDeadLetter.mockResolvedValue([
      { table_name: 'shops', row_id: 'shop-1', error_message: 'check constraint violated', failed_at: '2026-07-31T00:00:05.000Z' },
    ])
    const caps = useDiscountCaps()
    const result = await caps.checkSaveFailed('2026-07-31T00:00:00.000Z')
    expect(result).toBe('check constraint violated')
  })

  it('ignores dead-letter entries for a different table or an earlier failure time', async () => {
    mockListDeadLetter.mockResolvedValue([
      { table_name: 'sales', row_id: 'shop-1', error_message: 'unrelated', failed_at: '2026-07-31T00:00:05.000Z' },
      { table_name: 'shops', row_id: 'shop-1', error_message: 'stale', failed_at: '2026-07-30T23:59:00.000Z' },
    ])
    const caps = useDiscountCaps()
    const result = await caps.checkSaveFailed('2026-07-31T00:00:00.000Z')
    expect(result).toBeNull()
  })
})
