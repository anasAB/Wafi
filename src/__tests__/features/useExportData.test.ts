import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { fetchSalesRows, fetchExpensesRows, fetchProductsRows } from '@/features/exports/composables/useExportData'
import { db } from '@/data/powersync/db'

describe('fetchSalesRows', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([])
  })

  it('calls db.getAll with shop_id and date range params', async () => {
    await fetchSalesRows({ start: '2026-06-01', end: '2026-06-05' })
    expect(db.getAll).toHaveBeenCalledWith(
      expect.stringContaining('FROM sales'),
      expect.arrayContaining(['2026-06-01', '2026-06-05']),
    )
  })

  it('returns an empty array when db returns no rows', async () => {
    const result = await fetchSalesRows({ start: '2026-06-01', end: '2026-06-05' })
    expect(result).toEqual([])
  })

  it('maps a db row to Arabic-keyed export row', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([{
      display_sale_number: 'SALE-0001',
      created_at: '2026-06-05T10:30:00Z',
      total_usd: 450,
      payment_method: 'cash_usd',
      cashier_name: 'أحمد',
      product_name: 'iPhone',
      qty: 1,
      unit_price_usd: 450,
      unit_price_syp: 5625000,
    }])
    const rows = await fetchSalesRows({ start: '2026-06-05', end: '2026-06-05' })
    expect(rows).toHaveLength(1)
    expect(rows[0]['رقم البيع']).toBe('SALE-0001')
    expect(rows[0]['المنتج']).toBe('iPhone')
    expect(rows[0]['الكمية']).toBe(1)
    expect(rows[0]['طريقة الدفع']).toBe('نقد دولار')
    expect(rows[0]['الكاشير']).toBe('أحمد')
    expect(rows[0]['إجمالي السطر $']).toBe(450)
  })

  it('maps null cashier_name to "—"', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([{
      display_sale_number: 'SALE-0002',
      created_at: '2026-06-05T10:30:00Z',
      total_usd: 100,
      payment_method: 'credit',
      cashier_name: null,
      product_name: 'كتاب',
      qty: 2,
      unit_price_usd: 50,
      unit_price_syp: 625000,
    }])
    const rows = await fetchSalesRows({ start: '2026-06-05', end: '2026-06-05' })
    expect(rows[0]['الكاشير']).toBe('—')
    expect(rows[0]['طريقة الدفع']).toBe('آجل')
  })
})

describe('fetchExpensesRows', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([])
  })

  it('calls db.getAll with date range and shop_id', async () => {
    await fetchExpensesRows({ start: '2026-06-01', end: '2026-06-05' })
    expect(db.getAll).toHaveBeenCalledWith(
      expect.stringContaining('FROM expenses'),
      expect.arrayContaining(['2026-06-01', '2026-06-05']),
    )
  })

  it('maps a db row to Arabic-keyed export row', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([{
      expense_date: '2026-06-05',
      category: 'إيجار',
      description: 'إيجار شهر يونيو',
      amount_usd: 200,
      amount_syp: 2500000,
    }])
    const rows = await fetchExpensesRows({ start: '2026-06-01', end: '2026-06-05' })
    expect(rows).toHaveLength(1)
    expect(rows[0]['التاريخ']).toBe('2026-06-05')
    expect(rows[0]['الفئة']).toBe('إيجار')
    expect(rows[0]['المبلغ $']).toBe(200)
    expect(rows[0]['المبلغ ل.س']).toBe(2500000)
  })
})

describe('fetchProductsRows', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([])
  })

  it('calls db.getAll filtering only active products', async () => {
    await fetchProductsRows()
    expect(db.getAll).toHaveBeenCalledWith(
      expect.stringContaining('is_active'),
      expect.any(Array),
    )
  })

  it('maps a db row to Arabic-keyed export row with computed stock value', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([{
      name: 'iPhone 15',
      barcode: '1234567890',
      sale_price_usd: 500,
      sale_price_syp: 6250000,
      cost_usd: 380,
      current_stock: 10,
    }])
    const rows = await fetchProductsRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]['الاسم']).toBe('iPhone 15')
    expect(rows[0]['الباركود']).toBe('1234567890')
    expect(rows[0]['سعر البيع $']).toBe(500)
    expect(rows[0]['المخزون الحالي']).toBe(10)
    expect(rows[0]['قيمة المخزون $']).toBe(3800)
  })

  it('maps null barcode and cost to "—"', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([{
      name: 'منتج بدون باركود',
      barcode: null,
      sale_price_usd: 20,
      sale_price_syp: 250000,
      cost_usd: null,
      current_stock: 5,
    }])
    const rows = await fetchProductsRows()
    expect(rows[0]['الباركود']).toBe('—')
    expect(rows[0]['التكلفة $']).toBe('—')
    expect(rows[0]['قيمة المخزون $']).toBe('—')
  })
})
