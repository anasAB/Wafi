import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { parseRecurringMeta } from '@/features/expenses/composables/useExpenses'

export interface BucketExpenseEntry {
  id: string
  category: string
  amountUsd: number
  expenseDate: string
  notes?: string
  photoUrl?: string
}

export interface BucketBreakdownTotals {
  grossIncomeUsd: number
  refundsUsd: number
  cogsUsd: number
  expensesUsd: number
  profitUsd: number
}

type ExpenseRow = {
  id: string
  category: string
  amount_usd: number
  expense_date: string
  notes: string | null
  photo_url: string | null
}

export function useBucketBreakdown() {
  const device = useDeviceStore()
  let activeLoadToken = 0
  const totals = ref<BucketBreakdownTotals>({
    grossIncomeUsd: 0,
    refundsUsd: 0,
    cogsUsd: 0,
    expensesUsd: 0,
    profitUsd: 0,
  })
  const expenses = ref<BucketExpenseEntry[]>([])

  async function load(start: string, end: string) {
    const loadToken = ++activeLoadToken
    const [revRow, cogsRow, expRow, refundRow, cogsReversalRow, expenseRows] = await Promise.all([
      db.getOptional<{ total: number }>(
        `SELECT COALESCE(SUM(total_usd), 0) as total
         FROM sales WHERE shop_id = ? AND DATE(created_at, 'localtime') BETWEEN ? AND ?`,
        [device.shopId, start, end],
      ),
      db.getOptional<{ cogs: number }>(
        `SELECT COALESCE(SUM(sli.quantity * COALESCE(sli.unit_cost_usd, 0)), 0) as cogs
         FROM sale_line_items sli
         JOIN sales s ON sli.sale_id = s.id
         WHERE s.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?`,
        [device.shopId, start, end],
      ),
      db.getOptional<{ total: number }>(
        `SELECT COALESCE(SUM(amount_usd), 0) as total
         FROM expenses WHERE shop_id = ? AND expense_date BETWEEN ? AND ?`,
        [device.shopId, start, end],
      ),
      db.getOptional<{ total: number }>(
        `SELECT COALESCE(SUM(refund_amount_usd), 0) as total
         FROM returns WHERE shop_id = ? AND DATE(created_at, 'localtime') BETWEEN ? AND ?`,
        [device.shopId, start, end],
      ),
      // WAFI-153 (staff_summary evaluation follow-up): subquery scoped to shop_id
      // (sale_line_items.shop_id, indexed via idx_sale_lines_shop) so this no
      // longer scans every shop's entire sale_line_items history on every call.
      // Not date-scoped — the original sale can predate the requested [start, end]
      // return-date window.
      db.getOptional<{ cogs: number }>(
        `SELECT COALESCE(SUM(rli.qty_returned * COALESCE(c.unit_cost_usd, 0)), 0) as cogs
         FROM return_line_items rli
         JOIN returns r ON r.id = rli.return_id
         LEFT JOIN (
           SELECT sale_id, product_id, AVG(unit_cost_usd) as unit_cost_usd
           FROM sale_line_items
           WHERE shop_id = ?
           GROUP BY sale_id, product_id
         ) c ON c.sale_id = r.original_sale_id AND c.product_id = rli.product_id
         WHERE r.shop_id = ? AND rli.restock = 1 AND DATE(r.created_at, 'localtime') BETWEEN ? AND ?`,
        [device.shopId, device.shopId, start, end],
      ),
      db.getAll<ExpenseRow>(
        `SELECT id, category, amount_usd, expense_date, notes, photo_url
         FROM expenses
         WHERE shop_id = ? AND expense_date BETWEEN ? AND ?
         ORDER BY amount_usd DESC, expense_date DESC, created_at DESC`,
        [device.shopId, start, end],
      ),
    ])

    const grossIncomeUsd = revRow?.total ?? 0
    const refundsUsd = refundRow?.total ?? 0
    const netRevenue = grossIncomeUsd - refundsUsd
    const cogsUsd = (cogsRow?.cogs ?? 0) - (cogsReversalRow?.cogs ?? 0)
    const expensesUsd = expRow?.total ?? 0

    if (loadToken !== activeLoadToken) return

    totals.value = {
      grossIncomeUsd,
      refundsUsd,
      cogsUsd,
      expensesUsd,
      profitUsd: netRevenue - cogsUsd - expensesUsd,
    }

    expenses.value = expenseRows.map((row) => ({
      id: row.id,
      category: row.category,
      amountUsd: row.amount_usd,
      expenseDate: row.expense_date,
      notes: parseRecurringMeta(row.notes).cleanNotes,
      photoUrl: row.photo_url ?? undefined,
    }))
  }

  return { totals, expenses, load }
}
