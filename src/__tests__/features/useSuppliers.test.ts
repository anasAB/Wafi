import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useSuppliers } from '@/features/suppliers/composables/useSuppliers'
import { db } from '@/data/powersync/db'

describe('useSuppliers', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('load() maps rows to SupplierWithStats', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { id: 's1', shop_id: 'shop', name: 'النور', phone: '011', contact_person: null,
        address: null, notes: null, deleted: 0, created_at: 't', sync_status: 'synced',
        total_purchased_usd: 1200, last_received_at: '2026-06-10' },
    ] as any)
    const { load, suppliers } = useSuppliers()
    await load()
    expect(suppliers.value).toHaveLength(1)
    expect(suppliers.value[0]).toMatchObject({
      id: 's1', name: 'النور', phone: '011',
      totalPurchasedUsd: 1200, lastReceivedAt: '2026-06-10',
    })
  })

  it('save() inserts a supplier and returns its id', async () => {
    const { save } = useSuppliers()
    const id = await save({ name: 'مؤسسة النور', phone: '0999' })
    expect(typeof id).toBe('string')
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO suppliers'),
      expect.arrayContaining([id, 'مؤسسة النور', '0999']),
    )
  })

  it('update() builds a dynamic SET clause', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ name: 'النور' } as any)
    const { update } = useSuppliers()
    await update('s1', { phone: '0555' })
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE suppliers SET .*phone = \?/),
      expect.arrayContaining(['0555', 's1']),
    )
  })

  it('softDelete() sets deleted = 1', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ name: 'النور' } as any)
    const { softDelete } = useSuppliers()
    await softDelete('s1')
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE suppliers SET deleted = 1'),
      expect.arrayContaining(['s1']),
    )
  })
})
