import { db } from '@/data/powersync/db'
import { detailSection } from '../report.types'
import type { Report, ReportDateRange } from '../report.types'
import { REPORT_DEFINITIONS } from '../reportRegistry'

export interface TopCustomerRow { customerId: string; customerName: string; revenueUsd: number; visitCount: number }
export interface AtRiskCustomerRow { customerId: string; customerName: string; lastVisit: string }
export interface NewCustomerRow { customerId: string; customerName: string; createdAt: string; revenueUsd: number }

// I10: "At-Risk Customers" and "New Customers This Period" are unbounded queries over the
// shop's whole customer table (unlike the fixed-N Top 20 sections above, which ARE the full
// intended result) -- a shop with thousands of customers could otherwise render thousands of
// <tr>s in one section. Same DETAIL_ROW_CAP convention as discountReport.ts/returnsReport.ts:
// fetch cap+1 rows and slice so the exact-boundary case is never misreported as truncated.
const DETAIL_ROW_CAP = 500

export async function computeTopCustomersReport(shopId: string, range: ReportDateRange): Promise<Report> {
  const [byRevenue, byVisits, atRiskRows, newCustomersRows] = await Promise.all([
    db.getAll<TopCustomerRow>(
      `SELECT c.id AS customerId, c.name AS customerName, SUM(s.total_usd) AS revenueUsd, COUNT(*) AS visitCount
       FROM sales s JOIN customers c ON c.id = s.customer_id
       WHERE s.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY c.id, c.name ORDER BY revenueUsd DESC LIMIT 20`,
      [shopId, range.from, range.to],
    ),
    db.getAll<TopCustomerRow>(
      `SELECT c.id AS customerId, c.name AS customerName, SUM(s.total_usd) AS revenueUsd, COUNT(*) AS visitCount
       FROM sales s JOIN customers c ON c.id = s.customer_id
       WHERE s.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY c.id, c.name ORDER BY visitCount DESC LIMIT 20`,
      [shopId, range.from, range.to],
    ),
    db.getAll<AtRiskCustomerRow>(
      `SELECT c.id AS customerId, c.name AS customerName, MAX(s.created_at) AS lastVisit
       FROM customers c LEFT JOIN sales s ON s.customer_id = c.id AND s.shop_id = ?
       WHERE c.shop_id = ? AND (c.deleted = 0 OR c.deleted IS NULL)
       GROUP BY c.id, c.name
       HAVING lastVisit IS NULL OR DATE(lastVisit, 'localtime') < DATE(?, '-60 days')
       LIMIT ?`,
      [shopId, shopId, range.to, DETAIL_ROW_CAP + 1],
    ),
    // Task 0 P0 finding 7: revenueUsd here MUST be bound to `range`, not
    // all-time -- an earlier draft's unbounded subquery computed lifetime
    // revenue for a "new customers THIS PERIOD" row, which is meaningless
    // (and that draft never even displayed the column, hiding the bug).
    db.getAll<NewCustomerRow>(
      `SELECT c.id AS customerId, c.name AS customerName, c.created_at AS createdAt,
              COALESCE((SELECT SUM(total_usd) FROM sales
                        WHERE customer_id = c.id AND shop_id = ? AND DATE(created_at, 'localtime') BETWEEN ? AND ?), 0) AS revenueUsd
       FROM customers c
       WHERE c.shop_id = ? AND DATE(c.created_at, 'localtime') BETWEEN ? AND ?
       LIMIT ?`,
      [shopId, range.from, range.to, shopId, range.from, range.to, DETAIL_ROW_CAP + 1],
    ),
  ])
  const atRisk = atRiskRows.slice(0, DETAIL_ROW_CAP)
  const atRiskTruncated = atRiskRows.length > DETAIL_ROW_CAP
  const newCustomers = newCustomersRows.slice(0, DETAIL_ROW_CAP)
  const newCustomersTruncated = newCustomersRows.length > DETAIL_ROW_CAP

  return {
    id: 'top-customers', name: 'Top Customers Report', dateRange: range, generatedAt: new Date().toISOString(),
    sections: [
      detailSection<TopCustomerRow>({ title: 'Top 20 by Revenue', columns: [{ key: 'customerName', label: 'Customer' }, { key: 'revenueUsd', label: 'Revenue' }], rows: byRevenue }),
      detailSection<TopCustomerRow>({ title: 'Top 20 by Visits', columns: [{ key: 'customerName', label: 'Customer' }, { key: 'visitCount', label: 'Visits' }], rows: byVisits }),
      // Task 0 P0 finding 17 (corrected in second review): the query is
      // relative to `range.to`, not necessarily today (e.g. an Aug 1-31
      // report computes at-risk status as of Aug 31, not the day the report
      // happens to be opened) -- "as of report end" is the precise wording,
      // not "current," which would misleadingly imply it always means today.
      detailSection<AtRiskCustomerRow>({ title: 'At-Risk Customers (no visit in 60 days as of report end)', columns: [{ key: 'customerName', label: 'Customer' }, { key: 'lastVisit', label: 'Last visit' }], rows: atRisk, truncated: atRiskTruncated }),
      detailSection<NewCustomerRow>({ title: 'New Customers This Period', columns: [{ key: 'customerName', label: 'Customer' }, { key: 'createdAt', label: 'Joined' }, { key: 'revenueUsd', label: 'Revenue (this period)' }], rows: newCustomers, truncated: newCustomersTruncated }),
    ],
  }
}

REPORT_DEFINITIONS['top-customers'] = { id: 'top-customers', name: 'Top Customers Report', cadenceHint: 'monthly', compute: computeTopCustomersReport }
