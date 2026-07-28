# WAFI-018: Staff Performance Dashboard Design

**Date:** 2026-07-28
**Status:** Draft (rev 4 — incorporates founder review)
**Ticket:** WAFI-018 (P2, 0.5 sprint, "Net contribution, period selector, owner-only")

## Context

Confirmed via code audit 2026-07-27 (`WAFI_Production_Readiness_Plan_v3.md` status
table): no implementation exists for WAFI-018 today. This is a genuinely unbuilt
ticket.

**Note on ticket numbering:** this repo has two independent WAFI-NNN schemes that
collide (see `project_wafi_ticket_numbering` memory). A *different* WAFI-018 —
"Arabic search not diacritic-insensitive" — exists in
`docs/superpowers/plans/2026-06-20-audit-findings-tickets.md` and is already
shipped. This spec is for the v3-roadmap WAFI-018 ("Staff Performance Dashboard"),
scheduled Week 7 / Macro-Phase 1 Hardening Batch 2 alongside WAFI-016/017/019.

**What already exists and gets reused, not rebuilt:**

- **Profit engine.** `useDashboardMetrics.ts` and `useProfitTrend.ts`
  (`src/features/dashboard/composables/`) already compute
  `profitUsd = revenueUsd - cogsUsd - expensesUsd` per shop/date-range, with the
  WAFI-005 return/COGS-reversal fix baked in. This is "one profit engine" shared
  by dashboard and `/reports` today — WAFI-018 extends it with a `staff_id`
  dimension rather than inventing a second profit formula.
- **Period selector.** `PeriodToggle.vue` + `periodUtils.ts`
  (`getReportRange('week'|'month'|'quarter'|'custom', ...)`) already power the
  WAFI-067 Reports screen. WAFI-018 reuses this verbatim.
- **Sale attribution.** `sales.staff_id` (migration 017) records the operator
  who confirmed a sale; `useZReport.ts` already groups sales by `staff_id` for
  per-operator shift breakdowns. This is the join key for per-employee revenue.

**What's genuinely new:**

- **Returns have no direct staff attribution.** `public.returns` has no
  `staff_id` column (confirmed in migrations 056, 064) — a return is only
  attributable via `returns.shift_id → cashier_shifts.staff_id`, i.e. "whoever's
  shift it fell under," not necessarily who processed it.
- **No existing query groups profit by employee.** Both `useDashboardMetrics`
  and `useProfitTrend` scope only by `shop_id` + date range today.
- **No owner-only route meta flag exists.** Permission checks
  (`src/router/permissions.ts`, `canUserDo`) currently short-circuit `true` for
  `role === 'owner'` but grant everything else via named permission flags
  (`can_view_reports`, `can_manage_settings`) that a manager can also hold.
  There is no flag today that is *structurally* owner-only.

## Relationship to the v3 roadmap ticket text

`WAFI_Production_Readiness_Plan_v3.md` describes WAFI-018 in one line: "Net
contribution, period selector, owner-only." That roadmap line is a scope
pointer, not a spec — this document is the actual spec, and it deliberately
diverges from the roadmap's literal wording in one place: "net contribution"
in the roadmap line is being implemented here as **Contribution Margin**
(revenue minus COGS), not as a true net-profit-per-employee figure with
expenses allocated (see the Metric naming section below for why). Anyone
comparing the roadmap's phrase to this doc's terminology should read this
paragraph, not conclude one of the two is a mistake — the roadmap line was
never precise about the calculation, and this doc is the definition that
governs implementation.

## Metric naming — revised after review

The rev-1 draft called the headline metric "Net Contribution" and computed
`revenue - COGS`. That's wrong terminology: `revenue - COGS` is **gross margin**
(or, per-employee, "contribution margin" in the loose sense — but not "net"
anything, since no expenses are subtracted). Anyone with accounting background
reads "net" as "after all costs," which this isn't, and CLAUDE.md's own
plain-language discipline ("money coming in," not "revenue") argues for
precise, non-misleading labels over impressive-sounding ones.

**Decision:** rename the metric internally to **Contribution Margin**. The
code field is `marginUsd` (formula unchanged: `revenueUsd - cogsUsd`), not
`netContributionUsd`. **Terminology convention for the rest of this doc:**
in spec prose and code, this metric is always called "Contribution Margin" /
`marginUsd` (never the bare word "margin" alone).

This also renames the composable: `useStaffPerformance.ts` →
**`useStaffPerformanceMetrics.ts`**, matching the existing naming pattern
(`useDashboardMetrics`, `useProfitTrend`) and making the "this returns metrics,
not a page-level thing" responsibility obvious from the name alone.

**Further revision (rev 4):** "Contribution Margin" is accounting jargon a
Syrian shop owner is unlikely to know, which directly conflicts with
CLAUDE.md's plain-language discipline ("money coming in," not "revenue") —
getting the accounting *correct* doesn't help if the owner-facing label is
now less understandable than the wrong-but-familiar-sounding "net
contribution" it replaced. So the accounting-correct name and the
customer-facing name are split:

- **Internal (code, this doc, tests):** Contribution Margin / `marginUsd` —
  precise, matches how the profit-report vocabulary already distinguishes
  contribution margin from net profit elsewhere in this codebase.
- **UI-facing column header (what the owner actually reads):** plain
  language, e.g. "Sales after product cost" in English, and an Arabic
  equivalent such as "المبيعات بعد تكلفة البضاعة" (sales after the cost of
  goods) — phrased the same way CLAUDE.md already phrases "money coming in"
  and "what customers owe you." Final Arabic wording should be checked with
  customer #0 (brother) the same way other owner-facing strings are, rather
  than locked here.

Every other section of this document uses the internal term "Contribution
Margin" — read the UI column header as "Sales after product cost" wherever
this doc says "Contribution Margin column."

## What's changing

### 1. New composable: `useStaffPerformanceMetrics.ts`

New file: `src/features/dashboard/composables/useStaffPerformanceMetrics.ts`
(same directory as the existing profit composables — same query shape with an
added `GROUP BY staff_id`).

- Input: `(start: Date, end: Date)` — reuses `getReportRange()` output directly,
  no new date-range logic.
- Per active `staff` row in the shop: `revenueUsd`, `cogsUsd`,
  `marginUsd = revenueUsd - cogsUsd`, `salesCount`, `avgTicketUsd`.
- Revenue/COGS query joins `sales.staff_id` the same way `useZReport.ts`
  already does, extended to the full period range instead of a single shift.
- Returns reduce revenue/COGS at the `cashier_shifts.staff_id` level (see
  Context above) — each return is attributed to the shift owner, matching
  existing Z-report behavior, not to whoever technically clicked "return."
- Also computes the shop-period Contribution Margin total so the UI can
  derive `marginPct` per staff member (see §4 below) without a second query.
  (Rev 4: dropped the earlier plan to also compute `revenuePct` — see §4 for
  why revenue-share percentage was cut.)
- **Divide-by-zero:** if `salesCount === 0` for a staff member,
  `avgTicketUsd` is `null`, not `0` or `NaN`. The UI renders `null` as an em
  dash (`—`), not `$0.00` — `$0.00` implies "sold things for free," `—` implies
  "no data," which is the true state.
- **Inactive-staff / historical-period decision:** the composable includes a
  staff member if they have at least one `sales.staff_id` or
  `cashier_shifts.staff_id` row inside the selected period — it does **not**
  filter on `staff.is_active` (current status) at all. This is a deliberate
  reversal of the naive "just exclude inactive staff" approach: filtering on
  *current* `is_active` would make a staff member who left today vanish from
  *last month's* report too, silently making historical reports wrong. Staff
  who are active today but have zero activity in the selected period simply
  don't produce a row (there's nothing to show for them), which is a
  consequence of the join, not a separate active/inactive filter. Net effect:
  "historical reports include whoever was active during the selected period,"
  not "whoever is active today."

### 2. Why no labor normalization (revenue/day, Contribution Margin/shift) — explicitly deferred

Raw per-employee totals are misleading on their own: an employee who worked 6
days will out-total one who worked 2 days regardless of actual per-hour
effectiveness. The reviewer is right that this matters. It is **deliberately
not built in this ticket**, for a concrete reason, not just scope-cutting:

`cashier_shifts` records shift open/close per staff member, so "days worked" /
"shifts worked" *could* be derived — but turning that into a trustworthy
per-day or per-shift rate requires deciding how to handle partial shifts,
overlapping shifts (two people on one register), and shifts that span a
period boundary (e.g. a shift open at 11pm Sunday, closed 1am Monday, inside
a "this week" query). Those edge cases are real design work, not a one-line
addition, and rushing them risks shipping a normalized number that's *more*
misleading than the raw one it replaces. Given the 0.5-sprint size of this
ticket, normalization is listed under Future Scope (§7) rather than
half-built here.

**The UI must say this explicitly**, not leave it implicit: a static caption
under the table reading (in Arabic, matching the shop-owner voice) roughly
"these numbers are totals for the period, not adjusted for days or shifts
worked" — so an owner comparing Ahmed (6 days) and Sara (2 days) doesn't
silently conclude Sara underperformed.

### 3. Returns attribution — explicit operational framing

Because a return is attributed to `cashier_shifts.staff_id` (whoever's shift
it fell under), not to the original salesperson, this report answers "who was
operationally responsible for the register during this activity," not "whose
sales technique drove this revenue." Example: John sells a TV Monday; Sara
processes the return Friday during her own shift — the Contribution Margin reduction shows
under Sara, not John.

This is acceptable (rebuilding return attribution is a schema change, out of
scope — see Out of Scope), but it must be stated on the screen, not just in
this doc, or owners will misread "Sara's numbers went down" as "Sara sold
badly" when actually she just happened to process someone else's return.

**Rev 4: simplified caption wording.** The earlier draft's caption ("staff
numbers reflect activity during their shift, not necessarily the original
salesperson's performance") is accurate but abstract. A plainer, more
concrete sentence is easier for an owner to act on: add a one-line caption
near the table header — "المرتجعات تُحسب على الموظف الذي قام بمعالجتها"
(returns are counted against the employee who processed them). This states
the actual mechanic directly rather than describing it abstractly as
"operational activity."

### 4. New screen: `StaffPerformancePage.vue`

New file: `src/features/dashboard/components/StaffPerformancePage.vue`
(sibling of `ReportsPage.vue`), routed at `/reports/staff` as a child of the
existing `/reports` route in `src/router/index.ts`.

- Reuses `PeriodToggle.vue` verbatim for the period selector.
- Columns: name, revenue, COGS, Contribution Margin (+ `marginPct` of
  shop-period Contribution Margin total, e.g. `$1,200 (20%)`), sales count,
  avg ticket.
- **Rev 4: revenue-share percentage cut, margin-share percentage kept.** An
  earlier draft showed a percentage next to both revenue and Contribution
  Margin. Revenue share can mislead on its own: an employee with $9,000
  revenue (60% of shop revenue) but only $1,200 margin (20% of shop margin)
  looks dominant by the revenue number alone, while an employee with $4,000
  revenue (40%) but $3,000 margin (80%) is actually the stronger contributor
  — showing both percentages invites reading the wrong one. Margin share is
  the number worth calling out as a percentage; revenue stays as a plain
  dollar figure with no percentage attached.
- **All columns are sortable** (click header to sort, ascending/descending
  toggle), not just Contribution Margin. Default sort: Contribution Margin
  descending. This is close to free given the data is already a flat array
  in memory, and it directly serves real owner questions the table should
  answer ("who sold the most," "who processed the most invoices," "who has
  the highest average ticket") without a separate view per question.
- **Sort persists across period changes.** If the owner sorts by Average
  Ticket and then switches the period (via `PeriodToggle`), the table
  re-fetches for the new range but keeps the same sort column/direction
  rather than resetting to the Contribution-Margin-descending default —
  the owner picked that sort for a reason and shouldn't have to reapply it
  every time they change the period.
- **Zero state:** if the composable returns no staff rows with `salesCount >
  0` for the period (e.g. a slow custom range or a new shop), render a
  centered empty-state message — "لا يوجد نشاط للموظفين خلال هذه الفترة" (no
  employee activity during this period) — not an empty table with just
  headers, which reads as a bug rather than "nothing happened."
- No charts — a table is enough for a shop with a handful of employees; a
  bar-chart view is not worth the design/build cost at this scale (Loyverse-
  shape discipline: don't over-build for a shop with 2-5 staff).
- Entry point: the page appears as a child item under the existing Reports
  navigation (same nav group as the WAFI-067 profit report), gated the same
  way as the route (see below) so it doesn't appear at all for non-owners
  rather than appearing and 403-ing.

### 5. Owner-only gating

- Route meta: `meta: { permission: 'can_view_staff_performance' }` on
  `/reports/staff`.
- Unlike other permission flags, this one is **not** included in any manager's
  `permissionsForRole('manager', ...)` default or override set — it is only
  ever true when `role === 'owner'` (enforced in `canUserDo` via the existing
  owner short-circuit, same mechanism `canResetPin` already relies on for its
  owner-only behavior). No new "owner-only" concept is introduced into the
  permission model — this ticket just doesn't grant the new flag to any
  non-owner role, which is sufficient and matches the precedent in
  `router/permissions.ts`.
- Rationale for owner-only (not manager-visible): per-employee Contribution Margin is
  exactly the kind of number that creates friction between staff if a manager
  can see it about their peers — CLAUDE.md's "are my employees stealing"
  framing is an owner concern, not something to expose shop-floor.

### 6. Information architecture — open question, not resolved here

The reviewer's question — should this live under Reports, or as a top-level
"Staff" section — is a real long-term IA decision, not something this
0.5-sprint ticket should force. **Ship it under `/reports/staff` now** (small
footprint, reuses the Reports nav entry point, no new top-level nav item to
design/translate/test), but flag explicitly: if Future Scope items (§7) like
drill-down, attendance, or shift-duration tracking get built later, "Staff"
likely deserves to be promoted to its own first-level section rather than a
Reports sub-page. Don't let this ticket's placement quietly become the
permanent IA decision by default — revisit explicitly if/when §7 items are
scoped.

### 7. Future scope (explicitly not this ticket)

Listed explicitly so none of these get squeezed into this 0.5-sprint ticket
later without a deliberate decision:

- Labor normalization (revenue/Contribution Margin per day or per shift) — see §2 for why.
- Drill-down per employee (tap a row → revenue, returns, products sold,
  invoices, average discount breakdown for that person).
- Top-selling categories/products per employee.
- Refund rate, discount rate, upsell rate per employee.
- Commission calculation/payout (separate from the existing v1.5-roadmap
  cashier-commission-tracking item).
- Attendance / shift duration tracking.
- Performance trend over time (this ticket is single-period only; no
  week-over-week or month-over-month trend line for an individual employee).
- Promoting "Staff" to a top-level IA section (see §6).

## Performance expectations

The composable performs a single grouped aggregate query over the selected
period (sales/returns joined to staff, grouped by `staff_id`) — the same
shape `useZReport.ts` already runs per-shift, just over a wider date range.
At current WAFI scale (2-10 staff per shop, thousands of sales per shop
overall), no pre-aggregation, materialized view, or caching layer is
expected to be necessary. If the "custom" period range is later widened to
spans that make this query noticeably slow in practice, that should be
measured against real data before reaching for caching or summary tables —
not designed for speculatively now.

## Historical correctness

Metrics for a past period are derived from immutable sales/return/shift
records (`sales`, `returns`, `cashier_shifts` — all of which are append-only
per the WAFI-202 sales-immutability work) and are unaffected by later edits
to a staff member's name, a product's name/category, or similar display-only
changes. If "Ahmed" is later renamed "Mohammed" in the `staff` table, last
month's report re-renders with the current display name attached to the same
historical activity — the numbers themselves don't change, only the label.
Product/category deletions likewise don't retroactively alter historical
revenue or COGS, since both are captured on the sale/line-item at the time of
the transaction, not looked up live.

## Testing

- `useStaffPerformanceMetrics.test.ts`: given fixture sales/returns/staff rows
  across two staff members and one shift boundary, assert per-staff
  `revenueUsd`, `cogsUsd`, `marginUsd`, `salesCount` match hand-computed
  values, including a return attributed via `shift.staff_id` rather than the
  purchasing sale's `staff_id`. Explicit case: a staff member with
  `salesCount === 0` asserts `avgTicketUsd === null` (not `0`, not `NaN`).
- `StaffPerformancePage.vue` component test: mocks the composable, asserts
  rows render sorted by Contribution Margin descending by default; asserts clicking each
  column header re-sorts by that column and toggles direction on repeat
  click; asserts switching `PeriodToggle` re-invokes the composable with the
  new range (reusing the existing `PeriodToggle` test pattern from the
  WAFI-067 Reports screen); asserts the zero-state message renders when the
  composable returns no rows with `salesCount > 0`; asserts `avgTicketUsd ===
  null` renders as `—`, not `$0.00`.
- Route guard test: assert a `manager`-role staff fixture is denied
  `/reports/staff` and redirected via `resolveLanding`, same assertion style
  as existing `router/permissions.test.ts` cases for other gated routes.

## Out of scope

- Fixing `returns` having no direct `staff_id` (a returns-schema change) —
  Contribution Margin inherits shift-level return attribution as an accepted
  approximation, explicitly surfaced in the UI (§3), not silently fixed here.
- Per-employee allocation of shop-level expenses (rent, utilities) into a true
  net-profit-per-employee figure — Contribution Margin here is revenue minus
  COGS only, consistent with how the term is scoped and named in this spec.
  A fuller allocation model is a separate, larger ticket if ever needed.
- Commission calculation or payout — this is a read-only performance view, not
  the cashier-commission-tracking feature already listed separately in the
  v1.5 roadmap.
- A dedicated toggle to show/hide staff who are no longer active — not
  needed, since the join-based inclusion rule in §1 already surfaces former
  staff for periods where they had activity, with no filter to toggle.
- Charts/visualizations beyond a sorted table.
- Everything listed in §7 Future Scope.
