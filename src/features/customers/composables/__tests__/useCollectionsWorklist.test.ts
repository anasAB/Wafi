import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useCollectionsWorklist } from '../useCollectionsWorklist'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

function sqlOf(c: any[]): string { return c[0] as string }

describe('useCollectionsWorklist', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useDeviceStore().shopId = 'shop-1'
  })

  it('excludes customers with balance 0 and separates negative-balance (store credit) customers', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { id: 'c-debtor', name: 'مدين', phone: '0999', mobile: null, last_reminded_at: null, balance_usd: 50 },
      { id: 'c-settled', name: 'مسوّى', phone: null, mobile: null, last_reminded_at: null, balance_usd: 0 },
      { id: 'c-credit', name: 'له رصيد', phone: null, mobile: null, last_reminded_at: null, balance_usd: -20 },
    ] as any)
    vi.mocked(db.getOptional).mockResolvedValue({ oldest: '2026-05-01T00:00:00.000Z' } as any)

    const { debtorRows, creditRows, load } = useCollectionsWorklist()
    await load()

    expect(debtorRows.value.map(r => r.customerId)).toEqual(['c-debtor'])
    expect(creditRows.value.map(r => r.customerId)).toEqual(['c-credit'])
  })

  it('sorts by largest balance, oldest debt, or last-reminded (never-reminded first)', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { id: 'c-a', name: 'A', phone: '1', mobile: null, last_reminded_at: '2026-06-01T00:00:00.000Z', balance_usd: 10 },
      { id: 'c-b', name: 'B', phone: '2', mobile: null, last_reminded_at: null, balance_usd: 100 },
    ] as any)
    vi.mocked(db.getOptional).mockImplementation(async (sql: string) => {
      if (/MIN\(s\.created_at\)/.test(sql)) return { oldest: '2026-05-01T00:00:00.000Z' } as any
      return { paid_at: null } as any
    })

    const { debtorRows, sort, load } = useCollectionsWorklist()
    await load()

    sort.value = 'balance_desc'
    expect(debtorRows.value.map(r => r.customerId)).toEqual(['c-b', 'c-a'])

    sort.value = 'last_reminded_asc'
    // c-b was never reminded → comes before c-a which was reminded.
    expect(debtorRows.value.map(r => r.customerId)).toEqual(['c-b', 'c-a'])
  })

  it('markReminded stamps last_reminded_at and updates the in-memory row optimistically', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { id: 'c-a', name: 'A', phone: '1', mobile: null, last_reminded_at: null, balance_usd: 10 },
    ] as any)
    vi.mocked(db.getOptional).mockResolvedValue({ oldest: '2026-05-01T00:00:00.000Z' } as any)
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)

    const { debtorRows, load, markReminded } = useCollectionsWorklist()
    await load()
    expect(debtorRows.value[0].lastRemindedAt).toBeNull()

    await markReminded('c-a')

    const updateCall = vi.mocked(db.execute).mock.calls.find(c => /UPDATE customers SET last_reminded_at/.test(sqlOf(c)))
    expect(updateCall).toBeDefined()
    expect(debtorRows.value[0].lastRemindedAt).toBeTruthy()
  })

  it('never sends an offline-tap reminder timestamp write when markReminded is not called', async () => {
    // The page only calls markReminded after a confirmed WhatsApp send; a
    // prepare-only step (which is all that happens offline) must not touch
    // last_reminded_at. This test guards the composable's contract: load()
    // alone never writes.
    vi.mocked(db.getAll).mockResolvedValue([
      { id: 'c-a', name: 'A', phone: '1', mobile: null, last_reminded_at: null, balance_usd: 10 },
    ] as any)
    vi.mocked(db.getOptional).mockResolvedValue({ oldest: '2026-05-01T00:00:00.000Z' } as any)

    const { load } = useCollectionsWorklist()
    await load()

    expect(db.execute).not.toHaveBeenCalled()
  })
})
