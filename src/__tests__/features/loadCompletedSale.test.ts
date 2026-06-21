import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { loadCompletedSale } from '@/features/pos/loadCompletedSale'
import { db } from '@/data/powersync/db'

describe('loadCompletedSale (WAFI-030)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('returns null when the sale id is not found', async () => {
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
    expect(await loadCompletedSale('missing')).toBeNull()
  })

  it('reconstructs a CompletedSale (header + lines + split payments) from the DB', async () => {
    vi.mocked(db.execute).mockImplementation(async (sql: string) => {
      if (sql.includes('FROM sales')) return { rows: { _array: [{
        id: 's1', display_sale_number: 'A-000007', total_usd: 50, total_syp: 725000,
        exchange_rate_at_sale: 14500, payment_method: 'split', amount_received: 50,
        amount_received_currency: 'USD', change_due: null, created_at: '2026-06-21T09:00:00Z',
        customer_id: null, is_split: 1,
      }] } } as any
      if (sql.includes('FROM sale_line_items')) return { rows: { _array: [
        { name_ar: 'سماعة', quantity: 2, unit_price_usd: 20, line_total_usd: 40 },
        { name_ar: 'كبل',   quantity: 1, unit_price_usd: 10, line_total_usd: 10 },
      ] } } as any
      if (sql.includes('FROM sale_payments')) return { rows: { _array: [
        { method: 'cash_usd', amount_raw: 30, currency: 'USD', amount_usd: 30, exchange_rate: 14500, change_due: null },
        { method: 'card',     amount_raw: 20, currency: 'USD', amount_usd: 20, exchange_rate: 14500, change_due: null },
      ] } } as any
      return { rows: { _array: [] } } as any
    })

    const sale = await loadCompletedSale('s1')
    expect(sale).not.toBeNull()
    expect(sale!.saleId).toBe('s1')
    expect(sale!.displaySaleNumber).toBe('A-000007')
    expect(sale!.totalUsd).toBe(50)
    expect(sale!.totalSyp).toBe(725000)
    expect(sale!.paymentMethod).toBe('split')
    expect(sale!.lines).toHaveLength(2)
    expect(sale!.lines[0].nameAr).toBe('سماعة')
    expect(sale!.splitPayments).toHaveLength(2)
    expect(sale!.splitPayments![1].method).toBe('card')
  })
})
