// WAFI-147A: the canonical catalogue of report types. NOT a promise that a
// report's compute() implementation is reusable by a future server-side
// scheduler (147B) -- see design spec S3. Each report definition file
// (Tasks 6-18) adds its own entry here.
//
// NOTE on duplicate-key safety: Record<ReportId, ReportDefinition> gives
// compile-time KEY validity (a typo'd id fails to compile) -- it does NOT give
// compile-time duplicate-registration detection. Two files both assigning
// REPORT_DEFINITIONS['daily-closing'] = ... both compile; whichever import
// runs last silently wins at runtime. The registration barrel (Task 21,
// src/features/reports/index.ts) is the single reviewable place new report
// ids get added specifically so a duplicate is visible in one file's diff --
// this is a process safeguard, not a type-system guarantee.
import type { Report, ReportId, ReportContext, ReportDateRange } from './report.types'

export interface ReportDefinition {
  id: ReportId
  name: string
  /** Display/UX metadata only -- does NOT determine execution, scheduling,
   *  eligibility, or availability. Scheduling is 147B's problem entirely.
   *  Task 0 P0 finding 4: this is PURELY descriptive -- ReportDetailPage
   *  (Task 21) must never branch on cadenceHint to decide what context a
   *  report needs. That's contextRequirement's job, below. */
  cadenceHint: 'per-shift' | 'daily' | 'weekly' | 'monthly'
  /** What ReportDetailPage must collect before calling compute(). Absent
   *  (undefined) means only (shopId, range) is needed -- the common case.
   *  'staff' means compute() requires context.staffId (currently only
   *  Employee Summary) -- the page must show a staff selector and withhold
   *  compute() until one is chosen. This is a real, checkable invocation
   *  contract, not inferred from cadenceHint or any other unrelated field. */
  contextRequirement?: 'staff'
  compute: (shopId: string, range: ReportDateRange, context?: ReportContext) => Promise<Report>
}

export const REPORT_DEFINITIONS: Record<ReportId, ReportDefinition> = {} as Record<ReportId, ReportDefinition>
