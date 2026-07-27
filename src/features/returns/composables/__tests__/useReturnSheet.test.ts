import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useReturnSheet } from '../useReturnSheet'
import { db } from '@/data/powersync/db'

describe('useReturnSheet — WAFI-100 discounted-line refund', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()

    // Sale header + customer lookup, and the exchange-rate lookup, both go through
    // db.execute (SELECT ... rows._array). getAll covers the line-items and
    // already-returned lookups.
    vi.mocked(db.execute).mockImplementation(async (sql: unknown) => {
      const s = sql as string
      if (s.includes('FROM sales s')) {
        return { rows: { _array: [{ id: 'sale-1', display_sale_number: '1', customer_id: null, customer_name: null }] } } as any
      }
      if (s.includes('FROM exchange_rates')) {
        return { rows: { _array: [{ rate: 1 }] } } as any
      }
      return { rows: { _array: [] } } as any
    })

    vi.mocked(db.getAll).mockImplementation(async (sql: unknown) => {
      const s = sql as string
      if (s.includes('FROM sale_line_items')) {
        // A $10 list-price item sold at a 20% discount: unit_price_usd is
        // already the net, post-discount price (Task 8 writes it that way).
        return [{ product_id: 'p1', product_name: 'قلم', quantity: 1, unit_price_usd: 8 }] as any
      }
      if (s.includes('FROM return_line_items')) {
        return [] as any
      }
      return [] as any
    })
  })

  it('refunds the net (post-discount) unit price, not the list price', async () => {
    const sheet = useReturnSheet('sale-1')
    await sheet.load()
    sheet.lines.value[0].selected = true

    expect(sheet.refundTotalUsd.value).toBeCloseTo(8, 2) // NOT 10 (list price)
  })
})

describe('useReturnSheet — WAFI-011 sale-level discount proration', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  function mockSale(saleDiscountAmountUsd: number, lineRows: any[]) {
    vi.mocked(db.execute).mockImplementation(async (sql: unknown) => {
      const s = sql as string
      if (s.includes('FROM sales s')) {
        return {
          rows: {
            _array: [{
              id: 'sale-1', display_sale_number: '1', customer_id: null, customer_name: null,
              sale_discount_amount_usd: saleDiscountAmountUsd,
            }],
          },
        } as any
      }
      if (s.includes('FROM exchange_rates')) return { rows: { _array: [{ rate: 1 }] } } as any
      return { rows: { _array: [] } } as any
    })
    vi.mocked(db.getAll).mockImplementation(async (sql: unknown) => {
      const s = sql as string
      if (s.includes('FROM sale_line_items')) return lineRows as any
      if (s.includes('FROM return_line_items')) return [] as any
      return [] as any
    })
  }

  it('with no sale-level discount, refunds the plain net price (regression)', async () => {
    mockSale(0, [{ product_id: 'p1', product_name: 'قلم', quantity: 1, unit_price_usd: 10 }])
    const sheet = useReturnSheet('sale-1')
    await sheet.load()
    sheet.lines.value[0].selected = true
    expect(sheet.refundTotalUsd.value).toBeCloseTo(10, 2)
  })

  it('prorates a whole-sale discount across the single returned line', async () => {
    // $10 item, $2 whole-sale discount taken at checkout -> customer actually paid $8.
    mockSale(2, [{ product_id: 'p1', product_name: 'قلم', quantity: 1, unit_price_usd: 10 }])
    const sheet = useReturnSheet('sale-1')
    await sheet.load()
    sheet.lines.value[0].selected = true
    expect(sheet.refundTotalUsd.value).toBeCloseTo(8, 2) // NOT 10
  })

  it('prorates a whole-sale discount proportionally across multiple lines', async () => {
    // $30 + $70 = $100 cart, $10 whole-sale discount -> A owes 30% ($3), B owes 70% ($7).
    mockSale(10, [
      { product_id: 'a', product_name: 'A', quantity: 1, unit_price_usd: 30 },
      { product_id: 'b', product_name: 'B', quantity: 1, unit_price_usd: 70 },
    ])
    const sheet = useReturnSheet('sale-1')
    await sheet.load()
    sheet.lines.value[0].selected = true // return only A
    expect(sheet.refundTotalUsd.value).toBeCloseTo(27, 2) // 30 - 3, NOT 30
  })

  it('prorates a whole-sale discount by returned quantity on a partial-qty return', async () => {
    // 2 units at $10 = $20 cart, $10 whole-sale discount -> $5/unit share. Return 1 of 2.
    mockSale(10, [{ product_id: 'p1', product_name: 'قلم', quantity: 2, unit_price_usd: 10 }])
    const sheet = useReturnSheet('sale-1')
    await sheet.load()
    sheet.lines.value[0].selected = true
    sheet.lines.value[0].qtyToReturn = 1
    expect(sheet.refundTotalUsd.value).toBeCloseTo(5, 2) // 10 - 5, NOT 10
  })

  it('persists the discount-adjusted refund total on confirm()', async () => {
    mockSale(2, [{ product_id: 'p1', product_name: 'قلم', quantity: 1, unit_price_usd: 10 }])
    const sheet = useReturnSheet('sale-1')
    await sheet.load()
    sheet.lines.value[0].selected = true
    sheet.refundMethod.value = 'cash_usd'

    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [] } })
    vi.mocked(db.writeTransaction).mockImplementation(async (fn: any) => { await fn({ execute: txExecute }) })

    await sheet.confirm()

    const insert = txExecute.mock.calls.find(([sql]) => (sql as string).includes('INSERT INTO returns'))
    expect(insert).toBeDefined()
    // refund_amount_usd is the 6th bound param (id, shop_id, original_sale_id, created_at, refund_method, refund_amount_usd, ...)
    expect(insert![1][5]).toBeCloseTo(8, 2)
  })
})
