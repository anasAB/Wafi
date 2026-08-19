import { getCustomerAgingSnapshot } from '../primitives/getCustomerAgingSnapshot'
import { summarySection, detailSection } from '../report.types'
import type { Report, ReportDateRange } from '../report.types'
import { REPORT_DEFINITIONS } from '../reportRegistry'
import type { CustomerAgingRow } from '../primitives/getCustomerAgingSnapshot'

export interface RiskBucketRow { bucket: string; customerCount: number; totalOwedUsd: number }

function bucketFor(days: number): string {
  if (days <= 30) return '0-30 days'
  if (days <= 60) return '31-60 days'
  if (days <= 90) return '61-90 days'
  return '90+ days'
}

export async function computeCreditReport(shopId: string, range: ReportDateRange): Promise<Report> {
  const [current, prior] = await Promise.all([
    getCustomerAgingSnapshot(shopId, range.to),
    getCustomerAgingSnapshot(shopId, range.from),
  ])
  const debtors = current.filter((r) => r.balanceUsd > 0.001)
  const currentIds = new Set(current.map((r) => r.customerId))
  const priorDebtIds = new Set(prior.filter((r) => r.balanceUsd > 0.001).map((r) => r.customerId))
  const newDebtCustomers = debtors.filter((r) => !priorDebtIds.has(r.customerId))
  const overdue = debtors.filter((r) => r.daysOutstanding > 30)

  const bucketMap = new Map<string, RiskBucketRow>()
  for (const r of debtors) {
    const b = bucketFor(r.daysOutstanding)
    const existing = bucketMap.get(b) ?? { bucket: b, customerCount: 0, totalOwedUsd: 0 }
    existing.customerCount += 1
    existing.totalOwedUsd += r.balanceUsd
    bucketMap.set(b, existing)
  }

  return {
    id: 'credit-report', name: 'Credit Report', dateRange: range, generatedAt: new Date().toISOString(),
    sections: [
      summarySection({
        title: 'Outstanding Credit',
        metrics: [
          { label: 'Total outstanding', value: debtors.reduce((s, r) => s + r.balanceUsd, 0), unit: 'USD' },
          { label: 'New debt this period', value: newDebtCustomers.reduce((s, r) => s + r.balanceUsd, 0), unit: 'USD' },
        ],
      }),
      detailSection<CustomerAgingRow>({
        title: 'Overdue Accounts',
        columns: [{ key: 'customerName', label: 'Customer' }, { key: 'balanceUsd', label: 'Owed' }, { key: 'daysOutstanding', label: 'Days' }],
        rows: overdue,
      }),
      detailSection<RiskBucketRow>({
        title: 'Risk Distribution',
        columns: [{ key: 'bucket', label: 'Age bucket' }, { key: 'customerCount', label: 'Customers' }, { key: 'totalOwedUsd', label: 'Owed' }],
        rows: [...bucketMap.values()],
      }),
    ],
  }
}

REPORT_DEFINITIONS['credit-report'] = { id: 'credit-report', name: 'Credit Report', cadenceHint: 'weekly', compute: computeCreditReport }
