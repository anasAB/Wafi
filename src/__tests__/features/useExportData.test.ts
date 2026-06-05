import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { fetchSalesRows } from '@/features/exports/composables/useExportData'
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
