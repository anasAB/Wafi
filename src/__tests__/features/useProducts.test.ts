import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/services/events/publishEvent')

import { useProducts } from '@/features/products/composables/useProducts'
import { db } from '@/data/powersync/db'
import { publishEvent } from '@/services/events/publishEvent'

const mockRow = (overrides = {}) => ({
  id: 'p1', shop_id: 's1', name_ar: 'منتج', name_en: null,
  price_usd: 10, cost_price_usd: 7, barcode: null, category: null,
  current_stock: 5, low_stock_threshold: 3, photo_url: null,
  created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
  cost_updated_at: '2024-01-01T00:00:00Z',
  is_active: 1, deleted: 0, sync_status: 'synced',
  ...overrides,
})

describe('useProducts', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(publishEvent).mockResolvedValue(undefined)
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

  it('load maps cost_updated_at to costUpdatedAt (and leaves it undefined when null)', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([
      mockRow({ id: 'p1', cost_updated_at: '2026-01-01T00:00:00Z' }),
      mockRow({ id: 'p2', cost_updated_at: null }),
    ])
    const { products, load } = useProducts()
    await load()
    expect(products.value.find(p => p.id === 'p1')?.costUpdatedAt).toBe('2026-01-01T00:00:00Z')
    expect(products.value.find(p => p.id === 'p2')?.costUpdatedAt).toBeUndefined()
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

  it('save() persists categoryId and subcategoryId on create', async () => {
    vi.mocked(db.getAll).mockResolvedValue([])
    const { save } = useProducts()
    await save({
      shopId: 's1', nameAr: 'منتج جديد', salePriceUsd: 10, costPriceUsd: 5,
      currentStock: 4, lowStockThreshold: 2, isActive: true,
      categoryId: 'c1', subcategoryId: 's1',
    } as any)

    const insertCall = vi.mocked(db.execute).mock.calls.find(([sql]) => /INSERT INTO products/.test(sql))
    expect(insertCall![1]).toEqual(expect.arrayContaining(['c1', 's1']))
  })

  it('save() clears subcategoryId when no categoryId is provided (spec: subcategory-requires-category)', async () => {
    vi.mocked(db.getAll).mockResolvedValue([])
    const { save } = useProducts()
    await save({
      shopId: 's1', nameAr: 'منتج جديد', salePriceUsd: 10, costPriceUsd: 5,
      currentStock: 4, lowStockThreshold: 2, isActive: true,
      subcategoryId: 'sub1',
    } as any)

    const insertCall = vi.mocked(db.execute).mock.calls.find(([sql]) => /INSERT INTO products/.test(sql))
    expect(insertCall![1]).not.toContain('sub1')
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

  it('adjustStock uses writeTransaction and writes both product update and adjustment record', async () => {
    vi.mocked(db.getAll).mockResolvedValue([])
    // Mock tx.execute responses: first SELECT current_stock, then UPDATE, then INSERT
    const txExecute = vi.fn()
      .mockResolvedValueOnce({ rows: { _array: [{ current_stock: 10 }] } }) // SELECT
      .mockResolvedValueOnce({}) // UPDATE
      .mockResolvedValueOnce({}) // INSERT
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => {
      await fn({ execute: txExecute })
    })

    const { adjustStock } = useProducts()
    await adjustStock('p1', 8, 'stocktake')

    expect(db.writeTransaction).toHaveBeenCalled()
    const calls = txExecute.mock.calls.map((c: any[]) => c[0] as string)
    expect(calls.some((sql: string) => sql.includes('SELECT current_stock'))).toBe(true)
    expect(calls.some((sql: string) => sql.includes('UPDATE products'))).toBe(true)
    expect(calls.some((sql: string) => sql.includes('INSERT INTO stock_adjustments'))).toBe(true)
  })

  it('adjustStock clamps a negative new value to 0', async () => {
    vi.mocked(db.getAll).mockResolvedValue([])
    const txExecute = vi.fn()
      .mockResolvedValueOnce({ rows: { _array: [{ current_stock: 3 }] } }) // SELECT
      .mockResolvedValue({})
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => { await fn({ execute: txExecute }) })

    const { adjustStock } = useProducts()
    await adjustStock('p1', -5, 'stocktake')

    const updateCall = txExecute.mock.calls.find(c => (c[0] as string).includes('UPDATE products'))
    expect(updateCall?.[1][0]).toBe(0)  // clamped newValue, not -5
    const adjCall = txExecute.mock.calls.find(c => (c[0] as string).includes('INSERT INTO stock_adjustments'))
    expect(adjCall?.[1][4]).toBe(0)     // new_value recorded as 0
  })

  it('getById returns product by id after load', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([mockRow({ id: 'p1' })])
    const { getById, load } = useProducts()
    await load()
    expect(getById('p1')?.id).toBe('p1')
    expect(getById('missing')).toBeUndefined()
  })
})

describe('useProducts.save — cost_updated_at stamping (WAFI-013)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(publishEvent).mockResolvedValue(undefined)
  })

  it('creating a product with a real cost stamps cost_updated_at', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce(null)
    const { save } = useProducts()
    await save({
      shopId: 's1', nameAr: 'حليب', salePriceUsd: 5, costPriceUsd: 3.10,
      currentStock: 20, lowStockThreshold: 5, isActive: true,
      createdAt: '', updatedAt: '',
    })
    const insertCall = vi.mocked(db.execute).mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('INSERT INTO products'),
    )
    expect(insertCall).toBeDefined()
    const sql = insertCall![0] as string
    expect(sql).toContain('cost_updated_at')
  })

  it('creating a product with no cost (0) leaves cost_updated_at out / null', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce(null)
    const { save } = useProducts()
    await save({
      shopId: 's1', nameAr: 'قلم بلا سعر', salePriceUsd: 2, costPriceUsd: 0,
      currentStock: 20, lowStockThreshold: 5, isActive: true,
      createdAt: '', updatedAt: '',
    })
    const insertCall = vi.mocked(db.execute).mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('INSERT INTO products'),
    )
    expect(insertCall).toBeDefined()
    // cost_updated_at bound param must be null when costPriceUsd is 0.
    const params = insertCall![1] as any[]
    const sql = insertCall![0] as string
    const costUpdatedAtIndex = sql
      .slice(sql.indexOf('('), sql.indexOf(')'))
      .split(',').map(s => s.trim()).indexOf('cost_updated_at')
    expect(params[costUpdatedAtIndex]).toBeNull()
  })

  it('editing only the name (cost unchanged) does NOT update cost_updated_at', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({ price_usd: 10, cost_price_usd: 7 })
    const { save } = useProducts()
    await save({
      id: 'p1', shopId: 's1', nameAr: 'اسم جديد', salePriceUsd: 10, costPriceUsd: 7,
      currentStock: 20, lowStockThreshold: 5, isActive: true,
      createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
    })
    const updateCall = vi.mocked(db.execute).mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('UPDATE products'),
    )
    expect(updateCall).toBeDefined()
    const sql = updateCall![0] as string
    expect(sql).not.toContain('cost_updated_at')
  })

  it('editing only the sale price (cost unchanged) does NOT update cost_updated_at', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({ price_usd: 10, cost_price_usd: 7 })
    const { save } = useProducts()
    await save({
      id: 'p1', shopId: 's1', nameAr: 'منتج', salePriceUsd: 15, costPriceUsd: 7,
      currentStock: 20, lowStockThreshold: 5, isActive: true,
      createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
    })
    const updateCall = vi.mocked(db.execute).mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('UPDATE products'),
    )
    expect(updateCall).toBeDefined()
    const sql = updateCall![0] as string
    expect(sql).not.toContain('cost_updated_at')
  })

  it('editing the cost value DOES update cost_updated_at', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({ price_usd: 10, cost_price_usd: 7 })
    const { save } = useProducts()
    await save({
      id: 'p1', shopId: 's1', nameAr: 'منتج', salePriceUsd: 10, costPriceUsd: 9,
      currentStock: 20, lowStockThreshold: 5, isActive: true,
      createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
    })
    const updateCall = vi.mocked(db.execute).mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('UPDATE products'),
    )
    expect(updateCall).toBeDefined()
    const sql = updateCall![0] as string
    expect(sql).toContain('cost_updated_at')
  })

  it('the missing → fresh transition: editing cost from 0 to a real value stamps cost_updated_at', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({ price_usd: 5, cost_price_usd: 0 })
    const { save } = useProducts()
    await save({
      id: 'p1', shopId: 's1', nameAr: 'حليب', salePriceUsd: 5, costPriceUsd: 3.10,
      currentStock: 20, lowStockThreshold: 5, isActive: true,
      createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
    })
    const updateCall = vi.mocked(db.execute).mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('UPDATE products'),
    )
    expect(updateCall).toBeDefined()
    expect((updateCall![0] as string)).toContain('cost_updated_at')
  })
})

describe('useProducts.save — domain events (WAFI-140 Sprint 2)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    // clearAllMocks does not drain a mockResolvedValueOnce queue left over from a
    // prior test/describe block — reset explicitly so each test's queued value is
    // the only one db.getOptional will return.
    vi.mocked(db.getOptional).mockReset()
    vi.mocked(publishEvent).mockResolvedValue(undefined)
    vi.mocked(db.getAll).mockResolvedValue([])
  })

  it('save() update: emits product.cost_updated when cost changed (wins over a simultaneous price change)', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({ price_usd: 10, cost_price_usd: 5 })
    const { save } = useProducts()
    await save({
      id: 'p1', shopId: 'shop1', nameAr: 'قلم', salePriceUsd: 12, costPriceUsd: 7,
      currentStock: 5, lowStockThreshold: 1, isActive: true,
    } as any)

    expect(publishEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'product.cost_updated' }))
    expect(publishEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'product.price_changed' }))
  })

  it('save() update: emits product.price_changed when only price changed', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({ price_usd: 10, cost_price_usd: 5 })
    const { save } = useProducts()
    await save({
      id: 'p1', shopId: 'shop1', nameAr: 'قلم', salePriceUsd: 12, costPriceUsd: 5,
      currentStock: 5, lowStockThreshold: 1, isActive: true,
    } as any)

    expect(publishEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'product.price_changed' }))
    expect(publishEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'product.cost_updated' }))
  })

  it('save() update: emits no event when neither price nor cost changed', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({ price_usd: 10, cost_price_usd: 5 })
    const { save } = useProducts()
    await save({
      id: 'p1', shopId: 'shop1', nameAr: 'قلم محدث', salePriceUsd: 10, costPriceUsd: 5,
      currentStock: 5, lowStockThreshold: 1, isActive: true,
    } as any)

    expect(publishEvent).not.toHaveBeenCalled()
  })

  it('save() insert: emits product.created', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce(null)
    const { save } = useProducts()
    await save({
      shopId: 'shop1', nameAr: 'منتج جديد', salePriceUsd: 10, costPriceUsd: 5,
      currentStock: 5, lowStockThreshold: 1, isActive: true,
    } as any)

    expect(publishEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'product.created' }))
  })
})
