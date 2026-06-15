import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

export interface CashMovement {
  type:      'sale' | 'expense' | 'refund'
  label:     string
  usd:       number
  syp:       number
  createdAt: string
}

// Read per-tender rows from sale_payments (not sales.payment_method) so the cash
// legs of split sales are counted; sales.payment_method='split' would otherwise hide them.
type PaymentRow = { method: string; amount_usd: number; amount_raw: number; created_at: string }
type ExpenseRow = { amount_usd: number; amount: number; currency: string; category: string; created_at: string }
type RefundRow  = { refund_method: string; refund_amount_usd: number; refund_amount_syp: number; created_at: string }

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

    const [paymentRows, expenseRows, refundRows] = await Promise.all([
      db.getAll<PaymentRow>(
        `SELECT method, amount_usd, amount_raw, created_at FROM sale_payments
         WHERE shop_id = ? AND method IN ('cash_usd', 'cash_syp') AND created_at >= ?
         ORDER BY created_at DESC`,
        [device.shopId, dayStart]
      ),
      db.getAll<ExpenseRow>(
        `SELECT amount_usd, amount, currency, category, created_at FROM expenses
         WHERE shop_id = ? AND paid_in_cash = 1 AND created_at >= ?
         ORDER BY created_at DESC`,
        [device.shopId, dayStart]
      ),
      db.getAll<RefundRow>(
        `SELECT refund_method, refund_amount_usd, refund_amount_syp, created_at FROM returns
         WHERE shop_id = ? AND refund_method IN ('cash_usd', 'cash_syp') AND created_at >= ?
         ORDER BY created_at DESC`,
        [device.shopId, dayStart]
      ),
    ])

    // Totals: cash legs in, cash expenses out, cash refunds out.
    let totalUsd = 0
    let totalSyp = 0
    for (const p of paymentRows) {
      if (p.method === 'cash_usd') totalUsd += p.amount_usd
      if (p.method === 'cash_syp') totalSyp += p.amount_raw
    }
    for (const e of expenseRows) {
      if (e.currency === 'USD') totalUsd -= e.amount_usd
      if (e.currency === 'SYP') totalSyp -= e.amount
    }
    for (const r of refundRows) {
      if (r.refund_method === 'cash_usd') totalUsd -= r.refund_amount_usd
      if (r.refund_method === 'cash_syp') totalSyp -= r.refund_amount_syp
    }
    cashUsd.value = totalUsd
    cashSyp.value = totalSyp

    // Movements (merge + sort newest first)
    const saleMoves: CashMovement[] = paymentRows.map(p => ({
      type:      'sale' as const,
      label:     'بيع',
      usd:       p.method === 'cash_usd' ? p.amount_usd : 0,
      syp:       p.method === 'cash_syp' ? p.amount_raw : 0,
      createdAt: p.created_at,
    }))
    const expenseMoves: CashMovement[] = expenseRows.map(e => ({
      type:      'expense' as const,
      label:     `مصروف: ${e.category}`,
      usd:       e.currency === 'USD' ? -e.amount_usd : 0,
      syp:       e.currency === 'SYP' ? -e.amount : 0,
      createdAt: e.created_at,
    }))
    const refundMoves: CashMovement[] = refundRows.map(r => ({
      type:      'refund' as const,
      label:     'مرتجع',
      usd:       r.refund_method === 'cash_usd' ? -r.refund_amount_usd : 0,
      syp:       r.refund_method === 'cash_syp' ? -r.refund_amount_syp : 0,
      createdAt: r.created_at,
    }))
    movements.value = [...saleMoves, ...expenseMoves, ...refundMoves]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  return { cashUsd, cashSyp, movements, load }
}
