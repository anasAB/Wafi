// WAFI-147A: the report output contract. See design spec S2 for the full rationale
// behind the section-level (not report-level) SummarySection|DetailSection union.

export type ReportDateRange = {
  /** Device-local calendar date, YYYY-MM-DD, inclusive. */
  from: string
  /** Device-local calendar date, YYYY-MM-DD, inclusive. */
  to: string
}

export type ReportMetric = { label: string; value: string | number; unit?: string }

/** 'staff' means "identifies an individual staff member's figures" -- gated by
 *  can_view_staff_performance at render time (see ReportDetailPage, Task 21),
 *  the same structurally-owner-only flag WAFI-018 established for
 *  /reports/staff. Defaults to 'shop' (every existing call site that doesn't
 *  pass this stays correct with no change) -- only the handful of genuinely
 *  staff-identifying sections (Task 0 P0 finding 2) pass 'staff' explicitly. */
export type SectionVisibility = 'shop' | 'staff'

export type SummarySection = {
  type: 'summary'
  title: string
  metrics: ReportMetric[]
  visibility: SectionVisibility
}

/** format/align are presentation hints only -- the UI stays generic, row values are always
 *  real typed data (numbers, ISO date strings), never pre-formatted strings. `currency-usd`
 *  (not generic `currency`) since WAFI is dual-currency and a future column may need
 *  `currency-syp`. */
export type ReportColumn = {
  key: string
  label: string
  format?: 'text' | 'number' | 'currency-usd' | 'percent' | 'date'
  align?: 'start' | 'center' | 'end'
}

/** Plain, generic-free runtime shape -- a single Report's sections legitimately mix
 *  DetailSection built from different Row types at once, which a generic on this type
 *  itself cannot express without an `unknown` escape hatch. Row typing is checked at
 *  detailSection()'s call site instead (see below). */
export type DetailSection = {
  type: 'detail'
  title: string
  columns: ReportColumn[]
  rows: object[]
  visibility: SectionVisibility
  /** True when the underlying query applied a hard row cap and more rows existed than were
   *  materialized (e.g. Dead Stock's LIMIT 500). Reports already capped at a small fixed N
   *  (e.g. Top Customers' LIMIT 20) never set this -- the cap IS the full intended result,
   *  not a truncation. No totalRowCount: that needs a second COUNT(*) per section and a
   *  pagination concept this plan doesn't otherwise have. */
  truncated?: boolean
}

export type ReportSection = SummarySection | DetailSection

// ReportId lives here, not in reportRegistry.ts, so Report.id can be typed as
// ReportId without a circular import (reportRegistry.ts imports Report from this
// file; if ReportId lived there instead, this file would need to import it back).
export type ReportId =
  | 'daily-closing' | 'weekly-summary' | 'monthly-health' | 'employee-summary'
  | 'inventory-health' | 'discount-report' | 'returns-report' | 'credit-report'
  | 'cash-flow' | 'profit-trend' | 'top-customers' | 'top-products' | 'dead-stock'

/** Extra, report-specific invocation context a compute() may need beyond
 *  (shopId, range) -- currently only Employee Summary's staffId. Optional so
 *  every other report's compute() can ignore it entirely; see Task 10. */
export type ReportContext = { staffId?: string }

export type Report = {
  id: ReportId
  name: string
  dateRange: ReportDateRange
  generatedAt: string
  sections: ReportSection[]
}

export function summarySection(args: { title: string; metrics: ReportMetric[]; visibility?: SectionVisibility }): SummarySection {
  return { type: 'summary', title: args.title, metrics: args.metrics, visibility: args.visibility ?? 'shop' }
}

/** The only place row typing is checked. Each report definition calls this with its own
 *  Row type; `columns` is checked against that Row's actual keys at compile time, then
 *  normalized into the plain runtime DetailSection shape. */
export function detailSection<Row extends object>(args: {
  title: string
  columns: { key: keyof Row; label: string; format?: ReportColumn['format']; align?: ReportColumn['align'] }[]
  rows: Row[]
  visibility?: SectionVisibility
  truncated?: boolean
}): DetailSection {
  return {
    type: 'detail',
    title: args.title,
    columns: args.columns.map((c) => ({ key: String(c.key), label: c.label, format: c.format, align: c.align })),
    rows: args.rows,
    visibility: args.visibility ?? 'shop',
    truncated: args.truncated ?? false,
  }
}
