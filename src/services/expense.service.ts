import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { executeBusinessOperation } from '@/composables/executeBusinessOperation'
import { ExpenseEventType } from '@/services/events/domainEvent.types'
import type { NewExpense, Expense } from '@/features/expenses/expense.types'

const RECUR_META_PREFIX = '__wafi_recurring__:'

// Deliberately duplicated (not imported) from useExpenses.ts's private helpers —
// this service must stay free of any composable import, and these are small,
// pure, single-query functions. `duplicateLastMonth` (out of this ticket's scope,
// stays un-extracted) keeps using its own copy in useExpenses.ts; if the cost/rate
// logic ever changes, update both.
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

function costUsd(amount: number, currency: string, fallbackUsd: number, rate: number | null): number {
  if (currency !== 'SYP' || !rate || rate <= 0) return fallbackUsd
  return Math.round((amount / rate) * 100) / 100
}

function buildStoredNotes(
  userNotes: string | undefined,
  recurringStartDate?: string,
  recurringEndDate?: string,
): string | null {
  const plain = (userNotes ?? '').trim()
  if (recurringStartDate && recurringEndDate) {
    const meta = `${RECUR_META_PREFIX}${recurringStartDate}|${recurringEndDate}`
    return plain ? `${plain}\n${meta}` : meta
  }
  return plain || null
}

/** Narrow audit interface this service needs — implemented by the caller via
 *  useAuditLog(), never imported here. Keeps this file free of Vue imports in
 *  fact, not just by convention. */
export interface ExpenseAuditPort {
  logExpenseCreated: (id: string, category: string, amountUsd: number) => Promise<void>
}

/** Cash-drawer attribution (WAFI-120) — the service can't call useShiftStore()/
 *  useDeviceStore() itself, so the composable passes these through explicitly. */
export interface RecordExpenseContext {
  shiftId: string | null
  deviceId: string
}

export async function recordExpense(
  shopId: string,
  staffId: string,
  input: NewExpense,
  context: RecordExpenseContext,
  audit: ExpenseAuditPort,
): Promise<Expense> {
  const id = uuidv4()
  const now = new Date().toISOString()

  // Cost SYP at the rate effective on THIS occurrence's date (WAFI-025) — a
  // recurring expense spanning months must not book every month at one rate.
  const rate = input.currency === 'SYP' ? await rateForDate(shopId, input.expenseDate) : null
  const amountUsd = costUsd(input.amount, input.currency, input.amountUsd, rate)
  const storedNotes = buildStoredNotes(
    input.notes,
    input.isRecurringMonthly ? input.recurringStartDate : undefined,
    input.isRecurringMonthly ? input.recurringEndDate : undefined,
  )

  const write = async (): Promise<Expense> => {
    await db.execute(
      `INSERT INTO expenses (id, shop_id, amount, currency, amount_usd, category, expense_date,
         notes, photo_url, paid_in_cash, created_at, shift_id, device_id, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        id, shopId, input.amount, input.currency, amountUsd, input.category, input.expenseDate,
        storedNotes, input.photoUrl ?? null, input.paidInCash ? 1 : 0, now,
        context.shiftId, context.deviceId,
      ],
    )
    return {
      id, shopId, amount: input.amount, currency: input.currency, amountUsd,
      category: input.category, expenseDate: input.expenseDate,
      notes: input.notes, photoUrl: input.photoUrl, paidInCash: input.paidInCash,
      isRecurringMonthly: input.isRecurringMonthly,
      recurringStartDate: input.recurringStartDate, recurringEndDate: input.recurringEndDate,
      createdAt: now, syncStatus: 'pending',
    }
  }

  return executeBusinessOperation(write, {
    audit: (expense) => audit.logExpenseCreated(expense.id, expense.category, expense.amountUsd),
    toEvent: (expense) => ({
      type: ExpenseEventType.Recorded,
      entityId: expense.id,
      payload: { expenseId: expense.id, category: expense.category, amountUsd: expense.amountUsd, staffId, photoUrl: expense.photoUrl },
      staffId,
      shopId,
      occurredAt: now,
    }),
  })
}
