# WAFI-015 — Anomaly Detection Automation (Home Banner)

> Design spec. Status: proposed, awaiting implementation plan.
> Date: 2026-07-30.

## Cross-Epic Edge-Case Checklist (design time)
Domains touched: Sales, Returns, Inventory, Cash/Shifts, Products/Cost (WAFI-013 adjacency only — see §2), Reports/Dashboard.
Matrix rows consulted: Sales, Returns, Inventory, Cash/Shifts, Products/Cost (`AI_PRINCIPAL_ENGINEER_REVIEW.md`'s Domain Interaction Matrix).
Open cross-feature questions: none identified beyond what's already resolved in §2 (stale/missing cost is deliberately kept out of this engine, owned by WAFI-013, to avoid two features computing the same signal) and §7 (dismissal is per-device, not per-user — an accepted v1 limitation, not an open question).

---

## 1. Problem

The v3 roadmap's WAFI-015 asks for automated anomaly detection surfaced on the Home
dashboard, so an owner sees "something might be wrong" the moment they open the app —
without having to know to go check `/reports`.

A confirmed audit (2026-07-30) found this genuinely not started. What exists today,
`useReportAnomalies.ts` (`src/features/dashboard/composables/`), is a different, narrower
feature: it detects only 2 ratio-based flags (high expenses, high returns), renders only as
badges on the `/reports` page (Reporting Pack), and was built for the profit-report v1.0
work — not a partial WAFI-015 implementation. This spec scopes WAFI-015 as new work that
**reuses those 2 existing checks** as part of a larger, shared anomaly engine.

## 2. Scope: 7 anomaly types (not the ticket's original "5")

The ticket's "5 types" was a rough estimate, not a hard requirement — see WAFI-008's
precedent for scoping a ticket to what the actual data supports. Final set, arrived at by
distinguishing genuinely separate business problems rather than conflating them:

| # | Type | `code` | Condition | Severity (initial) |
|---|---|---|---|---|
| 1 | High expenses ratio | `HIGH_EXPENSES_RATIO` | expenses / revenue > 30% (existing) | warning |
| 2 | High returns ratio | `HIGH_RETURNS_RATIO` | refunds / revenue > 10% (existing) | warning |
| 3 | Low overall margin | `LOW_MARGIN` | period margin % (revenue − COGS) / revenue below threshold (e.g. <10%) | warning |
| 4 | Sale below cost | `SALE_BELOW_COST` | any single sale line where `unit_price_usd < unit_cost_usd` in-period | critical |
| 5 | Discount activity | `HIGH_DISCOUNT_RATIO` | discount total / revenue > flat threshold (e.g. >15%) — no trailing-baseline comparison in v1 | warning |
| 6 | Cash shift variance | `CASH_SHIFT_VARIANCE` | any shift closed in-period with `abs(variance) >` threshold (e.g. >$5 or >2% of expected cash) | critical |
| 7 | Inventory shrinkage | `INVENTORY_SHRINKAGE` | stock-take unexplained variance (reusing WAFI-009's inventory-movement timeline/variance logic) beyond threshold | critical |

**Types 3 and 4 are deliberately separate, not combined.** A shop can have a healthy overall
margin (type 3 = false) while a single sale still went out below cost (type 4 = true) —
conflating them would either miss the one-off mistake or falsely flag a healthy shop. They
are independent checks against independent conditions.

**Stale/missing cost prices is explicitly NOT one of the 7.** WAFI-013 already owns that
concept (`isCostMissing`/`isCostStale` predicates, `products.cost_updated_at`). Home instead
surfaces WAFI-013's own cost-freshness summary (e.g. "24 products missing cost") as a
**separate, clearly distinct** UI element next to the anomaly banner — not folded into
`useAnomalyDetection.ts`. This avoids two features owning the same underlying logic.

All revenue-ratio-based types (1, 2, 3, 5) share a `minRevenueUsd` floor (e.g. $50, matching
today's existing constant) to avoid flagging noise on a near-empty period.

Thresholds above are v1 placeholders, tunable later — not learned/per-shop baselines (that
would be premature complexity; ship flat thresholds first, revisit only if real usage shows
they're wrong for a given shop).

## 3. Architecture

New shared composable: `src/composables/useAnomalyDetection.ts` (cross-feature location,
alongside other shared composables like `executeFinancialWrite` — not nested inside
`src/features/dashboard/`, since both Home and Reports consume it).

It owns:
- `ANOMALY_RULES` — one config entry per type: `{ code, label, severityFn/severity,
  thresholds, minRevenueUsd }`. **Severity lives in the rule config, not hardcoded into the
  anomaly engine or the anomaly-type definition** — this keeps the door open for later
  dynamic severity (e.g. "1 sale below cost → warning, 20 → critical") without an
  architecture change; v1 ships static per-rule severity, nothing dynamic yet.
- One pure evaluation function per rule, taking already-fetched data as plain arguments (no
  querying inside the rule functions themselves) and returning `Anomaly | null`.
- The orchestration function that batches data fetching, then runs all rules in memory (see
  §5, Performance).

Both `ReportsPage.vue` (existing badges) and the new `AnomalyBanner.vue` (Home) call this
one composable — same computation, same thresholds, same 7 rules, no drift between what an
owner sees on Home vs. on Reports.

`useReportAnomalies.ts` is deleted; its 2 existing rules (`HIGH_EXPENSES_RATIO`,
`HIGH_RETURNS_RATIO`) move into `ANOMALY_RULES` verbatim (same thresholds, same behavior —
this is a relocation, not a logic change for those 2).

## 4. Anomaly shape

```ts
interface Anomaly {
  code: string          // stable identifier, e.g. 'HIGH_RETURNS_RATIO' — never compare on
                         // translated title/message text
  severity: 'critical' | 'warning' | 'info'
  kind: 'instant' | 'aggregate'  // 'instant' = a discrete event that already happened and
                                  // won't recur just because time passes (e.g. a specific
                                  // sale below cost); 'aggregate' = holds only while a
                                  // period-level condition remains true (e.g. high expense
                                  // ratio) and naturally clears when the period/data changes.
                                  // Not used for any behavior difference in v1 — carried now
                                  // so future notification/escalation logic doesn't require
                                  // a breaking shape change.
  title: string          // translated, user-facing
  message: string        // translated, user-facing detail
  deepLink?: string       // optional route to the relevant detail screen (e.g. /reports,
                          // /shifts/history)
}
```

`kind` per type: `SALE_BELOW_COST` and `INVENTORY_SHRINKAGE` are `instant` (discrete events);
the remaining 5 ratio/threshold-based types are `aggregate`.

## 5. Performance (<100ms budget) — the actual mechanism, not just the target

`useAnomalyDetection()` never issues more than one query per data source. Concretely:

1. Consume already-computed aggregates wherever `useDashboardMetrics`/`useProfitTrend`
   already fetch them for Home's existing cards (revenue, COGS, expenses, refunds,
   discounts) — zero additional queries for types 1, 2, 3, 5.
2. Batch any remaining reads by **source**, not by anomaly type: one query for shifts closed
   in-period (feeds type 6), one query for stock-take variance rows in-period (feeds type
   7), and one query for the period's sale line items with cost/price (feeds type 4, and any
   future per-line-item rule — e.g. highest/average/median markup — for free). **Not** a
   query scoped to only below-cost rows: fetch the period's sale line items once, then
   compute `belowCostSales`, and anything else derived from the same rows, in memory. This
   is deliberate — a query pre-filtered to "below cost" only answers that one question; a
   query for the period's line items answers this and every future per-line-item question
   without adding a query.
3. All 7 rule functions then evaluate in memory against that already-fetched data — adding
   an 8th, 9th, 10th anomaly type later costs zero additional queries as long as it reuses
   an existing batched source.

This is the concrete scaling contract: **N anomaly types must never mean N queries, and a
new rule that reuses an existing batched source must add zero queries.** A test asserts on
the query count (see §9) so this doesn't silently regress.

Evaluated once per Home mount / reporting-period change — not recomputed on every reactive
tick.

## 6. Ordering and deduplication

- **Ordering:** critical first, then warning, then info; stable order within a severity tier
  matches the table in §2 (not random/alphabetical).
- **Deduplication:** anomalies are independent and may coexist. No precedence suppression in
  v1 — e.g. a low-margin period caused by high expenses shows both `LOW_MARGIN` and
  `HIGH_EXPENSES_RATIO`. Avoids causal-inference complexity for a first pass; revisit only if
  real usage shows the banner feels redundant.
- **One anomaly per rule, regardless of row count:** each rule emits **at most one**
  `Anomaly` no matter how many underlying rows triggered it — e.g. 15 sales below cost in the
  period produces one `SALE_BELOW_COST` anomaly (with a count in its `message`, e.g. "15
  sales sold below cost"), never 15 separate cards. This must be explicit, not left to an
  implementer's judgment call — a per-row anomaly list would make a bad day produce a wall of
  critical cards instead of one clear signal.

## 7. UI, dismissal, permissions

- **Banner:** dismissible summary banner near the top of Home (e.g. "3 things need your
  attention"), tap to expand and see each anomaly's title/message/deep-link.
- **Dismiss scope:** per-anomaly `code` **and reporting period**, dismissed for **today
  only** — stored in localStorage as
  `wafi:anomaly-dismissed:{shopId}:{date}:{periodKey}:{code}`. Including `periodKey` (e.g.
  `today`/`7d`/`30d`) matters because "today" and "last 7 days" can legitimately disagree on
  whether an anomaly is active — without it, dismissing under one period could wrongly hide
  the same anomaly after switching to another. The date-scoped key means nothing needs
  explicit expiry/cleanup; a dismissal simply doesn't match tomorrow's key, so the anomaly
  reappears automatically if the underlying condition is still true.
- **Permission gate:** `can_view_reports` (owner + manager) — same gate as the existing
  `/reports` badges and WAFI-017's money-owed view, so visibility is consistent between Home
  and Reports (nobody sees the banner on one screen but not the other). **Dismissal is
  per-device, not per-user**, since it's stored in localStorage: if the owner dismisses an
  anomaly on their phone, a manager logging into a *different* device still sees it (the
  dismissal never synced); if the owner and manager share the same device/browser, the
  manager would see it as already-dismissed. This is an accepted v1 limitation, not a bug —
  documented here so it isn't "discovered" later and mistaken for one.

## 8. Error handling

If any underlying query fails (offline, dead-letter scenario, unexpected error), the banner
does **not** silently render nothing — a silent absence is indistinguishable from "no
anomalies, everything's fine," which is actively misleading (an owner could read a broken
evaluation as a clean bill of health). Instead: log to Sentry, and render a small, calm,
non-alarming grey info card reading "Unable to check for issues right now" — neutral in
tone, not scary, not phrased as an error the owner needs to act on (final copy can be
refined at implementation/localization time, but the neutral framing is a requirement, not a
detail). Anomaly detection is a supplementary signal, not a blocking feature —
it must never make Home itself feel broken or slow, but it also must never claim a clean
result it didn't actually compute.

## 9. Testing

- Unit tests per rule: boundary cases (just under / at / just over each threshold).
- Shared-consumption test: `ReportsPage.vue` and `AnomalyBanner.vue` render from identical
  underlying `Anomaly[]` output for the same input data (proves no drift between the two
  surfaces).
- Dismiss-persistence test: dismiss today, confirm it reappears "tomorrow" via a mocked date.
- **Query-count assertion**: spy/count DB calls made by `useAnomalyDetection()`. Two
  assertions, not one: (a) it never exceeds "one per data source" regardless of how many
  rules are added, and (b) adding a new rule that reuses an already-batched source (e.g. a
  future "average markup" rule reusing the same period sale-line-items query as
  `SALE_BELOW_COST`) produces **zero** additional queries versus the baseline. (b) is the
  actual contract this ticket cares about — (a) alone wouldn't catch a well-intentioned but
  wrong implementation that adds one query per new rule as long as each stays "only one."
- Permission-gate test: banner absent for a role without `can_view_reports`.

## 10. Explicitly out of scope (v1)

- Per-shop learned/adaptive thresholds (flat thresholds only).
- Trailing-baseline comparison for discount activity (flat ratio threshold only).
- Dynamic/count-based severity escalation (severity is static per rule in v1; the config
  shape supports adding this later without an architecture change).
- Folding WAFI-013's cost-freshness signal into this anomaly engine (kept as a separate,
  adjacent UI element on Home, owned by WAFI-013's own logic).
