import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { useSessionStore } from '@/store/session.store'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'
import { generateInstallmentSchedule } from '@/features/installments/installmentSchedule'
import type { InstallmentPlan, InstallmentDue, NewInstallmentPlanInput } from '@/features/installments/installment.types'

export function useInstallmentPlan() {
  const device  = useDeviceStore()
  const session = useSessionStore()
  const { logInstallmentPlanCreated, logInstallmentPaymentRecorded, logInstallmentPlanCancelled } = useAuditLog()

  async function createPlan(input: NewInstallmentPlanInput): Promise<InstallmentPlan> {
    const planId = uuidv4()
    const now = new Date().toISOString()
    const today = now.slice(0, 10)
    const createdBy = session.activeStaff?.name ?? 'system'

    const schedule = generateInstallmentSchedule(
      input.totalAmountUsd, input.downPaymentUsd, input.termCount, input.termFrequency, input.startDate,
    )

    await db.writeTransaction(async (tx) => {
      await tx.execute(
        `INSERT INTO installment_plans
           (plan_id, shop_id, customer_id, sale_id, total_amount_usd, down_payment_usd,
            term_count, term_frequency, start_date, status, created_at, created_by, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, 'pending')`,
        [
          planId, device.shopId, input.customerId, input.saleId,
          input.totalAmountUsd, input.downPaymentUsd, input.termCount,
          input.termFrequency, input.startDate, now, createdBy,
        ],
      )

      for (const due of schedule) {
        await tx.execute(
          `INSERT INTO installment_dues
             (due_id, plan_id, shop_id, due_date, amount_due_usd, amount_paid_usd, status, sync_status)
           VALUES (?, ?, ?, ?, ?, 0, 'pending', 'pending')`,
          [uuidv4(), planId, device.shopId, due.dueDate, due.amountDueUsd],
        )
      }

      // Down payment posts as an immediate payment against the customer's ledger
      // balance, reusing the existing customer_payments table (Epic 4) so the
      // balance/statement/Z-report queries pick it up with no changes. due_id is
      // left null — the down payment isn't collected against any single
      // scheduled due, it's the plan's own initiation payment.
      if (input.downPaymentUsd > 0) {
        await tx.execute(
          `INSERT INTO customer_payments
             (id, shop_id, customer_id, sale_id, due_id, amount_usd, currency, amount_raw,
              method, exchange_rate_at_payment, notes, paid_at, created_at, sync_status)
           VALUES (?, ?, ?, ?, NULL, ?, 'USD', ?, 'cash', NULL, NULL, ?, ?, 'pending')`,
          [
            uuidv4(), device.shopId, input.customerId, input.saleId,
            input.downPaymentUsd, input.downPaymentUsd, today, now,
          ],
        )
      }
    })

    await logInstallmentPlanCreated(planId, input.customerId, input.totalAmountUsd, input.downPaymentUsd, input.termCount)

    return {
      planId, shopId: device.shopId, customerId: input.customerId, saleId: input.saleId,
      totalAmountUsd: input.totalAmountUsd, downPaymentUsd: input.downPaymentUsd,
      termCount: input.termCount, termFrequency: input.termFrequency, startDate: input.startDate,
      status: 'active', createdAt: now, createdBy,
    }
  }

  async function recordDuePayment(dueId: string, amountUsd: number): Promise<void> {
    const due = await db.getOptional<{
      due_id: string; plan_id: string; sale_id: string; shop_id: string;
      amount_due_usd: number; amount_paid_usd: number; customer_id: string;
    }>(
      `SELECT d.due_id, d.plan_id, p.sale_id, d.shop_id, d.amount_due_usd, d.amount_paid_usd, p.customer_id
       FROM installment_dues d
       JOIN installment_plans p ON p.plan_id = d.plan_id
       WHERE d.due_id = ?`,
      [dueId],
    )
    if (!due) throw new Error('لم يتم العثور على القسط')

    const newPaid = due.amount_paid_usd + amountUsd
    if (newPaid - due.amount_due_usd > 0.01) {
      throw new Error('المبلغ المدخل يتجاوز المبلغ المتبقي لهذا القسط')
    }

    const now = new Date().toISOString()
    const today = now.slice(0, 10)
    const newStatus: 'pending' | 'paid' = newPaid >= due.amount_due_usd - 0.01 ? 'paid' : 'pending'

    await db.writeTransaction(async (tx) => {
      await tx.execute(
        `INSERT INTO customer_payments
           (id, shop_id, customer_id, sale_id, due_id, amount_usd, currency, amount_raw,
            method, exchange_rate_at_payment, notes, paid_at, created_at, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, 'USD', ?, 'cash', NULL, NULL, ?, ?, 'pending')`,
        [uuidv4(), due.shop_id, due.customer_id, due.sale_id, dueId, amountUsd, amountUsd, today, now],
      )

      await tx.execute(
        `UPDATE installment_dues SET amount_paid_usd = ?, status = '${newStatus}' WHERE due_id = ?`,
        [newPaid, dueId],
      )

      if (newStatus === 'paid') {
        const remaining = await tx.execute(
          `SELECT COUNT(*) as count FROM installment_dues
           WHERE plan_id = ? AND due_id != ? AND status = 'pending'`,
          [due.plan_id, dueId],
        )
        const remainingCount = (remaining as any).rows?._array?.[0]?.count ?? 0
        if (remainingCount === 0) {
          await tx.execute(
            `UPDATE installment_plans SET status = 'completed' WHERE plan_id = ?`,
            [due.plan_id],
          )
        }
      }
    })

    await logInstallmentPaymentRecorded(dueId, due.plan_id, amountUsd)
  }

  async function cancelPlan(_planId: string): Promise<void> {
    throw new Error('not implemented — see Task 7')
  }

  async function loadActivePlanForCustomer(
    _customerId: string,
  ): Promise<{ plan: InstallmentPlan; dues: InstallmentDue[] } | null> {
    throw new Error('not implemented — see Task 7')
  }

  async function loadPlan(_planId: string): Promise<{ plan: InstallmentPlan; dues: InstallmentDue[] } | null> {
    throw new Error('not implemented — see Task 7')
  }

  return { createPlan, recordDuePayment, cancelPlan, loadActivePlanForCustomer, loadPlan }
}
