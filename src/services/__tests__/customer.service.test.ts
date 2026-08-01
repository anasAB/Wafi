import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/services/events/publishEvent', () => ({ publishEvent: vi.fn().mockResolvedValue(undefined) }))

import { db } from '@/data/powersync/db'
import { recordPayment } from '@/services/customer.service'

describe('CustomerService.recordPayment', () => {
  const fakeAudit = { logCustomerPaymentRecorded: vi.fn().mockResolvedValue(undefined) }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects allocations that cumulatively exceed one invoice remaining within a batch', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ remaining_usd: 100 } as any)
    await expect(recordPayment('shop1', 'c1', [
      { saleId: 's1', amountUsd: 60, currency: 'USD', amountRaw: 60, method: 'cash' },
      { saleId: 's1', amountUsd: 60, currency: 'USD', amountRaw: 60, method: 'cash' },
    ], fakeAudit)).rejects.toThrow('المبلغ المدخل يتجاوز المبلغ المتبقي للفاتورة')
  })

  it('rejects a batch exceeding customer outstanding balance when per-sale remaining is unavailable offline', async () => {
    vi.mocked(db.getOptional).mockImplementation(async (sql: string) => {
      if (sql.includes('AS balance_usd')) return { balance_usd: 50 } as any
      return null
    })
    await expect(recordPayment('shop1', 'c1', [
      { saleId: 's1', amountUsd: 100, currency: 'USD', amountRaw: 100, method: 'cash' },
    ], fakeAudit)).rejects.toThrow('المبلغ المدخل يتجاوز رصيد العميل المستحق')
  })

  it('allows a batch within the outstanding balance when per-sale remaining is unavailable offline', async () => {
    vi.mocked(db.getOptional).mockImplementation(async (sql: string) => {
      if (sql.includes('AS balance_usd')) return { balance_usd: 200 } as any
      return null
    })
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => fn({ execute: txExecute }))

    await expect(recordPayment('shop1', 'c1', [
      { saleId: 's1', amountUsd: 100, currency: 'USD', amountRaw: 100, method: 'cash' },
    ], fakeAudit)).resolves.toBeTruthy()
  })

  it('inserts one customer_payments row per allocation inside one writeTransaction', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ remaining_usd: 1000 } as any)
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => fn({ execute: txExecute }))

    await recordPayment('shop1', 'c1', [
      { saleId: 's1', amountUsd: 100, currency: 'USD', amountRaw: 100, method: 'cash' },
      { saleId: 's2', amountUsd: 80, currency: 'USD', amountRaw: 80, method: 'cash' },
    ], fakeAudit)
    expect(txExecute).toHaveBeenCalledTimes(2)
  })

  it('carries shiftId/deviceId onto each inserted row (WAFI-120 drawer attribution)', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ remaining_usd: 1000 } as any)
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => fn({ execute: txExecute }))

    await recordPayment('shop1', 'c1', [
      { saleId: 's1', amountUsd: 100, currency: 'USD', amountRaw: 100, method: 'cash' },
    ], fakeAudit, 'shift1', 'device1')

    const [, params] = txExecute.mock.calls[0]
    expect(params).toContain('shift1')
    expect(params).toContain('device1')
  })

  it('calls the injected audit port with the customer id and total paid', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ remaining_usd: 1000 } as any)
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => fn({ execute: txExecute }))

    await recordPayment('shop1', 'c1', [
      { saleId: 's1', amountUsd: 100, currency: 'USD', amountRaw: 100, method: 'cash' },
    ], fakeAudit)
    expect(fakeAudit.logCustomerPaymentRecorded).toHaveBeenCalledWith('c1', 100)
  })

  it('returns the fresh outstanding balance after the write', async () => {
    vi.mocked(db.getOptional).mockImplementation(async (sql: string) => {
      if (sql.includes('AS balance_usd')) return { balance_usd: 42 } as any
      return { remaining_usd: 1000 } as any
    })
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => fn({ execute: txExecute }))

    const result = await recordPayment('shop1', 'c1', [
      { saleId: 's1', amountUsd: 100, currency: 'USD', amountRaw: 100, method: 'cash' },
    ], fakeAudit)
    expect(result.balanceUsd).toBe(42)
  })

  it('publishes customer.installment_due_paid with exactly the InstallmentDuePaidPayload keys', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ remaining_usd: 1000 } as any)
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => fn({ execute: txExecute }))
    const { publishEvent } = await import('@/services/events/publishEvent')

    await recordPayment('shop1', 'c1', [
      { saleId: 's1', amountUsd: 100, currency: 'USD', amountRaw: 100, method: 'cash' },
    ], fakeAudit)

    const event = vi.mocked(publishEvent).mock.calls[0][0]
    expect(Object.keys(event.payload).sort()).toEqual(['customerId', 'amount', 'remainingBalance'].sort())
  })
})
