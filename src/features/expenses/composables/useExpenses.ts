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

const RECUR_META_PREFIX = '__wafi_recurring__:'

export function parseRecurringMeta(rawNotes: string | null): {
  cleanNotes?: string
  isRecurringMonthly?: boolean
  recurringStartDate?: string
  recurringEndDate?: string
} {
  const text = rawNotes ?? ''
  if (!text.includes(RECUR_META_PREFIX)) {
    return { cleanNotes: text || undefined }
  }

  const lines = text.split('\n')
  const metaLine = lines.find(l => l.startsWith(RECUR_META_PREFIX))
  const visibleNotes = lines.filter(l => !l.startsWith(RECUR_META_PREFIX)).join('\n').trim()

  if (!metaLine) return { cleanNotes: visibleNotes || undefined }

  const payload = metaLine.slice(RECUR_META_PREFIX.length)
  const [start, end] = payload.split('|')
  if (!start || !end) return { cleanNotes: visibleNotes || undefined }

  return {
    cleanNotes: visibleNotes || undefined,
    isRecurringMonthly: true,
    recurringStartDate: start,
    recurringEndDate: end,
  }
}

function buildStoredNotes(userNotes: string | undefined, recurringStartDate?: string, recurringEndDate?: string): string | null {
  const plain = (userNotes ?? '').trim()
  if (recurringStartDate && recurringEndDate) {
    const meta = `${RECUR_META_PREFIX}${recurringStartDate}|${recurringEndDate}`
    return plain ? `${plain}\n${meta}` : meta
  }
  return plain || null
}

function rowToExpense(r: ExpenseRow): Expense {
  const recurring = parseRecurringMeta(r.notes)
  return {
    id: r.id, shopId: r.shop_id, amount: r.amount,
    currency: r.currency as 'USD' | 'SYP', amountUsd: r.amount_usd,
    category: r.category, expenseDate: r.expense_date,
    notes: recurring.cleanNotes, photoUrl: r.photo_url ?? undefined,
    paidInCash: r.paid_in_cash === 1, createdAt: r.created_at, syncStatus: r.sync_status,
    isRecurringMonthly: recurring.isRecurringMonthly,
    recurringStartDate: recurring.recurringStartDate,
    recurringEndDate: recurring.recurringEndDate,
  }
}

// The SYP→USD rate in effect on a given calendar day, from the rate history, so
// an expense is costed at the rate that applied on its date (WAFI-025) rather than
// a single stale rate. Falls back to the earliest recorded rate for dates that
// precede any rate entry; null if no rate was ever set.
async function rateForDate(shopId: string, dateStr: string): Promise<number | null> {
  const onOrBefore = await db.getOptional<{ rate: number }>(
    `SELECT rate FROM exchange_rates WHERE shop_id = ? AND set_at <= ? ORDER BY set_at DESC LIMIT 1`,
    [shopId, `${dateStr}T23:59:59.999Z`],
  )
  if (onOrBefore) return onOrBefore.rate
  const earliest = await db.getOptional<{ rate: number }>(
    `SELECT rate FROM exchange_rates WHERE shop_id = ? ORDER BY set_at ASC LIMIT 1`,
    [shopId],
  )
  return earliest?.rate ?? null
}

// USD cost of an expense: SYP amounts are re-derived from the date's rate (rounded
// to cents); USD amounts keep their entered value. Falls back to fallbackUsd when
// no rate is available so the figure is never zeroed.
function costUsd(amount: number, currency: string, fallbackUsd: number, rate: number | null): number {
  if (currency !== 'SYP' || !rate || rate <= 0) return fallbackUsd
  return Math.round((amount / rate) * 100) / 100
}

export function useExpenses() {
  const expenses = ref<Expense[]>([])
  // Store last date range so mutations can reload the same window
  let lastStart = ''
  let lastEnd   = ''
  const { logExpenseCreated, logExpenseUpdated, logExpenseDeleted } = useAuditLog()

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
    const now = new Date().toISOString()
    const createdIds: string[] = []

    const insertOne = async (expenseDate: string) => {
      const id = uuidv4()
      const storedNotes = buildStoredNotes(
        data.notes,
        data.isRecurringMonthly ? data.recurringStartDate : undefined,
        data.isRecurringMonthly ? data.recurringEndDate : undefined,
      )
      // Cost SYP at the rate effective on THIS occurrence's date (WAFI-025) — a
      // recurring expense spanning months must not book every month at one rate.
      const rate = data.currency === 'SYP' ? await rateForDate(device.shopId, expenseDate) : null
      const amountUsd = costUsd(data.amount, data.currency, data.amountUsd, rate)
      await db.execute(
        `INSERT INTO expenses (id, shop_id, amount, currency, amount_usd, category, expense_date,
          notes, photo_url, paid_in_cash, created_at, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [id, device.shopId, data.amount, data.currency, amountUsd,
         data.category, expenseDate, storedNotes,
         data.photoUrl ?? null, data.paidInCash ? 1 : 0, now]
      )
      createdIds.push(id)
    }

    if (data.isRecurringMonthly && data.recurringStartDate && data.recurringEndDate) {
      const start = new Date(data.recurringStartDate + 'T00:00:00')
      const end   = new Date(data.recurringEndDate + 'T00:00:00')
      const dayOfMonth = start.getDate()

      const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
      const limit  = new Date(end.getFullYear(), end.getMonth(), 1)

      while (cursor <= limit) {
        const year  = cursor.getFullYear()
        const month = cursor.getMonth()
        const lastDay = new Date(year, month + 1, 0).getDate()
        const day = Math.min(dayOfMonth, lastDay)
        const occurrence = new Date(year, month, day)
        if (occurrence >= start && occurrence <= end) {
          const expenseDate = `${occurrence.getFullYear()}-${String(occurrence.getMonth() + 1).padStart(2, '0')}-${String(occurrence.getDate()).padStart(2, '0')}`
          await insertOne(expenseDate)
        }
        cursor.setMonth(cursor.getMonth() + 1)
      }
    } else {
      await insertOne(data.expenseDate)
    }

    if (lastStart) await load(lastStart, lastEnd)
    for (const id of createdIds) {
      await logExpenseCreated(id, data.category, data.amountUsd)
    }
  }

  // Copy last month's expenses into the current month (for recurring costs like
  // rent/salary). Lightweight "duplicate last month" — the owner can delete any
  // one-offs afterward. Returns how many were copied. (#12)
  async function duplicateLastMonth(): Promise<number> {
    const device = useDeviceStore()
    const now = new Date()
    const firstLast = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const lastLast  = new Date(now.getFullYear(), now.getMonth(), 0)
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const rows = await db.getAll<ExpenseRow>(
      `SELECT * FROM expenses WHERE shop_id = ? AND expense_date BETWEEN ? AND ? ORDER BY created_at`,
      [device.shopId, fmt(firstLast), fmt(lastLast)]
    )
    const today  = fmt(now)
    const nowIso = now.toISOString()
    const todayRate = await rateForDate(device.shopId, today)
    for (const r of rows) {
      // Re-cost SYP at today's rate (WAFI-025) — copying last month's amount_usd
      // verbatim drifts as the rate moves. And drop the recurring meta marker so a
      // plain duplicate isn't silently treated as a recurring expense.
      const amountUsd  = costUsd(r.amount, r.currency, r.amount_usd, todayRate)
      const plainNotes = parseRecurringMeta(r.notes).cleanNotes ?? null
      await db.execute(
        `INSERT INTO expenses (id, shop_id, amount, currency, amount_usd, category, expense_date,
          notes, photo_url, paid_in_cash, created_at, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [uuidv4(), device.shopId, r.amount, r.currency, amountUsd, r.category, today,
         plainNotes, r.photo_url, r.paid_in_cash, nowIso]
      )
    }
    if (lastStart) await load(lastStart, lastEnd)
    return rows.length
  }

  async function deleteExpense(id: string) {
    const row = await db.getOptional<{ category: string; amount_usd: number }>(
      `SELECT category, amount_usd FROM expenses WHERE id = ?`, [id]
    )
    await db.execute(`DELETE FROM expenses WHERE id = ?`, [id])
    if (lastStart) await load(lastStart, lastEnd)
    if (row) await logExpenseDeleted(id, row.category, row.amount_usd)
  }

  async function updateExpense(id: string, data: NewExpense) {
    const existing = await db.getOptional<ExpenseRow>(
      `SELECT * FROM expenses WHERE id = ?`, [id]
    )
    if (!existing) throw new Error('Expense not found')

    const existingExpense = rowToExpense(existing)
    const nextExpenseDate = data.isRecurringMonthly
      ? (data.recurringStartDate || data.expenseDate)
      : data.expenseDate

    const nextStoredNotes = buildStoredNotes(
      data.notes,
      data.isRecurringMonthly ? data.recurringStartDate : undefined,
      data.isRecurringMonthly ? data.recurringEndDate : undefined,
    )

    await db.execute(
      `UPDATE expenses
       SET amount = ?, currency = ?, amount_usd = ?, category = ?, expense_date = ?,
           notes = ?, photo_url = ?, paid_in_cash = ?, sync_status = 'pending'
       WHERE id = ?`,
      [
        data.amount,
        data.currency,
        data.amountUsd,
        data.category,
        nextExpenseDate,
        nextStoredNotes,
        data.photoUrl ?? null,
        data.paidInCash ? 1 : 0,
        id,
      ],
    )

    if (lastStart) await load(lastStart, lastEnd)

    const changedFields: string[] = []
    if (existingExpense.amount !== data.amount || existingExpense.currency !== data.currency) changedFields.push('المبلغ')
    if (existingExpense.category !== data.category) changedFields.push('الفئة')
    if (existingExpense.expenseDate !== nextExpenseDate) changedFields.push('التاريخ')
    if ((existingExpense.notes ?? '') !== (data.notes ?? '')) changedFields.push('الملاحظات')
    if (existingExpense.paidInCash !== data.paidInCash) changedFields.push('طريقة الدفع')
    if (!!existingExpense.isRecurringMonthly !== !!data.isRecurringMonthly
      || (existingExpense.recurringStartDate ?? '') !== (data.recurringStartDate ?? '')
      || (existingExpense.recurringEndDate ?? '') !== (data.recurringEndDate ?? '')) {
      changedFields.push('التكرار')
    }

    await logExpenseUpdated(id, data.category, data.amountUsd, changedFields)
  }

  return { expenses, load, save, updateExpense, deleteExpense, duplicateLastMonth }
}
