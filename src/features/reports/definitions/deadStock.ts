import { summarySection, detailSection } from '../report.types'
import type { Report, ReportDateRange } from '../report.types'
import { REPORT_DEFINITIONS } from '../reportRegistry'
import { queryDeadStockRows } from '../primitives/queryDeadStockRows'
import type { DeadStockRow } from '../primitives/queryDeadStockRows'

const THRESHOLD_DAYS = 90 // spec offers 60/90/180; 90 is this report's fixed default, matching Task 16 and useDeadStockReport.ts

export async function computeDeadStockReport(shopId: string, range: ReportDateRange): Promise<Report> {
  const { rows: deadStock, truncated } = await queryDeadStockRows(shopId, THRESHOLD_DAYS)

  return {
    id: 'dead-stock', name: 'Dead Stock Report', dateRange: range, generatedAt: new Date().toISOString(),
    sections: [
      // "(current snapshot)" -- see Task 16's identical labeling rationale:
      // current_stock/cost_price_usd reflect today, not `range`. The capital-tied-up
      // total only sums the capped/returned rows (queryDeadStockRows already sorts by
      // valueUsd descending, so a truncated result still totals the most material items,
      // not an arbitrary sample) -- if truncated, the summary label says so rather than
      // silently implying it's the shop's full dead-stock total.
      summarySection({
        title: 'Capital Tied Up (current snapshot)',
        metrics: [{
          label: truncated
            ? `Capital in top ${deadStock.length} dead-stock items (${THRESHOLD_DAYS}+ days, more not shown)`
            : `Capital in dead stock (${THRESHOLD_DAYS}+ days)`,
          value: deadStock.reduce((s, r) => s + r.valueUsd, 0),
          unit: 'USD',
        }],
      }),
      detailSection<DeadStockRow>({
        title: `Products with No Sales in ${THRESHOLD_DAYS}+ Days (current snapshot)`,
        columns: [{ key: 'nameAr', label: 'Product' }, { key: 'currentStock', label: 'Stock', align: 'end' }, { key: 'valueUsd', label: 'Value', format: 'currency-usd', align: 'end' }, { key: 'lastSoldAt', label: 'Last Sold', format: 'date' }],
        rows: deadStock,
        truncated,
      }),
    ],
  }
}

REPORT_DEFINITIONS['dead-stock'] = { id: 'dead-stock', name: 'Dead Stock Report', cadenceHint: 'weekly', compute: computeDeadStockReport }
