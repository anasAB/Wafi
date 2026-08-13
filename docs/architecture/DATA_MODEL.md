# DATA_MODEL.md — Tables, ownership, and how the schema evolves

> Cited by CLAUDE.md, part of WAFI-021 (Documentation & Runbook). Companion to
> ARCHITECTURE.md (where things live) and API_CONTRACTS.md (RPC surface). This is a map of
> what exists, not a column-by-column reference — read the migration file for exact
> columns/constraints; this doc tells you which migration to open.
> Last updated: 2026-07-30.

---

## 1. Source of truth

Postgres (Supabase), migrated via `supabase/migrations/NNN_*.sql` (sequential, additive-only
— see DEPLOYMENT.md's rollback section: **there is no down-migration path**, only forward
fixes). The client's local copy (PowerSync/SQLite) mirrors a subset of
this schema — see `src/data/powersync/schema.ts` for the exact synced-table list, which
should match section 2 below; if it doesn't, the schema.ts file is stale and needs updating
alongside the next migration that touches a synced table.

As of this writing the highest applied migration is `072_register_device_rpc.sql`
(72 migration files total). A `073_products_cost_updated_at.sql` migration is specified
(not yet applied) by the WAFI-013 cost-freshness design spec
(`docs/superpowers/specs/2026-07-30-wafi-013-cost-freshness-design.md`) — it adds a
`products.cost_updated_at` column; update the Catalog domain row and section 6 (no read
models) when it lands.

## 2. Tables (by domain)

| Domain | Tables |
|---|---|
| Tenant / shop | `shops` |
| Catalog | `products`, `categories`, `subcategories`, `stock_adjustments` |
| Sales | `sales`, `sale_line_items`, `sale_payments` |
| Returns | `returns`, `return_line_items`, `return_reasons` |
| Customers & credit | `customers`, `customer_payments`, `installment_plans`, `installment_dues` |
| Suppliers | `suppliers`, `stock_receivings`, `stock_receiving_line_items` |
| Stock-take | `stock_take_sessions`, `stock_take_lines` |
| Cash & shifts | `cashier_shifts`, `cash_movements`, `denomination_configs` |
| Staff | `staff`, `staff_ledger`, `staff_settlements`, `devices`, `device_sessions` |
| Money/pricing | `exchange_rates` |
| Expenses | `expenses` |
| Receipts | `receipt_settings` |
| Audit | `audit_log` (append-only — see below) |
| Sync infrastructure | `sync_dead_letter` |

This list is derived from the client's synced schema (`src/data/powersync/schema.ts`) —
it is the set of tables the app actually reads/writes locally, not necessarily every table
in Postgres (server-only tables, if any are added later, won't appear here).

## 3. Invariants that hold across the schema

These are enforced structurally (RLS policies, triggers, or grant restrictions), not just
by convention — see AI_PRINCIPAL_ENGINEER_REVIEW.md's Core Invariants for the product-level
statement of these rules:

- **Tenant isolation**: RLS on `shop_id`/`owner_user_id`, introduced progressively —
  `008_products_rls.sql`, `012_rls_policies_remaining_tables.sql`,
  `015_rls_tenant_scoping.sql` are the key migrations if you need to see the pattern.
- **Audit log is append-only**: enforced by both grant revocation and a hard
  `BEFORE UPDATE OR DELETE` trigger, not RLS alone — `018_audit_log_append_only.sql`.
  Corrections to a mis-logged event are a new row, never an edit.
- **Sales/returns immutability once completed**: a manager/owner cannot mutate or delete a
  completed sale/return via direct REST — see `064_wafi202_sales_immutability.sql` and its
  pgTAP suite; this was a real exploit found and fixed (see
  `WAFI_Production_Readiness_Plan_v3.md`'s WAFI-202 entry), not a hypothetical hardening.
- **Cash movements always belong to a shift** (`cashier_shifts` foreign key on
  `cash_movements`) — a pay-in/pay-out/drop with no open shift is not a valid state.
- **Historical reports never change**: profit/dashboard metrics derive from transactional
  data at query time (see `useDashboardMetrics`, `useProfitTrend`), not from a
  duplicated/cached calculation that could drift from the ledger.
- **Domain-by-domain RLS hardening (058-063)**: a later wave beyond the original
  008/012/015 tenant-scoping pass — `058_cash_shifts_domain_rls.sql`,
  `059_accounting_domain_rls.sql`, `060_staff_finance_domain_rls.sql`,
  `061_audit_domain_rls.sql`, `062_configuration_domain_rls.sql`, plus
  `063_backfill_staff_permissions.sql` — locked down remaining tables domain-by-domain as
  part of WAFI-001. Server-side role enforcement (WAFI-001) and sales/returns immutability
  (WAFI-202, migration `064`) build on top of this wave.

## 4. Refund/return timing (a real gap someone will eventually "fix" wrong)

Refunds are recognized on the **return's own date**, not the original sale's date — a June
2 sale refunded June 20 reduces June 20's revenue/COGS, not June 2's. Verified directly
against `useDashboardMetrics.ts`'s refund query (`DATE(returns.created_at,'localtime')`).
Documented explicitly in the profit-report v1.0 plan
(`docs/superpowers/plans/2026-06-25-premium-insights-reporting-pack-v1.md`) so this doesn't
get "corrected" to sale-date recognition by someone who assumes it's a bug.

## 4a. Sale source tagging

`sales.source` (migration `070_sales_source_tagging.sql`, WAFI-008) is a `NOT NULL DEFAULT
'pos'` provenance column distinguishing how a sale was created (e.g. POS checkout vs. a
future import/API path). Profit-engine composables (`useDashboardMetrics`, `useProfitTrend`)
filter/group on it — if you add a new sale-creation path, set `source` explicitly rather than
relying on the default, or reporting will silently misattribute it to POS.

## 5. Currency

All financial calculation (profit, COGS, revenue, anomaly thresholds) operates on
normalized USD columns (`*_usd`) already computed by the accounting/write layer. SYP is a
presentation-layer-only conversion — never reintroduce SYP into a `WHERE`, `SUM`, or
comparison; convert only for display.

## 6. Read models / caching

Stale as of 2026-08-13 — this section previously said no read models exist and WAFI-153 was
"not started." Neither is true. Real status, per shop-scoped `(shop_id, day)` event-derived
table, maintained by a Postgres apply function keyed off `events` (never queried ad-hoc, never
mutated directly by clients):

| Table | Populated by | Read side | Status |
|---|---|---|---|
| `profit_cache` | `apply_profit_cache()` (migration `086`) from `sale.completed`/`sale.returned`/`expense.recorded` | `useProfitCache()` — the authoritative source for revenue/COGS/profit/discount/refund/return metrics on the Dashboard/Reports pages | ✅ Built, adopted everywhere (see below) |
| `daily_event_counts` | `apply_daily_event_count()` (WAFI-151, migrations `083`/`085`) from `sale.completed` | `dailyEventCountsProjection.ts` (also the authoritative-count basis `local_today_revenue_projection`'s rebuild path cross-checks against) | ✅ Built |
| `dashboard_metrics` | — | — | ❌ Explicitly **dropped by design** (duplicate of `profit_cache`, see the WAFI-153 design spec's "Out of scope") |
| `staff_summary` | — | `useStaffPerformanceMetrics.ts` still does live per-request SQL aggregation over `sales`/`sale_line_items`/`returns`/`cashier_shifts` | ❌ **Evaluated and declined, 2026-08-13.** See below — this is not "not built yet," it's a considered no. |
| `inventory_summary` | — | `useDeadStockReport.ts`/`useInventoryIntelligence.ts`/`useLowStockAlerts.ts` still do live per-request aggregation | ❌ **Evaluated and declined, 2026-08-13.** See below. |
| `customer_summary` | — | `useMoneyOwed.ts`/`creditDebtors.ts`/`installmentDues.ts` still do live all-time aggregation | ❌ **Evaluated and declined, 2026-08-14.** See below. |

### Read-model litmus test (WAFI-153, applied going forward)

Before proposing a new read model, check it against the pattern that actually justified
`profit_cache` (not just "the roadmap names a table"). A strong candidate shows several of:

1. **High-frequency access across important user flows** — hit on every session/every load, not
   an occasional owner-initiated report.
2. **Significant duplicated aggregation work** — the same formula independently reimplemented
   across multiple consumers (not just two composables computing a *conceptually similar* number
   over *different* row subsets — that's shared-calculation duplication, fixable with a plain
   helper function, not a CQRS signal).
3. **Expensive joins/scans or measurable query pressure** — not already mitigated by an existing
   index/perf fix.
4. **A stable aggregate that naturally fits an event-maintained `(shop_id, day)`-shaped row** —
   not something that needs today's live product/current-state snapshot.
5. **An operational payoff that justifies the projection/rebuild/recovery complexity** — a table,
   apply function, subscriber, rebuild path, and tests are real ongoing maintenance cost for a
   small part-time team; the query-time savings has to outweigh that, concretely, not abstractly.

`profit_cache` hit several of these. `staff_summary` and `inventory_summary` (below) hit almost
none. Don't build a read model on fewer than that — and record the evaluation either way (built
or declined), so the next person doesn't have to re-derive the reasoning from scratch, and doesn't
assume "not built" means "not yet gotten to."

**`staff_summary` — evaluated and declined, not deferred.** The workload behind
`useStaffPerformanceMetrics.ts` was checked against the same criteria that justified building
`profit_cache`, and does not meet them: `profit_cache`'s own design spec justified itself on
"every dashboard/reports load" hit frequency plus logic "duplicated in spirit across
`useRevenueIntelligence`/`useProfitIntelligence`" (multiple consumers independently
re-implementing the same aggregation). `useStaffPerformanceMetrics.ts` has exactly two call
sites (`StaffPerformancePage.vue` at `/reports/staff`, and `useStaffIntelligence.ts`'s Home
card), both gated behind `can_view_staff_performance` — structurally owner-only, never
grantable to a manager's custom permission set — so this is occasional owner-initiated access,
not something every session or every cashier hits, and there's no duplicated aggregation logic
across consumers to unify. The operational and implementation cost of a full CQRS stack (table +
Postgres apply/rebuild functions + client subscriber + recovery semantics + tests) would exceed
the query-time benefit at this product's actual scale (small shops, a handful of staff, part-time
maintainers). **Revisit only if** access frequency, consumer count, data volume, or duplicated
computation materially increases from today's shape — not on a schedule, and not just because the
roadmap names it.

A real, separate, and much smaller issue was found in the same investigation and was
**deliberately not treated as evidence for this decision**: the return-COGS-reversal query's
inline `sale_line_items` subquery (`useStaffPerformanceMetrics.ts`) had no `shop_id` predicate of
its own, so it scanned the full historical table regardless of the requested period or shop — a
pre-existing pattern inherited from `useDashboardMetrics.ts`'s own WAFI-005 precedent, duplicated
across three more files (`useBucketBreakdown.ts`, `useProfitTrend.ts`, `useSalesChart.ts`). Fixed
directly (all four, `shop_id`-scoped, 2026-08-13) as a plain query-scoping fix — not bundled into
this decision, since a slow query is a reason to scope the query, not a reason to build CQRS
machinery around it.

**`inventory_summary` — evaluated and declined, 2026-08-13**, against the same litmus test above.
Three composables do live per-request inventory aggregation: `useDeadStockReport.ts` (dead-stock
detection + "frozen capital" total, `ReportsPage.vue`), `useInventoryIntelligence.ts` (thin
wrapper over the same, `Dashboard2Screen.vue`'s inventory card), and `useLowStockAlerts.ts`
(low-stock count, `HomePage.vue`) — 3 call sites total, gated by `can_view_reports` (owner-default,
manager-grantable — broader reach than `staff_summary`'s owner-only gate, including the
every-session `HomePage.vue`). But the decisive signals are still missing: no full duplication of
one aggregate across consumers (only a *partial* overlap — `useDeadStockReport.ts` and
`useExportData.ts` both compute a stock-value figure, `current_stock × cost_price_usd`, but over
different row subsets — dead-stock-only vs. all-active-products — so this is shared-formula
duplication, not read-model duplication), no unscoped/expensive join (the dead-stock query is
already `shop_id`-scoped with a single `GROUP BY` join, carrying an explicit WAFI-108 perf-fix
comment), and no N+1. The CQRS build cost (table, apply function, subscriber, rebuild/recovery,
tests) isn't justified by broader reach alone when the query itself is already structurally
reasonable. **If the stock-value duplication is worth addressing**, do it as a small shared
calculation helper (e.g. `stockValueUsd(product)`) consumed by both `useDeadStockReport.ts` and
`useExportData.ts` — not as a read model. **Revisit `inventory_summary` only if** inventory
aggregation becomes materially more expensive, gains real cross-consumer duplication of one
aggregate, or gains substantially more high-frequency consumers than today's three.

**`useDashboardMetrics.ts` (the old live-aggregation composable this replaced) and its
`missingCostCount` extraction `useMissingCostCount.ts` were both deleted 2026-08-13** — see
the WAFI-153 design spec's "Post-implementation status" section for the full migration/
retirement history, including why `missingCostCount` was retired rather than migrated.

**`customer_summary` — evaluated and declined, 2026-08-14**, deferring to an *existing* decision
rather than re-deciding from scratch. `useMoneyOwed.ts` (1 call site, `MoneyOwedPage.vue`,
`can_view_reports`-gated, not on Home) combines `creditDebtors.ts` and `installmentDues.ts`, both
of which scan **all** customers/all-time — there's no natural per-day window for an AR/debt
aggregate the way there is for daily sales metrics, so this candidate doesn't fit the
`profit_cache` `(shop_id, day)` shape at all even before weighing frequency. Two real signals
were found here, stronger than either sibling candidate: the credit-balance formula (`SUM(credit
sales) - SUM(payments) - SUM(returns...) - SUM(store-credit refunds)`) is fully reimplemented as
separate SQL in three places (`creditDebtors.ts`, `useCustomerBalance.ts`, `useCustomers.ts`), and
`creditDebtors.ts` runs a genuine N+1 (two extra per-customer queries in a loop for oldest-unpaid-
sale/last-payment-date). Despite both, the decision is still decline: `docs/superpowers/specs/
2026-07-28-wafi-017-money-owed-design.md`'s own "Performance expectations" section already
evaluated and explicitly rejected pre-aggregation/caching for this exact feature — "no
pre-aggregation or caching is expected to be necessary at current WAFI scale; measure before
reaching for either if a shop's customer count grows large enough to matter," proven at "dozens to
a few hundred customers/plans per shop." That decision stands; a duplicated formula and an
accepted N+1 are code-quality signals, not new evidence that overturns an explicit prior
architecture call — they're addressed below as their own follow-ups, not as WAFI-153 work, and
not as grounds to build a read model WAFI-017 already declined.

**Follow-ups surfaced by this WAFI-153 evaluation pass, deliberately NOT implemented as part of
WAFI-153 (tracked here so they aren't lost, not forgotten as "already handled"):**
- **Stock-value duplication**: `useDeadStockReport.ts` and `useExportData.ts` each compute
  `current_stock × cost_price_usd` independently over different row subsets. A shared
  `stockValueUsd(product)`-style helper would remove the drift risk without any projection
  infrastructure.
- **Credit-balance duplication**: `creditDebtors.ts`, `useCustomerBalance.ts`, and
  `useCustomers.ts` each hand-write the same credit-balance SQL formula. A shared
  helper/query-fragment would reduce drift.
- **`creditDebtors.ts`'s N+1**: known, and explicitly accepted at current scale by the WAFI-017
  design spec — leave alone unless customer volume or measured performance crosses that spec's
  own stated revisit threshold.

**Two revenue sources for "today", intentionally, not redundantly:**
`local_today_revenue_projection` (client-local-only table, no server counterpart) is written
synchronously the instant `sale.completed` is processed on-device (`dashboardRevenueProjection.ts`)
— zero round trip, but single-device and best-effort (design spec: "never treated as a source of
truth for anything financial"). `profit_cache`'s numbers, by contrast, only become authoritative
after upload → server-side `apply_profit_cache()` → sync-down, so every device converges on the
same value, at the cost of latency the local table doesn't have. `HomePage.vue` encodes this
tradeoff explicitly: for `period === 'today'` it prefers the instant local value and falls back
to `profitCache`'s value only when the local one is still zero (a fresh-device stopgap, not the
primary path). Do not try to unify these into one table — the whole point is that one is
same-device-instant/advisory and the other is cross-device-authoritative/eventually-consistent,
and the dashboard needs both properties simultaneously for different scenarios.

If you're about to add a new read-model table, check whether one of the four unbuilt candidates
above already covers the need, and read the WAFI-153 design spec's "CQRS-Lite" pattern
(`_apply_*`/`apply_*` pair, `(shop_id, day)` grain, `projection_processed_events` idempotency
ledger, rebuild-via-CLI) before inventing a different shape.
