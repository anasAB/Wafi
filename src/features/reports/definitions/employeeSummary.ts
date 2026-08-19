// WAFI-147A: the only report needing ReportContext.staffId beyond (shopId,
// range) -- see Task 0 finding 1. compute() is a real, uniform implementation:
// absent staffId is an explicit, renderable Report state, never a throw.
import { db } from '@/data/powersync/db'
import { getStaffMetrics } from '../primitives/getStaffMetrics'
import { summarySection } from '../report.types'
import type { Report, ReportDateRange, ReportContext } from '../report.types'
import { REPORT_DEFINITIONS } from '../reportRegistry'

export async function computeEmployeeSummaryReport(shopId: string, range: ReportDateRange, context?: ReportContext): Promise<Report> {
  const staffId = context?.staffId
  if (!staffId) {
    return {
      id: 'employee-summary', name: 'Employee Summary', dateRange: range, generatedAt: new Date().toISOString(),
      sections: [summarySection({ title: 'لم يتم اختيار موظف', metrics: [] })],
    }
  }

  const [staffRows, cashRows, hoursRow] = await Promise.all([
    getStaffMetrics(shopId, range),
    db.getAll<{ variance_usd: number | null }>(
      `SELECT variance_usd FROM cashier_shifts WHERE shop_id = ? AND staff_id = ? AND status = 'closed'
       AND DATE(closed_at, 'localtime') BETWEEN ? AND ?`,
      [shopId, staffId, range.from, range.to],
    ),
    db.getOptional<{ hours: number }>(
      `SELECT COALESCE(SUM((julianday(closed_at) - julianday(opened_at)) * 24), 0) AS hours
       FROM cashier_shifts WHERE shop_id = ? AND staff_id = ? AND status = 'closed'
       AND DATE(closed_at, 'localtime') BETWEEN ? AND ?`,
      [shopId, staffId, range.from, range.to],
    ),
  ])

  const row = staffRows.find((r) => r.staffId === staffId)
  const variance = cashRows.reduce((s, r) => s + (r.variance_usd ?? 0), 0)

  return {
    id: 'employee-summary', name: 'Employee Summary', dateRange: range, generatedAt: new Date().toISOString(),
    sections: [summarySection({
      title: row?.name ?? 'Employee',
      metrics: [
        { label: 'Sales count', value: row?.salesCount ?? 0 },
        { label: 'Revenue', value: row?.revenueUsd ?? 0, unit: 'USD' },
        { label: 'Average basket', value: row?.avgTicketUsd ?? 0, unit: 'USD' },
        { label: 'Discounts given', value: row?.discountUsd ?? 0, unit: 'USD' },
        { label: 'Cash variance', value: variance, unit: 'USD' },
        { label: 'Hours worked', value: Math.round((hoursRow?.hours ?? 0) * 10) / 10 },
      ],
      visibility: 'staff',
    })],
  }
}

REPORT_DEFINITIONS['employee-summary'] = {
  id: 'employee-summary',
  name: 'Employee Summary',
  cadenceHint: 'per-shift',
  contextRequirement: 'staff', // the real, checkable signal Task 21's UI branches on -- not cadenceHint
  compute: computeEmployeeSummaryReport,
}
