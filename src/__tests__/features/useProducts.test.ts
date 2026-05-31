import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useProducts } from '@/features/products/composables/useProducts'
import { db } from '@/data/powersync/db'

const mockRow = (overrides = {}) => ({
  id: 'p1', shop_id: 's1', name_ar: 'منتج', name_en: null,
  price_usd: 10, cost_price_usd: 7, barcode: null, category: null,
  current_stock: 5, low_stock_threshold: 3, photo_url: null,
  created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
  is_active: 1, deleted: 0, sync_status: 'synced',
  ...overrides,
})

describe('useProducts', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('load populates products from db', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([mockRow()])
    const { products, load } = useProducts()
    await load()
    expect(products.value).toHaveLength(1)
    expect(products.value[0].nameAr).toBe('منتج')
    expect(products.value[0].salePriceUsd).toBe(10)
    expect(products.value[0].costPriceUsd).toBe(7)
    expect(products.value[0].currentStock).toBe(5)
  })

  it('lowStockProducts returns products at or below threshold', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([
      mockRow({ id: 'p1', current_stock: 2, low_stock_threshold: 5 }),
      mockRow({ id: 'p2', current_stock: 10, low_stock_threshold: 5 }),
    ])
    const { lowStockProducts, load } = useProducts()
    await load()
    expect(lowStockProducts.value).toHaveLength(1)
    expect(lowStockProducts.value[0].id).toBe('p1')
  })

  it('save calls INSERT for a new product (no id)', async () => {
    vi.mocked(db.getAll).mockResolvedValue([])
    const { save } = useProducts()
    await save({
      shopId: 's1', nameAr: 'جديد', salePriceUsd: 10, costPriceUsd: 7,
      currentStock: 20, lowStockThreshold: 5, isActive: true,
      createdAt: '', updatedAt: '',
    })
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO products'),
      expect.any(Array)
    )
  })

  it('save calls UPDATE for an existing product (has id)', async () => {
    vi.mocked(db.getAll).mockResolvedValue([])
    const { save } = useProducts()
    await save({
      id: 'p1', shopId: 's1', nameAr: 'معدّل', salePriceUsd: 12, costPriceUsd: 8,
      currentStock: 20, lowStockThreshold: 5, isActive: true,
      createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
    })
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE products'),
      expect.any(Array)
    )
  })

  it('softDelete sets deleted = 1', async () => {
    vi.mocked(db.getAll).mockResolvedValue([])
    const { softDelete } = useProducts()
    await softDelete('p1')
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('deleted = 1'),
      expect.arrayContaining(['p1'])
    )
  })

  it('adjustStock uses writeTransaction', async () => {
    vi.mocked(db.getAll).mockResolvedValue([])
    const { adjustStock } = useProducts()
    await adjustStock('p1', 8, 'stocktake')
    expect(db.writeTransaction).toHaveBeenCalled()
  })

  it('getById returns product by id after load', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([mockRow({ id: 'p1' })])
    const { getById, load } = useProducts()
    await load()
    expect(getById('p1')?.id).toBe('p1')
    expect(getById('missing')).toBeUndefined()
  })
})
