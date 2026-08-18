# WAFI-147A — Report Generation & On-Demand Reports Design

> Split off from WAFI-147 (Automatic Reports) after a 2026-08-18 investigation found the ticket bundled three
> independent capabilities. See `WAFI_Production_Readiness_Plan_v3.md`'s Macro-Phase 3 status row for the full
> evidence trail. This spec covers **147A only**.

## 1. Problem, scope, and what this explicitly is not

**The 13 reports themselves are a real, specified product requirement** — full field lists, cadence, and delivery
intent already exist in `WAFI_Event_Driven_Platform_Plan_v1.md:639-786`. What is NOT real today, verified by
investigation, is the word "Automatic" in the original ticket title:

- **Wall-clock scheduling** (generate at midnight / Sunday 9am / 1st-of-month 9am, independent of the app being
  open) does not exist anywhere in this architecture. WAFI-154's `local_deferred_jobs` queue is local-only,
  drained on app-foreground/reconnect — a fundamentally different guarantee. No `pg_cron`, no Supabase Edge
  Functions, no server-side scheduled-job mechanism exists at all.
- **Automated delivery** does not exist. Every WhatsApp touchpoint (`whatsapp.ts`, `useDailyDigest.ts`,
  `useSendStatement.ts`) is a `wa.me` deep link requiring a human tap; there is no send API.

147A is scoped to the one capability that's genuinely buildable today: **generate any of the 13 reports on
demand, from already-synced local data, and present them in the app.** Scheduling (147B) and automated delivery
(147C) are separate, later tickets that block on infrastructure/product decisions outside this spec's scope.

**In scope:**
- The `Report`/`ReportSection` output contract
- All 13 report definitions (`compute()` functions)
- The 3 proven shared aggregation primitives + new report-specific aggregation where no primitive fits
- The report registry
- On-demand generation triggered by opening the Reports UI
- Reports UI: list, view, loading/error/empty states
- Authorization appropriate to report data
- Tests for each report's computation

**Explicitly out of scope (do not build speculatively):**
- Wall-clock scheduling of any kind (147B)
- Background/unattended execution while the app is closed (147B)
- Automatic WhatsApp/email delivery, WhatsApp Business API integration (147C)
- A generic export abstraction (PDF/Excel) — a report is exportable in principle once `Report` exists, but
  building the export mechanism is a later consumer's problem, not this spec's, unless a specific report's own
  definition-of-done requires it
- A "report engine," query planner, or generic metric registry — 13 reports do not justify one

## 2. Report output contract

```ts
type ReportDateRange = {
  /** Device-local calendar date, YYYY-MM-DD, inclusive. */
  from: string
  /** Device-local calendar date, YYYY-MM-DD, inclusive. */
  to: string
}

type Report = {
  id: ReportId
  name: string
  dateRange: ReportDateRange
  generatedAt: string // ISO timestamp, device clock
  sections: ReportSection[]
}

type ReportSection = SummarySection | DetailSection

type SummarySection = {
  type: 'summary'
  title: string
  metrics: ReportMetric[]
}
type ReportMetric = { label: string; value: string | number; unit?: string }

// Runtime shape: no phantom generic threaded through Report/ReportSection. A single Report's
// sections array legitimately mixes DetailSection<TopProductRow> and DetailSection<StaffPerformanceRow>
// simultaneously, which a generic on the union itself cannot express without an `unknown`
// escape hatch — exactly the "GenericTableRow" outcome this design set out to avoid. Row typing
// instead lives at construction time, not at the stored/serialized shape.
type ReportColumn = { key: string; label: string }
type DetailSection = {
  type: 'detail'
  title: string
  columns: ReportColumn[]
  rows: object[]
}

/** The only place row typing is checked. Each report definition calls this with its own Row
 *  type; `columns` is checked against that Row's actual keys at compile time, then normalized
 *  into the plain runtime DetailSection shape above. */
function detailSection<Row extends object>(args: {
  title: string
  columns: { key: keyof Row; label: string }[]
  rows: Row[]
}): DetailSection {
  return {
    type: 'detail',
    title: args.title,
    columns: args.columns.map((c) => ({ key: String(c.key), label: c.label })),
    rows: args.rows,
  }
}
```

**Why the union lives at the section level, not the report level:** field-by-field review of all 13 reports (§4)
showed most are composite — Daily Closing alone needs 3 summary sections (totals, cash reconciliation, expenses)
and 2 detail sections (top 5 products, staff performance) in one report the owner experiences as a single
artifact. A report-level `SummaryReport | DetailReport` union would force a composite report to either drop half
its own data or fragment into artificial sibling reports requiring an external composition mechanism. The union
belongs where the actual shape boundary is: individual sections, not whole reports. The union is available per
section, not mandatory across a report — a report may be all-summary (Cash Flow), all-detail (Top Customers), or
mixed (Daily Closing).

**Row types stay local to each report's own file** (`TopCustomerRow`, `DeadStockRow`, `StaffPerformanceRow`,
etc., defined in `definitions/topCustomers.ts` etc.) — never centralized into a `GenericTableRow`/
`Record<string, unknown>` shape. Compile-time checking happens at `detailSection<Row>()`'s call site (each
report definition's own module); the resulting `Report` object itself is a plain, generic-free, serializable
structure, since one `Report`'s `sections` legitimately mixes multiple different row types at once and a
generic threaded onto `DetailSection` itself can't express that without an `unknown` fallback.

**Date range semantics:** `[from, to]` inclusive, both device-local calendar dates (`YYYY-MM-DD`), matching this
codebase's existing `DATE(created_at, 'localtime')` convention used throughout (`useAnomalyDetection.ts`,
`useDailyDigest.ts`, `profit_cache`'s own day bucketing) — device timezone, not a shop-business-timezone field,
since `shops.timezone` defaults to UTC and nothing in this codebase reliably sets it yet (the same known,
deliberately-accepted limitation WAFI-151's final review already documented, not a new gap introduced here).
Report definitions must use this exact convention for day-boundary queries so a report's numbers agree with
every other client-side computation that already uses it (`useDailyDigest.ts`'s "today," the dashboard's
period toggle, etc.) — inventing a different boundary convention here would create numbers that silently
disagree with the rest of the app for the same nominal day.

## 3. Report definitions and the registry

```ts
type ReportId =
  | 'daily-closing' | 'weekly-summary' | 'monthly-health' | 'employee-summary'
  | 'inventory-health' | 'discount-report' | 'returns-report' | 'credit-report'
  | 'cash-flow' | 'profit-trend' | 'top-customers' | 'top-products' | 'dead-stock'

type ReportDefinition = {
  id: ReportId
  name: string
  /** Display/UX hint only — the cadence a shop owner would naturally expect this report at.
   *  Does NOT determine execution, scheduling, eligibility, or availability. Scheduling is
   *  147B's problem entirely; this field exists so the Reports UI can group/label reports,
   *  nothing more. */
  cadenceHint: 'per-shift' | 'daily' | 'weekly' | 'monthly'
  compute: (shopId: string, range: ReportDateRange) => Promise<Report>
}

const REPORT_DEFINITIONS: Record<ReportId, ReportDefinition> = { /* ... */ }
```

A keyed map, not an array — "get report by id" is the common operation the Reports UI actually performs
(list → pick one → generate), and a keyed structure makes a duplicate `ReportId` a compile-time impossibility
rather than a runtime bug to discover. `Object.values(REPORT_DEFINITIONS)` covers the list case.

**A report definition is a plain function, not a declarative model.** `compute()` is free to run whatever SQL or
call whatever composables it needs internally — exactly like `useDailyDigest.ts` does today. No `ReportEngine`,
`QueryPlanner`, or `MetricRegistry`: 13 reports do not justify that machinery, and the existing codebase already
proves flat per-feature composables scale fine at this count.

**Important boundary the registry does NOT promise:** the registry is the canonical catalogue of report types —
what reports exist, their id, name, and cadence hint. It is **not** a promise that `compute()`'s implementation
is directly reusable by a future server-side scheduler (147B). 147A's `compute()` functions are free to be
client-oriented (calling `db`/PowerSync/Vue composables directly), because 147A only ever runs inside the app.
147B, whenever it exists, will very likely run in a different environment (Postgres/Edge Function) that cannot
import Vue or Dexie-adjacent client code. When unattended execution is designed, shared computation should be
extracted at that point, for the specific primitives that genuinely need to run server-side — not assumed now.
Making this promise today would smuggle a scheduling-environment requirement into a ticket explicitly scoped to
exclude scheduling.

## 4. The 13 reports, mapped

From the report×dimension analysis (2026-08-18): three primitives cover most of the scalar/rollup work; five to
six domains need genuinely new aggregation with no shared shape between them (do not force a common abstraction
over these — they don't share a computation shape, only a rough time-window shape).

**Shared primitives (build/generalize once, reuse across reports):**
1. `readProfitCache(shopId, range)` — thin wrapper over the existing `profit_cache` table (WAFI-153, already
   built): revenue/cogs/expenses/discount/refunds per day. Feeds Daily Closing, Weekly Summary, Monthly Health,
   Cash Flow, Profit Trend.
2. `getStaffMetrics(shopId, range)` — generalize `useStaffPerformanceMetrics.ts`'s existing date-range logic
   (already does per-staff revenue/margin/discount/returns) into a plain reusable function, not a Vue-bound
   composable. Feeds Weekly/Monthly/Employee Summary and the staff-cut of Discount/Returns reports.
3. `getCustomerAgingSnapshot(shopId, asOfDate)` — **as-of-date, not current-state.** Consolidates the AR balance
   formula currently duplicated identically in `customer.service.ts`, `creditDebtors.ts`, and other call sites,
   but with a real semantic change: the existing formula (`sales.total_usd - SUM(customer_payments.amount_usd)
   - SUM(returns.refund_amount_usd)`, see `customer.service.ts`) has no date boundary at all — it always means
   "balance right now." A Weekly Summary for Aug 3-9 or a Credit Report for last month must not report today's
   (Aug 18's) live balance as if it were the period's balance — that would silently misreport every historical
   report. The primitive therefore takes `asOfDate` and adds `AND created_at <= asOfDate` to the existing
   payments/returns sums (both tables already carry `created_at`, so this is a filter addition to the existing
   query, not new data). Every report using this primitive passes `range.to` as `asOfDate` — an explicit
   as-of-period-end snapshot, consistent across Weekly Summary, Monthly Health, Credit Report, and Top
   Customers. A live "what's owed right now" view (e.g. the existing Money Owed page, if it ever adopts this
   primitive) would pass today's date, which is just `asOfDate = range.to` where `range.to` happens to be today
   — the same function, no special-casing needed.

**Report-by-report section shape and computation source** (S = summary section, D = detail section):

| # | Report | Sections | Computation |
|---|---|---|---|
| 1 | Daily Closing | S(totals, cash recon, expenses) + D(top 5 products, staff performance) | primitive 1 + 2, new: cash reconciliation query, top-N products query |
| 2 | Weekly Summary | S(revenue/profit/expenses, WoW) + D(staff ranking, inventory changes) | primitive 1 + 2, new: inventory-change delta query |
| 3 | Monthly Health | S(P&L, inventory valuation) + D(top 10 products, top 10 customers, staff review) | primitive 1 + 2 + 3, new: top-N products/customers, inventory valuation |
| 4 | Employee Summary | S only (sales/basket/discounts/returns/variance/hours, single staff) | primitive 2, new: cash variance + hours-worked from shift ledger |
| 5 | Inventory Health | S(turnover rate, shrinkage) + D(dead stock, fast/slow movers) | `useDeadStockReport.ts` covers dead-stock core; new: turnover rate, shrinkage, fast/slow classification |
| 6 | Discount Report | S(total) + D(by staff, by product, below-cost list) | primitive 2 (staff cut), new: by-product discount aggregation |
| 7 | Returns Report | S(total count/value) + D(by staff, by product, by reason) | primitive 2 (staff cut), new: by-product/by-reason returns aggregation |
| 8 | Credit Report | S(outstanding/new debt/payments) + D(overdue accounts, risk distribution) | primitive 3, new: risk-score distribution, average collection time |
| 9 | Cash Flow | S only (cash in/out/net, drawer reconciliation) | new: cash-movement + shift ledger aggregation (shared with #1) |
| 10 | Profit Trend | D only (daily series, by category, by staff, by day-of-week, vs. target) | primitive 1 (daily series) + 2, new: by-category, vs.-target |
| 11 | Top Customers | D only (top 20 by revenue/visits/loyalty, at-risk, new) | primitive 3, new: visits/loyalty ranking, at-risk/new-customer queries |
| 12 | Top Products | D only (top 20 by revenue/qty/profit, most discounted, most returned) | new: product-level profit+discount+returns joins (no existing primitive) |
| 13 | Dead Stock | S(capital tied up) + D(rows, suggested actions) | `useDeadStockReport.ts` covers the core |

**Recommended build order** (cheapest/highest-leverage first, from the primitives pass): Daily Closing (
`useDailyDigest.ts` already covers ~60% of its summary sections) → Cash Flow (shares the same ledger work as
#1) → Weekly Summary + Profit Trend (pure `profit_cache` reads) → Employee Summary → Discount Report + Returns
Report (share a query shape) → Credit Report + Top Customers (share primitive 3 once built) → Top Products
(genuinely new) → Inventory Health + Dead Stock (`useDeadStockReport.ts` covers the core) → Monthly Health last
(a rollup of nearly everything above, cheapest once its dependencies exist).

## 5. Authorization

**This section describes UI/report visibility, not a data-security boundary.** `can_view_staff_performance`
controls which reports/sections render in the application, consistent with the existing `/reports/staff` UX —
it is not a new database/RLS boundary, and cannot be one: 147A introduces no new sync surface or server read
path, only computation over data already present on the device. A staff member who already has the underlying
`sales`/`sale_line_items`/etc. rows synced locally could in principle inspect them outside this UI regardless of
what any report gates; that is an existing property of this offline-first architecture, not something 147A
changes or is responsible for fixing.

Reuse the existing `/reports` route's gating exactly (`meta: { permission: 'can_view_reports', feature:
'reporting_pack' }`) for the Reports list/index and every report that only shows shop-aggregate figures — no new
permission flag needed for those. **Employee Summary, and the staff-ranking sections within Weekly Summary and
Monthly Health, and the staff-cut sections within Discount Report and Returns Report** must additionally require
`can_view_staff_performance` — the same structurally-owner-only flag WAFI-018 established for `/reports/staff`
(never grantable to a manager/cashier via `permissionsForRole`) — since per-employee figures create the same
shop-floor-friction risk that flag already exists to prevent. (Top Customers is explicitly NOT in this list —
it identifies customers, not staff, and needs no additional gating beyond `can_view_reports`.) Concretely:
**whole-report gating** for Employee Summary, where staff identification is the report's entire purpose (a
`can_view_staff_performance`-gated staff member simply never sees that report in the list at all, same as
`/reports/staff` today); **section-level omission** for the composite reports named above (Weekly Summary/
Monthly Health render normally minus their staff-ranking `DetailSection`, Discount/Returns Reports render
normally minus their staff-cut section, for a viewer without the flag, rather than hiding the whole report over
one section). Enforce both at the report definition/UI level.

## 6. Testing

Two layers, not one — mocking `db` proves a report definition calls the right functions with the right
arguments, but cannot validate actual SQL semantics (date-boundary correctness, join correctness, aggregation
correctness), and several of these queries are exactly where that risk concentrates: date boundaries, returns
joins, discount/returns-by-product aggregation, inventory calculations, cash reconciliation, the customer-aging
as-of-date filter, and top-N ranking.

1. **Unit tests, one file per report definition** (`definitions/__tests__/dailyClosing.test.ts` etc.), asserting
   the computed `Report`'s section structure and specific values against a mocked `db` — following this
   codebase's existing pattern (`vi.mock('@/data/powersync/db', ...)`, `src/__tests__/__mocks__/db.ts`). This
   layer validates report assembly (which sections, which primitives get called, correct wiring), not SQL
   correctness.
2. **Integration tests against a real SQLite database, for the shared primitives and the high-risk aggregation
   queries only** (not all 13 report definitions) — extending the existing real-SQLite harness pattern
   (`src/__tests__/helpers/realSqliteDb.ts`, Node's built-in `node:sqlite`, already used for WAFI-154's
   deferred-jobs tests) to seed the relevant tables (`sales`, `sale_line_items`, `customer_payments`, `returns`,
   `products`, etc.) and assert real query output against hand-computed expected values. This is where
   `readProfitCache`, `getStaffMetrics`, `getCustomerAgingSnapshot`'s as-of-date filter, and any report's
   genuinely new aggregation (returns-by-product, discount-by-product, top-N ranking, inventory turnover, cash
   reconciliation) get validated for real, once each — not 13 integration suites, one per genuinely distinct
   query pattern.

**Implementation rule, enforced by the integration layer above:** every report query's date-boundary filtering
must use the same inclusive local-calendar-day interpretation already used throughout this codebase
(`DATE(created_at, 'localtime')` or equivalent — see `useAnomalyDetection.ts`, `useDailyDigest.ts`, `profit_cache`'s
day bucketing) and must never mix UTC truncation with local-date filtering within the same report or across
reports. A report whose date math silently disagrees with `useDailyDigest.ts`'s "today" for the same nominal
calendar day is a correctness bug, not a rounding difference — the integration tests should assert this
explicitly for every date-bounded query, not just assert "produces a number."

## Cross-Epic Edge-Case Checklist (design time)

```
Domains touched: Sales, Returns, Inventory, Staff, Customer Credit, Cash/Shifts, Products/Cost, Expenses
Matrix rows consulted: Sales, Returns, Inventory, Cash/Shifts, Customer Credit, Staff, Products/Cost, Expenses
  (all existing rows in AI_PRINCIPAL_ENGINEER_REVIEW.md's Domain Interaction Matrix) — no new domain row needed,
  147A is a pure read-side consumer of all of them, introducing no new writes or new tables.
Open cross-feature questions: whether report-level authorization (S5) needs a finer-grained flag than
  can_view_staff_performance if a future report exposes something more sensitive than staff ranking — not
  currently the case for any of the 13 reports as specified, revisit only if a report's scope changes.
```

## 7. What comes after this spec

An implementation plan (via `superpowers:writing-plans`) should sequence: (1) the `Report`/`ReportSection`
type shell, (2) the 3 shared primitives, (3) the registry with an empty map, (4) each report definition in the
build order from §4 — each one task-reviewable independently since they don't depend on each other, only on the
shell and whichever primitives they use, (5) the two presentation components + Reports page, (6) route/nav
wiring reusing the existing `/reports` permission pattern.
