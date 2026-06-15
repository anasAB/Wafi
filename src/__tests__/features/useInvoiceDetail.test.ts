import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useInvoiceDetail } from '@/features/customers/composables/useInvoiceDetail'
import { db } from '@/data/powersync/db'

describe('useInvoiceDetail', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([])
  })

  it('starts empty', () => {
    const { lines, payments } = useInvoiceDetail()
    expect(lines.value).toHaveLength(0)
    expect(payments.value).toHaveLength(0)
  })

  it('maps line items and payments for a sale', async () => {
    vi.mocked(db.getAll)
      .mockResolvedValueOnce([
        { name_ar: 'Samsung A55', quantity: 2, unit_price_usd: 100, line_total_usd: 200 },
        { name_ar: 'غطاء',        quantity: 1, unit_price_usd: 20,  line_total_usd: 20  },
      ])
      .mockResolvedValueOnce([
        { id: 'pay1', customer_id: 'c1', sale_id: 's1', amount_usd: 60, currency: 'USD', paid_at: '2025-06-03', created_at: '2025-06-03T09:00:00Z' },
      ])

    const { lines, payments, load } = useInvoiceDetail()
    await load('s1')

    expect(lines.value).toHaveLength(2)
    expect(lines.value[0]).toMatchObject({ nameAr: 'Samsung A55', quantity: 2, lineTotalUsd: 200 })
    expect(payments.value).toHaveLength(1)
    expect(payments.value[0].amountUsd).toBe(60)
  })

  it('falls back to a placeholder name when the product was deleted', async () => {
    vi.mocked(db.getAll)
      .mockResolvedValueOnce([
        { name_ar: null, quantity: 1, unit_price_usd: 50, line_total_usd: 50 },
      ])
      .mockResolvedValueOnce([])

    const { lines, load } = useInvoiceDetail()
    await load('s1')

    expect(lines.value[0].nameAr).toBe('منتج محذوف')
  })

  it('queries line items by sale id', async () => {
    const { load } = useInvoiceDetail()
    await load('s9')
    expect(db.getAll).toHaveBeenCalledWith(
      expect.stringContaining('sale_line_items'),
      ['s9']
    )
  })
})
