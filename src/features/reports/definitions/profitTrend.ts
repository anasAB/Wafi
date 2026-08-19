import { db } from '@/data/powersync/db'
import { detailSection } from '../report.types'
import type { Report, ReportDateRange } from '../report.types'
import { REPORT_DEFINITIONS } from '../reportRegistry'

export interface DailyProfitRow { day: string; revenueUsd: number; profitUsd: number }

export async function computeProfitTrendReport(shopId: string, range: ReportDateRange): Promise<Report> {
  const rows = await db.getAll<{ day: string; revenue_usd: number; cogs_usd: number; expenses_usd: number; refunds_usd: number; cogs_reversal_usd: number }>(
    `SELECT day, revenue_usd, cogs_usd, expenses_usd, refunds_usd, cogs_reversal_usd
     FROM profit_cache WHERE shop_id = ? AND day BETWEEN ? AND ? ORDER BY day ASC`,
    [shopId, range.from, range.to],
  )
  const daily: DailyProfitRow[] = rows.map((r) => {
    const revenueUsd = r.revenue_usd / 100
    const profitUsd = (r.revenue_usd - r.refunds_usd) / 100 - (r.cogs_usd - r.cogs_reversal_usd) / 100 - r.expenses_usd / 100
    return { day: r.day, revenueUsd, profitUsd }
  })

  return {
    id: 'profit-trend', name: 'Profit Trend Report', dateRange: range, generatedAt: new Date().toISOString(),
    sections: [
      detailSection<DailyProfitRow>({
        title: 'Daily Profit',
        columns: [{ key: 'day', label: 'Day' }, { key: 'revenueUsd', label: 'Revenue' }, { key: 'profitUsd', label: 'Profit' }],
        rows: daily,
      }),
    ],
  }
}

REPORT_DEFINITIONS['profit-trend'] = { id: 'profit-trend', name: 'Profit Trend Report', cadenceHint: 'monthly', compute: computeProfitTrendReport }
