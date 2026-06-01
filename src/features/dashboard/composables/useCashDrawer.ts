import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

export interface CashMovement {
  type:      'sale' | 'expense'
  label:     string
  usd:       number
  syp:       number
  createdAt: string
}

type SaleRow    = { total_usd: number; total_syp: number; payment_method: string; created_at: string }
type ExpenseRow = { amount_usd: number; amount: number; currency: string; category: string; created_at: string }

export function useCashDrawer() {
  const cashUsd   = ref(0)
  const cashSyp   = ref(0)
  const movements = ref<CashMovement[]>([])

  function getDayStart(): string {
    const now = new Date()
    const dayStart = new Date(now)
    dayStart.setHours(6, 0, 0, 0)
    // If before 6 AM, use yesterday's 6 AM
    if (now < dayStart) dayStart.setDate(dayStart.getDate() - 1)
    return dayStart.toISOString()
  }

  async function load() {
    const device = useDeviceStore()
    const dayStart = getDayStart()

    const [salesRows, expenseRows] = await Promise.all([
      db.getAll<SaleRow>(
        `SELECT total_usd, total_syp, payment_method, created_at FROM sales
         WHERE shop_id = ? AND payment_method IN ('cash_usd', 'cash_syp') AND created_at >= ?
         ORDER BY created_at DESC`,
        [device.shopId, dayStart]
      ),
      db.getAll<ExpenseRow>(
        `SELECT amount_usd, amount, currency, category, created_at FROM expenses
         WHERE shop_id = ? AND paid_in_cash = 1 AND created_at >= ?
         ORDER BY created_at DESC`,
        [device.shopId, dayStart]
      ),
    ])

    // Totals
    let totalUsd = 0
    let totalSyp = 0
    for (const s of salesRows) {
      if (s.payment_method === 'cash_usd') totalUsd += s.total_usd
      if (s.payment_method === 'cash_syp') totalSyp += s.total_syp
    }
    for (const e of expenseRows) {
      if (e.currency === 'USD') totalUsd -= e.amount_usd
      if (e.currency === 'SYP') totalSyp -= e.amount
    }
    cashUsd.value = totalUsd
    cashSyp.value = totalSyp

    // Movements (merge + sort newest first)
    const saleMoves: CashMovement[] = salesRows.map(s => ({
      type:      'sale' as const,
      label:     'بيع',
      usd:       s.payment_method === 'cash_usd' ? s.total_usd : 0,
      syp:       s.payment_method === 'cash_syp' ? s.total_syp : 0,
      createdAt: s.created_at,
    }))
    const expenseMoves: CashMovement[] = expenseRows.map(e => ({
      type:      'expense' as const,
      label:     `مصروف: ${e.category}`,
      usd:       e.currency === 'USD' ? -e.amount_usd : 0,
      syp:       e.currency === 'SYP' ? -e.amount : 0,
      createdAt: e.created_at,
    }))
    movements.value = [...saleMoves, ...expenseMoves]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  return { cashUsd, cashSyp, movements, load }
}
