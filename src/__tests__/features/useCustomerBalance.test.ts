import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useCustomerBalance } from '@/features/customers/composables/useCustomerBalance'
import { db } from '@/data/powersync/db'

describe('useCustomerBalance', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getOptional).mockResolvedValue(null)
    vi.mocked(db.getAll).mockResolvedValue([])
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
  })

  it('balanceUsd defaults to 0', () => {
    const { balanceUsd } = useCustomerBalance('c1')
    expect(balanceUsd.value).toBe(0)
  })

  it('load queries balance using two subqueries', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({ balance_usd: 240 } as any)
    const { balanceUsd, load } = useCustomerBalance('c1')
    await load()
    expect(balanceUsd.value).toBe(240)
    expect(db.getOptional).toHaveBeenCalledWith(
      expect.stringContaining('customer_payments'),
      expect.any(Array)
    )
  })

  it('openInvoices is empty when all invoices are paid', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({ balance_usd: 0 } as any)
    vi.mocked(db.getAll).mockResolvedValue([])
    const { openInvoices, load } = useCustomerBalance('c1')
    await load()
    expect(openInvoices.value).toHaveLength(0)
  })

  it('load maps open invoice rows correctly', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({ balance_usd: 160 } as any)
    vi.mocked(db.getAll)
      .mockResolvedValueOnce([{
        id: 's1', display_sale_number: '#231', created_at: '2025-06-02T10:00:00Z',
        total_usd: 220, remaining_usd: 160,
      }])
      .mockResolvedValueOnce([{ name_ar: 'Samsung A55' }, { name_ar: 'غطاء' }])
      .mockResolvedValueOnce([]) // payment history
    const { openInvoices, load } = useCustomerBalance('c1')
    await load()
    expect(openInvoices.value).toHaveLength(1)
    expect(openInvoices.value[0].remainingUsd).toBe(160)
    expect(openInvoices.value[0].itemsSummary).toContain('Samsung A55')
  })

  it('recordPayment inserts one customer_payment row per allocation', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ balance_usd: 0 } as any)
    vi.mocked(db.getAll).mockResolvedValue([])
    const { recordPayment } = useCustomerBalance('c1')
    await recordPayment([
      { saleId: 's1', amountUsd: 100, currency: 'USD', amountRaw: 100 },
      { saleId: 's2', amountUsd: 80,  currency: 'USD', amountRaw: 80  },
    ])
    expect(db.execute).toHaveBeenCalledTimes(2)
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO customer_payments'),
      expect.any(Array)
    )
  })

  it('recordPayment calls load after saving to refresh state', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ balance_usd: 0 } as any)
    vi.mocked(db.getAll).mockResolvedValue([])
    const { recordPayment } = useCustomerBalance('c1')
    await recordPayment([{ saleId: 's1', amountUsd: 50, currency: 'USD', amountRaw: 50 }])
    // getOptional called during the final load() after save
    expect(db.getOptional).toHaveBeenCalled()
  })
})
