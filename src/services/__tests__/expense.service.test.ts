import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/services/events/publishEvent', () => ({ publishEvent: vi.fn().mockResolvedValue(undefined) }))

import { db } from '@/data/powersync/db'
import { recordExpense } from '@/services/expense.service'
import type { NewExpense } from '@/features/expenses/expense.types'

describe('ExpenseService.recordExpense', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
    vi.mocked(db.getOptional).mockResolvedValue(null)
  })

  const baseInput: NewExpense = {
    amount: 50,
    currency: 'USD',
    amountUsd: 50,
    category: 'صيانة',
    expenseDate: '2026-07-30',
    paidInCash: true,
  }
  const context = { shiftId: 'shift1', deviceId: 'device1' }
  const fakeAudit = { logExpenseCreated: vi.fn().mockResolvedValue(undefined) }

  it('inserts one expense row (USD, no rate lookup) and returns the created Expense', async () => {
    const result = await recordExpense('shop1', 'staff1', baseInput, context, fakeAudit)

    expect(db.execute).toHaveBeenCalledTimes(1)
    expect(db.getOptional).not.toHaveBeenCalled()
    const [, params] = vi.mocked(db.execute).mock.calls[0]
    expect(params).toContain('shop1')
    expect(params).toContain('صيانة')
    expect(params).toContain('shift1')
    expect(params).toContain('device1')
    expect(result.category).toBe('صيانة')
    expect(result.amountUsd).toBe(50)
    expect(result.shopId).toBe('shop1')
  })

  it('does not call db.writeTransaction (matches existing behavior — no transaction today)', async () => {
    await recordExpense('shop1', 'staff1', baseInput, context, fakeAudit)
    expect(db.writeTransaction).not.toHaveBeenCalled()
  })

  it('calls the injected audit port with the created expense id/category/amount', async () => {
    const result = await recordExpense('shop1', 'staff1', baseInput, context, fakeAudit)
    expect(fakeAudit.logExpenseCreated).toHaveBeenCalledWith(result.id, 'صيانة', 50)
  })

  it('re-costs a SYP expense using the exchange rate effective on its date (WAFI-025)', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({ rate: 15000 } as any)
    const sypInput: NewExpense = {
      ...baseInput, currency: 'SYP', amount: 150000, amountUsd: 9,  // fallback, should be overridden
    }

    const result = await recordExpense('shop1', 'staff1', sypInput, context, fakeAudit)

    expect(result.amountUsd).toBe(10)  // 150000 / 15000
    const [, params] = vi.mocked(db.execute).mock.calls[0]
    expect(params).toContain(10)
  })

  it('falls back to the entered amountUsd when no exchange rate is available', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce(null)
    const sypInput: NewExpense = { ...baseInput, currency: 'SYP', amount: 150000, amountUsd: 12 }

    const result = await recordExpense('shop1', 'staff1', sypInput, context, fakeAudit)

    expect(result.amountUsd).toBe(12)
  })

  it('stamps recurring meta onto stored notes when isRecurringMonthly is set', async () => {
    const recurringInput: NewExpense = {
      ...baseInput, notes: 'إيجار المحل',
      isRecurringMonthly: true, recurringStartDate: '2026-01-01', recurringEndDate: '2026-12-31',
    }

    await recordExpense('shop1', 'staff1', recurringInput, context, fakeAudit)

    const [, params] = vi.mocked(db.execute).mock.calls[0]
    const notesParam = params.find((p: unknown) => typeof p === 'string' && p.includes('__wafi_recurring__:'))
    expect(notesParam).toBe('إيجار المحل\n__wafi_recurring__:2026-01-01|2026-12-31')
  })

  it('returns the clean (marker-free) notes on the Expense object, not the stored/stamped notes', async () => {
    const recurringInput: NewExpense = {
      ...baseInput, notes: 'إيجار المحل',
      isRecurringMonthly: true, recurringStartDate: '2026-01-01', recurringEndDate: '2026-12-31',
    }

    const result = await recordExpense('shop1', 'staff1', recurringInput, context, fakeAudit)
    expect(result.notes).toBe('إيجار المحل')
  })

  it('publishes expense.recorded with exactly the ExpenseRecordedPayload keys', async () => {
    const { publishEvent } = await import('@/services/events/publishEvent')
    await recordExpense('shop1', 'staff1', baseInput, context, fakeAudit)
    const event = vi.mocked(publishEvent).mock.calls[0][0]
    expect(event.type).toBe('expense.recorded')
    expect(Object.keys(event.payload).sort()).toEqual(
      ['expenseId', 'category', 'amountUsd', 'staffId', 'photoUrl'].sort(),
    )
    expect(event.payloadVersion).toBe(1)
  })
})
