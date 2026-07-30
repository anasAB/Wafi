# WAFI-015 — Anomaly Detection Automation (Home Banner)

> Design spec. Status: proposed, awaiting implementation plan.
> Date: 2026-07-30.

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
  title: string          // translated, user-facing
  message: string        // translated, user-facing detail
  deepLink?: string       // optional route to the relevant detail screen (e.g. /reports,
                          // /shifts/history)
}
```

## 5. Performance (<100ms budget) — the actual mechanism, not just the target

`useAnomalyDetection()` never issues more than one query per data source. Concretely:

1. Consume already-computed aggregates wherever `useDashboardMetrics`/`useProfitTrend`
   already fetch them for Home's existing cards (revenue, COGS, expenses, refunds,
   discounts) — zero additional queries for types 1, 2, 3, 5.
2. Batch any remaining reads by **source**, not by anomaly type: one query for shifts closed
   in-period (feeds type 6), one query for stock-take variance rows in-period (feeds type
   7), one query for below-cost sale lines in-period (feeds type 4).
3. All 7 rule functions then evaluate in memory against that already-fetched data — adding
   an 8th, 9th, 10th anomaly type later costs zero additional queries as long as it reuses
   an existing batched source.

This is the concrete scaling contract: **N anomaly types must never mean N queries.** A test
asserts on the query count (see §8) so this doesn't silently regress.

Evaluated once per Home mount / reporting-period change — not recomputed on every reactive
tick.

## 6. Ordering and deduplication

- **Ordering:** critical first, then warning, then info; stable order within a severity tier
  matches the table in §2 (not random/alphabetical).
- **Deduplication:** anomalies are independent and may coexist. No precedence suppression in
  v1 — e.g. a low-margin period caused by high expenses shows both `LOW_MARGIN` and
  `HIGH_EXPENSES_RATIO`. Avoids causal-inference complexity for a first pass; revisit only if
  real usage shows the banner feels redundant.

## 7. UI, dismissal, permissions

- **Banner:** dismissible summary banner near the top of Home (e.g. "3 things need your
  attention"), tap to expand and see each anomaly's title/message/deep-link.
- **Dismiss scope:** per-anomaly `code`, dismissed for **today only** — stored in
  localStorage as `wafi:anomaly-dismissed:{shopId}:{date}:{code}`. The date-scoped key means
  nothing needs explicit expiry/cleanup; a dismissal simply doesn't match tomorrow's key, so
  the anomaly reappears automatically if the underlying condition is still true.
- **Permission gate:** `can_view_reports` (owner + manager) — same gate as the existing
  `/reports` badges and WAFI-017's money-owed view, so visibility is consistent between Home
  and Reports (nobody sees the banner on one screen but not the other).

## 8. Error handling

If any underlying query fails (offline, dead-letter scenario, unexpected error), the banner
**fails closed**: log to Sentry, render nothing, never show a broken/error UI on Home.
Anomaly detection is a supplementary signal, not a blocking feature — it must never make
Home itself feel broken or slow.

## 9. Testing

- Unit tests per rule: boundary cases (just under / at / just over each threshold).
- Shared-consumption test: `ReportsPage.vue` and `AnomalyBanner.vue` render from identical
  underlying `Anomaly[]` output for the same input data (proves no drift between the two
  surfaces).
- Dismiss-persistence test: dismiss today, confirm it reappears "tomorrow" via a mocked date.
- **Query-count assertion**: spy/count DB calls made by `useAnomalyDetection()`, assert it
  never exceeds "one per data source" regardless of how many rules are added — the
  regression guard for §5's scaling contract.
- Permission-gate test: banner absent for a role without `can_view_reports`.

## 10. Explicitly out of scope (v1)

- Per-shop learned/adaptive thresholds (flat thresholds only).
- Trailing-baseline comparison for discount activity (flat ratio threshold only).
- Dynamic/count-based severity escalation (severity is static per rule in v1; the config
  shape supports adding this later without an architecture change).
- Folding WAFI-013's cost-freshness signal into this anomaly engine (kept as a separate,
  adjacent UI element on Home, owned by WAFI-013's own logic).
