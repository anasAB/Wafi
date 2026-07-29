import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useInstallmentPlan, cancelPlanWithinTx } from '@/features/installments/composables/useInstallmentPlan'
import { db } from '@/data/powersync/db'
import { useSessionStore } from '@/store/session.store'
import type { Staff } from '@/features/staff/staff.types'

const mockStaff: Staff = {
  id: 'staff-1', shopId: 'shop-1', name: 'أحمد', pinHash: 'abc', pinSalt: null,
  role: 'owner',
  permissions: {
    can_view_reports: true, can_manage_products: true,
    can_manage_customers: true, can_view_expenses: true, can_manage_settings: true,
    can_manage_inventory: true, can_manage_suppliers: true, can_manage_stock_take: true,
    can_view_staff_ledger: true, can_view_staff_performance: true,
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
      id: 'due-1', plan_id: 'plan-1', sale_id: 'sale-1', shop_id: 'shop-1',
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
      id: 'due-1', plan_id: 'plan-1', sale_id: 'sale-1', shop_id: 'shop-1',
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
      id: 'due-1', plan_id: 'plan-1', sale_id: 'sale-1', shop_id: 'shop-1',
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

describe('useInstallmentPlan.cancelPlan', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  function mockTxExecute() {
    return vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('UPDATE installment_plans') && sql.includes('RETURNING id')) {
        return { rows: { _array: [{ id: 'plan-1' }] } }
      }
      return { rows: { _array: [] } }
    })
  }

  it('voids every still-pending due and cancels the plan', async () => {
    const txExecute = mockTxExecute()
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => { await fn({ execute: txExecute }) })

    const { cancelPlan } = useInstallmentPlan()
    await cancelPlan('plan-1')

    const calls = txExecute.mock.calls.map((c: any[]) => c[0] as string)
    expect(calls.some(sql => sql.includes('UPDATE installment_dues') && sql.includes(`'voided'`))).toBe(true)
    expect(calls.some(sql => sql.includes('UPDATE installment_plans') && sql.includes(`'cancelled'`))).toBe(true)
  })

  it('writes an installment_plan.cancelled audit row with reason "manual" by default', async () => {
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => { await fn({ execute: mockTxExecute() }) })
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)

    const { cancelPlan } = useInstallmentPlan()
    await cancelPlan('plan-1')

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.arrayContaining(['installment_plan.cancelled', 'installment_plan', 'plan-1', JSON.stringify({ reason: 'manual' })]),
    )
  })

  it('does not cancel dues or audit-log when the plan is not active (e.g. already cancelled/defaulted)', async () => {
    // The plan UPDATE's WHERE clause matches zero rows -> RETURNING yields no rows.
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => { await fn({ execute: txExecute }) })
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)

    const { cancelPlan } = useInstallmentPlan()
    await cancelPlan('plan-1')

    expect(db.execute).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.anything(),
    )
  })

  it('refuses to cancel a defaulted plan: attempts the guarded UPDATE but never flips it or audit-logs', async () => {
    // Simulate a plan whose status is 'defaulted': the WHERE status = 'active'
    // clause excludes it, so RETURNING yields zero rows.
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [] } })

    // Exercise cancelPlanWithinTx directly to assert on the guard SQL itself.
    const cancelled = await cancelPlanWithinTx({ execute: txExecute }, 'plan-defaulted')
    expect(cancelled).toBe(false)

    const planUpdateCall = txExecute.mock.calls.find(
      (c: any[]) => (c[0] as string).includes('UPDATE installment_plans'),
    )
    expect(planUpdateCall).toBeDefined()
    expect(planUpdateCall![0] as string).toContain(`status = 'active'`)
    expect(planUpdateCall![0] as string).not.toContain('defaulted')

    // And through cancelPlan, confirm the defaulted plan is never audit-logged.
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => { await fn({ execute: vi.fn().mockResolvedValue({ rows: { _array: [] } }) }) })
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)

    const { cancelPlan } = useInstallmentPlan()
    await cancelPlan('plan-defaulted')

    expect(db.execute).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.anything(),
    )
  })
})

describe('useInstallmentPlan.loadActivePlanForCustomer / loadPlan', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('returns null when the customer has no active plan', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce(null)
    const { loadActivePlanForCustomer } = useInstallmentPlan()
    const result = await loadActivePlanForCustomer('cust-1')
    expect(result).toBeNull()
  })

  it('returns the active plan and its dues ordered by due_date', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({
      id: 'plan-1', shop_id: 'shop-1', customer_id: 'cust-1', sale_id: 'sale-1',
      total_amount_usd: 300, down_payment_usd: 60, term_count: 3, term_frequency: 'monthly',
      start_date: '2026-08-01', status: 'active', created_at: '2026-07-14T00:00:00.000Z', created_by: 'أحمد',
    } as any)
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { id: 'd1', plan_id: 'plan-1', shop_id: 'shop-1', due_date: '2026-08-01', amount_due_usd: 100, amount_paid_usd: 100, status: 'paid' },
      { id: 'd2', plan_id: 'plan-1', shop_id: 'shop-1', due_date: '2026-09-01', amount_due_usd: 100, amount_paid_usd: 0, status: 'pending' },
    ] as any)

    const { loadActivePlanForCustomer } = useInstallmentPlan()
    const result = await loadActivePlanForCustomer('cust-1')

    expect(result?.plan.planId).toBe('plan-1')
    expect(result?.plan.termFrequency).toBe('monthly')
    expect(result?.dues).toHaveLength(2)
    expect(result?.dues[0].dueId).toBe('d1')
  })

  it('loadPlan returns null for an unknown plan id', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce(null)
    const { loadPlan } = useInstallmentPlan()
    expect(await loadPlan('missing')).toBeNull()
  })
})
