import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { fetchSalesRows, fetchExpensesRows, fetchProductsRows, fetchCustomersRows } from '@/features/exports/composables/useExportData'
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

describe('fetchCustomersRows', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([])
  })

  it('uses correlated subqueries (not a fan-out join) scoped to shop_id', async () => {
    await fetchCustomersRows()
    const call = vi.mocked(db.getAll).mock.calls[0]
    // Balance comes from per-customer subqueries, not a SUM over joined tables.
    expect(call[0]).toContain('SELECT SUM(total_usd)')
    expect(call[0]).not.toContain('GROUP BY')
    // Balance nets off returned goods, not just payments.
    expect(call[0]).toContain('refund_amount_usd')
    // Every table reference is shop-scoped (incl. the returns subqueries that net
    // off returned goods from the balance, in both USD and SYP).
    expect((call[1] as unknown[]).filter(v => v === '00000000-0000-0000-0000-000000000001')).toHaveLength(9)
  })

  it('maps a db row to Arabic-keyed export row', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([{
      name: 'محمد علي',
      phone: '0991234567',
      balance_usd: 150,
      balance_syp: 1875000,
      last_purchase: '2026-06-04T09:00:00Z',
    }])
    const rows = await fetchCustomersRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]['الاسم']).toBe('محمد علي')
    expect(rows[0]['الهاتف']).toBe('0991234567')
    expect(rows[0]['الرصيد المستحق $']).toBe(150)
    expect(rows[0]['الرصيد المستحق ل.س']).toBe(1875000)
  })

  it('maps null phone and last_purchase to "—"', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([{
      name: 'زبون بدون هاتف',
      phone: null,
      balance_usd: 0,
      balance_syp: 0,
      last_purchase: null,
    }])
    const rows = await fetchCustomersRows()
    expect(rows[0]['الهاتف']).toBe('—')
    expect(rows[0]['آخر شراء']).toBe('—')
  })
})

// The mocked db.getAll above can't detect column-name drift from the real schema.
// These structural guards assert the SQL references actual schema columns and never
// the wrong names that previously made every export throw "no such column" at runtime.
describe('export SQL references real schema columns', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([])
  })

  const sql = () => (vi.mocked(db.getAll).mock.calls[0][0] as string)

  it('sales export uses name_ar, li.quantity, exchange_rate_at_sale', async () => {
    await fetchSalesRows({ start: '2026-06-01', end: '2026-06-05' })
    expect(sql()).toContain('name_ar')
    expect(sql()).toContain('li.quantity')
    expect(sql()).toContain('exchange_rate_at_sale')
    expect(sql()).not.toContain('li.unit_price_syp') // column does not exist on line items
  })

  it('expenses export derives SYP from amount/currency (no amount_syp column)', async () => {
    await fetchExpensesRows({ start: '2026-06-01', end: '2026-06-05' })
    expect(sql()).toContain("CASE WHEN currency = 'SYP'")
  })

  it('products export uses name_ar, price_usd, cost_price_usd', async () => {
    await fetchProductsRows()
    expect(sql()).toContain('name_ar')
    expect(sql()).toContain('price_usd')
    expect(sql()).toContain('cost_price_usd')
  })

  it('customers export uses c.deleted (not is_deleted) and no amount_syp column', async () => {
    await fetchCustomersRows()
    expect(sql()).toContain('c.deleted')
    expect(sql()).not.toContain('is_deleted')
    expect(sql()).not.toContain('amount_syp')
  })
})
