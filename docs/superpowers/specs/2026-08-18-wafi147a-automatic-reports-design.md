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
- The 5 shared aggregation primitives (§9.3) + new report-specific aggregation where no primitive fits
- The report registry
- On-demand generation, lazy per selected report: opening the Reports list must only read the registry
  (id/name/cadenceHint metadata) to render the catalogue — `compute()` runs only for the one report the owner
  actually opens, never all 13 eagerly on list load. Several `compute()` implementations run genuinely expensive
  aggregation (top-N ranking, inventory turnover, cash reconciliation); triggering all of them from the list
  screen would defeat the entire "on-demand" framing and make opening the Reports page itself slow.
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
type ReportColumn = {
  key: string
  label: string
  /** Presentation hint only — the UI stays generic/"dumb," row values are always the real typed
   *  data (numbers, ISO date strings, etc.), never pre-formatted strings. `currency-usd` (not the
   *  generic `currency`) because WAFI is dual-currency and a future column may need `currency-syp`. */
  format?: 'text' | 'number' | 'currency-usd' | 'percent' | 'date'
  align?: 'start' | 'center' | 'end'
}
type DetailSection = {
  type: 'detail'
  title: string
  columns: ReportColumn[]
  rows: object[]
  /** True when the underlying query applied a hard row cap and more rows existed than were
   *  materialized (e.g. Dead Stock's `LIMIT 500`). Reports already capped at a small fixed N
   *  (e.g. Top Customers' `LIMIT 20`) never set this — the cap IS the full intended result, not a
   *  truncation. No `totalRowCount`: that requires a second COUNT(*) query per section and a
   *  pagination concept 147A doesn't otherwise have. The UI shows a "showing first N results"
   *  notice when `truncated` is true, nothing more precise. */
  truncated?: boolean
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
  /** context is optional and only Employee Summary reads it — see §9.1/§9.2. */
  compute: (shopId: string, range: ReportDateRange, context?: ReportContext) => Promise<Report>
}

const REPORT_DEFINITIONS: Record<ReportId, ReportDefinition> = { /* ... */ }
```

A keyed map is used because "get report by id" is the common operation the Reports UI performs. `ReportId`
provides compile-time validation of the allowed keys, but duplicate side-effect registration is a runtime/process
concern rather than something TypeScript prevents. `Object.values(REPORT_DEFINITIONS)` covers the list case.

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

From the report×dimension analysis (2026-08-18): five primitives (§9.3) cover most of the scalar/rollup work;
several domains still need genuinely new aggregation with no shared shape between them (do not force a common
abstraction over these — they don't share a computation shape, only a rough time-window shape).

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
   query, not new data). Every report that uses this primitive passes `range.to` as `asOfDate`, currently Weekly
   Summary and Credit Report. A live "what's owed right now" view (e.g. the existing Money Owed page, if it ever adopts this
   primitive) would pass today's date, which is just `asOfDate = range.to` where `range.to` happens to be today
   — the same function, no special-casing needed.

**Report-by-report section shape and computation source** (S = summary section, D = detail section):

| # | Report | Sections | Computation |
|---|---|---|---|
| 1 | Daily Closing | S(totals, cash recon, expenses) + D(top 5 products, staff performance) | primitive 1 + 2, new: cash reconciliation query, top-N products query |
| 2 | Weekly Summary | S(revenue/profit/expenses, WoW) + D(staff ranking, inventory changes) | primitive 1 + 2, new: inventory-change delta query |
| 3 | Monthly Health | S(P&L, inventory valuation) + D(top 10 products, top 10 customers, staff review) | primitive 1 + 2 + 3, new: top-N products/customers, inventory valuation |
| 4 | Employee Summary | S only (sales/basket/discounts/returns/variance/hours, single staff) | primitive 2, new: cash variance + hours-worked from shift ledger |
| 5 | Inventory Health | S(current snapshot: inventory value/turnover) + D(low stock, fast/slow movers, dead stock) | primitive 5 (dead stock) + `useDeadStockReport.ts`; new: turnover rate, low-stock, fast/slow classification |
| 6 | Discount Report | S(total) + D(by staff, by product, below-cost list) | primitive 2 (staff cut), new: by-product discount aggregation |
| 7 | Returns Report | S(total count/value) + D(by staff, by product, by reason) | primitive 2 (staff cut), new: by-product/by-reason returns aggregation |
| 8 | Credit Report | S(outstanding/new debt) + D(overdue accounts, risk distribution) | primitive 3, new: risk-score distribution |
| 9 | Cash Flow | S only (cash in/out/net, drawer reconciliation) | new: cash-movement + shift ledger aggregation (shared with #1) |
| 10 | Profit Trend | D only (daily revenue/profit series) | primitive 1 (daily series) + 2 |
| 11 | Top Customers | D only (top 20 revenue, top 20 visits, at-risk, new customers) | primitive 3, new: visits ranking, at-risk/new-customer queries |
| 12 | Top Products | D only (top 20 by revenue/qty/profit, most discounted, most returned) | new: product-level profit+discount+returns joins (no existing primitive) |
| 13 | Dead Stock | S(capital tied up) + D(dead-stock rows) | primitive 5 + `useDeadStockReport.ts` covers the core |

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
must implement the identical semantic invariant already used throughout this codebase — an inclusive
`[from, to]` device-local calendar-day range (see `useAnomalyDetection.ts`'s `DATE(created_at, 'localtime')`,
`useDailyDigest.ts`, `profit_cache`'s day bucketing) — and must never mix UTC truncation with local-date
filtering within the same report or across reports. This is a semantic requirement, not a mandated SQL
technique: `DATE(created_at, 'localtime') BETWEEN ? AND ?` is one valid implementation, but
`created_at >= ? AND created_at < ?` against pre-computed local range boundaries is equally valid and may be
more efficient against an indexed `created_at` column (a `DATE(...)` wrapper on the column defeats a plain
index) — whichever technique a given query uses, it must produce identical results to the others for the same
nominal calendar day, and the integration tests should assert that explicitly (e.g. a fixture straddling a
local-day boundary near UTC midnight), not just assert "produces a number." A report whose date math silently
disagrees with `useDailyDigest.ts`'s "today" for the same nominal calendar day is a correctness bug.

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
type shell, (2) the shared primitives (§9.3), (3) the registry with an empty map, (4) each report definition in the
build order from §4 — each one task-reviewable independently since they don't depend on each other, only on the
shell and whichever primitives they use, (5) the two presentation components + a Reports list page (registry
metadata only, no `compute()` calls) + a per-report page/route that lazily calls `compute()` for the one
selected report, (6) route/nav wiring reusing the existing `/reports` permission pattern.

## 8. Confirmed De-Scopes (2026-08-18, post-plan-review)

Checked against the actual codebase during implementation planning — these fields from the original 13-report
spec (`WAFI_Event_Driven_Platform_Plan_v1.md:639-786`) are genuinely absent from this codebase's data model, not
merely inconvenient to build. This is the authoritative final scope for the reports named; do not re-add these
speculatively:

- **Profit Trend:** no "profit by product category" (no product-category cost attribution exists) and no "profit
  vs. target" (no target/goal concept exists anywhere).
- **Top Customers:** no "top 20 by loyalty" (no loyalty/points system exists; CLAUDE.md places loyalty in v1.5).
- **Inventory Health:** no "shrinkage summary" (no reconciled expected-vs-counted shrinkage mechanism exists).
- **Dead Stock:** no "suggested actions" (a business-rules/product decision, not a data query — candidate for a
  future WAFI-156 rule, not fabricated here).
- **Credit Report:** no "average collection time" in v1 of this report (derivable from
  `CustomerAgingRow.lastPaymentDate` as a documented follow-up, not built in this pass).
- **Top Products "Profit":** gross sale-line profit, NOT net of returns — netting would require joining each
  returned unit back to its original sale's cost via the same cost-lookup pattern `getStaffMetrics` already uses
  for per-staff return-COGS, a separate piece of work deliberately not duplicated here. The report's own section
  title says "gross, not net of returns" so this is never silently ambiguous.
- **Top Products "Most Returned":** units returned (`SUM(qty_returned)`), not return-transaction count.

## 9. Amendments from implementation planning (2026-08-18)

The implementation plan's own review process (two rounds) surfaced several real design gaps this spec did not
originally cover. Recorded here so spec and plan do not diverge going into execution — these are not
afterthoughts bolted onto the plan; they are now part of this design.

### 9.1 `ReportContext` — the third `compute()` parameter

§3's `ReportDefinition.compute` signature is actually `(shopId: string, range: ReportDateRange, context?:
ReportContext) => Promise<Report>`, where:

```ts
type ReportContext = { staffId?: string }
```

Employee Summary is the only report needing anything beyond `(shopId, range)` — it requires a specific staff
member. Rather than a special-cased signature or a throwing stub for that one report, every `ReportDefinition`
carries the same three-parameter shape; reports that don't need `context` simply never read it. Absent
`context.staffId`, Employee Summary's `compute()` returns an explicit "not selected" `Report` (one
`SummarySection` saying so) — never an exception. `contextRequirement?: 'staff'` (§9.2) is the companion field
that tells the UI *when* to collect this before calling `compute()`.

### 9.2 `contextRequirement` — decoupled from `cadenceHint`

`cadenceHint: 'per-shift' | 'daily' | 'weekly' | 'monthly'` remains purely descriptive metadata — it selects a
sensible default date range (§9.4) and labels the report in the UI, and must never be branched on to decide
what invocation context a report needs. That is `contextRequirement?: 'staff'`'s job: when present, the Reports
UI must collect a staff selection (and gate the entire report — §9.5 below) before ever calling `compute()`.
Currently only Employee Summary sets this.

### 9.3 Five shared primitives, not three

The original §3 primitives list undercounted by two, found necessary during planning:

1. `readProfitCache(shopId, range)` — unchanged from the original draft.
2. `getStaffMetrics(shopId, range)` — unchanged, generalized from `useStaffPerformanceMetrics.ts`, extended with
   `returnRevenueUsd`/`returnCount` per staff (needed by Returns Report's "By Staff" section — see below).
3. `getCustomerAgingSnapshot(shopId, asOfDate)` — unchanged, as-of-date semantics per this spec's original §2
   correction.
4. **`readShiftCashReconciliation(shopId, range)`** — new. Daily Closing's and Cash Flow's cash-reconciliation
   figures must come from `cashier_shifts.z_report_data`, an immutable snapshot of `ZReportMetrics`
   (`src/features/shifts/shift.types.ts`) already captured by this app's own verified `computeCashReconciliation`
   engine at shift-close time. An independently reconstructed equation (`expected = opening + revenue -
   expenses`) omits credit-payment collection, refunds, and mid-shift pay-in/pay-out movements — a real
   correctness bug, not a simplification. This primitive throws (naming the shift and the missing/invalid field)
   on unparseable JSON or a missing/non-finite required field — a financial primitive must fail loudly on
   malformed data, never silently produce a wrong number by treating it as zero. A genuinely absent (`NULL`)
   `z_report_data` on a legacy pre-this-feature shift is the one tolerated case, contributing zero, not an error.
5. **`queryDeadStockRows(shopId, thresholdDays)`** — new. Shared by Inventory Health's Dead Stock section and
   the dedicated Dead Stock report — a primitive used by two report definitions belongs in `primitives/`, not
   inside one of its own consumers.

### 9.4 Rolling cadence ranges, decided explicitly

`cadenceHint` maps to a default `ReportDateRange` as follows, and this mapping lives in exactly one place (the
Reports UI, never inside a report definition): `'daily'` → today only. `'weekly'` → the last 7 calendar days
ending today (a rolling window, not the current Sunday-to-Sunday week — a report opened mid-week should show a
meaningful trailing week). `'monthly'` → the last 30 calendar days ending today (same rolling-window rationale,
not the current calendar month). `'per-shift'` → today only, further narrowed to one staff member via
`ReportContext.staffId`.

### 9.5 `SectionVisibility` and whole-report gating

Extending §2's `ReportSection` union, every section carries `visibility: 'shop' | 'staff'` (defaulting to
`'shop'` via the `summarySection()`/`detailSection()` helpers, so most call sites need no change):

```ts
type SectionVisibility = 'shop' | 'staff'
```

`'staff'` marks a section as identifying an individual staff member's figures — the staff-ranking sections in
Weekly Summary/Monthly Health/Daily Closing, the staff-cut sections in Discount Report/Returns Report, and
Employee Summary's entire content. At render time, the Reports UI filters `report.sections` by
`visibility === 'shop' || canUserDo(activeStaff, 'can_view_staff_performance')` — the same structurally-owner-only
flag WAFI-018 established for `/reports/staff`. This is section-level filtering for composite reports (Weekly
Summary renders normally minus its staff-ranking section for an unpermitted viewer), distinct from **whole-report
gating** for any report whose `contextRequirement === 'staff'` (currently only Employee Summary): an unpermitted
viewer reaches neither the staff selector nor a `compute()` call for that report at all, since its entire purpose
is staff-identifying and there is no meaningful shop-level remainder to show. Per §5, this remains UI/report
visibility, not a new data-security boundary — 147A introduces no new sync surface or server read path.

### 9.6 Current-snapshot labeling

Any metric built from `products.current_stock`/`cost_price_usd` (inventory valuation, dead stock, low-stock
alerts, turnover rate) reflects today's live point-in-time state, not a value scoped to `range` — every such
section's title says so explicitly (e.g. "Inventory Overview (current snapshot)"). Top Customers' at-risk section
is a related but distinct case: it reflects the report-end point-in-time status, not a period aggregate — bound
to `range.to`, not literally "today" — so its title reads "At-Risk Customers (no visit in 60 days as of report
end)" rather than "(current snapshot)". A Monthly Health report for last month legitimately contains today's
inventory valuation, but must never present that figure as if it were last month's.
