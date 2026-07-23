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
