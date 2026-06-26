import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { parseRecurringMeta } from '@/features/expenses/composables/useExpenses'

export interface ExpenseBreakdownSlice {
  category: string
  totalUsd: number
}

export interface ExpenseBreakdownEntry {
  id: string
  category: string
  amountUsd: number
  expenseDate: string
  description: string
  photoUrl?: string
}

type ExpenseGroupRow = {
  category: string
  total: number
}

type ExpenseEntryRow = {
  id: string
  category: string
  amount_usd: number
  expense_date: string
  notes: string | null
  photo_url: string | null
}

function normalizeCategory(raw: string | null | undefined): string {
  const value = (raw ?? '').trim()
  return value ? value : 'غير مصنف'
}

export function useExpenseBreakdown() {
  const device = useDeviceStore()
  const slices = ref<ExpenseBreakdownSlice[]>([])
  const totalUsd = ref(0)
  const entries = ref<ExpenseBreakdownEntry[]>([])

  async function load(start: string, end: string) {
    const rows = await db.getAll<ExpenseGroupRow>(
      `SELECT TRIM(category) AS category, COALESCE(SUM(amount_usd), 0) AS total
       FROM expenses
       WHERE shop_id = ? AND expense_date BETWEEN ? AND ?
       GROUP BY TRIM(category)`,
      [device.shopId, start, end],
    )

    const grouped = new Map<string, ExpenseBreakdownSlice>()
    for (const row of rows) {
      const category = normalizeCategory(row.category)
      const key = category.toLocaleLowerCase('ar')
      const current = grouped.get(key)
      if (current) {
        current.totalUsd += row.total ?? 0
      } else {
        grouped.set(key, { category, totalUsd: row.total ?? 0 })
      }
    }

    const merged: ExpenseBreakdownSlice[] = [...grouped.values()]
    merged.sort((a, b) => b.totalUsd - a.totalUsd)
    slices.value = merged
    totalUsd.value = merged.reduce((sum, item) => sum + item.totalUsd, 0)
  }

  async function loadEntries(start: string, end: string, category?: string) {
    const normalizedCategory = category ? category.trim() : ''
    const hasCategoryFilter = Boolean(normalizedCategory)

    const rows = await db.getAll<ExpenseEntryRow>(
      `SELECT id, category, amount_usd, expense_date, notes, photo_url
       FROM expenses
       WHERE shop_id = ? AND expense_date BETWEEN ? AND ?
      ${hasCategoryFilter ? 'AND LOWER(TRIM(category)) = LOWER(TRIM(?))' : ''}
       ORDER BY amount_usd DESC, expense_date DESC, created_at DESC`,
      hasCategoryFilter
        ? [device.shopId, start, end, normalizedCategory]
        : [device.shopId, start, end],
    )

    entries.value = rows.map((row) => {
      const cleanedNotes = parseRecurringMeta(row.notes).cleanNotes?.trim()
      return {
        id: row.id,
        category: normalizeCategory(row.category),
        amountUsd: row.amount_usd,
        expenseDate: row.expense_date,
        description: cleanedNotes || normalizeCategory(row.category),
        photoUrl: row.photo_url ?? undefined,
      }
    })
  }

  return { slices, totalUsd, entries, load, loadEntries }
}
