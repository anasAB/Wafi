// src/features/reports/primitives/readProfitCache.ts
// WAFI-147A primitive 1: thin wrapper over the existing profit_cache table
// (WAFI-153, migration 086) -- no new table, no new computation, same
// cents-first-then-divide convention as useProfitCache.ts (see design spec S4).
import { db } from '@/data/powersync/db'
import type { ReportDateRange } from '../report.types'

export interface ProfitCacheSummary {
  revenueUsd: number; revenueSyp: number; cogsUsd: number; cogsReversalUsd: number
  expensesUsd: number; refundsUsd: number; discountUsd: number
  invoiceCount: number; returnCount: number; costlessSaleCount: number
  netRevenueUsd: number; netCogsUsd: number; profitUsd: number
}

type ProfitCacheRow = {
  revenue_usd: number; revenue_syp: number; cogs_usd: number; cogs_reversal_usd: number
  expenses_usd: number; refunds_usd: number; discount_usd: number
  invoice_count: number; return_count: number; costless_sale_count: number
}

export async function readProfitCache(shopId: string, range: ReportDateRange): Promise<ProfitCacheSummary> {
  const rows = await db.getAll<ProfitCacheRow>(
    `SELECT revenue_usd, revenue_syp, cogs_usd, cogs_reversal_usd, expenses_usd,
            refunds_usd, discount_usd, invoice_count, return_count, costless_sale_count
     FROM profit_cache WHERE shop_id = ? AND day BETWEEN ? AND ?`,
    [shopId, range.from, range.to],
  )

  const sums = rows.reduce((acc, r) => ({
    revenueCents: acc.revenueCents + r.revenue_usd, revenueSyp: acc.revenueSyp + r.revenue_syp,
    cogsCents: acc.cogsCents + r.cogs_usd, cogsRevCents: acc.cogsRevCents + r.cogs_reversal_usd,
    expensesCents: acc.expensesCents + r.expenses_usd, refundsCents: acc.refundsCents + r.refunds_usd,
    discountCents: acc.discountCents + r.discount_usd, invoiceCount: acc.invoiceCount + r.invoice_count,
    returnCount: acc.returnCount + r.return_count, costlessCount: acc.costlessCount + r.costless_sale_count,
  }), {
    revenueCents: 0, revenueSyp: 0, cogsCents: 0, cogsRevCents: 0, expensesCents: 0,
    refundsCents: 0, discountCents: 0, invoiceCount: 0, returnCount: 0, costlessCount: 0,
  })

  const revenueUsd = sums.revenueCents / 100
  const refundsUsd = sums.refundsCents / 100
  const cogsUsd = sums.cogsCents / 100
  const cogsReversalUsd = sums.cogsRevCents / 100
  const expensesUsd = sums.expensesCents / 100
  const discountUsd = sums.discountCents / 100
  const netRevenueUsd = revenueUsd - refundsUsd
  const netCogsUsd = cogsUsd - cogsReversalUsd

  return {
    revenueUsd, revenueSyp: sums.revenueSyp, cogsUsd, cogsReversalUsd, expensesUsd, refundsUsd, discountUsd,
    invoiceCount: sums.invoiceCount, returnCount: sums.returnCount,
    costlessSaleCount: Math.max(0, sums.costlessCount),
    netRevenueUsd, netCogsUsd, profitUsd: netRevenueUsd - netCogsUsd - expensesUsd,
  }
}
