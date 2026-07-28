# WAFI-017: Unified "Money Owed" View Design

**Date:** 2026-07-28
**Status:** Draft (rev 4 — incorporates founder review)
**Ticket:** WAFI-017 (P2, 0.5 sprint, "Credit + installments combined, aging buckets")

## Context

Confirmed via code audit 2026-07-27 (`WAFI_Production_Readiness_Plan_v3.md` status
table): no implementation exists for WAFI-017 today. This is a genuinely unbuilt
ticket.

**Note on ticket numbering:** this repo has two independent WAFI-NNN schemes that
collide (see `project_wafi_ticket_numbering` memory). A *different* WAFI-017 —
the real ESC/POS printer driver (Sacred Rule #3 hardware support) — is tracked
in `docs/superpowers/plans/2026-06-21-roadmap-index.md` and is unrelated,
still-open work. This spec is for the v3-roadmap WAFI-017 ("Unified Money Owed
View"), scheduled Week 7 / Macro-Phase 1 Hardening Batch 2 alongside
WAFI-016/018/019.

**Relationship to the v3 roadmap ticket text:** the roadmap line ("Credit +
installments combined, aging buckets") is a scope pointer, not a spec — this
document is the actual spec. It also closes a gap noted separately in
`docs/superpowers/plans/2026-06-21-roadmap-index.md`'s "confirmed still-open
gaps" list: *"AR aging — Customer pack has an open-invoice list but no aging
buckets (0-30/30-60/60+)."* That existing open-invoice list is
`CollectionsWorklistPage.vue` (see below) — WAFI-017 closes that gap with a
new screen that reuses `CollectionsWorklistPage.vue`'s data and adds the
missing aging buckets plus installments, rather than building a screen
unrelated to any existing credit-owed concept. See §7 for why this is an
additional, coexisting screen rather than a modification of
`CollectionsWorklistPage.vue` itself.

**What already exists and gets reused, not rebuilt:**

- **Customer credit balance.** `useCustomerBalance.ts` and
  `useCollectionsWorklist.ts` (`src/features/customers/composables/`) already
  compute a customer's outstanding credit as `SUM(credit sales) -
  SUM(payments) - SUM(returns on credit sales) - SUM(store-credit refunds)`,
  scoped per customer. `useCollectionsWorklist.ts` already computes
  `daysOutstanding` — days since the customer's oldest unpaid credit sale
  (a FIFO anchor via `MIN(created_at)` over sales with an unpaid remainder).
  WAFI-017 reuses this balance query and FIFO-anchor age calculation directly.
- **Installment due tracking.** `useInstallmentPlan.ts`
  (`src/features/installments/composables/`) already has a `dueBucket(due,
  today)` function returning `'upcoming' | 'due' | 'overdue' | 'paid' |
  'voided'` per `installment_dues` row, explicitly computed at read time (no
  background scheduler, matching this app's offline-first constraint).
  WAFI-017 extends this per-row due-date math into day-count aging buckets
  rather than inventing new due-date logic.
- **Existing open-invoice list.** `CollectionsWorklistPage.vue`, routed at
  `/customers/collections` (`can_view_reports`), already lists debtor
  customers ranked by balance/age with a single binary "overdue" threshold
  (default 30 days) — no 0-30/30-60/60+ buckets. WAFI-017's new screen reuses
  this composable's data (see §4) rather than recomputing credit age, but
  **it coexists with, and does not replace,** `CollectionsWorklistPage.vue` —
  see §7 for why the two serve different moments (daily collections workflow
  vs. periodic risk triage) and stay as separate screens.

**What's genuinely new:**

- **No unified query combines credit + installments today.** They live in two
  separate features with two separate composables and no shared "total owed"
  concept.
- **No day-bucketed aging exists anywhere.** Both the credit worklist and the
  installment due list use a single overdue/not-overdue split, not
  0-30/31-60/60+ ranges.
- **Credit sales have no due date.** Confirmed via
  `docs/superpowers/specs/2026-06-02-customer-credit-ledger.md`: a credit sale
  is only `sales.is_credit = 1` + `sales.customer_id`, with no
  `credit_due_date` or `payment_terms_days` column anywhere in the schema.
  Credit aging can only ever be "days since the sale," never "days past a due
  date" — that's a real, permanent constraint, not a gap this ticket can close
  (see §2 below for how this shapes the bucket definition).

## 0. Definition of "today"

Every age/bucket calculation in this doc uses "today" to mean **the device's
local calendar day** — the same convention `useInstallmentPlan.ts`'s
`dueBucket()` and the dashboard's period calculations (`periodUtils.ts`'s
`toDateStr`) already use, not a UTC day boundary. This matters specifically
because this is an offline-first app: a device can compute "today" without
any server round-trip, and mixing local-day and UTC-day boundaries across
composables is exactly the kind of bug that surfaces as an off-by-one-day
aging discrepancy between this screen and the installment due list it reuses
logic from. Stated once, here, rather than repeated (and risking drift) at
every mention of "today" below.

## 1. Scope decision: one merged list, not two side-by-side sections

**Decision:** WAFI-017 produces a single per-customer list — one row per
customer who owes the shop money via *either* credit or installments (or
both) — with a combined `totalOwedUsd` and a bucket assignment, rather than
two separate "Credit" and "Installments" sections stacked on the page.

**Why:** the ticket's own scope line says "combined," and the product
question this screen answers is "who owes me money and how worried should I
be" — an owner shouldn't have to mentally sum two separate lists to know that
one customer owes $200 in overdue credit *and* has a defaulted installment.
A customer with both shows up once, with a breakdown of the two components
inside the row (see §4).

## 2. Aging bucket definition — the hard part of this ticket

Credit and installments aren't structurally comparable: credit only has "days
since the sale" (no due date), while installments have a real per-due-row
`due_date`. Two different "how overdue" numbers need to become one bucket per
customer.

**Decision:**
- **Credit component age** = `daysOutstanding` from `useCollectionsWorklist.ts`
  (days since the oldest unpaid credit sale) — reused verbatim, not
  recomputed.
- **Installment component age** = for each customer, the number of days
  between today and the due date of their **oldest unpaid (`pending`) due
  row that is at or past its due date** — i.e., the same anchor logic as
  credit (oldest unresolved obligation), applied to `installment_dues.due_date`
  instead of a sale date. A due row not yet at its due date contributes 0
  days (it isn't aged at all — see §3 for how "not yet due" amounts are
  handled). **A customer with multiple installment plans has all of their
  qualifying dues (across every plan) aggregated into one `installmentOwedUsd`
  sum and one oldest-due-row age anchor before being joined with that
  customer's credit row** — this composable does not surface individual
  plans, only the per-customer total, matching the per-customer (not
  per-invoice, not per-plan) granularity of the rest of this screen.
- **Customer's bucket** = whichever of the two component ages is larger (the
  worse one), not an average of a fresh installment and old credit. Age
  alone isn't a complete risk signal, but for the purposes of *this screen*,
  the aging bucket shown is determined by the customer's single most
  overdue obligation.
- **Buckets, as a code enum, not string-literal ranges:**
  ```
  type AgingBucket = '0_30' | '31_60' | '60_plus'
  ```
  applied to the max age above (0-30 / 31-60 / 60+ days). Using an enum-style
  identifier rather than the display string (`'0-30'` etc.) as the field's
  actual type means adding a fourth bucket later (e.g. a `91_plus` split) is
  a type/logic change in one place, not a find-and-replace across every
  string comparison in the codebase. The UI renders `AgingBucket` values to
  their display form (`0_30` → "0-30", `31_60` → "31-60", `60_plus` → "60+")
  at render time — the enum identifiers are never shown to the owner
  directly.
  **`0_30` explicitly includes age 0** — a credit sale rung today is owed
  starting the moment it's rung (per Context: credit has no future/current
  distinction the way installments do), so a customer whose only obligation
  is a same-day credit sale appears in `0_30` with `ageDays: 0`, not
  excluded. The *only* way a customer produces no row at all is the §3 case
  (nothing qualifies as currently owed — e.g. only not-yet-due installment
  amounts and zero credit balance); a customer with age 0 owed via credit is
  a different case and is shown.

Written down here precisely so a future reader doesn't assume the bucket is
some other average or sum of the two ages.

## 3. Not-yet-due installment amounts are excluded from "money owed"

An active installment plan's future (not-yet-due) dues are money the
customer *will* owe, not money they *currently* owe — including them in a
"money owed" total would overstate the shop's actual receivable risk and
conflate "scheduled" with "overdue/outstanding." **Decision:** only
`installment_dues` rows with `status = 'pending'` **and** `due_date <= today`
count toward `installmentOwedUsd`. A fully-current customer whose only
installment dues are all in the future does not appear on this screen at all
— they owe nothing *yet*.

This mirrors how credit already works (a credit sale is "owed" the moment
it's rung, so there's no future/current distinction to make there) — this
decision exists specifically to define the equivalent boundary for
installments, where a future/current distinction is meaningful.

**Naming note:** "money owed" is used throughout this doc to mean
*currently collectible* (per this section's definition), not "everything the
customer will ever owe under a signed plan." A future installment due is
real money the shop will eventually collect, just not yet — the screen name
and field names stay "Money Owed" / `MoneyOwedRow` rather than something
like "Outstanding Receivables," matching the roadmap ticket's own title, but
this paragraph is the definition to point to if that ever reads as
ambiguous.

## 4. New composable: `useMoneyOwed.ts`

New file: `src/features/customers/composables/useMoneyOwed.ts` (customers
feature, not dashboard/reports — see §7 on IA placement).

- No date-range/period input — this is a point-in-time snapshot, matching
  the existing precedent (`useCollectionsWorklist.ts` and
  `useInstallmentPlan.ts` both take no period; "money owed right now" has no
  meaningful date range, only a snapshot moment). `load()` takes no
  arguments and queries current state.
- Per customer with `creditOwedUsd > 0` or `installmentOwedUsd > 0`:
  ```
  interface MoneyOwedRow {
    customerId: string
    customerName: string
    creditOwedUsd: number
    installmentOwedUsd: number
    totalOwedUsd: number        // creditOwedUsd + installmentOwedUsd
    ageDays: number             // max(credit age, installment age) — see §2
    bucket: AgingBucket         // '0_30' | '31_60' | '60_plus' — see §2
  }
  ```
  **Merge key:** rows are keyed by `customerId`; each customer appears at
  most once in the final row set (credit and installment amounts for the
  same customer are combined into one row, per §1, not two).
  **No speculative fields** (e.g. a `riskLevel` score or a `flags` array)
  are added to this interface for future collection-priority features not
  yet on the roadmap — this codebase's discipline is to not design for
  hypothetical requirements (per CLAUDE.md's working principles), and
  nothing in the current roadmap calls for a risk score beyond the three
  aging buckets already specified. If a future ticket needs one, it extends
  this interface then.
- **Reuse mechanism, made explicit — data helpers, not composable-on-
  composable.** `useMoneyOwed.ts` must **not** call `useCollectionsWorklist()`
  or `useInstallmentPlan()` directly as its data source. Those are
  UI-oriented composables (they own `ref`s, loading state, and are free to
  grow UI-only concerns later — search, pagination, filters, selection state
  — none of which a business/aggregation composable should depend on). Making
  `useMoneyOwed.ts` depend on them would couple a data-aggregation concern to
  a screen-oriented one, backwards from how this codebase already separates
  the two (e.g. `useDashboardMetrics`/`useProfitTrend` are themselves the
  shared data layer that screens depend on — nothing depends upward on a
  screen's composable).

  Instead: **reuse the shared data-access logic those two composables
  currently use, not the composables themselves.** Concretely — the credit
  balance + `daysOutstanding` query body inside `useCollectionsWorklist.ts`
  and the qualifying-dues query inside `useInstallmentPlan.ts` should each be
  extracted into a plain (non-reactive, no `ref`s) query helper function that
  both the existing composable and `useMoneyOwed.ts` call. If, at
  implementation time, that extraction hasn't happened yet and those two
  composables currently encapsulate the only implementation of this logic,
  **extract the shared query into a reusable helper as part of this ticket**
  rather than either duplicating the SQL/business logic into
  `useMoneyOwed.ts` or taking the shortcut of depending on the composables
  directly. `useMoneyOwed.ts` must not duplicate that SQL/business logic
  under any circumstance — extraction is the one acceptable path, not an
  optional nice-to-have.
- **USD only, explicitly.** Both underlying data sources are USD-only today
  (`useCustomerBalance`'s balance is USD-only; `installment_plans`/
  `installment_dues` have no SYP columns at all — confirmed in the codebase
  research for this spec). This ticket does not add a SYP figure to either
  source — doing so would be a larger schema/data-model change to two
  existing features, well beyond a 0.5-sprint aggregation ticket. **The UI
  must not silently imply this is the full picture in both currencies** —
  see §6.
- Also computes shop-wide bucket totals — **money, not customer counts**:
  `totals: Record<AgingBucket, number> & { grandTotal: number }`, where each
  bucket value is `SUM(totalOwedUsd)` over the rows whose `bucket` matches,
  and `grandTotal` is `SUM(totalOwedUsd)` over every row. (A separate
  customer-count-per-bucket figure is not computed — see Out of Scope.) All
  from the same row set already in memory, no second query. **These totals
  always reflect the full qualifying row set returned by `load()`, never a
  client-side-filtered subset** — there is no search/filter feature on this
  screen in this ticket (see Out of Scope), but this is stated explicitly now
  so that if one is added later, the summary cards are not silently
  redefined to mean "visible rows" without a deliberate decision to do so.

## 5. New screen: `MoneyOwedPage.vue`

New file: `src/features/customers/components/MoneyOwedPage.vue`, routed at
`/customers/money-owed`.

- Three bucket-total summary cards at the top (0-30 / 31-60 / 60+), plus a
  grand total headline — same "headline + breakdown" visual pattern already
  used on `ReportsPage.vue`'s profitability tab, for consistency.
- Below that, the per-customer table: name, credit owed, installment owed,
  total owed, age (days), bucket — **all columns sortable** (same rationale
  as WAFI-018: owners ask different questions — "who owes the most," "who's
  most overdue" — and sorting is nearly free once the data's in memory).
  Default sort: `ageDays` descending (oldest/most-overdue risk first, since
  that's the actionable "who do I need to chase" ordering). **Tie-break
  chain, applied regardless of which column is the active sort:**
  `ageDays` → `totalOwedUsd` → `customerName` (each descending except name,
  which is ascending). Concretely: sorting by `totalOwedUsd` still breaks
  ties by `ageDays` then `customerName`; sorting by `customerName` still
  breaks ties by `ageDays` then `totalOwedUsd` (name ties are rare but not
  impossible with duplicate customer names). The chain is fixed and does not
  change based on which column the owner clicked — only the primary sort key
  changes, never the tie-break order behind it — so the ordering is always
  fully deterministic and never depends on incidental query/array order.
- **Zero state:** if no customer has any qualifying owed amount, render
  "لا يوجد مبالغ مستحقة حالياً" (no outstanding amounts right now) instead of
  an empty table.
- Tapping a customer row navigates to the existing
  `CustomerDetailPage.vue` (`/customers/:id`) — this screen is a triage list,
  not a new place to manage payments; payment recording/collection actions
  stay on the customer detail page where they already live. No new
  drill-down UI is built for this ticket. `CustomerDetailPage.vue` is the
  right single destination regardless of *which* component (credit,
  installment, or both) a given row represents: it already embeds both the
  credit ledger and `InstallmentPlanSection.vue` (confirmed in
  `src/features/customers/CustomerDetailPage.vue`), making it the one
  existing screen that already shows a customer's full picture rather than
  just one component of what they owe.

## 6. Currency caveat — must be on screen, not just in this doc

Per §4, every figure here is USD-only. A static caption under the summary
cards states this explicitly: "المبالغ بالدولار فقط، ولا تشمل أي رصيد بالليرة
السورية بشكل منفصل" (amounts are in USD only; they do not separately track
any SYP balance) — so an owner doesn't assume this total also reflects a SYP
receivable that isn't actually being tracked here.

## 7. Information architecture — lives under Customers, not Reports, and coexists with Collections (does not replace it)

**Decision, made explicit (Option B, not Option A):** `CollectionsWorklistPage.vue`
**stays exactly as it is today**, unchanged, at `/customers/collections`.
`MoneyOwedPage.vue` is a **new, separate, additional** screen at
`/customers/money-owed`, routed alongside it — not a replacement, redirect,
or rename of the existing screen.

Why coexist rather than replace: `CollectionsWorklistPage.vue` is a
credit-only *workflow* tool — reminders (`lastRemindedAt`), a single
actionable overdue threshold, WhatsApp collection actions — tuned for
"which credit customers do I need to follow up with today." `MoneyOwedPage.vue`
is a broader *triage summary* — credit + installments combined, three aging
buckets, no reminder/workflow state — tuned for "what's my total exposure
and how aged is it." These answer different questions for different moments
(daily collections work vs. periodic risk review), so collapsing them into
one screen would force one of the two use cases to lose fidelity. Revisit
this as a merge candidate only if real usage shows owners consistently
opening both back-to-back for the same task — not speculatively now.

This IA choice still keeps both screens under `/customers` (not splitting
one under `/reports` and one under `/customers`), which is the "not
fragmented across top-level sections" point the earlier draft was making —
it was the replace-vs-coexist question, not the section placement, that
needed to be pinned down. (Contrast with WAFI-018, which deliberately placed
its new report under `/reports` — that ticket had no existing sibling screen
to coexist with in the first place.)

## 8. Permission

**Decision:** gate on `can_view_reports`, matching the existing
`/customers/collections` precedent exactly (same permission, same financial
sensitivity level — a combined owed-money view is not more sensitive than the
credit worklist it extends). This is **not** owner-only like WAFI-018: unlike
per-employee performance data, "which customers owe money" is routine
financial information a reports-granted manager already sees via the
Collections worklist today, and duplicating that boundary here would be an
inconsistent, undiscussed narrowing relative to the existing screen it
extends.

`/installments` today gates on `can_manage_customers`, a different permission
than `/customers/collections`'s `can_view_reports` — WAFI-017 does not change
either existing route's gating; it only decides the new merged screen's own
permission, which follows the Collections precedent since this screen is
that screen's evolution, not the installments screen's.

## Performance expectations

`useMoneyOwed.ts` reuses the shared data-access helpers already backing
`useCollectionsWorklist()` and `useInstallmentPlan()` (per §4's reuse
mechanism) rather than introducing a new, separate query path. That is the
actual performance-relevant invariant — **no duplicated data access, however
many queries that ends up being** — not a specific query count, which this
spec deliberately does not estimate: whatever the current implementation's
query shape is (a handful of SQL queries today, potentially an RPC, a
PowerSync-specific pattern, or a single joined query later), it's already
proven at the scale those two composables run at today (dozens to a few
hundred customers/plans per shop), and any future change to that shape is
free to happen without this document going stale. No pre-aggregation or
caching is expected to be necessary at current WAFI scale; measure before
reaching for either if a shop's customer count grows large enough to matter.

## Testing

- `useMoneyOwed.test.ts`: given fixture customers with (a) credit-only debt,
  (b) installment-only debt, (c) both, (d) an installment plan with only
  future (not-yet-due) dues, assert: (a)/(b)/(c) each produce a row with the
  correct `totalOwedUsd` and `bucket`, and (d) produces **no row at all**
  (future-only dues don't count as currently owed, per §3). **Explicit core-
  algorithm case:** a customer with 31-day-old credit AND a 61-day-old
  overdue installment due asserts `ageDays === 61` and `bucket === '60_plus'`
  (the worse of the two ages wins, per §2 — this is the one case that most
  directly exercises the max-of-two-ages rule, not just "both present").
  Also assert a same-day-only credit sale (age 0, no installments) produces
  `bucket === '0_30'`, not an excluded row (per §2's explicit age-0 handling).
- `MoneyOwedPage.vue` component test: mocks the composable; asserts rows
  render sorted by `ageDays` descending by default; asserts clicking each
  column header re-sorts by that column; asserts the zero-state message
  renders when the composable returns no rows; asserts the three bucket-total
  summary cards match hand-computed sums from the fixture rows.
- Route guard test: assert a cashier (lacking `can_view_reports`) is denied
  `/customers/money-owed` and redirected via `resolveLanding`, same
  assertion style as the existing `/customers/collections` case in
  `router/permissions.test.ts`.

## Out of scope

- Adding a SYP-tracked balance to either credit or installments — both are
  USD-only today; extending either is a larger data-model change to two
  existing features, not this aggregation ticket. Explicitly surfaced on
  screen (§6), not silently omitted.
- Adding a due date to credit sales (`credit_due_date` /
  `payment_terms_days`) — credit aging stays "days since sale," permanently,
  unless a separate ticket adds real payment terms to credit sales.
- Payment recording, reminders, or any write action from this screen — it is
  a read-only triage list; existing actions (WhatsApp reminder, payment
  recording) stay on `CollectionsWorklistPage.vue`/`CustomerDetailPage.vue`
  where they already live.
- Changing either existing route's (`/customers/collections`,
  `/installments`) permission gating — only the new merged screen's
  permission is decided here.
- A period selector — this is a point-in-time snapshot, not a report over a
  date range (see §4).
- Per-invoice aging within the credit component (i.e., bucketing each of a
  customer's individual unpaid credit sales separately rather than using one
  FIFO-anchor age for the whole customer) — `useCollectionsWorklist.ts`'s
  existing per-customer anchor is reused as-is; a finer per-invoice aging
  breakdown is a larger change to that composable, not scoped here.
