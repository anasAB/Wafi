import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useCustomers } from '@/features/customers/composables/useCustomers'
import { db } from '@/data/powersync/db'

describe('useCustomers', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([])
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
  })

  it('load calls db.getAll filtering by shop_id and deleted', async () => {
    const { load } = useCustomers()
    await load()
    expect(db.getAll).toHaveBeenCalledWith(
      expect.stringContaining('deleted'),
      expect.any(Array)
    )
  })

  it('load maps rows to Customer objects', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([{
      id: 'c1', shop_id: 's1', name: 'أبو خالد', phone: '0991234567',
      mobile: null, address: null, deleted: 0,
      created_at: '2025-01-01T00:00:00Z', sync_status: 'synced',
    }])
    const { customers, load } = useCustomers()
    await load()
    expect(customers.value).toHaveLength(1)
    expect(customers.value[0].name).toBe('أبو خالد')
    expect(customers.value[0].deleted).toBe(false)
  })

  it('save calls INSERT INTO customers', async () => {
    const { save } = useCustomers()
    await save({ name: 'محل الأمل', phone: '0991111111' })
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO customers'),
      expect.any(Array)
    )
  })

  it('save returns the new customer id', async () => {
    const { save } = useCustomers()
    const id = await save({ name: 'محل الأمل' })
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  it('softDelete calls UPDATE SET deleted=1', async () => {
    const { softDelete } = useCustomers()
    await softDelete('c1')
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('deleted = 1'),
      expect.arrayContaining(['c1'])
    )
  })

  it('search filters by name in JS, diacritic-insensitive, with no SQL LIKE (WAFI-018)', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { id: 'c1', shop_id: 's1', name: 'أبو خالِد', phone: null, mobile: null, address: null, deleted: 0, created_at: '2025-01-01T00:00:00Z', sync_status: 'synced' },
      { id: 'c2', shop_id: 's1', name: 'سمير',       phone: null, mobile: null, address: null, deleted: 0, created_at: '2025-01-01T00:00:00Z', sync_status: 'synced' },
    ])
    const { search } = useCustomers()
    const results = await search('خالد') // query without the kasra on خالِد
    // No SQL LIKE — fetch the shop's customers, fold + filter in JS.
    expect(db.getAll).not.toHaveBeenCalledWith(
      expect.stringContaining('LIKE'),
      expect.anything()
    )
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('أبو خالِد')
  })
})
