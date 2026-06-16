import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useReceivings } from '@/features/suppliers/composables/useReceivings'
import { db } from '@/data/powersync/db'

describe('useReceivings', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks() })

  it('load() maps receiving header rows', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { id: 'r1', shop_id: 'shop', supplier_id: 's1', supplier_name: 'النور',
        received_at: 't', invoice_photo_url: null, total_cost_usd: 1350,
        exchange_rate_at_receiving: 12500, notes: null, staff_id: 'st1' },
    ] as any)
    const { load, receivings } = useReceivings()
    await load()
    expect(receivings.value[0]).toMatchObject({
      id: 'r1', supplierId: 's1', supplierName: 'النور', totalCostUsd: 1350,
    })
  })

  it('loadForSupplier() filters by supplier_id', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([] as any)
    const { loadForSupplier } = useReceivings()
    await loadForSupplier('s1')
    expect(db.getAll).toHaveBeenCalledWith(
      expect.stringContaining('sr.supplier_id = ?'),
      expect.arrayContaining(['s1']),
    )
  })

  it('loadDetail() returns header plus mapped lines', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({
      id: 'r1', shop_id: 'shop', supplier_id: 's1', supplier_name: 'النور',
      received_at: 't', invoice_photo_url: null, total_cost_usd: 1350,
      exchange_rate_at_receiving: 12500, notes: null, staff_id: 'st1',
    } as any)
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { product_id: 'p1', product_name: 'iPhone', qty_received: 3, unit_cost_usd: 450, cost_updated: 1 },
    ] as any)
    const { loadDetail } = useReceivings()
    const detail = await loadDetail('r1')
    expect(detail?.header.id).toBe('r1')
    expect(detail?.lines[0]).toMatchObject({
      productId: 'p1', productName: 'iPhone', qtyReceived: 3, unitCostUsd: 450, costUpdated: true,
    })
  })
})
