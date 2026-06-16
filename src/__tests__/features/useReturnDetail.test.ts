import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useReturnDetail } from '@/features/returns/composables/useReturnDetail'
import { db } from '@/data/powersync/db'

describe('useReturnDetail', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([])
  })

  it('starts empty', () => {
    const { returns } = useReturnDetail()
    expect(returns.value).toHaveLength(0)
  })

  it('loads each return with its line items', async () => {
    vi.mocked(db.getAll)
      .mockResolvedValueOnce([
        { id: 'r1', created_at: '2025-06-03T10:00:00Z', refund_method: 'store_credit',
          refund_amount_usd: 75, refund_amount_syp: 0, reason: 'تغيير رأي', notes: null },
      ])
      .mockResolvedValueOnce([
        { name_ar: 'Samsung A55', qty_returned: 3, unit_price_usd: 25, restock: 1 },
      ])

    const { returns, load } = useReturnDetail()
    await load('s1')

    expect(returns.value).toHaveLength(1)
    expect(returns.value[0].refundMethod).toBe('store_credit')
    expect(returns.value[0].refundAmountUsd).toBe(75)
    expect(returns.value[0].reason).toBe('تغيير رأي')
    expect(returns.value[0].lines).toHaveLength(1)
    expect(returns.value[0].lines[0]).toMatchObject({ nameAr: 'Samsung A55', qtyReturned: 3, restock: true })
  })

  it('falls back to a placeholder name for a deleted product', async () => {
    vi.mocked(db.getAll)
      .mockResolvedValueOnce([
        { id: 'r1', created_at: '2025-06-03T10:00:00Z', refund_method: 'cash_usd',
          refund_amount_usd: 10, refund_amount_syp: 0, reason: null, notes: null },
      ])
      .mockResolvedValueOnce([
        { name_ar: null, qty_returned: 1, unit_price_usd: 10, restock: 0 },
      ])

    const { returns, load } = useReturnDetail()
    await load('s1')

    expect(returns.value[0].lines[0].nameAr).toBe('منتج محذوف')
    expect(returns.value[0].lines[0].restock).toBe(false)
  })
})
