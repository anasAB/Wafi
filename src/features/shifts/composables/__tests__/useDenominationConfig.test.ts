import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useDenominationConfig } from '../useDenominationConfig'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

function sqlOf(c: any[]): string { return c[0] as string }

describe('useDenominationConfig', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useDeviceStore().shopId = 'shop-1'
  })

  it('seeds default SYP + USD denominations on first load when none exist', async () => {
    vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
      if (/COUNT\(\*\)/.test(sql)) return [{ c: 0 }] as any
      return [] as any
    })
    vi.mocked(db.writeTransaction).mockImplementation(async (fn: any) => {
      await fn({ execute: vi.fn().mockResolvedValue({ rows: { _array: [] } }) })
    })

    const { load } = useDenominationConfig()
    await load()

    expect(db.writeTransaction).toHaveBeenCalledTimes(1)
  })

  it('does not reseed when denominations already exist', async () => {
    vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
      if (/COUNT\(\*\)/.test(sql)) return [{ c: 5 }] as any
      return [
        { id: 'a', currency: 'SYP', value: 5000, sort_order: 0 },
        { id: 'b', currency: 'USD', value: 20, sort_order: 0 },
      ] as any
    })

    const { syp, usd, load } = useDenominationConfig()
    await load()

    expect(db.writeTransaction).not.toHaveBeenCalled()
    expect(syp.value.map(d => d.value)).toEqual([5000])
    expect(usd.value.map(d => d.value)).toEqual([20])
  })

  it('remove soft-deletes (never hard DELETE) so history referencing it stays intact', async () => {
    vi.mocked(db.getAll).mockResolvedValue([{ c: 1 }] as any)
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)

    const { remove } = useDenominationConfig()
    await remove('denom-1')

    const call = vi.mocked(db.execute).mock.calls.find(c => /UPDATE denomination_configs SET deleted = 1/.test(sqlOf(c)))
    expect(call).toBeDefined()
    expect(vi.mocked(db.execute).mock.calls.some(c => /DELETE FROM/.test(sqlOf(c)))).toBe(false)
  })
})
