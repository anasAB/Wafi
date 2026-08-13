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
| `inventory_summary`, `customer_summary` | — | — | ⏭️ Not built, not evaluated against the same bar as `staff_summary` below — don't assume either would also be declined without actually checking their call-site count/frequency/duplication first |

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

A real, separate, and much smaller issue was found in the same investigation and is **explicitly
not** part of this decision or bundled into any future `staff_summary` work: the return-COGS-
reversal query's inline `sale_line_items` subquery (`useStaffPerformanceMetrics.ts` lines 77-92)
has no `shop_id` or date-range predicate of its own, so it scans the full historical table
regardless of the requested period or shop — a pre-existing pattern inherited from
`useDashboardMetrics.ts`'s own WAFI-005 precedent, not new to this composable. This is a
query-scoping/indexing fix, tracked as its own separate bounded hardening task, not evidence
that a read model is needed — conflating the two would let a slow query justify CQRS machinery
it doesn't actually call for.

**`useDashboardMetrics.ts` (the old live-aggregation composable this replaced) and its
`missingCostCount` extraction `useMissingCostCount.ts` were both deleted 2026-08-13** — see
the WAFI-153 design spec's "Post-implementation status" section for the full migration/
retirement history, including why `missingCostCount` was retired rather than migrated.

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
