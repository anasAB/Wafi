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
