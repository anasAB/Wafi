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

  it('balance query subtracts returns on credit sales', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({ balance_usd: -25 } as any)
    const { load } = useCustomerBalance('c1')
    await load()
    // Outstanding must net off returned goods, not just payments.
    expect(db.getOptional).toHaveBeenCalledWith(
      expect.stringContaining('refund_amount_usd'),
      expect.any(Array)
    )
  })

  it('open invoice remaining subtracts returns for the sale', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({ balance_usd: 0 } as any)
    const { load } = useCustomerBalance('c1')
    await load()
    // The open-invoices query must reduce each invoice's remaining by its returns.
    expect(db.getAll).toHaveBeenCalledWith(
      expect.stringContaining('refund_amount_usd'),
      expect.any(Array)
    )
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

  it('recordPayment inserts one customer_payment row per allocation in a transaction', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ balance_usd: 0 } as any)
    vi.mocked(db.getAll).mockResolvedValue([])
    // recordPayment now wraps inserts in db.writeTransaction — capture the tx.execute spy.
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => { await fn({ execute: txExecute }) })

    const { recordPayment } = useCustomerBalance('c1')
    await recordPayment([
      { saleId: 's1', amountUsd: 100, currency: 'USD', amountRaw: 100, method: 'cash' },
      { saleId: 's2', amountUsd: 80,  currency: 'USD', amountRaw: 80,  method: 'cash' },
    ])
    expect(txExecute).toHaveBeenCalledTimes(2)
    expect(txExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO customer_payments'),
      expect.any(Array)
    )
  })

  it('recordPayment persists the payment method', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ balance_usd: 0 } as any)
    vi.mocked(db.getAll).mockResolvedValue([])
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => { await fn({ execute: txExecute }) })

    const { recordPayment } = useCustomerBalance('c1')
    await recordPayment([
      { saleId: 's1', amountUsd: 100, currency: 'USD', amountRaw: 100, method: 'transfer' },
    ])
    const [sql, params] = txExecute.mock.calls[0]
    expect(sql).toContain('method')
    expect(params).toContain('transfer')
  })

  it('recordPayment rejects allocations that exceed an invoice remaining (cumulative within a batch)', async () => {
    // Same invoice twice; each is 60, remaining is 100 → together 120 > 100 must throw.
    vi.mocked(db.getOptional).mockResolvedValue({ remaining_usd: 100 } as any)
    const { recordPayment } = useCustomerBalance('c1')
    await expect(recordPayment([
      { saleId: 's1', amountUsd: 60, currency: 'USD', amountRaw: 60, method: 'cash' },
      { saleId: 's1', amountUsd: 60, currency: 'USD', amountRaw: 60, method: 'cash' },
    ])).rejects.toThrow()
  })

  it('rejects a batch that exceeds the customer outstanding balance (offline-safe)', async () => {
    // Even when the per-sale remaining row has not synced locally (null), the
    // batch must be bounded by the customer's total outstanding balance.
    vi.mocked(db.getOptional).mockImplementation(async (sql: string) => {
      if (sql.includes('AS balance_usd')) return { balance_usd: 50 } as any
      return null  // per-sale remaining unavailable (offline)
    })
    const { recordPayment } = useCustomerBalance('c1')
    await expect(recordPayment([
      { saleId: 's1', amountUsd: 100, currency: 'USD', amountRaw: 100, method: 'cash' },
    ])).rejects.toThrow()
  })

  it('recordPayment calls load after saving to refresh state', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ balance_usd: 0 } as any)
    vi.mocked(db.getAll).mockResolvedValue([])
    const { recordPayment } = useCustomerBalance('c1')
    await recordPayment([{ saleId: 's1', amountUsd: 50, currency: 'USD', amountRaw: 50, method: 'cash' }])
    // getOptional called during the final load() after save
    expect(db.getOptional).toHaveBeenCalled()
  })
})
