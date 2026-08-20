// WAFI-147B. The canonical period-boundary computation, client side. Must
// implement the EXACT same rule as the server's _wafi147b_expected_period
// (supabase/migrations/102_wafi147b_generate_report_snapshot.sql) -- neither
// side may invent its own notion of "week" or "month" independent of the
// design spec's Period semantics. Verified against the server via
// cross-runtime parity tests (Task 11), not via shared code -- PL/pgSQL and
// TypeScript are different runtimes and cannot literally share a function.
import type { ReportId } from './report.types'

const DAILY: ReportId[] = ['daily-closing', 'cash-flow']
const WEEKLY: ReportId[] = ['weekly-summary', 'inventory-health', 'discount-report', 'returns-report', 'credit-report', 'dead-stock']
const MONTHLY: ReportId[] = ['monthly-health', 'profit-trend', 'top-customers', 'top-products']

function cadenceFor(reportId: ReportId): 'daily' | 'weekly' | 'monthly' {
  if (DAILY.includes(reportId)) return 'daily'
  if (WEEKLY.includes(reportId)) return 'weekly'
  if (MONTHLY.includes(reportId)) return 'monthly'
  throw new Error(`${reportId} has no wall-clock cadence (not a 147B-scheduled report type)`)
}

export function expectedPeriodUtc(reportId: ReportId, scheduledFor: Date): { periodStart: Date; periodEnd: Date } {
  const cadence = cadenceFor(reportId)
  const s = scheduledFor

  if (cadence === 'daily') {
    const periodEnd = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()))
    const periodStart = new Date(periodEnd.getTime() - 24 * 60 * 60 * 1000)
    return { periodStart, periodEnd }
  }

  if (cadence === 'weekly') {
    // The COMPLETED Mon-Sun week that ended the day before the trigger day
    // (not the week containing the trigger day) -- 13 days before the
    // trigger's own midnight through 6 days before it. E.g. scheduledFor =
    // 2026-08-23 (Sunday) -> [2026-08-10, 2026-08-17), matching the server's
    // _wafi147b_expected_period exactly (cross-runtime parity, Task 12).
    const dayStart = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()))
    const periodStart = new Date(dayStart.getTime() - 13 * 24 * 60 * 60 * 1000)
    const periodEnd = new Date(dayStart.getTime() - 6 * 24 * 60 * 60 * 1000)
    return { periodStart, periodEnd }
  }

  // monthly
  const periodEnd = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1))
  const periodStart = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() - 1, 1))
  return { periodStart, periodEnd }
}
