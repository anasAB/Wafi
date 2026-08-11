# WAFI-146 — Dashboard 2.0 (Design Spec)

Date: 2026-08-10
Status: Approved by founder, ready for planning
Revision: v3 — incorporates two rounds of review feedback (see "Revision notes" at bottom)

## Problem

Today's dashboard (Home, Reports) shows numbers and — since WAFI-144 —
a single up/down comparison insight for revenue and profit. It still
doesn't answer "why": an owner sees revenue is down 12% but has to go
digging through history/reports/staff pages themselves to find out
whether that's fewer transactions, more returns, a discount spree, or
something else. The roadmap's framing: executive intelligence, not
metrics — explain WHY, not just WHAT.

**Terminology note:** this spec deliberately says "drivers" or
"contributing factors," not "causal reasons." Revenue = transactions ×
avg basket is a mathematical identity — that's genuinely explanatory.
Returns moving is a *contributor* to the same net-revenue number, not
a proven cause of the revenue change. Calling everything "causal"
overclaims what a handful of correlated metrics can tell you. The UI
copy can still ask "Why did this change?" — the underlying data model
and this doc call them drivers.

## Scope

**In scope:** a new `/dashboard` screen with 5 expandable "intelligence
cards" (Revenue, Profit, Inventory, Staff, Customer), each showing a
headline comparison plus 2-3 concrete drivers pulled from data that
already exists (or is a small, obvious extension of an existing
query). Fixed period selector (Today / This Week / This Month) and a
fixed previous-equivalent-period comparison, reusing WAFI-144's
`insightRanges.ts` semantics — including its existing intraday-partial
handling for `day` (see "Comparison basis" below).

**Out of scope (explicitly deferred or dropped):**
- **Register-offline-duration** and **supplier price-change history**
  drivers from the original plan text — no tracking infrastructure for
  either exists anywhere in the codebase today. Building either is a
  separate, much larger side-quest (a new device-heartbeat/offline log,
  or a new cost-price-history table), not a natural extension of
  existing data. Dropped from this design; would need their own design
  spec if ever prioritized.
- **Selectable comparison anchor** (Yesterday / Last Week / Last Month /
  Same Day Last Year). Cut to a single fixed comparison — each period
  always compares to its own previous equivalent, exactly what
  `insightRanges.ts` already computes. "Same day last year" is dropped
  entirely (not deferred): most shops on this product won't have a
  full year of data, and it isn't worth a UI control for a comparison
  most owners can't use yet.
- **Sparklines / trend mini-charts** on cards. Visual polish, not part
  of the driver breakdown. Left out; can be a follow-up.
- **"View returns" and "View discounts" action links.** No returns-list
  or discount-report screen exists anywhere in the app. Rather than
  build two new list screens just to host a link, these action links
  are dropped — the driver text (with numbers) still shows, just
  without a tap-through. Same for "Create promotion" (Inventory card) —
  there is no promotions feature in this app at all.
- Replacing Home's content. Home (`HomePage.vue`) stays exactly as the
  fast operational glance it is today — unchanged.
- A real churn-prediction model. The Customer card reports observed
  inactivity, not a predicted likelihood of leaving — see the Customer
  card section below.
- **Recent-notifications strip and pull-to-refresh** (originally in the
  Layout section) — descoped during implementation; WAFI-145's
  notification bell/center already covers recent-notification
  visibility elsewhere in the app, and pull-to-refresh is non-essential
  polish. Not built in this branch.

## Placement & routing

New route:
```
{ path: '/dashboard', component: () => import('@/features/dashboard/components/Dashboard2Screen.vue'),
  meta: { permission: 'can_view_reports', feature: 'reporting_pack' } }
```
Same gating pattern as the existing `/reports` route. The Staff card
additionally checks `can_view_staff_performance` via `useCan()` inside
the card itself (owner-only per WAFI-018, same as
`StaffPerformancePage.vue`) — when the viewer lacks that permission,
the Staff card is omitted from the grid rather than shown locked, and
is excluded from the parallel load (see "Refresh & error handling").

Added as a new item in the existing sidebar + bottom nav, alongside
Home and Reports — not a replacement for either.

## Layout

Top → bottom, on `Dashboard2Screen.vue`:

1. **Period selector** — Today | This Week | This Month. Own local
   `ref`, same pattern `ReportsPage.vue` already uses (not the shared
   `usePeriodToggle` singleton Home uses).
2. **5 intelligence cards** (4 for a viewer without staff-performance
   access) — see "Card grid" below for the responsive rule.
3. **Quick actions row** — ring sale, add expense, record payment, open
   shift. All route to existing screens; no new logic.
4. **Recent notifications strip** — last 5 rows from the `notifications`
   table (already populated by WAFI-145), links to `/notifications`.
   Its own independent load — a failure here must not block or delay
   the 5 cards above it.

### Card grid — not a rigid 2-col/1-row rule

Original draft called for "2-column mobile, single row desktop." Revised:
cards need enough width to show 2-3 drivers with real numbers, and an
expanded card (e.g. Customer's inactive-customer list) is cramped at
half a phone's width. Responsive rule instead:

| Breakpoint | Columns |
|---|---|
| Mobile (< 768px) | 1 |
| Tablet (768–1023px) | 2 |
| Desktop (≥ 1024px) | CSS grid, `repeat(auto-fit, minmax(260px, 1fr))` — naturally 3-5 depending on viewport width, never forced into exactly one row |

The requirement is "cards stay readable," not "cards fit in one row."

### Shared card shell — presentation only, not a shared data contract

One `IntelligenceCard.vue` wrapper, not 5 bespoke shells — but it owns
**only presentation concerns**: collapsed/expanded, loading/ready/error,
retry, and the mobile accordion coordination (see "Expand behavior"
below). It does not prescribe a data shape. The first draft of this
spec forced Revenue/Profit's period-comparison shape
(`{currentUsd, previousUsd, changePct}`) onto Inventory (a point-in-time
snapshot: frozen capital), Staff (a ranking: top performer + highest
discount rate), and Customer (a count: inactive customers) — none of
which are naturally a "current vs previous" comparison. Rather than
bend those three into a comparison shape they don't have, each card
component owns its own local data shape from its own composable and
passes headline/body content into `IntelligenceCard.vue` via slots:

```
Dashboard2Screen.vue
 ├── RevenueIntelligenceCard.vue   (wraps IntelligenceCard; data from useRevenueIntelligence — comparison-shaped)
 ├── ProfitIntelligenceCard.vue    (wraps IntelligenceCard; data from useProfitIntelligence — comparison-shaped)
 ├── InventoryIntelligenceCard.vue (wraps IntelligenceCard; data from useInventoryIntelligence — snapshot-shaped)
 ├── StaffIntelligenceCard.vue     (wraps IntelligenceCard; data from useStaffIntelligence — ranking-shaped; omitted if !canViewStaffPerformance)
 └── CustomerIntelligenceCard.vue  (wraps IntelligenceCard; data from useCustomerIntelligence — snapshot-shaped)
```

Each composable internally reuses existing composables/queries where
possible (`useDashboardMetrics`, `useDeadStockReport`,
`useStaffPerformanceMetrics`) rather than re-querying from scratch.

**Data/presentation separation still applies within each card**, per
`InsightBanner.vue`'s (WAFI-144) existing convention: each composable
returns raw numbers, its wrapping card component formats and localizes
at render time via `useI18n`'s `t()`. Revenue and Profit (the two
genuinely comparison-shaped cards) share a local
`ComparisonMetric`/`ComparisonDriver` shape for their own two
composables only — this is not promoted to `IntelligenceCard.vue` or
imposed on the other three cards:

```ts
// Used only by useRevenueIntelligence / useProfitIntelligence.
interface ComparisonMetric {
  currentUsd: number
  previousUsd: number
  changePct: number | null   // null when previousUsd is 0 — see "Zero/edge cases"
  direction: 'up' | 'down' | 'flat'
}

interface ComparisonDriver {
  key: string                 // e.g. 'transactionCount', 'cogs' — i18n key suffix, not display text
  current: number
  previous: number
  changePct: number | null
  actionRoute?: string
  actionLabel?: string        // i18n key, not display text
}
```

Inventory/Staff/Customer's composables return whatever shape actually
fits them (a snapshot total + list, a ranked pair, a count + list) —
specified per-card below, not forced through a shared interface.

Every card's rendering (headline + driver/detail rows) is formatted
via `t()` at the component layer, exactly like `InsightBanner.vue`'s
`primaryLine()` does today — including showing both absolute values
and percentages where the review recommended it (e.g. "842 → 691, ↓18%").

**Driver/detail ordering is fixed, not query-order-dependent** (each
card's section below states its order explicitly) — this makes the UI
deterministic and the component tests exact rather than order-tolerant.

**Expand behavior:** on mobile, expanding a card collapses any other
currently-expanded card (accordion — one expanded at a time), since
five independently-expandable cards stacked in a single column would
otherwise produce an unbounded-height page. On tablet/desktop, where
cards sit side by side, multiple can be expanded simultaneously.

### Comparison basis

Inherited verbatim from WAFI-144's `insightRanges.ts` — `day` vs same
weekday last week, `week` vs immediately preceding week, `month` vs
immediately preceding month. No new comparison-range logic.

**Day-period truncation — the one real gap this revision closes.**
`useAutomaticInsights.ts` already truncates revenue's `day` comparison
to elapsed time (`getRevenueUsdUpToTimestamp` + `isCurrentDayComplete`)
so a Monday-at-20:00 "today" is compared against last Monday
00:00→20:00, not last Monday's full day — and skips profit's `day`
insight entirely until the current day is complete, for the same
reason (no time-of-day column on `expenses`, see WAFI-144's spec).
**This dashboard's new drivers (transaction count, returns count, avg
basket, COGS, discounts, per-staff figures) do not have that
truncation built** — they'd naively compare a partial today against a
full previous day if implemented as first drafted. Rather than build
new truncated-count queries for every driver, this spec applies
WAFI-144's existing rule uniformly: **for the `day` period, every
card's drivers (not just Profit's) are only computed and shown once
`isCurrentDayComplete` is true.** The headline metric itself (revenue
%, profit %, etc.) still uses whatever WAFI-144 already computes today
(truncated for revenue, hidden until complete for profit). `week` and
`month` need no such gating — both already compare whole elapsed days
on both sides.

**Explicit presentation state, not an empty section.** When `day` is
selected and the current day is incomplete, a card's driver/detail
section must not simply render nothing — an owner seeing "Revenue
↓12%" followed by a blank "Why did this change?" area reads as broken,
not as intentional. Each card renders a neutral placeholder state in
that case, e.g. "Details available once today's comparison is
complete" — a fourth explicit state alongside loading/ready/error, not
inferred from an empty drivers array (an empty array is otherwise a
legitimate "no notable drivers" result once the day *is* complete).

## The 5 cards

### Revenue Intelligence Card
- **Headline metric:** revenue current vs previous period (two
  `useDashboardMetrics()` instances, same pattern `ReportsPage.vue`
  already uses for `metrics`/`previousMetrics`).
- **Drivers, in this fixed order:**
  1. Transaction count — `invoiceCount`, already on the composable.
  2. Return transaction count — **new**: `useDashboardMetrics`
     currently only exposes refund $ total, not a count. Add
     `returnCount` alongside the existing refund query (`COUNT(*)`
     instead of `SUM`). **Explicit domain definition:** this counts
     *return transactions* (rows in `returns`, each linked to one
     `original_sale_id` via `refund_amount_usd`), not distinct sales —
     one sale can have more than one return row against it (e.g.
     partial returns on separate visits). This matches the plan's
     "returns increased by 7" framing (7 return transactions).
  3. Avg basket size — `revenue / invoiceCount`, same calc
     `HomePage.vue` already does inline (`avgPerInvoice`), computed
     for both periods.
- **Actions:** "View transactions" → `/history?period=X`.

### Profit Intelligence Card
- **Headline metric (corrected):** profit **USD** current vs previous
  period — matching WAFI-144's actual convention. Checked
  `evaluateInsight.ts`: WAFI-144's existing profit insight (surfaced
  today on Home/Reports via `InsightBanner.vue`) is already
  dollar-based (`currentUsd`/`previousUsd`/`percentChange` of the
  dollar figure), not margin-percentage-point-based. The first draft
  of this spec said "headline = margin %," which would have
  contradicted the metric an owner already sees elsewhere in the app
  for the same word "profit." Fixed: the headline is profit $ (e.g.
  "Profit ↓14%," meaning profit dollars fell 14%), with margin shown as
  a **supporting** line underneath (current margin % vs previous
  margin %, expressed as a Δ in percentage points, e.g. "Margin 28% →
  24% (−4pp)") — not the headline itself.
- **Drivers, in this fixed order:**
  1. Revenue Δ (reuses the Revenue card's own comparison — profit's
     driver list should explain profit specifically, not repeat basket
     size, which is a revenue-composition detail, not a direct profit
     driver).
  2. COGS Δ — **reuses the existing calculation, does not reproduce
     it**: `useProfitIntelligence` internally instantiates two
     `useDashboardMetrics()` instances (current/previous — the same
     pattern the Revenue card and `ReportsPage.vue` already use) and
     reads `cogsUsd` directly off each. No second, independently
     written COGS query — a duplicate formula is exactly how a
     dashboard tile and a report end up disagreeing on the same number
     after only one of the two gets edited later.
  3. Discounts Δ — **new query**: `SUM(sales.discount_usd)` current vs
     previous period (column already exists on `sales`).
- **Why the driver set changed:** discounts + basket size alone can't
  explain a profit drop driven by rising product cost. Revenue/COGS/
  Discounts covers the three levers that actually move profit and
  reuses data already computed elsewhere in the app.
- **Actions:** none (no discount-report screen exists — see Scope).

### Inventory Intelligence Card
- **Headline metric:** `totalFrozenCapitalUsd` (dollars tied up), not
  the product count — an owner cares more about money stuck than SKU
  count. Reuses `useDeadStockReport()` as-is, fixed at the 60-day
  threshold (the composable already supports 30/60/90/180; the card
  just calls it with 60).
- **Supporting line:** "N products haven't sold in 60 days"
  (`rows.length`) underneath the dollar headline.
- **Expand:** top offenders, ordered by frozen capital descending
  (already the composable's default `sort` value).
- **Actions:** "View dead stock" → `/reports?tab=deadStock`.
- **Shape note:** this is a point-in-time snapshot, not a
  period-comparison — see "Shared card shell" above. There is no
  "previous period frozen capital" in this design; building one would
  need `useDeadStockReport` to support an as-of-date query it doesn't
  have today, which is out of scope here.

### Staff Intelligence Card
- **Headline:** top performer by revenue (`useStaffPerformanceMetrics`,
  unchanged).
- **Discount-rate driver (revised):** instead of "flag the top
  performer if they also have the highest discount total" (which
  falsely implies suspicion when a high-volume seller naturally
  generates proportionally more discounts too), compute **discount
  rate per staff member** (`discountUsd / revenueUsd`, new column
  added to `useStaffPerformanceMetrics` alongside its existing
  revenue/COGS query — same `SUM(sales.discount_usd) GROUP BY
  staff_id`) and separately surface whoever has the **highest discount
  rate**, alongside the shop-average rate for context. No invented
  multiplier threshold (e.g. "2× shop average") gates whether this
  shows — it's always shown as a second, independent fact next to top
  performer, not a conditional "flag."
  - **Shop-average rate is weighted, not an average of per-staff
    rates:** `SUM(all staff discountUsd) / SUM(all staff revenueUsd)`
    for the period — a total-dollars-weighted rate, not
    `average(staff1Rate, staff2Rate, ...)`. Those two produce
    different, and sometimes very different, numbers (a simple
    average lets a low-revenue staff member's rate pull the "shop
    average" away from where the shop's actual dollars sit). The
    weighted total is the metric that answers "what fraction of the
    shop's revenue is being discounted away," which is what the
    comparison is actually for.
  - Order shown: top performer first, then highest-discount-rate
    staff member.
  - Example: "Top performer: Ahmed — $18,400 revenue" /
    "Highest discount rate: Sara — 6.8% (shop average 9.1%)"
- **Actions:** "View Ahmed's performance" → `/reports/staff`.
- **Visibility:** card (and its load call) omitted entirely when the
  viewer lacks `can_view_staff_performance` (see Placement & routing).

### Customer Intelligence Card
- **Renamed from "churn risk" to "inactive 60+ days."** "Churn risk"
  implies a prediction this system doesn't make — it only observes
  that a customer hasn't purchased recently. Using "inactive" avoids
  overclaiming.
- **Headline:** "N customers inactive 60+ days" — **new composable**
  (`useCustomerIntelligence.ts`).
- **Explicit domain rule:** a customer is inactive when they have at
  least one qualifying past sale and their most recent qualifying
  sale's `created_at` is older than 60 days.
  - **Qualifying sale** = any row in `sales` with a non-null
    `customer_id` for that customer, regardless of `is_credit` (credit
    sales count — a credit sale is still a visit) and regardless of
    whether it was later returned (a later full/partial return doesn't
    erase that the visit happened; recency of *visits*, not net
    revenue, is what this card measures).
  - A customer with **zero** qualifying sales ever (new customer, or a
    walk-in sale with no `customer_id`) is excluded — "never
    purchased" is not "went inactive." `sales.customer_id IS NULL`
    rows aren't attributable to any customer row and are never
    counted here.
  - Query: `MAX(sales.created_at) GROUP BY customer_id HAVING
    MAX(created_at) < <60-day cutoff>`, joined to `customers` for name.
- **Expand:** list ordered by last-purchase date ascending (oldest/most
  overdue first).
- **Actions:**
  - "Send reminder" — **new** thin composable
    (`useSendChurnReminder.ts`) mirroring `useSendStatement.ts`'s
    WhatsApp-link pattern: **opens WhatsApp with a prefilled check-in
    message; never sends anything automatically.** No new messaging
    backend. Disabled/hidden for a customer with no phone number on
    file (same `resolvePhone` check `useSendStatement.ts` already
    performs) — never presented as an available action if there's no
    number to send to.
  - "View customer detail" → `/customers/:id` (exists).

## Refresh & error handling

- **Per-card state machine, not inferred from data shape.** Each card
  tracks explicit `'loading' | 'ready' | 'error'` state. This matters
  because "0 dead-stock products" or "0 inactive customers" is valid,
  good-news data — it must render as a normal ready state, never be
  mistaken for a failed load.
- **Auto-refresh:** each card composable exposes a `load(start, end)`
  matching the existing `useDashboardMetrics`-style contract. On
  mount, cards load via:
  ```ts
  const loaders = [
    revenue.load(), profit.load(), inventory.load(), customer.load(),
  ]
  if (canViewStaffPerformance.value) loaders.push(staff.load())
  await Promise.allSettled(loaders)
  ```
  `allSettled` (not `all`) makes the per-card failure isolation
  explicit at the orchestration level, not just inside each card's own
  try/catch.
- **Event-driven refresh is coalesced, not per-event.** Refresh is
  triggered by events WAFI-143 already publishes (`sale.completed`,
  `sale.returned`, `customer.debt_changed`, etc.) via
  `useEventSubscription` — no new event types. But a single business
  action (e.g. completing a sale) can fan out into several of these
  events in quick succession; without coalescing, that would trigger
  several full dashboard reloads within milliseconds. Requirement:
  incoming events within a short window (implementation detail, not
  specified here — e.g. a debounce/microtask-batch) schedule **one**
  refresh cycle that then reloads all cards once, not once per event.
- **Pull-to-refresh:** re-runs the same `Promise.allSettled` loader
  batch on demand.
- **Notifications strip failure isolation:** its own independent load;
  a failure there never blocks or blanks the 5 cards above it.

## Testing

- **Composable/query tests** for every new/extended query: `returnCount`
  on `useDashboardMetrics`, COGS-for-comparison-period, discount Δ,
  the staff discount-rate extension, `useCustomerIntelligence`,
  `useSendChurnReminder` — same Vitest + `db` mock pattern as the rest
  of `dashboard/composables/__tests__`.
- **Calculation/edge-case tests**, called out explicitly per the
  review (these are everyday dashboard states, not rare edges):
  - `previousUsd === 0, currentUsd > 0` → `changePct` must be `null`
    (not `Infinity`/`NaN`), and the card must render a "new activity"
    state rather than a bogus percentage.
  - No sales in either period; no customers at all; no dead stock; no
    staff sales in period; a period that is 100% returns (net revenue
    ≤ 0); negative/zero profit.
  - `day` period, current day incomplete → drivers hidden per the
    "Day-period truncation" rule above and the placeholder state
    renders (not an empty section); headline still shows per WAFI-144's
    existing behavior.
  - Shop-wide discount rate uses the weighted formula (total discount ÷
    total revenue), verified against a case where a simple average of
    per-staff rates would produce a different number.
- **Component tests** per card: headline + driver/detail rendering
  (formatted via `t()`, not baked into the composable), action-link
  routing, loading/ready/error/placeholder states rendering distinctly,
  mobile accordion (expanding one card collapses another) — mirrors
  `InsightBanner.test.ts`.
- No new integration/e2e infra needed.

## Cross-Epic Edge-Case Checklist (design time)

```
Domains touched: Sales, Returns, Inventory, Staff, Customer Credit, Insights
Matrix rows consulted: Sales, Returns, Inventory, Staff, Customer Credit, Insights (WAFI-144)
Open cross-feature questions: none identified — every new query is a straightforward
  extension of an existing composable's WHERE/GROUP BY, no new writes, no new domain.
```

**Domain Interaction Matrix update:** add "Dashboard 2.0" to the
existing "Reports/Dashboards affected" column for the Sales, Returns,
Inventory, Staff, and Customer Credit rows (no new domain row needed —
this feature only reads, via existing composables/extensions).

## Revision notes (v2)

Incorporated from review feedback:
1. Renamed "causal reasons" → "drivers/contributing factors" throughout.
2. Closed a real gap: new drivers need the same day-period elapsed-time
   truncation WAFI-144 already applies to its headline metrics — the
   original draft would have silently reintroduced the "20h vs 24h"
   comparison bug for every new driver. Resolved by gating all drivers
   (not just Profit's) on `isCurrentDayComplete` for the `day` period,
   reusing WAFI-144's existing flag rather than adding new truncated
   queries.
3. Driver detail now carries absolute values, not just percentages.
4. Made the returns-count domain definition explicit (return
   transactions, not distinct sales) after checking the `returns`
   schema — confirmed `COUNT(*)` is correct, not a bug.
5. Profit card drivers changed from Discounts+Basket to
   Revenue Δ/COGS Δ/Discounts Δ — materially more informative, no new
   infrastructure (COGS already computed elsewhere).
6. Staff card changed from a "flag" on discount total to a discount-rate
   comparison against the shop average, avoiding a misleading
   correlation-implies-suspicion framing. No invented threshold.
7. Customer card renamed "churn risk" → "inactive 60+ days"; the
   purchase-qualifying rule (credit sales count, returned sales still
   count as visits, no-customer-id sales excluded) is now explicit.
8. Layout changed from a rigid 2-col-mobile/1-row-desktop grid to
   1/2/auto-fit responsive columns.
9. Explicit loading/ready/error per-card state, `Promise.allSettled`
   orchestration with conditional Staff loader, and coalesced
   event-driven refresh added to "Refresh & error handling."
10. Card composables now return raw metric/driver data
    (`IntelligenceCardMetric`/`IntelligenceCardDriver`), not
    pre-formatted display strings — matches `InsightBanner.vue`'s
    existing data/presentation split rather than diverging from it.
11. Added explicit zero/edge-case tests to the Testing section.

## Revision notes (v3)

Incorporated from a second review pass:
1. Fixed a real headline bug, not just wording: Profit's headline is
   profit **USD**, not margin %, matching WAFI-144's actual
   `evaluateInsight.ts` convention (checked directly) — margin is now
   a supporting line, not the headline metric.
2. `IntelligenceCard.vue` no longer prescribes a shared data contract
   across all 5 cards. It owns presentation only (collapsed/expanded,
   loading/ready/error/placeholder, accordion coordination). The
   period-comparison `ComparisonMetric`/`ComparisonDriver` shape is
   scoped to Revenue/Profit only; Inventory (snapshot), Staff
   (ranking), and Customer (count) each keep their own natural shape
   instead of being bent into a comparison structure they don't have.
3. Added an explicit fourth per-card state — a placeholder ("details
   available once today's comparison is complete") for the `day`
   incomplete-period case — instead of letting the driver section
   render empty, which would look broken rather than intentional.
4. Fixed the shop-average discount rate to be dollar-weighted
   (total discount ÷ total revenue), not an average of per-staff
   rates — those produce materially different numbers, and the
   weighted figure is the one that actually answers "what fraction of
   shop revenue is being discounted."
5. Made explicit that Profit's COGS driver reuses
   `useDashboardMetrics`'s existing `cogsUsd` (via a second
   current/previous instance pair, same as Revenue), rather than a
   second independently-written COGS query — guards against the
   dashboard and reports ever silently disagreeing on the same number.
6. Added mobile accordion behavior (one card expanded at a time on
   mobile; multiple allowed on tablet/desktop) to "Shared card shell."
7. Made driver/detail ordering explicit and fixed per card (previously
   only implied by list order in prose).
