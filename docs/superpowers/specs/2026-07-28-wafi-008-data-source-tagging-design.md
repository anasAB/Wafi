# WAFI-008: Data Source Tagging Design

**Date:** 2026-07-28
**Status:** Draft
**Ticket:** WAFI-008 (P1, 0.5 sprint, "live vs. imported sales, profit report filtering")

## Context

Confirmed via code audit 2026-07-27 (`WAFI_Production_Readiness_Plan_v3.md` status
table): no implementation exists for WAFI-008 today. This is a genuinely unbuilt
ticket.

**Critical scoping finding, surfaced before any design decision was made:**
the roadmap line assumes imported sales exist somewhere in this app. They
don't:

- **No sales/transaction import feature exists anywhere in this codebase.**
  `src/features/imports/ImportWizardPage.vue` and its composables
  (`useProductImport.ts`, `useColumnMapping.ts`, `useImportValidation.ts`)
  import **products only** — barcode, price, cost, currency. There is no
  code path anywhere that writes a bulk-imported row into `sales` or
  `sale_line_items`.
- **WAFI-004's demo-data seeding also never touches `sales`.** Checked
  directly: `useDemoDataSeed.ts` seeds 5 demo products only (tagged
  `createdVia: 'demo_seed'`); the WAFI-004 design doc explicitly states demo
  sales/customers were "deliberately excluded... to avoid touching the
  sales/customer domains." So demo-data pollution of profit reports —
  another plausible real-world reason a source tag might matter today — also
  isn't a live concern.
- **A distinct, already-shipped concept exists for a related worry:**
  `useDashboardMetrics.ts` tracks `costlessSalesInPeriod` and derives
  `profitIsEstimated` when any sale in the period has an uncosted line
  (`unit_cost_usd = 0` or `NULL`) — this is WAFI-101, keyed on **missing
  cost data**, not on **row origin**. `useUncostedSalesNotice.ts` surfaces
  the same signal as a UI caveat on `ReportsPage.vue`. This is a related but
  genuinely different problem from "which sales came from an import" and is
  not duplicated or extended by this ticket (see Out of Scope).

**Decision made explicitly before writing this spec (not silently assumed):**
given no import feature exists to tag, and CLAUDE.md's own working
principles caution against building for hypothetical requirements, this
ticket was scoped down to **schema preparation only** — the same pattern
CLAUDE.md already endorses elsewhere for a different domain: *"Wholesale-aware
schema from day one... costs nothing now, saves months of migration later."*
WAFI-008 applies that identical reasoning to sales provenance: add the
column and the filtering capability now, while the migration is cheap and
the table is still small, without building a UI or a feature that has
nothing to operate on yet.

## 1. What WAFI-008 actually delivers — schema + composable-level filter, no UI, no import feature

**Decision:** exactly two things:

1. A `source` column on `sales`, defaulted to (and, for now, exclusively)
   `'pos'` — every sale rung today is tagged as what it actually is.
2. An optional source filter parameter threaded through the profit-engine
   queries (`useDashboardMetrics.ts`, `useProfitTrend.ts`), so a future
   import feature can exclude imported sales from profit reporting without
   a second migration to retrofit filtering onto an already-populated
   column.

**Explicitly not delivered:** any sales-import feature itself, any UI
control to filter by source (there is exactly one value in practice today —
a dropdown with one always-selected option is a confusing dead affordance,
not a feature), and any change to WAFI-101's uncosted-sales machinery.

## 2. Schema: `sales.source`

New migration, e.g. `0XX_sales_source_tagging.sql`:

```sql
ALTER TABLE public.sales
  ADD COLUMN source TEXT NOT NULL DEFAULT 'pos'
    CHECK (source IN ('pos', 'import', 'seed'));
```

- **`'pos'`** — a sale rung live through the POS. The only value any code
  path produces today.
- **`'import'`** — reserved for a future bulk sales-import feature. No code
  writes this value yet.
- **`'seed'`** — reserved for a future demo/seed-sales feature, if
  WAFI-004's demo data ever expands to include sales (it doesn't today — see
  Context). No code writes this value yet.
- `NOT NULL DEFAULT 'pos'` means the migration needs no backfill step beyond
  the default itself — every existing row becomes `'pos'` on migration,
  which is correct: every sale in production today was, in fact, rung live.
- **`usePayment.ts`'s `INSERT INTO sales` must list `source` explicitly**
  (with literal value `'pos'`), not rely on the column default silently —
  this matches the existing convention in that same insert statement, which
  already explicitly lists every business-meaningful column (`is_credit`,
  `is_split`, `staff_id`, etc.) rather than omitting any and depending on a
  schema default. A future import feature's own insert path is then
  responsible for setting `'import'` explicitly, the same way.

## 3. Profit-engine filtering (inert today, ready when needed)

`useDashboardMetrics.ts` and `useProfitTrend.ts`'s `load()`/`loadRange()`
functions gain an optional `sources?: string[]` parameter (default:
`undefined`, meaning "no filter, include everything" — today's exact
behavior, unchanged). When provided, every query in both composables adds
`AND s.source IN (...)` (and the equivalent `sale_line_items`-joined
subqueries reference `s.source` through their existing `JOIN sales s`).

**Why build this now with nothing to filter:** the same reasoning as §1 —
retrofitting a source filter onto the profit engine's half-dozen already-
tuned queries (revenue, COGS, refunds, COGS-reversal, missing-cost count,
costless-sales count, per the WAFI-005-audited profit engine) later, once
an import feature exists and real data needs filtering, is a much larger
and riskier change than adding one optional parameter now while the query
shapes are already being touched for this ticket. This mirrors exactly the
CLAUDE.md-endorsed "costs nothing now, saves months of migration later"
tradeoff cited in Context.

**No default filtering behavior changes.** Every existing caller
(`ReportsPage.vue`, `HomePage.vue`'s dashboard, any other profit-engine
consumer) continues to call `load()`/`loadRange()` with no `sources`
argument and sees identical numbers to before this ticket — there is
nothing to filter since only `'pos'` exists. This ticket's test suite proves
that non-regression explicitly (see Testing).

## 4. No UI filter control

**Decision:** no dropdown, toggle, or settings option is added anywhere for
selecting which sources to include. With exactly one value in production
(`'pos'`), a filter UI would present a choice that doesn't exist yet — a
dead, confusing affordance, which CLAUDE.md's working principles explicitly
warn against ("don't add validation for scenarios that can't happen").
When a real import feature ships, that feature's own design is responsible
for deciding whether/how to expose a source filter in the UI — this ticket
only guarantees the underlying data and query capability will already be
there when that decision needs to be made.

## 5. Relationship to the v3 roadmap ticket text

The roadmap line ("live vs. imported sales, profit report filtering") reads
as if imported sales already exist and need to be distinguished from live
ones. They don't — confirmed by direct codebase research before writing
this spec, not assumed. This document deliberately narrows the ticket to
schema + query-layer preparation, explicitly choosing this scope over three
other options considered (extend WAFI-101's uncosted-sales work instead;
build a real minimal sales-import feature to give the tag something to
mark; or defer the ticket as premature) — schema-now was chosen because it
costs one small migration today and removes a much larger migration/
retrofit risk later, matching a pattern CLAUDE.md already endorses for a
different domain (wholesale-aware schema).

## Testing

- **Migration test / schema check:** the new `source` column exists, is
  `NOT NULL`, defaults to `'pos'`, and the `CHECK` constraint rejects a
  value outside `('pos', 'import', 'seed')`.
- **`usePayment.test.ts`:** assert the `INSERT INTO sales` call includes
  `'pos'` as an explicit parameter for the `source` column (not merely
  relying on the DB default) — extends the existing insert-shape assertions
  already in that test file.
- **`useDashboardMetrics`/`useProfitTrend` non-regression:** existing tests
  continue to pass unmodified with no `sources` argument supplied,
  demonstrating the new optional parameter doesn't change default behavior.
- **New filtering test:** a fixture with two sales — one `source = 'pos'`,
  one `source = 'import'` (inserted directly as a fixture row, since no
  production code writes `'import'` yet) — asserts that calling
  `loadRange(start, end, { sources: ['pos'] })` excludes the `'import'`
  row's revenue/COGS from the computed totals, while calling with no
  `sources` argument includes both. This proves the filter mechanism works
  correctly even though nothing in the shipped product exercises it yet.

## Out of scope

- **Any sales/transaction import feature.** This ticket only prepares the
  schema and query layer for one; building the actual import path (column
  mapping, validation, COGS handling for historical data, etc.) is separate,
  substantially larger work, not attempted here.
- **A UI control for filtering by source.** See §4.
- **Backfilling or reclassifying any existing production sale.** Every
  existing row becomes `'pos'` via the migration default, which is correct
  as-is — there is no historical data to reclassify.
- **WAFI-101's uncosted-sales machinery** (`costlessSalesInPeriod`,
  `useUncostedSalesNotice.ts`) — a related but distinct concern (missing
  cost data, not row origin), already shipped, not modified by this ticket.
- **Demo/seed sales.** WAFI-004's demo data doesn't write sales today; the
  `'seed'` enum value is reserved for if that ever changes, but no code
  writes it as part of this ticket.
