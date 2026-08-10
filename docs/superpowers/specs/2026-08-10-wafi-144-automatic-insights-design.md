# WAFI-144 — Automatic Insights (Design Spec)

Date: 2026-08-10
Status: Approved by founder, ready for planning

## Problem

Shop owners see raw numbers (today's revenue, today's profit) but have to
do the comparison in their head — "is this good or bad?" The roadmap's
own framing: turn numbers into conclusions ("Sales are 12% lower than
last Tuesday") rather than making the owner do the subtraction.

Nothing in the codebase does period-over-period comparison today.
`useAnomalyDetection.ts` (WAFI-015) only checks single-period thresholds
(e.g. "expenses > 30% of income") — it has no notion of "compared to
last week." `useDashboardMetrics`/`useProfitTrend` compute one period's
numbers per call, with no diffing helper. This ticket is genuinely new
work, not a duplicate of WAFI-015.

## Scope

**In scope:** A stateless engine that compares the current period's
Revenue and Profit against the equivalent prior cycle, and — when the
difference is large enough to matter — produces a short plain-language
insight. Surfaced on Home (day) and the Reports page (week/month).

**Out of scope (explicitly deferred):**
- Explaining *why* a number changed (transaction count, returns, staff
  activity) — that's WAFI-146 (Dashboard 2.0).
- Quarter and custom-range periods — no unambiguous "equivalent prior
  cycle" defined for them yet; can be added later as its own follow-up.
- Any new notification/event type, or persistence of insights over time
  — see "Delivery model" below.
- User-configurable thresholds or comparison basis — one deterministic
  rule, tunable later only by changing constants, not exposed as a
  setting in this ticket.

## Comparison basis

Insights compare the current period against the equivalent prior cycle:

| Period | Compared against |
|---|---|
| `day` | Same weekday, previous week |
| `week` | Immediately preceding week |
| `month` | Immediately preceding month |

**Week/month boundaries:** week is ISO/Monday-start, matching the
existing convention in `periodUtils.ts` (`getDateRange`'s `'week'`
branch, already consumed by `useDashboardMetrics`/`useProfitTrend`) —
not reinvented here, just inherited.

**Partial-period rule:** if the current period is still in progress
(e.g. it's Monday 11:27, or the 12th of the month), the comparison
period is truncated to the equivalent elapsed portion — e.g. "today
00:00→11:27" vs "last Monday 00:00→11:27," not last Monday's full day.
This prevents a nonsensical "revenue is down 65%" reading purely
because the current day/week/month isn't finished yet.

All date math (today's cutoff, the comparison window's matching
cutoff, week/month boundaries) uses local wall-clock time via JS
`Date`'s local getters (`getHours()`, `getDate()`, etc.) — the same
convention already used everywhere else in this app
(`periodUtils.ts`, `businessHours.ts`, `usePeriodToggle.ts`,
`useDailyDigest.ts`) and deliberately never `Date.UTC`/`getUTCHours()`,
so a DST transition over a week/month boundary can't silently shift
the comparison cutoff by an hour. No new date-handling code is
introduced — this reuses the existing pattern rather than inventing
one.

The engine is UI-agnostic — it takes an `InsightPeriod` and has no
concept of "Home" or "Reports":

```ts
type InsightPeriod = 'day' | 'week' | 'month'
```

Home always requests `'day'`. Reports requests `'week'`/`'month'` to
match its existing period selector; it passes nothing (no insight
rendered) for `'quarter'`/`'custom'`.

## Metrics

Revenue and Profit only (both already computed by
`useDashboardMetrics`/`useProfitTrend` — reused, not reimplemented).
Each metric is evaluated independently; a given cycle can produce zero,
one, or two insight cards.

## Threshold and skip rules

Named constants (tunable later without redesigning the engine):

```ts
const INSIGHT_PERCENT_THRESHOLD = 10        // percent
const INSIGHT_MIN_ABSOLUTE_CHANGE_USD = 5   // dollars
```

**"Missing" is a precise term, not a vibe:** a comparison period is
*missing* iff its start date is before `shops.created_at` — the shop
didn't exist yet for (some or all of) that window, so there is nothing
to compare against. If the comparison window's start is on/after
`shops.created_at`, any $0 result is a *genuine zero* (the shop was
open and simply had no revenue/profit that period), not missing data.
This distinction doesn't change revenue's behavior (both missing and
zero baselines skip), but it matters for profit, where a genuine $0 is
evaluated on the dollar-only path while a missing period is skipped.

**Revenue:**
- If the comparison period is missing, or its revenue is `≤ $0`, skip
  — no insight for revenue this cycle. Never show `+∞%` or manufacture
  a fallback wording. (A revenue swing that lands exactly on $0 today
  is handled by the "no sales today" phrasing case below — that's
  about the *current* period being zero, not the comparison period.)
- Otherwise, generate an insight iff both hold:
  `abs(current - previous) / previous >= INSIGHT_PERCENT_THRESHOLD%`
  AND `abs(current - previous) >= INSIGHT_MIN_ABSOLUTE_CHANGE_USD`.

**Profit:**
- If the comparison period is missing, skip.
- If either period's profit is `≤ $0` (a loss, or exactly break-even),
  percentages are not computed — profit can cross zero, and a percent
  change across a sign flip is meaningless ("−$50 → +$30" is not a
  "+160%"). Instead, use dollar-only phrasing, gated only by the
  `INSIGHT_MIN_ABSOLUTE_CHANGE_USD` floor (no percent test in this
  branch). The engine returns a `direction` so the UI never has to
  infer wording from raw sign math:

  | Previous | Current | `direction` | Example phrasing |
  |---|---|---|---|
  | loss | profit | `loss_to_profit` | "Profit improved by $80 — from a $50 loss to a $30 profit" |
  | profit | loss | `profit_to_loss` | "Went from a $30 profit to a $50 loss — down $80" |
  | loss | smaller loss | `loss_narrowed` | "Loss narrowed by $30 — from $50 to $20" |
  | loss | bigger loss | `loss_widened` | "Loss widened by $50 — from $20 to $70" |
  | $0 | profit | `loss_to_profit` (treated as the $0-loss boundary) | "Profit improved by $40" |
  | $0 | loss | `profit_to_loss` | "Went into a $40 loss" |

  Never phrase a widening/growing loss as "profit decreased by
  −$40" — the sign must always resolve to one of the verbs above.
- If both periods are `> $0`, apply the same percent-and-floor rule as
  revenue, with `direction: 'up' | 'down'`.

**Revenue also carries `direction: 'up' | 'down'`**, plus a dedicated
case: if current revenue is exactly `$0` (and the comparison period
passed the percent+floor test), use "No sales today, compared to $X
last Tuesday" rather than the generic "100% lower" phrasing — a flat
percentage reads oddly at the 100%-drop boundary.

Worked examples:

| Previous | Current | Metric | Result |
|---|---|---|---|
| $100 | $115 | revenue | `up`, +15% / +$15 → insight |
| $100 | $108 | revenue | +8% / +$8 → no insight (below % threshold) |
| $100 | $94 | revenue | −6% / −$6 → no insight |
| $4 | $6 | revenue | +50% / +$2 → no insight (below $ floor) |
| $100 | $0 | revenue | `down`, −100% / −$100 → insight, "no sales today" phrasing |
| $0 | $45 | revenue | skipped (zero comparison baseline) |
| missing (shop created after comparison window start) | $450 | revenue | skipped |
| +$100 | +$130 | profit | `up`, +30% → insight (percent path) |
| −$50 | +$30 | profit | `loss_to_profit`, +$80 → insight |
| +$30 | −$50 | profit | `profit_to_loss`, −$80 → insight |
| −$20 | −$70 | profit | `loss_widened`, −$50 → insight |
| −$70 | −$20 | profit | `loss_narrowed`, +$50 → insight |
| −$50 | −$48 | profit | +$2 → no insight (below $ floor) |
| $0 | +$40 | profit | `loss_to_profit`, +$40 → insight (genuine $0 baseline, not missing) |

## Delivery model

Live, stateless recompute — no new database table, no read/dismiss
state, no deduplication. Every time Home or the Reports page loads (or
its period changes), the engine recomputes from current data and
renders whatever is true right now. An insight can appear, change
direction, or disappear within the same day as more sales land — this
is intentional; the card represents "what's true right now," not a
historical record.

**Data freshness caveat:** because this reads through
`useDashboardMetrics`/`useProfitTrend`, the insight is only as fresh as
those hooks — if they're cached or lag behind a just-completed sale
(offline-first sync), the insight lags too. This is expected, not a
bug: "insight doesn't update instantly after a sale" is a freshness
characteristic inherited from the underlying metrics hooks, not
something WAFI-144 needs to solve.

This is a deliberate architectural split from WAFI-145's Notification
Center:

| | WAFI-144 Insights | WAFI-145 Notifications |
|---|---|---|
| Nature | Derived view of current data | Durable record of an event |
| Storage | None | `notifications` table |
| Trigger | Read-time (page load) | Event-time (something happened) |
| State | None (no read/dismiss) | Read/dismiss/settings |

## Presentation

The engine returns typed metadata, not pre-rendered strings — the UI
layer owns phrasing/i18n/color, the engine only owns the numbers and
the semantic `direction`:

```ts
interface Insight {
  metric: 'revenue' | 'profit'
  direction: 'up' | 'down' | 'loss_to_profit' | 'profit_to_loss'
            | 'loss_widened' | 'loss_narrowed'
  currentUsd: number
  previousUsd: number
  percentChange: number | null   // null on the dollar-only profit paths
}
```

`direction` drives both the verb (higher/أعلى vs lower/أقل vs
widened/زادت vs narrowed/انخفضت, per the phrasing table above) and the
color (`up`/`loss_to_profit`/`loss_narrowed` → green;
`down`/`profit_to_loss`/`loss_widened` → red) — the UI never infers
either from raw sign arithmetic.

Primary line: short, plain-language, no jargon — matches the roadmap's
own phrasing exactly (Arabic-first, RTL):

> 📉 المبيعات أقل بنسبة 12% مقارنة بيوم الثلاثاء الماضي

Secondary line: the actual dollar figures, small/muted. Currency
display follows the existing app-wide convention — there is no
`<Currency>` component or `formatCurrency` helper anywhere in this
codebase; every money value (`ReportsPage.vue`, anomaly messages) is
inline `${{ value.toFixed(2) }}` wrapped in `dir="ltr"`. Insights
follow that same pattern rather than introducing a new one:

> اليوم $450 · الثلاثاء الماضي $510

USD only, matching WAFI-017's existing precedent (money-owed reporting
is USD-only since neither underlying data source tracks SYP
separately) — `useDashboardMetrics`/`useProfitTrend`, which this
reuses, only expose `*Usd` fields.

No charts, no extra explanation, no paragraphs — one card, two lines.
Visually reuses `AnomalyBanner.vue`'s existing card styling for
consistency with the app's other computed-insight surface, rather than
introducing a new visual pattern.

## Where it plugs in

- **Home:** a new insight section/card near (not replacing)
  `AnomalyBanner.vue`, computed for `period: 'day'`.
- **Reports page:** a similar section next to the existing anomaly
  banner there, computed for whichever of `'week'`/`'month'` matches
  the page's current period selector; renders nothing for
  `'quarter'`/`'custom'`.
- Both call the same `useAutomaticInsights(period)` composable — no
  UI-specific logic lives in the engine itself.

## Testing notes

- Threshold/skip-rule tables above should become the core unit test
  matrix (revenue and profit paths, all six `direction` cases —
  including both loss-widening and loss-narrowing — the exact-$0
  "no sales today" case, and the zero-vs-missing distinction driven
  by `shops.created_at`).
- Partial-period truncation needs an explicit test for a mid-day/
  mid-week/mid-month clock, asserting the comparison window's elapsed
  portion matches the current period's, not the full prior period —
  plus a DST-boundary regression test in the style of
  `businessHours.test.ts`'s TZ-stubbed case, confirming local-getter
  math doesn't shift the cutoff across a DST transition.
- No new migration, no new RLS surface, no new event type — this
  reduces the testing surface considerably relative to a typical WAFI
  ticket.

## Cross-Epic Edge-Case Checklist (design time)

```
Domains touched: Sales, Products/Cost (via useDashboardMetrics/useProfitTrend), Reports/Dashboard
Matrix rows consulted: Sales, Products / Cost, Audit (confirmed no audit-log write applies — this is a read-only derived view, not a financial write)
Open cross-feature questions: none identified — deliberately does not touch Notifications, Events, or Cash/Shifts; WAFI-146 owns the causal "why" breakdown that would touch more domains
```

A new **Insights** row is added to the Domain Interaction Matrix in
`AI_PRINCIPAL_ENGINEER_REVIEW.md`:

| Domain | Writes to (tables) | Reads from (other domains) | Key composables | Reports/Dashboards affected |
|---|---|---|---|---|
| Insights | none (stateless, no persistence) | Sales, Products/Cost (via `useDashboardMetrics`/`useProfitTrend`) | `useAutomaticInsights` | Home, Reports page |
