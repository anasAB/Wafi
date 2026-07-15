import { ref, computed } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { dueBucket } from '@/features/installments/installment.types'
import type { DueBucket } from '@/features/installments/installment.types'

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

export function useInstallmentsDueAlert() {
  const items = ref<DueAlertItem[]>([])

  const dueOrOverdue = computed(() =>
    items.value.filter(i => i.bucket === 'due' || i.bucket === 'overdue'),
  )
  const count = computed(() => dueOrOverdue.value.length)
  const totalDueUsd = computed(() =>
    dueOrOverdue.value.reduce((s, i) => s + (i.amountDueUsd - i.amountPaidUsd), 0),
  )
  const top3 = computed(() => dueOrOverdue.value.slice(0, 3))
  const allClear = computed(() => count.value === 0)

  async function load() {
    const device = useDeviceStore()
    const today = new Date().toISOString().slice(0, 10)

    const rows = await db.getAll<DueAlertRow>(
      `SELECT d.due_id, d.plan_id, p.customer_id, c.name as customer_name,
              d.due_date, d.amount_due_usd, d.amount_paid_usd, d.status
       FROM installment_dues d
       JOIN installment_plans p ON p.plan_id = d.plan_id
       JOIN customers c ON c.id = p.customer_id
       WHERE d.shop_id = ? AND d.status = 'pending' AND p.status = 'active'
       ORDER BY d.due_date ASC`,
      [device.shopId],
    )

    items.value = rows.map(r => ({
      dueId: r.due_id, planId: r.plan_id, customerId: r.customer_id, customerName: r.customer_name,
      dueDate: r.due_date, amountDueUsd: r.amount_due_usd, amountPaidUsd: r.amount_paid_usd,
      bucket: dueBucket({ status: r.status, dueDate: r.due_date }, today),
    }))
  }

  return { items, count, totalDueUsd, top3, allClear, load }
}
