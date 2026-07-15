import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useInstallmentPlan } from '@/features/installments/composables/useInstallmentPlan'
import { useSendInstallmentReminder } from '@/features/messaging/useSendInstallmentReminder'
import { db } from '@/data/powersync/db'

describe('InstallmentPlanSection integration points', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('loadActivePlanForCustomer + prepare() together produce a reminder for the soonest pending due', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({
      plan_id: 'plan-1', shop_id: 'shop-1', customer_id: 'cust-1', sale_id: 'sale-1',
      total_amount_usd: 300, down_payment_usd: 60, term_count: 3, term_frequency: 'monthly',
      start_date: '2026-08-01', status: 'active', created_at: '2026-07-14T00:00:00.000Z', created_by: 'أحمد',
    } as any)
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { due_id: 'd1', plan_id: 'plan-1', shop_id: 'shop-1', due_date: '2026-08-01', amount_due_usd: 80, amount_paid_usd: 80, status: 'paid' },
      { due_id: 'd2', plan_id: 'plan-1', shop_id: 'shop-1', due_date: '2026-09-01', amount_due_usd: 80, amount_paid_usd: 0, status: 'pending' },
    ] as any)

    const { loadActivePlanForCustomer } = useInstallmentPlan()
    const result = await loadActivePlanForCustomer('cust-1')
    expect(result).toBeTruthy()

    const nextDue = result!.dues.find(d => d.status === 'pending')!
    const remainingUsd = result!.dues.reduce((s, d) => s + (d.amountDueUsd - d.amountPaidUsd), 0)

    const { prepare } = useSendInstallmentReminder()
    const reminder = prepare({
      customerName: 'محمد', shopName: 'المحل',
      amountDueUsd: nextDue.amountDueUsd, dueDate: nextDue.dueDate,
      remainingUsd, phoneRaw: '0944123456',
    })

    expect(reminder.text).toContain('$80.00')
    expect(reminder.text).toContain('2026-09-01')
  })

  it('recordDuePayment is called with the tapped due id and entered amount', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({
      due_id: 'd2', plan_id: 'plan-1', sale_id: 'sale-1', shop_id: 'shop-1',
      amount_due_usd: 80, amount_paid_usd: 0, customer_id: 'cust-1',
    } as any)
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => { await fn({ execute: txExecute }) })

    const { recordDuePayment } = useInstallmentPlan()
    await recordDuePayment('d2', 80)

    expect(txExecute.mock.calls.some((c: any[]) => (c[0] as string).includes('INSERT INTO customer_payments'))).toBe(true)
  })
})
