import { ref } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'
import type { Expense, NewExpense } from '@/features/expenses/expense.types'

type ExpenseRow = {
  id: string; shop_id: string; amount: number; currency: string; amount_usd: number
  category: string; expense_date: string; notes: string | null; photo_url: string | null
  paid_in_cash: number; created_at: string; sync_status: string
}

function rowToExpense(r: ExpenseRow): Expense {
  return {
    id: r.id, shopId: r.shop_id, amount: r.amount,
    currency: r.currency as 'USD' | 'SYP', amountUsd: r.amount_usd,
    category: r.category, expenseDate: r.expense_date,
    notes: r.notes ?? undefined, photoUrl: r.photo_url ?? undefined,
    paidInCash: r.paid_in_cash === 1, createdAt: r.created_at, syncStatus: r.sync_status,
  }
}

export function useExpenses() {
  const expenses = ref<Expense[]>([])
  // Store last date range so mutations can reload the same window
  let lastStart = ''
  let lastEnd   = ''
  const { logExpenseCreated, logExpenseDeleted } = useAuditLog()

  async function load(startDate: string, endDate: string) {
    lastStart = startDate
    lastEnd   = endDate
    const device = useDeviceStore()
    const rows = await db.getAll<ExpenseRow>(
      `SELECT * FROM expenses WHERE shop_id = ? AND expense_date BETWEEN ? AND ?
       ORDER BY expense_date DESC, created_at DESC`,
      [device.shopId, startDate, endDate]
    )
    expenses.value = rows.map(rowToExpense)
  }

  async function save(data: NewExpense) {
    const device = useDeviceStore()
    const id = uuidv4()
    const now = new Date().toISOString()
    await db.execute(
      `INSERT INTO expenses (id, shop_id, amount, currency, amount_usd, category, expense_date,
        notes, photo_url, paid_in_cash, created_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [id, device.shopId, data.amount, data.currency, data.amountUsd,
       data.category, data.expenseDate, data.notes ?? null,
       data.photoUrl ?? null, data.paidInCash ? 1 : 0, now]
    )
    if (lastStart) await load(lastStart, lastEnd)
    await logExpenseCreated(id, data.category, data.amountUsd)
  }

  async function deleteExpense(id: string) {
    const row = await db.getOptional<{ category: string; amount_usd: number }>(
      `SELECT category, amount_usd FROM expenses WHERE id = ?`, [id]
    )
    await db.execute(`DELETE FROM expenses WHERE id = ?`, [id])
    if (lastStart) await load(lastStart, lastEnd)
    if (row) await logExpenseDeleted(id, row.category, row.amount_usd)
  }

  return { expenses, load, save, deleteExpense }
}
