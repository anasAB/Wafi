# Profit Report Screen — Design

> Date: 2026-06-23
> Status: Approved (pending spec review)
> Pack: Reporting (+$5/mo)
> Sacred Rules touched: Arabic + dual currency (2), Offline-first (1)
> Origin: CEO / customer-#0 request — "check each period if I made profit, with a clear chart."

## Problem

The home dashboard answers "how is today/this week/this month." It does **not** let the owner deliberately review *"did I make money over a period, and is it trending up or down?"* — and it stops at Month. The brother (customer #0) asked for this directly, and wants to test it on a weekly/monthly basis rather than wait a quarter.

## Decisions (locked during brainstorming)

1. **Dedicated Reports screen**, filling the existing empty `reports` nav entry (`href: null`, gated by `can_view_reports`) — not crammed into the home dashboard.
2. **Period-flexible:** Week / Month / Quarter **+ custom date range**. (Not quarterly-only — so it's usable/testable within days of real sales.)
3. **Reuse the verified profit engine** (`useDashboardMetrics`, Tier-1-correct). No second profit calculation.
4. **One clear chart** — a profit *trend* (green/red bars over time). No multi-metric/advanced charts.
5. **Focused scope.** Deferred to a tracked **Reports v2**: P&L export/PDF, best-sellers on this screen (home already has it), pre-aggregation (premature optimization), advanced multi-metric charts.

## Architecture

```
/reports  (can_view_reports)
  ┌─ period selector: Week | Month | Quarter | Custom range
  ├─ headline verdict: period profit (green +/red −) + plain Arabic line
  ├─ trend chart: profit per bucket (day for week/month, month for quarter), green/red
  ├─ breakdown: money in (net of refunds) − cost of goods − expenses = profit
  └─ caveat: "X products missing cost — profit may be off"
        ▲ period totals + breakdown ── useDashboardMetrics(start,end)  [reused]
        ▲ trend series ────────────── useProfitTrend(start,end,bucket) [new, same netting shape]
```

## Components

- **`ReportsPage.vue` (or `ProfitReportScreen.vue`)** — the screen. Period selector, headline, chart, breakdown, caveat, empty state.
- **Period selection** — reuse/extend `usePeriodToggle` to add `quarter` and a custom range (start/end). Resolve each period to a `{ start, end }` (local-time dates, matching the Tier-1 boundary).
- **`useDashboardMetrics(start, end)`** — reused for the period's revenue (net of refunds), COGS (with reversal), expenses, profit, and `missingCostCount`. Confirm/extend it to accept an explicit range.
- **`useProfitTrend(start, end, bucket)`** — new composable returning `Array<{ label: string; profitUsd: number }>`, one entry per bucket (`day` or `month`), using the **same refund-netting + restocked-COGS-reversal** SQL shape as `useDashboardMetrics`/`useSalesChart` so the bars sum to the headline.
- **Trend chart component** — reuse the dashboard's existing chart rendering; color each bar by profit sign.
- **Route** `/reports` + wire the `reports` nav `href` to it.

## Data flow

Owner opens `/reports` → picks a period (default Month) → both `useDashboardMetrics(range)` (headline + breakdown) and `useProfitTrend(range, bucket)` (chart) run against the local DB → render. Changing the period re-runs both. All local → offline.

## Error handling & edge cases

- **No sales in period** → friendly Arabic empty state ("لا توجد مبيعات في هذه الفترة").
- **Missing cost prices** → reuse the "profit may be off" warning.
- **Custom range inverted (start > end)** → validate and prompt; no query.
- **Quarter on a cheap phone with large data** → acceptable for now (small data); pre-aggregation deferred until measured slow.
- **Sample data (trip)** → numbers are illustrative; the brother evaluates the *view*. Real profit is meaningful after ~1 week of real sales post-catalog.
- **Bucket choice** — `day` for week/month and custom ≤ ~62 days; `month` for quarter and longer custom ranges.

## Permissions

Behind `can_view_reports` (owner + manager; cashier excluded) — matches the existing nav gating.

## Imported-history / multi-year data integrity (IMPORTANT)

This screen's profit numbers are only trustworthy for **live, post-go-live sales**, where each sale captures its `unit_cost_usd` and `exchange_rate_at_sale`. **Imported historical sales are different** and must not be shown as profit unless the import carries that data:

- **Profit needs per-sale cost.** A shop's spreadsheet rarely has the cost at the time of each historical sale → no real COGS → profit over imported history is fiction.
- **Exchange rate over years.** SYP/USD may move 3–5× across 2 years; without the rate *at each historical sale*, USD profit is guesswork and SYP is inflation-distorted (nominal SYP can rise from inflation alone while real volume is flat).
- **Rule:** for periods backed by imported data lacking cost+rate, show **sales/units trends (reliable), not profit**, and label it on screen. Only show profit for periods where cost+rate exist.

This is a **hard dependency for the Import feature**: it must consciously decide whether to import historical cost and per-sale rate. That decision gates whether multi-year *profit* is even possible. In a hyperinflation market the most truthful multi-year signals are **unit-based** (units sold, transaction count, basket size) — immune to inflation/rate.

## Out of scope (→ tracked as Reports v2, driven by the brother's feedback)

- **Multi-year / imported-history business review** (revenue growth, seasonality, year-over-year, **unit/volume trends**) — depends on the Import feature capturing cost + per-sale rate (see above). Lead with unit-based metrics for imported periods.
- **Pre-aggregation / running-totals table** — premature for small live data, but **becomes required the moment a bulk multi-year import lands** (perf on cheap devices). Tie it to the Import feature, not "someday."
- P&L export / PDF (accountant-facing; reuse the existing CSV/XLSX exporter when built — Epic 11).
- Best-sellers on this screen (home dashboard already has it).
- Advanced multi-metric charts (works against plain-language, phone-first clarity).

## Testing

- Unit: `useProfitTrend` buckets correctly (day vs month), each bucket's profit nets refunds + reverses restocked COGS, and the buckets **sum to** `useDashboardMetrics` for the same range (the two surfaces must agree — the bug Tier-1 fixed).
- Unit: period→range resolution (week/month/quarter/custom) uses local-time boundaries; inverted custom range rejected.
- Flow: empty-period state; missing-cost warning shows; cashier cannot reach `/reports`.

## Definition of Done

- [ ] `/reports` reachable from the (previously empty) reports nav entry; owner + manager only.
- [ ] Period selector: Week / Month / Quarter / custom range; default Month.
- [ ] Headline profit (green +/red −) + plain-language verdict for the selected period.
- [ ] Profit trend chart (green/red bars per bucket); bars sum to the headline.
- [ ] Plain breakdown: money in − cost of goods − expenses = profit, reusing `useDashboardMetrics`.
- [ ] Missing-cost caveat reused; empty-period state; inverted-range guard.
- [ ] Works offline; no second profit calculation (reuses the verified engine).
- [ ] Deferred items recorded as Reports v2.
