import { v4 as uuidv4 } from 'uuid'
import { executeBusinessOperation } from '@/composables/executeBusinessOperation'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { useSessionStore } from '@/store/session.store'
import { useShiftStore } from '@/features/shifts/shift.store'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'
import { generateInstallmentSchedule } from '@/features/installments/installmentSchedule'
import type { InstallmentPlan, InstallmentDue, NewInstallmentPlanInput } from '@/features/installments/installment.types'

type PlanRow = {
  id: string; shop_id: string; customer_id: string; sale_id: string;
  total_amount_usd: number; down_payment_usd: number; term_count: number;
  term_frequency: 'weekly' | 'monthly'; start_date: string;
  status: 'active' | 'completed' | 'defaulted' | 'cancelled';
  created_at: string; created_by: string;
}
type DueRow = {
  id: string; plan_id: string; shop_id: string; due_date: string;
  amount_due_usd: number; amount_paid_usd: number; status: 'pending' | 'paid' | 'voided';
}

function rowToPlan(r: PlanRow): InstallmentPlan {
  return {
    planId: r.id, shopId: r.shop_id, customerId: r.customer_id, saleId: r.sale_id,
    totalAmountUsd: r.total_amount_usd, downPaymentUsd: r.down_payment_usd,
    termCount: r.term_count, termFrequency: r.term_frequency, startDate: r.start_date,
    status: r.status, createdAt: r.created_at, createdBy: r.created_by,
  }
}

function rowToDue(r: DueRow): InstallmentDue {
  return {
    dueId: r.id, planId: r.plan_id, shopId: r.shop_id, dueDate: r.due_date,
    amountDueUsd: r.amount_due_usd, amountPaidUsd: r.amount_paid_usd, status: r.status,
  }
}

/**
 * Voids every still-pending due on the plan and marks the plan cancelled, but
 * ONLY if the plan is currently 'active' — a `defaulted` plan is never
 * auto-cancelled by this helper, regardless of caller (WAFI-010). Returns
 * whether a cancellation actually happened, so callers know whether to
 * audit-log. Uses RETURNING + rows._array.length rather than rowsAffected,
 * since PowerSync's rowsAffected is documented as unreliable for conditional
 * UPDATEs under its client-side JSON-view storage layer.
 */
export async function cancelPlanWithinTx(tx: any, planId: string): Promise<boolean> {
  // Guarded plan-status flip FIRST — only void dues if this actually flipped
  // an 'active' plan to 'cancelled'. Running the dues-void unconditionally
  // (as before) meant a non-active plan (e.g. 'defaulted') could have its
  // entire pending-dues schedule voided with no plan-status change and no
  // audit trail, since callers only audit-log when this returns true.
  const planResult = await tx.execute(
    `UPDATE installment_plans SET status = 'cancelled' WHERE id = ? AND status = 'active' RETURNING id`,
    [planId],
  )
  const cancelled = (planResult.rows?._array?.length ?? 0) > 0
  if (!cancelled) return false

  await tx.execute(
    `UPDATE installment_dues SET status = 'voided' WHERE plan_id = ? AND status = 'pending'`,
    [planId],
  )
  return true
}

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

    return executeBusinessOperation(
      async () => {
        await db.writeTransaction(async (tx) => {
          await tx.execute(
            `INSERT INTO installment_plans
               (id, shop_id, customer_id, sale_id, total_amount_usd, down_payment_usd,
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
                 (id, plan_id, shop_id, due_date, amount_due_usd, amount_paid_usd, status, sync_status)
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
            // WAFI-120: cash down payment enters the drawer → carries shift + device.
            const shiftStore = useShiftStore()
            await tx.execute(
              `INSERT INTO customer_payments
                 (id, shop_id, customer_id, sale_id, due_id, amount_usd, currency, amount_raw,
                  method, exchange_rate_at_payment, notes, paid_at, created_at, shift_id, device_id, sync_status)
               VALUES (?, ?, ?, ?, NULL, ?, 'USD', ?, 'cash', NULL, NULL, ?, ?, ?, ?, 'pending')`,
              [
                uuidv4(), device.shopId, input.customerId, input.saleId,
                input.downPaymentUsd, input.downPaymentUsd, today, now,
                shiftStore.activeShiftId, device.deviceId,
              ],
            )
          }
        })
        return {
          planId, shopId: device.shopId, customerId: input.customerId, saleId: input.saleId,
          totalAmountUsd: input.totalAmountUsd, downPaymentUsd: input.downPaymentUsd,
          termCount: input.termCount, termFrequency: input.termFrequency, startDate: input.startDate,
          status: 'active' as const, createdAt: now, createdBy,
        }
      },
      { audit: (plan) => logInstallmentPlanCreated(plan.planId, input.customerId, input.totalAmountUsd, input.downPaymentUsd, input.termCount) },
    )
  }

  async function recordDuePayment(dueId: string, amountUsd: number): Promise<void> {
    const due = await db.getOptional<{
      id: string; plan_id: string; sale_id: string; shop_id: string;
      amount_due_usd: number; amount_paid_usd: number; customer_id: string;
    }>(
      `SELECT d.id, d.plan_id, p.sale_id, d.shop_id, d.amount_due_usd, d.amount_paid_usd, p.customer_id
       FROM installment_dues d
       JOIN installment_plans p ON p.id = d.plan_id
       WHERE d.id = ?`,
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

    // WAFI-120: cash installment collection enters the drawer → shift + device.
    const shiftStore = useShiftStore()
    const deviceStore = useDeviceStore()
    await executeBusinessOperation(
      async () => {
        await db.writeTransaction(async (tx) => {
          await tx.execute(
            `INSERT INTO customer_payments
               (id, shop_id, customer_id, sale_id, due_id, amount_usd, currency, amount_raw,
                method, exchange_rate_at_payment, notes, paid_at, created_at, shift_id, device_id, sync_status)
             VALUES (?, ?, ?, ?, ?, ?, 'USD', ?, 'cash', NULL, NULL, ?, ?, ?, ?, 'pending')`,
            [uuidv4(), due.shop_id, due.customer_id, due.sale_id, dueId, amountUsd, amountUsd, today, now,
             shiftStore.activeShiftId, deviceStore.deviceId],
          )

          await tx.execute(
            `UPDATE installment_dues SET amount_paid_usd = ?, status = '${newStatus}' WHERE id = ?`,
            [newPaid, dueId],
          )

          if (newStatus === 'paid') {
            const remaining = await tx.execute(
              `SELECT COUNT(*) as count FROM installment_dues
               WHERE plan_id = ? AND id != ? AND status = 'pending'`,
              [due.plan_id, dueId],
            )
            const remainingCount = (remaining as any).rows?._array?.[0]?.count ?? 0
            if (remainingCount === 0) {
              await tx.execute(
                `UPDATE installment_plans SET status = 'completed' WHERE id = ?`,
                [due.plan_id],
              )
            }
          }
        })
      },
      { audit: () => logInstallmentPaymentRecorded(dueId, due.plan_id, amountUsd) },
    )
  }

  /**
   * Manual owner-initiated cancellation. Silently a no-op (`Promise<void>`
   * gives the caller no signal) if `planId` isn't currently `active` —
   * `cancelPlanWithinTx`'s guard (WAFI-010) is structural and applies here
   * too. Not a live concern today: the one UI call site
   * (`InstallmentPlanSection.vue`) only ever loads a plan via
   * `loadActivePlanForCustomer`, which itself filters to `status = 'active'`
   * — so this path can't currently be reached with a non-active plan. Would
   * need a return-value/error surfaced to the caller if this composable is
   * ever wired up to a screen that can load a non-active plan.
   */
  async function cancelPlan(planId: string): Promise<void> {
    await executeBusinessOperation(
      async () => {
        let cancelled = false
        await db.writeTransaction(async (tx) => {
          cancelled = await cancelPlanWithinTx(tx, planId)
        })
        return cancelled
      },
      {
        audit: (cancelled) => cancelled
          ? logInstallmentPlanCancelled(planId, { reason: 'manual' })
          : Promise.resolve(),
      },
    )
  }

  async function loadActivePlanForCustomer(
    customerId: string,
  ): Promise<{ plan: InstallmentPlan; dues: InstallmentDue[] } | null> {
    const planRow = await db.getOptional<PlanRow>(
      `SELECT * FROM installment_plans
       WHERE customer_id = ? AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`,
      [customerId],
    )
    if (!planRow) return null

    const dueRows = await db.getAll<DueRow>(
      `SELECT * FROM installment_dues WHERE plan_id = ? ORDER BY due_date ASC`,
      [planRow.id],
    )
    return { plan: rowToPlan(planRow), dues: dueRows.map(rowToDue) }
  }

  async function loadPlan(planId: string): Promise<{ plan: InstallmentPlan; dues: InstallmentDue[] } | null> {
    const planRow = await db.getOptional<PlanRow>(
      `SELECT * FROM installment_plans WHERE id = ?`,
      [planId],
    )
    if (!planRow) return null

    const dueRows = await db.getAll<DueRow>(
      `SELECT * FROM installment_dues WHERE plan_id = ? ORDER BY due_date ASC`,
      [planId],
    )
    return { plan: rowToPlan(planRow), dues: dueRows.map(rowToDue) }
  }

  return { createPlan, recordDuePayment, cancelPlan, loadActivePlanForCustomer, loadPlan }
}
