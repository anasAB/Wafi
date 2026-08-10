# WAFI-146 — Dashboard 2.0 (Design Spec)

Date: 2026-08-10
Status: Approved by founder, ready for planning

## Problem

Today's dashboard (Home, Reports) shows numbers and — since WAFI-144 —
a single up/down comparison insight for revenue and profit. It still
doesn't answer "why": an owner sees revenue is down 12% but has to go
digging through history/reports/staff pages themselves to find out
whether that's fewer transactions, more returns, a discount spree, or
something else. The roadmap's framing: executive intelligence, not
metrics — explain WHY, not just WHAT.

## Scope

**In scope:** a new `/dashboard` screen with 5 expandable "intelligence
cards" (Revenue, Profit, Inventory, Staff, Customer), each showing a
headline comparison plus 2-3 concrete causal reasons pulled from data
that already exists (or is a small, obvious extension of an existing
query). Fixed period selector (Today / This Week / This Month) and a
fixed previous-equivalent-period comparison, reusing WAFI-144's
`insightRanges.ts` semantics.

**Out of scope (explicitly deferred or dropped):**
- **Register-offline-duration** and **supplier price-change history**
  reasons from the original plan text — no tracking infrastructure for
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
  of the causal explanation. Left out; can be a follow-up.
- **"View returns" and "View discounts" action links.** No returns-list
  or discount-report screen exists anywhere in the app. Rather than
  build two new list screens just to host a link, these action links
  are dropped — the reason text (with numbers) still shows, just
  without a tap-through. Same for "Create promotion" (Inventory card) —
  there is no promotions feature in this app at all.
- Replacing Home's content. Home (`HomePage.vue`) stays exactly as the
  fast operational glance it is today — unchanged.

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
the Staff card is omitted from the grid rather than shown locked.

Added as a new item in the existing sidebar + bottom nav, alongside
Home and Reports — not a replacement for either.

## Layout

Top → bottom, on `Dashboard2Screen.vue`:

1. **Period selector** — Today | This Week | This Month. Own local
   `ref`, same pattern `ReportsPage.vue` already uses (not the shared
   `usePeriodToggle` singleton Home uses).
2. **5 intelligence cards** — 2-column grid on mobile, single row on
   desktop (same responsive convention as Home's `.kpi-strip`).
3. **Quick actions row** — ring sale, add expense, record payment, open
   shift. All route to existing screens; no new logic.
4. **Recent notifications strip** — last 5 rows from the `notifications`
   table (already populated by WAFI-145), links to `/notifications`.

### Shared card shell

One `IntelligenceCard.vue` wrapper, not 5 bespoke shells. Collapsed by
default; tap to expand. Each card composable returns:

```ts
interface IntelligenceCardData {
  headline: string          // "Revenue ↓12% vs. yesterday"
  direction: 'up' | 'down' | 'flat'
  reasons: {
    label: string
    detail: string
    actionRoute?: string
    actionLabel?: string
  }[]
}
```

`IntelligenceCard.vue` always renders the headline; expanding reveals
`reasons`, each row optionally tappable via `actionRoute` (same
routing mechanism WAFI-145 already established for notification
deep-links — no new mechanism).

### Comparison basis

Inherited verbatim from WAFI-144's `insightRanges.ts` — `day` vs same
weekday last week, `week` vs immediately preceding week, `month` vs
immediately preceding month. No new comparison logic.

## The 5 cards

### Revenue Intelligence Card
- **Headline:** % change vs previous period. Current/previous revenue
  from two `useDashboardMetrics()` instances (exact pattern
  `ReportsPage.vue` already uses for `metrics`/`previousMetrics`).
- **Reasons:**
  - Transaction count Δ — `invoiceCount`, already on the composable.
  - Returns count Δ — **new**: `useDashboardMetrics` currently only
    exposes refund $ total, not a count. Add `returnCount` alongside
    the existing refund query (same WHERE clause, `COUNT(*)` instead
    of `SUM`).
  - Avg basket size Δ — `revenue / invoiceCount`, same calc
    `HomePage.vue` already does inline (`avgPerInvoice`), computed for
    both periods.
- **Actions:** "View transactions" → `/history?period=X`.

### Profit Intelligence Card
- **Headline:** margin % and percentage-point change vs previous period.
- **Reasons:**
  - Total discounts Δ — **new query**: `SUM(sales.discount_usd)`
    current vs previous period (column already exists on `sales`).
  - Basket size flat/Δ — shared calc with Revenue card.
- **Actions:** none (see "View discounts" drop above).

### Inventory Intelligence Card
- **Headline:** "N products haven't sold in 60 days" — reuses
  `useDeadStockReport()` as-is, fixed at the 60-day threshold for the
  headline (the composable already supports 30/60/90/180; the card
  just calls it with 60).
- **Expand:** top offenders by frozen capital (`totalFrozenCapitalUsd`,
  already computed).
- **Actions:** "View dead stock" → `/reports?tab=deadStock`.

### Staff Intelligence Card
- **Headline:** top performer by revenue, flagged if the same person
  also has the highest discount total.
- **Data:** `useStaffPerformanceMetrics()`, extended with a **new**
  per-staff discount total (`SUM(sales.discount_usd) GROUP BY
  staff_id`, same period/shop scoping as the existing revenue/COGS
  queries in that composable).
- **Actions:** "View Ahmed's performance" → `/reports/staff`.
- **Visibility:** card omitted entirely when the viewer lacks
  `can_view_staff_performance` (see Placement & routing above).

### Customer Intelligence Card
- **Headline:** "N customers at churn risk (no purchase in 60 days)" —
  **new composable** (`useCustomerChurnRisk.ts`): `MAX(sales.created_at)`
  per customer vs. a 60-day cutoff, excluding customers who have never
  purchased (no prior sale = not "churned," just new/inactive).
- **Expand:** list with last-purchase date per customer.
- **Actions:** "Send reminder" — **new** thin composable
  (`useSendChurnReminder.ts`) mirroring `useSendStatement.ts`'s
  WhatsApp-link pattern, with a simple check-in message (no new
  messaging infrastructure). "View customer detail" → `/customers/:id`
  (exists).

## Refresh & error handling

- **Auto-refresh:** each card composable exposes a `load(start, end)`
  matching the existing `useDashboardMetrics`-style contract. All 5
  load in parallel on mount for the current period. Refresh is driven
  by events WAFI-143 already publishes (`sale.completed`,
  `sale.returned`, `customer.debt_changed`, etc.) via
  `useEventSubscription` — no new event types.
- **Pull-to-refresh:** re-runs all `load()` calls.
- **Per-card failure isolation:** each card's `load()` is wrapped
  independently — one card's query throwing shows that card's own
  inline retry state, without blanking the other four (matches
  `HomePage.vue`'s per-section `try/catch` discipline in `onMounted`).

## Testing

- Unit tests per new/extended composable: `returnCount` on
  `useDashboardMetrics`, the discount-Δ query, the staff discount
  extension, `useCustomerChurnRisk`, `useSendChurnReminder` — same
  Vitest + `db` mock pattern as the rest of
  `dashboard/composables/__tests__`.
- Component tests per card: headline text, reasons list rendering,
  action-link routing — mirrors `InsightBanner.test.ts`.
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
