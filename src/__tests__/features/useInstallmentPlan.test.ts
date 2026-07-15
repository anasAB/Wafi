import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useInstallmentPlan } from '@/features/installments/composables/useInstallmentPlan'
import { db } from '@/data/powersync/db'
import { useSessionStore } from '@/store/session.store'
import type { Staff } from '@/features/staff/staff.types'

const mockStaff: Staff = {
  id: 'staff-1', shopId: 'shop-1', name: 'أحمد', pinHash: 'abc', pinSalt: null,
  role: 'owner',
  permissions: {
    can_view_reports: true, can_manage_products: true,
    can_manage_customers: true, can_view_expenses: true, can_manage_settings: true,
  },
  isActive: true, createdAt: '2026-01-01T00:00:00Z',
}

describe('useInstallmentPlan.createPlan', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    const session = useSessionStore()
    session.setActiveStaff(mockStaff)
  })

  it('inserts one installment_plans row, one installment_dues row per term, and the down payment as a customer_payments row', async () => {
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => { await fn({ execute: txExecute }) })

    const { createPlan } = useInstallmentPlan()
    const plan = await createPlan({
      customerId: 'cust-1',
      saleId: 'sale-1',
      totalAmountUsd: 300,
      downPaymentUsd: 60,
      termCount: 3,
      termFrequency: 'monthly',
      startDate: '2026-08-01',
    })

    expect(plan.customerId).toBe('cust-1')
    expect(plan.status).toBe('active')

    const calls = txExecute.mock.calls.map((c: any[]) => c[0] as string)
    expect(calls.filter(sql => sql.includes('INSERT INTO installment_plans'))).toHaveLength(1)
    expect(calls.filter(sql => sql.includes('INSERT INTO installment_dues'))).toHaveLength(3)
    expect(calls.filter(sql => sql.includes('INSERT INTO customer_payments'))).toHaveLength(1)
  })

  it('skips the customer_payments insert when down payment is 0', async () => {
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => { await fn({ execute: txExecute }) })

    const { createPlan } = useInstallmentPlan()
    await createPlan({
      customerId: 'cust-1', saleId: 'sale-1', totalAmountUsd: 300, downPaymentUsd: 0,
      termCount: 3, termFrequency: 'monthly', startDate: '2026-08-01',
    })

    const calls = txExecute.mock.calls.map((c: any[]) => c[0] as string)
    expect(calls.filter(sql => sql.includes('INSERT INTO customer_payments'))).toHaveLength(0)
  })

  it('writes an audit log row after the transaction commits', async () => {
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => { await fn({ execute: txExecute }) })
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)

    const { createPlan } = useInstallmentPlan()
    await createPlan({
      customerId: 'cust-1', saleId: 'sale-1', totalAmountUsd: 300, downPaymentUsd: 60,
      termCount: 3, termFrequency: 'monthly', startDate: '2026-08-01',
    })

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.arrayContaining(['installment_plan.created', 'installment_plan']),
    )
  })
})

describe('useInstallmentPlan.recordDuePayment', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    const session = useSessionStore()
    session.setActiveStaff(mockStaff)
  })

  it('inserts a customer_payments row tagged with due_id and updates amount_paid_usd/status to paid when fully covered', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({
      due_id: 'due-1', plan_id: 'plan-1', sale_id: 'sale-1', shop_id: 'shop-1',
      amount_due_usd: 100, amount_paid_usd: 0, customer_id: 'cust-1',
    } as any)

    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [{ count: 0 }] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => { await fn({ execute: txExecute }) })

    const { recordDuePayment } = useInstallmentPlan()
    await recordDuePayment('due-1', 100)

    const calls = txExecute.mock.calls.map((c: any[]) => ({ sql: c[0] as string, params: c[1] }))
    const paymentInsert = calls.find(c => c.sql.includes('INSERT INTO customer_payments'))
    expect(paymentInsert).toBeTruthy()
    expect(paymentInsert!.params).toEqual(expect.arrayContaining(['due-1']))

    const dueUpdate = calls.find(c => c.sql.includes('UPDATE installment_dues'))
    expect(dueUpdate!.sql).toContain(`status = 'paid'`)

    // "are there any other unpaid/unvoided dues left on this plan?" check —
    // performed atomically inside the same transaction via tx.execute, not a
    // second db.getOptional call.
    const remainingCheck = calls.find(c => c.sql.includes('SELECT COUNT(*)') && c.sql.includes('installment_dues'))
    expect(remainingCheck).toBeTruthy()

    const planUpdate = calls.find(c => c.sql.includes('UPDATE installment_plans'))
    expect(planUpdate).toBeTruthy() // no other unpaid dues -> plan completes
  })

  it('leaves the due pending on a partial payment and does not touch the plan status', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({
      due_id: 'due-1', plan_id: 'plan-1', sale_id: 'sale-1', shop_id: 'shop-1',
      amount_due_usd: 100, amount_paid_usd: 0, customer_id: 'cust-1',
    } as any)

    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => { await fn({ execute: txExecute }) })

    const { recordDuePayment } = useInstallmentPlan()
    await recordDuePayment('due-1', 40)

    const calls = txExecute.mock.calls.map((c: any[]) => c[0] as string)
    const dueUpdate = calls.find(sql => sql.includes('UPDATE installment_dues'))!
    expect(dueUpdate).toContain(`status = 'pending'`)
    expect(calls.some(sql => sql.includes('UPDATE installment_plans'))).toBe(false)
  })

  it('rejects a payment exceeding the remaining amount on the due', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({
      due_id: 'due-1', plan_id: 'plan-1', sale_id: 'sale-1', shop_id: 'shop-1',
      amount_due_usd: 100, amount_paid_usd: 80, customer_id: 'cust-1',
    } as any)

    const { recordDuePayment } = useInstallmentPlan()
    await expect(recordDuePayment('due-1', 30)).rejects.toThrow('يتجاوز')
  })

  it('rejects when the due is not found', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce(null)
    const { recordDuePayment } = useInstallmentPlan()
    await expect(recordDuePayment('missing', 10)).rejects.toThrow()
  })
})
