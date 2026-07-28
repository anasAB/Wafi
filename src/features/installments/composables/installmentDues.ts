import { db } from '@/data/powersync/db'
import { dueBucket } from '@/features/installments/installment.types'
import type { DueBucket } from '@/features/installments/installment.types'

// WAFI-017: extracted from useInstallmentsDueAlert.ts so the "all pending
// dues for the shop" query has exactly one implementation, reusable by both
// the due-alert badge (UI composable) and useMoneyOwed (data aggregation,
// which must not depend on a UI-oriented composable — see the WAFI-017
// design doc's §4 reuse-mechanism decision).

export interface DueAlertItem {
  dueId:         string
  planId:        string
  customerId:    string
  customerName:  string
  dueDate:       string
  amountDueUsd:  number
  amountPaidUsd: number
  bucket:        DueBucket
}

type DueAlertRow = {
  due_id: string; plan_id: string; customer_id: string; customer_name: string;
  due_date: string; amount_due_usd: number; amount_paid_usd: number; status: 'pending' | 'paid' | 'voided';
}

/**
 * Every pending due on an active plan for the shop, each carrying its display
 * bucket (upcoming/due/overdue) computed against today's local calendar day
 * — the same convention `dueBucket()` has always used. Ordered by due date
 * ascending (oldest/most-overdue first).
 */
export async function fetchPendingInstallmentDues(shopId: string): Promise<DueAlertItem[]> {
  const today = new Date().toISOString().slice(0, 10)

  const rows = await db.getAll<DueAlertRow>(
    `SELECT d.id AS due_id, d.plan_id, p.customer_id, c.name as customer_name,
            d.due_date, d.amount_due_usd, d.amount_paid_usd, d.status
     FROM installment_dues d
     JOIN installment_plans p ON p.id = d.plan_id
     JOIN customers c ON c.id = p.customer_id
     WHERE d.shop_id = ? AND d.status = 'pending' AND p.status = 'active'
     ORDER BY d.due_date ASC`,
    [shopId],
  )

  return rows.map(r => ({
    dueId: r.due_id, planId: r.plan_id, customerId: r.customer_id, customerName: r.customer_name,
    dueDate: r.due_date, amountDueUsd: r.amount_due_usd, amountPaidUsd: r.amount_paid_usd,
    bucket: dueBucket({ status: r.status, dueDate: r.due_date }, today),
  }))
}
