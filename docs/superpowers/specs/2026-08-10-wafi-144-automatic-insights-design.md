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

**Partial-period rule:** if the current period is still in progress
(e.g. it's Monday 11:27, or the 12th of the month), the comparison
period is truncated to the equivalent elapsed portion — e.g. "today
00:00→11:27" vs "last Monday 00:00→11:27," not last Monday's full day.
This prevents a nonsensical "revenue is down 65%" reading purely
because the current day/week/month isn't finished yet.

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

**Revenue:**
- If the comparison period's revenue is `≤ $0` or there is no data
  reaching back that far (shop too new), skip — no insight for revenue
  this cycle. Never show `+∞%` or manufacture a fallback wording.
- Otherwise, generate an insight iff both hold:
  `abs(current - previous) / previous >= INSIGHT_PERCENT_THRESHOLD%`
  AND `abs(current - previous) >= INSIGHT_MIN_ABSOLUTE_CHANGE_USD`.

**Profit:**
- If the comparison period is missing (no data that far back), skip.
- If either period's profit is `≤ $0` (a loss, or exactly break-even),
  percentages are not computed — profit can cross zero, and a percent
  change across a sign flip is meaningless ("−$50 → +$30" is not a
  "+160%"). Instead, use dollar-only phrasing ("profit improved by
  $80 — from a $50 loss to a $30 profit"), gated only by the
  `INSIGHT_MIN_ABSOLUTE_CHANGE_USD` floor (no percent test in this
  branch).
- If both periods are `> $0`, apply the same percent-and-floor rule as
  revenue.

Worked examples:

| Previous | Current | Metric | Result |
|---|---|---|---|
| $100 | $115 | revenue | +15% / +$15 → insight |
| $100 | $108 | revenue | +8% / +$8 → no insight (below % threshold) |
| $100 | $94 | revenue | −6% / −$6 → no insight |
| $4 | $6 | revenue | +50% / +$2 → no insight (below $ floor) |
| $0 | $45 | revenue | skipped (zero baseline) |
| missing | $450 | revenue | skipped (no data) |
| +$100 | +$130 | profit | +30% → insight (percent path) |
| −$50 | +$30 | profit | +$80 → insight (dollar-only path, loss→profit) |
| −$50 | −$48 | profit | +$2 → no insight (below $ floor) |
| $0 | +$40 | profit | +$40 → insight (dollar-only path; previous not "missing," treated as a real $0 baseline for profit, unlike revenue) |

## Delivery model

Live, stateless recompute — no new database table, no read/dismiss
state, no deduplication. Every time Home or the Reports page loads (or
its period changes), the engine recomputes from current data and
renders whatever is true right now. An insight can appear, change
direction, or disappear within the same day as more sales land — this
is intentional; the card represents "what's true right now," not a
historical record.

This is a deliberate architectural split from WAFI-145's Notification
Center:

| | WAFI-144 Insights | WAFI-145 Notifications |
|---|---|---|
| Nature | Derived view of current data | Durable record of an event |
| Storage | None | `notifications` table |
| Trigger | Read-time (page load) | Event-time (something happened) |
| State | None (no read/dismiss) | Read/dismiss/settings |

## Presentation

Primary line: short, plain-language, no jargon — matches the roadmap's
own phrasing exactly (Arabic-first, RTL):

> 📉 المبيعات أقل بنسبة 12% مقارنة بيوم الثلاثاء الماضي

Secondary line: the actual dollar figures, small/muted:

> اليوم $450 · الثلاثاء الماضي $510

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

- Threshold/skip-rule table above should become the core unit test
  matrix (revenue and profit paths, including the loss↔profit
  transition and the zero-vs-missing distinction).
- Partial-period truncation needs an explicit test for a mid-day/
  mid-week/mid-month clock, asserting the comparison window's elapsed
  portion matches the current period's, not the full prior period.
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
