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

There are currently **no materialized read models or report caches** — every dashboard/
report metric is computed from transactional tables at query time. This is intentional at
current data volumes (see the v3 roadmap's WAFI-153, "Read Models / CQRS Optimization",
Macro-Phase 3 — not started, tracked for when per-shop data volume actually needs it, not
before). If you're about to add a cache table, check whether WAFI-153 already covers the
need first.
