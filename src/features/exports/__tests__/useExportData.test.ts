import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { fetchSalesRows } from '../composables/useExportData'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

const range = { start: '2026-06-01', end: '2026-06-23' }

function sqlOf(call: any[]): string { return call[0] as string }

describe('fetchSalesRows — deleted/missing products', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useDeviceStore().shopId = 'shop-1'
    vi.mocked(db.getAll).mockResolvedValue([])
  })

  it('LEFT-joins products so a sale line is not dropped when its product row is missing', async () => {
    await fetchSalesRows(range)
    const sql = sqlOf(vi.mocked(db.getAll).mock.calls[0])
    expect(sql).toMatch(/LEFT JOIN products\b/)
  })

  it('labels a missing product name as "منتج محذوف" instead of blank/undefined', async () => {
    vi.mocked(db.getAll).mockResolvedValue([{
      display_sale_number: 'A-1',
      created_at: '2026-06-10T08:30:00.000Z',
      total_usd: 10,
      payment_method: 'cash_usd',
      cashier_name: null,
      product_name: null,
      qty: 2,
      unit_price_usd: 5,
      unit_price_syp: 50000,
    }] as any)
    const rows = await fetchSalesRows(range)
    expect(rows[0]['المنتج']).toBe('منتج محذوف')
  })

  it('passes through a real product name unchanged', async () => {
    vi.mocked(db.getAll).mockResolvedValue([{
      display_sale_number: 'A-1',
      created_at: '2026-06-10T08:30:00.000Z',
      total_usd: 10,
      payment_method: 'cash_usd',
      cashier_name: 'أحمد',
      product_name: 'شاحن',
      qty: 1,
      unit_price_usd: 10,
      unit_price_syp: 100000,
    }] as any)
    const rows = await fetchSalesRows(range)
    expect(rows[0]['المنتج']).toBe('شاحن')
  })
})
