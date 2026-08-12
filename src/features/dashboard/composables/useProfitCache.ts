import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { logger } from '@/services/events/logger'
import { EMPTY_PROFIT_METRICS, type PeriodProfitMetrics } from '../types/profitMetrics'

type ProfitCacheRow = {
  revenue_usd: number; revenue_syp: number; cogs_usd: number; cogs_reversal_usd: number
  expenses_usd: number; refunds_usd: number; discount_usd: number
  invoice_count: number; return_count: number; costless_sale_count: number
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

// Local-date (not UTC) formatting -- matches this codebase's periodUtils.ts
// convention, since Syria is UTC+3 and toISOString() would shift the day.
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function toRange(period: 'today' | 'week' | 'month' | 'quarter'): [string, string] {
  const now = new Date()
  const today = toDateStr(now)
  if (period === 'today') return [today, today]

  const start = new Date(now)
  if (period === 'week') start.setDate(now.getDate() - 6)
  else if (period === 'month') start.setDate(now.getDate() - 29)
  else start.setDate(now.getDate() - 89) // quarter
  return [toDateStr(start), today]
}

export function useProfitCache() {
  const metrics = ref<PeriodProfitMetrics>({ ...EMPTY_PROFIT_METRICS })
  const loading = ref(false)

  async function loadRange(from: string, to: string): Promise<void> {
    loading.value = true
    try {
      const { shopId } = useDeviceStore()
      const rows = await db.getAll<ProfitCacheRow>(
        `SELECT revenue_usd, revenue_syp, cogs_usd, cogs_reversal_usd, expenses_usd,
                refunds_usd, discount_usd, invoice_count, return_count, costless_sale_count
         FROM profit_cache WHERE shop_id = ? AND day BETWEEN ? AND ?`,
        [shopId, from, to],
      )

      // Sum whole integer CENTS across all rows first; divide by 100 exactly
      // once, at the very end, per metric -- never sum floating-dollar values
      // row by row (that would reintroduce the float error this whole design
      // exists to avoid).
      const sums = rows.reduce((acc, r) => ({
        revenueCents:  acc.revenueCents  + r.revenue_usd,
        revenueSyp:    acc.revenueSyp    + r.revenue_syp,
        cogsCents:     acc.cogsCents     + r.cogs_usd,
        cogsRevCents:  acc.cogsRevCents  + r.cogs_reversal_usd,
        expensesCents: acc.expensesCents + r.expenses_usd,
        refundsCents:  acc.refundsCents  + r.refunds_usd,
        discountCents: acc.discountCents + r.discount_usd,
        invoiceCount:  acc.invoiceCount  + r.invoice_count,
        returnCount:   acc.returnCount   + r.return_count,
        costlessCount: acc.costlessCount + r.costless_sale_count,
      }), {
        revenueCents: 0, revenueSyp: 0, cogsCents: 0, cogsRevCents: 0, expensesCents: 0,
        refundsCents: 0, discountCents: 0, invoiceCount: 0, returnCount: 0, costlessCount: 0,
      })

      const revenueUsd       = sums.revenueCents / 100.0
      const refundsUsd       = sums.refundsCents / 100.0
      const cogsUsd          = sums.cogsCents / 100.0
      const cogsReversalUsd  = sums.cogsRevCents / 100.0
      const expensesUsd      = sums.expensesCents / 100.0
      const discountUsd      = sums.discountCents / 100.0
      const netRevenueUsd    = revenueUsd - refundsUsd
      const netCogsUsd       = cogsUsd - cogsReversalUsd
      const profitUsd        = netRevenueUsd - netCogsUsd - expensesUsd

      // A transiently negative summed count (return-before-sale upsert mid-flight)
      // is expected eventual consistency, not corrupt data -- clamp for display,
      // but log so a PERSISTENTLY negative count is visible to an operator.
      if (sums.costlessCount < 0) {
        logger.error('[useProfitCache] negative costlessSaleCount for range', { from, to, value: sums.costlessCount })
      }

      metrics.value = {
        revenueUsd, refundsUsd, cogsUsd, cogsReversalUsd, expensesUsd, discountUsd,
        invoiceCount: sums.invoiceCount, returnCount: sums.returnCount,
        costlessSaleCount: Math.max(0, sums.costlessCount),
        netRevenueUsd, netCogsUsd, profitUsd,
        profitIsEstimated: sums.costlessCount > 0,
      }
    } finally {
      loading.value = false
    }
  }

  async function load(period: 'today' | 'week' | 'month' | 'quarter'): Promise<void> {
    const [from, to] = toRange(period)
    await loadRange(from, to)
  }

  return { metrics, loading, load, loadRange }
}
