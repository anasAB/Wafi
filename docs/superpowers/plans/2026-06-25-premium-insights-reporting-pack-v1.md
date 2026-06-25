# Premium Insights & Reporting Pack v1.0 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Status:** Approved for build (PRD v1.0, 2026-06-25). Supersedes the scope of `2026-06-25-profit-report-screen.md`, which shipped the v0 baseline this plan extends.
> **Pack:** Reporting (+$5/mo). **Sacred Rules touched:** Offline-first (1), Arabic + dual currency (2).

---

## Goal

Turn the shipped single-view `/reports` profit screen into a two-tab **Premium Insights** screen that answers three owner questions in <5 seconds: *Am I growing?* (PoP context), *What's my trajectory?* (cumulative chart), *Where is my money leaking?* (expense donut). Make the +$5 Reporting Pack demonstrably worth paying for.

**Founder decisions locked for this iteration (2026-06-25):**
- **Full PRD as written** — both tabs, both charts, drill-down, anomaly alerts.
- **Cumulative area chart replaces the bar chart.** `ProfitTrendChart.vue` (bar) is retired; the "Rule of Two" (Area + Donut only) is enforced.
- **PO correctness fixes are mandatory, not optional** (baked into the tasks/tests below). These were the gaps the PRD hand-waved.

> ## 🚫 SHIP BLOCKER (mandatory gate, 2026-06-25)
>
> **v1.0 MUST NOT ship until the cumulative area chart is validated for legibility with customer #0 (the brother).** Show him the area chart on a real phone alongside the retired v0 red/green daily bars. If he reads the daily red/green bars better than the cumulative curve, **revisit the chart choice before the Syria trip** — do not ship the area chart on the assumption it's clearer. This gate exists because the area chart replaced tested work on an aesthetic ("Rule of Two") call, not a validated-comprehension one. Building all tasks is allowed; **release is blocked** on this check. Record the outcome (pass / revisit) in the memory note before merge.

---

## What is already shipped (REUSE — do not rebuild)

On `wafi-067` / `main` the v0 baseline exists and is Tier-1-tested. Build on it:

- `periodUtils.ts` — `ReportPeriod` (`week|month|quarter|custom`), `getReportRange`, `bucketForRange` (day ≤62d else month).
- `useDashboardMetrics` — the **verified profit engine**. `loadRange(start,end)` already exists and populates `revenueUsd` (net of refunds), `cogsUsd`, `expensesUsd`, `refundsUsd`, `profitUsd`, `invoiceCount`, `profitIsEstimated`. **No second profit calculation anywhere.**
- `useProfitTrend(start,end,bucket)` — per-bucket profit points that **sum to** the headline. The cumulative chart is a running-sum view of these same points (no new math).
- `ReportsPage.vue` — period selector, headline (ربحت/خسرت, green/red), breakdown, empty state, inverted-range guard, custom date pickers.
- Route `/reports` + nav, gated `can_view_reports`. i18n `reports` block in ar.ts/en.ts.

## Retired by this plan

- `ProfitTrendChart.vue` (bar) and its test — replaced by `ProfitCumulativeChart.vue` (area). Delete after the area chart's tests pass.

---

## Global Constraints (apply to every task)

- **Reuse the verified engine.** Revenue/COGS/expenses/profit/refunds and the missing-cost caveat come from `useDashboardMetrics`. The PoP comparison and the cumulative chart reuse it — they do not re-derive profit.
- **Offline-first.** All queries hit the local DB. Every feature works with WiFi off.
- **Local-time boundaries.** `DATE(created_at,'localtime')` for sales/returns; `expense_date` (already `YYYY-MM-DD`) for expenses. A late-night sale lands on the right day.
- **Arabic-primary, RTL, plain shop-owner language.** "الدخل" / "المرتجعات" / "تكلفة البضاعة" / "المصاريف" / "الربح" — no accounting jargon.
- **Permission gate** `can_view_reports` already enforced — unchanged.
- **No DB migration.** `expenses.category` already exists (`category TEXT NOT NULL`, migration 009). The PRD's "category blocker" does not exist. The PRD's "Uncategorized for NULL" case cannot arise from the app (NOT NULL); only guard it for imported blank strings.
- **Tabs = segmented control**, matching the existing `PeriodToggle` / `SaleHistoryScreen` pattern (NOT a top navbar — respects the "no internal navbars in pages" design rule).
- **Test commands:** single file `npx vitest run <path>`; full suite `npm run test`; type gate `npm run build` (build type-checks tests — a test TS error blocks deploy).

---

## CORRECTNESS FIXES (the reason this isn't a verbatim PRD build)

These are requirements, enforced by named tests in the tasks below:

1. **In-progress period PoP must compare same-elapsed-days.** `month` = "1st → today". On the 12th, comparing 12 days vs last month's full 30 always shows a false drop. The previous-period resolver MUST clamp the prior period to the **same number of elapsed days**. (Task 1.)
2. **PoP hides on no-prior-data** (new user) — never render "−100%". (Tasks 1, 3.)
3. **Anomaly alerts need a revenue floor.** A ratio banner that fires on a $5 week trains owners to ignore banners. Only evaluate ratios when period revenue ≥ a floor. (Task 7.)
4. **Drill-down is per-granularity.** Day buckets → day breakdown sheet; month buckets (quarter/long custom) → month breakdown sheet. Never promise "that day" on a monthly bar. (Task 6.)
5. **Returns shown explicitly in the breakdown.** Current revenue is net of refunds; the PRD wants gross. Surface `grossIncome = revenueUsd + refundsUsd` and a `− Returns` line. (Task 2.)
6. **Donut category normalization.** Categories are free text + per-device localStorage; `TRIM` and group case-insensitively so "كهرباء" and "كهرباء " don't split. Strip the `__wafi_recurring__:` notes marker from descriptions via the existing `parseRecurringMeta`. (Tasks 8, 9.)
7. **PoP currency basis = USD, live-data only.** Inherit the spec's rule: profit (and its delta) is trustworthy only for post-go-live sales carrying per-sale cost + rate. Do not reintroduce inflation-distorted comparisons.

---

### Task 1: Previous-period resolver + elapsed-day clamping

**Files:** Modify `src/features/dashboard/composables/periodUtils.ts`; Test `src/features/dashboard/composables/__tests__/periodUtils.previous.test.ts`

**Produces:** `getPreviousReportRange(period, curStart, curEnd): { start, end } | null` — the equivalent prior period. For `week`/`month`/`custom`: a window of the **same day-span** ending the day before `curStart`. For `quarter`: the 3 calendar months before the current quarter window. Returns `null` when no sensible prior exists.

- [ ] **Step 1: Failing test** — assert:
  - For a month-to-date range `2026-06-01..2026-06-12` (12 days), previous = `2026-05-20..2026-05-31` (same 12-day span ending the day before the current start) — NOT all of May. (This is fix #1.)
  - For a full custom range `2026-04-01..2026-06-30` (91 days), previous is the 91 days immediately before `2026-04-01`.
  - `quarter` previous spans the 3 calendar months before the current 3-month window.
- [ ] **Step 2:** Run → FAIL (not exported).
- [ ] **Step 3: Implement.** Compute `spanDays = daysBetween(curStart, curEnd)`; `prevEnd = curStart − 1 day`; `prevStart = prevEnd − (spanDays) + 1 day`. Quarter: `start = 1st of (currentMonth−5)`, `end = last day of (currentMonth−3)`. Reuse `toDateStr`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(reports): previous-period resolver with elapsed-day clamping`.

---

### Task 2: Explicit-Returns breakdown (gross income + returns line)

**Files:** Modify `src/features/dashboard/composables/useDashboardMetrics.ts` (expose `grossIncomeUsd`); Modify `ReportsPage.vue` breakdown; Test `src/__tests__/features/useDashboardMetrics.gross.test.ts`

**Produces:** `grossIncomeUsd = computed(revenueUsd + refundsUsd)` added to the return object. Breakdown renders 5 lines: `الدخل` (gross) → `− المرتجعات` (refundsUsd) → `− تكلفة البضاعة` → `− المصاريف` → `= الربح`.

- [ ] **Step 1: Failing test** — mock revenue 1000, refunds 150, cogs 300, expenses 100 → `grossIncomeUsd` = 1000, `refundsUsd` = 150, `profitUsd` = 450 (1000−150−300−100). Confirms the PRD's worked example.
- [ ] **Step 2:** FAIL. **Step 3:** add the computed + return it; update `ReportsPage.vue` breakdown markup (add `reports.gross` / `reports.returns` i18n keys). **Step 4:** PASS. **Step 5:** Commit `feat(reports): explicit returns line in profit breakdown`.

---

### Task 3: PoP delta in the headline (+ info tooltip)

**Files:** Modify `ReportsPage.vue`; new `src/features/dashboard/composables/usePeriodComparison.ts` (or a 2nd `useDashboardMetrics` instance); Test `src/__tests__/features/ReportsPagePoP.test.ts`

**Produces:** Under the profit number: a delta chip — green ▲ `+15%` / red ▼ `−5%` vs the previous equivalent period. A tappable ⓘ next to the headline shows: *"هذا ربح التشغيل (المبيعات ناقص المرتجعات وتكلفة البضاعة والمصاريف). لا يشمل سحوبات شخصية أو فواتير موردين غير مدفوعة."*

**Approach:** instantiate a second `useDashboardMetrics()` for the previous range (separate refs, no shared state), call its `loadRange(getPreviousReportRange(...))` in the same `Promise.all` as the current load. `deltaPct = prevProfit === 0 ? null : (curProfit − prevProfit) / Math.abs(prevProfit) * 100`.

- [ ] **Step 1: Failing test** — three cases:
  - cur profit 230, prev 200 → shows `+15%`, green/up.
  - **prev period has zero sales (`invoiceCount` 0)** → delta chip is **absent** (no "−100%"). (Fixes #2.)
  - tooltip text present and gated behind the ⓘ control (`data-test="profit-info"`).
- [ ] **Step 2:** FAIL. **Step 3:** implement; reuse PrimeVue tooltip or a simple `v-if` popover (match design system — no new lib). **Step 4:** PASS. **Step 5:** Commit `feat(reports): period-over-period delta + profit info tooltip`.

---

### Task 4: Cumulative area chart (replaces the bar chart)

**Files:** Create `src/features/dashboard/components/ProfitCumulativeChart.vue`; Delete `ProfitTrendChart.vue` + its test; Test `src/__tests__/features/ProfitCumulativeChart.test.ts`

**Produces:** ApexCharts **area** chart. Input: `points: ProfitTrendPoint[]` (from `useProfitTrend`). Series = **running cumulative sum** of `profitUsd`, starting from 0. Smooth fill; brand-blue stroke/gradient; emits `point-select(index)` for drill-down. Negative cumulative dips render naturally (a down day flattens/dips the line).

- [ ] **Step 1: Failing test** — points `[{1/6:50},{2/6:108},{3/6:-20}]` → series data `[50,158,138]` (cumulative); categories `['1/6','2/6','3/6']`; chart `type` is `'area'`; clicking a marker emits `point-select` with the index.
- [ ] **Step 2:** FAIL. **Step 3:** implement (ApexCharts `area`, `dataPointSelection` → emit; `as const` on literal option fields for `ApexOptions` typing, per the v0 chart's lesson). **Step 4:** PASS. **Step 5:** delete the bar chart + test; Commit `feat(reports): cumulative profit area chart (retire bar chart)`.

---

### Task 5: "<3 days of data" chart empty state

**Files:** Modify `useProfitTrend.ts` (expose `distinctSaleDays`) OR compute in `ReportsPage.vue`; Modify `ReportsPage.vue`; Test in `ReportsPage.test.ts`

**Produces:** when the selected period has **fewer than 3 distinct days with sales**, hide the cumulative chart and show: *"سجّل مبيعاتك! سنعرض اتجاه نموك هنا بعد ٣ أيام من البيانات."* The headline + breakdown still render (they're valid with 1 day).

- [ ] **Step 1: Failing test** — 2 sale-days → chart absent, friendly message present; 3+ sale-days → chart present.
- [ ] **Step 2:** FAIL. **Step 3:** `distinctSaleDays = points.value.length` for day buckets (each point is a day with activity); for month buckets the rule is N/A (a quarter always clears it) — only apply the <3 guard when `bucket === 'day'`. **Step 4:** PASS. **Step 5:** Commit `feat(reports): cold-start empty state for the trend chart`.

---

### Task 6: Chart drill-down bottom sheet (per-granularity)

**Files:** Create `src/features/dashboard/components/ReportDrilldownSheet.vue` (presentational, follows `RecordCashMovementSheet` shape); Create `src/features/dashboard/composables/useBucketBreakdown.ts`; Modify `ReportsPage.vue`; Tests for both.

**Produces:** tapping a chart point opens a bottom sheet for that bucket showing: الدخل (gross), − المرتجعات, − تكلفة البضاعة, − المصاريف, = الربح, plus the **list of expense entries** in that bucket with their photo receipts (`photo_url`). **Day bucket → single-day window; month bucket → that month's window.** Descriptions strip the recurring marker via `parseRecurringMeta`.

- [ ] **Step 1: Failing test** (composable) — `useBucketBreakdown.load('2026-06-02','2026-06-02')` returns gross/returns/cogs/expenses/profit for that day reusing the same SQL shape as the engine; expense rows include `photoUrl` and cleaned `notes`.
- [ ] **Step 2:** FAIL. **Step 3:** implement composable (reuse engine query shapes scoped to the bucket window; expenses list via a small query like `useExpenses.load`). Implement the sheet (emits `close`; parent owns data). In `ReportsPage`, map `point-select(index)` → the bucket's `{start,end}` (day = that date; month = 1st…last of that month) → open sheet.
- [ ] **Step 4:** PASS (composable + sheet mount tests). **Step 5:** Commit `feat(reports): chart drill-down bottom sheet (day/month breakdown + receipts)`.

---

### Task 7: Smart anomaly alerts (with revenue floor)

**Files:** Modify `ReportsPage.vue` (or a `useReportAnomalies` computed); Test `src/__tests__/features/ReportAnomalies.test.ts`

**Produces:** yellow banners, shown only when triggered AND period revenue ≥ floor (`ANOMALY_MIN_REVENUE_USD`, start at e.g. 50 — tune with the brother):
- expenses > 30% of gross income → *"⚠️ مصاريفك مرتفعة بشكل غير معتاد هذه الفترة."*
- returns > 10% of gross income → *"⚠️ المرتجعات أعلى من المعتاد."*

- [ ] **Step 1: Failing test** — (a) gross 1000, expenses 400 → expense banner shows; (b) gross 1000, returns 150 → returns banner shows; (c) **gross 20 (below floor), expenses 19** → **no banner** (fixes #3); (d) clean period → no banners.
- [ ] **Step 2:** FAIL. **Step 3:** implement computed booleans + banner markup + i18n keys + the floor constant. **Step 4:** PASS. **Step 5:** Commit `feat(reports): anomaly banners with revenue-floor guard`.

---

### Task 8: Tab shell (Profitability | Expenses)

**Files:** Modify `ReportsPage.vue` (wrap existing body as the Profitability tab; add an empty Expenses tab); Modify ar.ts/en.ts; Test in `ReportsPage.test.ts`

**Produces:** a segmented tab control (matching `PeriodToggle` styling) with two tabs; default **Profitability**. The period selector + anomaly banners are **global** (above the tabs, apply to both, per the PRD). Switching tabs does not re-query the period (state is shared).

- [ ] **Step 1: Failing test** — both tab buttons render; default shows the profit headline; clicking `data-test="tab-expenses"` shows the expenses tab container (donut placeholder), hides the headline. **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS. **Step 5:** Commit `feat(reports): profitability/expenses tab shell`.

---

### Task 9: Expense category donut + center total

**Files:** Create `src/features/dashboard/composables/useExpenseBreakdown.ts`; Create `src/features/dashboard/components/ExpenseDonutChart.vue`; Modify `ReportsPage.vue`; Tests for both.

**Produces:** `useExpenseBreakdown(start,end)` → `{ slices: Ref<{category,totalUsd}[]>, totalUsd }`, grouped by **normalized** category (`TRIM(category)`, case-folded; blank → `غير مصنف`), ordered by total desc. ApexCharts **donut** with `totalUsd` in the center; clicking a slice emits `category-select(category)`. Empty (no expenses) → hide donut, show *"لا توجد مصاريف في هذه الفترة."* (PRD #6 empty state.)

- [ ] **Step 1: Failing test** (composable) — rows `[{cat:'كهرباء',40},{cat:'كهرباء ',10},{cat:'إيجار',100}]` → slices `[{إيجار,100},{كهرباء,50}]` (trailing-space merged — fix #6), total 150. Donut test: center shows total; slice click emits `category-select`.
- [ ] **Step 2:** FAIL. **Step 3:** implement — SQL `SELECT TRIM(category) cat, COALESCE(SUM(amount_usd),0) total FROM expenses WHERE shop_id=? AND expense_date BETWEEN ? AND ? GROUP BY TRIM(category)`; fold blanks to `غير مصنف` in JS; donut component (`dataPointSelection` → emit). **Step 4:** PASS. **Step 5:** Commit `feat(reports): expense category donut with center total`.

---

### Task 10: Top-offenders list + slice filter + clear

**Files:** Create `src/features/dashboard/components/TopExpensesList.vue` (or inline in ReportsPage); reuse a query in `useExpenseBreakdown` (add `loadEntries(start,end,category?)`); Modify `ReportsPage.vue`; Test.

**Produces:** a plain text list (NOT a bar chart — Rule of Two) of individual expenses ordered by `amount_usd` desc: التاريخ · الوصف · المبلغ. Description = cleaned `notes` (via `parseRecurringMeta`) else category. When a donut slice is selected, the list filters to that category and a `مسح الفلتر (X)` button appears that resets it.

- [ ] **Step 1: Failing test** — unfiltered shows all entries amount-desc; after `category-select('إيجار')` only إيجار rows show + clear button present; clicking clear restores all. Description strips the `__wafi_recurring__:` marker.
- [ ] **Step 2:** FAIL. **Step 3:** implement `loadEntries` (`ORDER BY amount_usd DESC`, optional `AND TRIM(category)=?`), wire selection state in ReportsPage, render list + clear button. **Step 4:** PASS. **Step 5:** Commit `feat(reports): top-expenses list with donut-driven filtering`.

---

### Task 11: Full-suite regression + type gate + cleanup

- [ ] Run `npm run test` (all green, incl. the retired bar-chart test deleted).
- [ ] Run `npm run build` (type gate clean — remember it type-checks tests).
- [ ] Verify offline: queries are all local; no network calls added.
- [ ] Manual RTL pass on a phone viewport: tabs, donut labels, area chart, bottom sheet, anomaly banners all read right-to-left.
- [ ] Commit any fixups; update memory note `project_wafi067_profit_report` to point at this v1.0 plan.

---

## Out of scope (Reports v2 — unchanged from the approved spec)

PDF / P&L export (screenshots suffice for v1), multi-year / imported-history profit (HARD-depends on the Import feature capturing per-sale cost + exchange rate — without it, historical profit is fiction; lead with unit/volume trends in hyperinflation), pre-aggregation (required once bulk import lands), AI forecasting, and the UI to create/govern expense categories (donut groups whatever exists; taxonomy governance is a separate effort).

## PO sign-off conditions (verify before calling v1.0 done)

- [ ] In-progress month PoP does NOT show a false drop on day 12 (Task 1 test proves it).
- [ ] New user (no prior period) sees NO delta chip (not "−100%").
- [ ] Anomaly banners stay silent below the revenue floor.
- [ ] Drill-down on a quarter (month buckets) opens a **month** sheet, not a broken "day" sheet.
- [ ] Donut does not split a category by trailing whitespace / case.
- [ ] **🚫 SHIP BLOCKER — MANDATORY:** Validate the **cumulative area chart legibility with customer #0 (brother)** on a real phone, against the v0 red/green daily bars. If he reads the bars better, revisit the chart before the Syria trip. **Release is blocked until this passes.** Record pass/revisit in the memory note before merge.

## Success metrics (from PRD §10)

Attach rate >15% in 60 days; weekly `/reports` visits among premium users; drill-down + donut-filter interaction counts. Instrument these when analytics lands (do not block v1.0 on them).
