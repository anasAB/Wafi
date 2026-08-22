# WAFI Product Constitution — Compliance Matrix

## Purpose

`PRODUCT_CONSTITUTION.md` states what must always be true. This document
tracks whether the current codebase actually satisfies each law today. It
is a living, factual record — expected to change every time a gap is
closed or a new one is found — and it never edits the constitution's own
wording to reflect current reality. A law does not become false because
the code hasn't caught up to it yet; it becomes a row in this matrix
instead.

This document is audited against actual code (migrations, RLS policies,
composables, RPCs) as of **2026-08-22**, not against intent or memory. Every
row cites the evidence it's based on.

## Status/tier definitions

- **Fully enforced** — structurally protected; violating the law is not
  possible through a normal code path (a DB constraint, RLS policy, or
  code structure makes it impossible, not merely discouraged).
- **Partial enforcement** — the system clearly relies on the law and
  enforces it in the core/primary case, but a real, confirmed gap exists
  somewhere in its actual scope.
- **Unverified / high-risk** — a mechanism intended to enforce the law
  exists, but its real-world correctness has not been confirmed under the
  conditions it will actually run in. This is explicitly NOT the same as
  "violated" — it means the risk is open and undetermined, not that a
  violation has been confirmed.
- **Verified violation** — a specific, confirmed code path exists today
  that contradicts the law as stated, independent of intent.

---

## Law 1 — Financial history is immutable; corrections create new facts

**Status: Partial enforcement**

**Enforcement mechanisms:** `sales`, `sale_line_items`, `sale_payments`,
`returns`, `return_line_items` all have insert-only RLS (no UPDATE/DELETE
policy) — `supabase/migrations/064_wafi202_sales_immutability.sql:44-52`.
Shift-close persists an immutable Z-report snapshot, read back verbatim
rather than recomputed (`src/features/shifts/composables/useShift.ts:287-303`).
Returns are recorded as new `returns` rows, never edits to the original
sale (no UPDATE call site into `sales`/`sale_*` tables found anywhere in
`src/`).

**Known gap (verified violation):** `staff_ledger` and `staff_settlements`
are financial-adjacent records without append-only/immutability protection
— see Law 2's matching finding below; the same evidence applies to both
laws since these tables sit at the intersection.

**Severity:** Medium — this closed a previously-live exploit for the core
sales tables (a manager session could mutate `total_usd` on a completed
sale before migration 064); the `staff_ledger` gap is the same class of
risk, unaddressed, on a different table.

**Follow-up:** Not yet ticketed. Recommend a scoped fix restricting
`staff_ledger`/`staff_settlements` UPDATE access to exactly the narrow,
one-time field-completion case the design already intends (see Law 2).

---

## Law 2 — Ledgers are append-only

**Status: Partial enforcement**

**Enforcement mechanisms:** `audit_log` has both RLS UPDATE/DELETE policies
dropped and a `BEFORE UPDATE OR DELETE` trigger that hard-raises for every
role except a bypass-RLS superuser
(`supabase/migrations/018_audit_log_append_only.sql:16-27`). `cash_movements`
has only SELECT+INSERT RLS policies, no UPDATE/DELETE
(`supabase/migrations/027_cash_movements.sql:37-45`). The `events` table
(the append-only domain-event backbone covering financial and non-financial
facts alike — `StaffEventType`, `ProductEventType`, `DeviceEventType`
alongside `SalesEventType`/`CashEventType`, per
`src/services/events/domainEvent.types.ts:35-73`) has no update/delete
write path found anywhere.

**Known gap (verified violation):**
`supabase/migrations/043_staff_ledger.sql:124-142` — `staff_ledger` and
`staff_settlements` both carry an `UPDATE` RLS policy
(`staff_ledger_update_all`/`staff_settlements_update_all`) scoped only by
`shop_id`, with **no column restriction**. The migration's own comment
(line 103) states the intent is that only `settlement_id` is ever set once
by `finalize()` — but the RLS as written permits any in-shop
authenticated/anon session to update **any column** of any ledger row, not
just the one field the design intends. This directly contradicts the
append-only guarantee for this specific ledger.

**Severity:** Medium-High — this is a currently-open, confirmed
contradiction between documented intent and actual enforcement on a
financial-adjacent ledger, not a theoretical risk.

**Follow-up:** Not yet ticketed. Recommend narrowing the RLS policy (or
moving the one legitimate write to a SECURITY DEFINER RPC that only ever
sets `settlement_id`, mirroring the pattern already used elsewhere in this
codebase for narrow, intentional server-mediated writes) so the policy
actually matches its own documented intent.

---

## Law 3 — Historical meaning is fixed at write time

**Status: Partial enforcement**

**Enforcement mechanisms:** `event_projection_day` is computed once via a
`BEFORE INSERT` trigger, from `occurred_at` + the shop's timezone *at that
moment*, stored, and never re-derived at replay
(`supabase/migrations/084_events_sequence_and_projection_day.sql:15-19,90-99`).
Sales store `exchange_rate_at_sale` at write time rather than looking one
up later (`supabase/migrations/001_initial_schema.sql:39`); staff-ledger
entries similarly store a `locked_rate` at write/settlement time
(`supabase/migrations/043_staff_ledger.sql`). `dashboardRevenueProjection.ts`
was previously a live violation of this law (deriving a day bucket from a
raw UTC slice of `occurred_at` rather than the immutable projection-day
column) and has since been corrected to read the stored value
(`src/services/events/dashboardRevenueProjection.ts:23-29`).

**Known gaps:**
1. **Verified violation, non-financial:**
   `src/services/notifications/syncStalenessCheck.ts:35` derives a raw UTC
   calendar day from a passed-in timestamp (`new
   Date(now).toISOString().slice(0, 10)`) rather than the shop-local,
   immutable equivalent. Currently feeds notification/staleness logic only,
   not a financial bucket — same bug class as the two fixed instances
   below, lower severity because nothing financial depends on it today.
2. **Verified violation, financial-adjacent:**
   `src/pages/HomePage.vue:243` computes a period-scoped revenue figure
   (`profitCache.metrics.value.netRevenueUsd`, which can represent any past
   period, not only "today") by multiplying it against the **current, live**
   exchange rate rather than a rate fixed to the period it describes. This
   is a direct instance of this law's forbidden pattern: recomputing a
   historical figure's meaning using today's configuration.
3. **Previously fixed, noted for completeness:** `dashboardRevenueProjection.ts`
   (UTC-slice bug) and `localTodayRevenueRebuild.ts`/`HomePage.vue`'s
   `local_today_revenue_projection` date-key derivation (device-UTC vs.
   shop-local) — both corrected 2026-08-21/22 as part of WAFI-148's
   follow-up work.

**Severity:** #1 is Low (non-financial). #2 is Medium — it can produce a
visibly wrong SYP figure on the home dashboard for any period other than
"right now," for any shop whose exchange rate has changed since that
period.

**Follow-up:** Not yet ticketed for either #1 or #2.

---

## Law 4 — Projections are derived state and must be rebuildable

**Status: Fully enforced**

**Enforcement mechanisms:** `daily_event_counts`
(`supabase/migrations/085_daily_event_counts_rebuild.sql`), `profit_cache`
(`087_profit_cache_rebuild.sql`, access-restricted further in
`089_profit_cache_rebuild_revoke_public.sql`), `local_today_revenue_projection`
(`src/services/events/localTodayRevenueRebuild.ts:20-58`, a coverage-checked
rebuild that explicitly refuses to proceed — returns `coverage_unavailable`
— rather than guess, when it cannot verify it has seen every source event),
and both WAFI-148 health projections (`drawer_mismatch_count`,
`never_closed_shift_count` — `_rebuild_health_drawer_mismatch()`/
`_rebuild_health_never_closed_shift()`, `supabase/migrations/115_wafi148_timezone_confirmation_gates.sql`)
all have real, callable rebuild functions.

**Known gaps:** None found. Every projection identified during this audit
has a corresponding rebuild path.

**Follow-up:** None.

---

## Law 5 — A business fact has one canonical definition, calculation, and representation

**Status: Partial enforcement**

**Enforcement mechanisms:** `profit_cache` is the canonical, server-computed
source for revenue/profit; `useProfitCache.ts:44-49` sums its integer-cent
values once, and `useRevenueIntelligence.ts`/`ReportsPage.vue` both read
that same computed result rather than recomputing it independently
(`src/features/dashboard/composables/useProfitCache.ts:55-71`,
`src/pages/ReportsPage.vue:142,379`).

**Known gaps (verified violations):**
1. **Competing revenue definitions:** `src/features/shifts/composables/useZReport.ts:22-38`
   computes revenue/cash/card/credit totals via its own independent SQL
   (device+time-window-scoped `SUM(total_usd)`), not by reading
   `profit_cache`. `src/composables/insights/revenueUpToTimestamp.ts:18,24`
   is a third, independent raw-SQL revenue definition. Neither is
   necessarily wrong today, but both are independent redefinitions of the
   same business concept rather than reads of the one canonical
   calculation — exactly the pattern this law forbids, with real risk of
   silent future divergence (e.g. differing refund handling).
2. **Duplicated currency-conversion formula, inconsistent rounding:** the
   formula `Math.round((amount / rate) * 100) / 100` (or its inverse,
   `Math.round(usd * rate)`) is independently reimplemented in at least 10
   locations rather than centralized: `src/services/sales.service.ts:44-45`,
   `src/services/staff.service.ts:29`, `src/features/imports/lib/convert.ts:7`,
   `src/services/expense.service.ts:30`,
   `src/features/customers/components/RecordPaymentSheet.vue:35`,
   `src/features/payment/usePayment.ts:33,104-105`,
   `src/features/payment/useFastCash.ts:33`,
   `src/features/expenses/composables/useExpenses.ts:93`,
   `src/features/returns/composables/useReturnSheet.ts:47,161,243`,
   `src/features/pos/useSale.ts:26`, `src/features/pos/SalePanel.vue:45`,
   `src/pages/HomePage.vue:243`. Rounding rules differ by call site
   (some round SYP directly, some round USD to cents first, one branches
   its rounding rule by currency inline) — there is no single shared
   rounding policy.
3. **Mixed money representation:** `sales.total_usd` is `NUMERIC(10,2)`
   (decimal dollars) while `profit_cache`-derived values are treated as
   integer cents (`useProfitCache.ts:55-71` divides by 100) — two different
   USD encodings reconciled only by naming/comment discipline across
   layers, not a shared type. `cash_movements.amount` is a single untyped
   `NUMERIC` column used for both currencies, with the "SYP must be integer"
   rule enforced only by comment and composable convention, not a DB
   constraint (`supabase/migrations/027_cash_movements.sql:22-24`).

**Severity:** Medium — no confirmed live discrepancy between the competing
revenue formulas has surfaced yet, but the structural risk is real and the
conversion-formula sprawl is a genuine, currently-active maintenance and
correctness hazard (a rounding-rule change in one of 10+ places doesn't
propagate to the other 9).

**Follow-up:** Not yet ticketed. Candidate scope: (a) evaluate whether
`useZReport.ts` and `revenueUpToTimestamp.ts` can be reconciled to read
from `profit_cache`-derived values instead of their own SQL; (b) introduce
one shared money/conversion utility and migrate the ~10 call sites to it,
with one centrally-defined rounding policy.

---

## Law 6 — Offline-first protects core workflows

**Status: Partial enforcement (documented boundary, not a gap)**

**Enforcement mechanisms:** Core POS write paths (sales, stock, payments)
go through PowerSync's local-write-then-sync flow.

**Documented online-only boundary** (intentional, not a violation, but
worth keeping visible as the actual current scope of the law):
`bootstrap_owner_identity`, `register_device`/`revoke_device_session`,
`record_device_session_id`, `switch_active_operator`,
`confirm_shop_timezone`, `update_business_rule`/`execute_rule_action`,
`report_health_metrics`, `list_shops_for_rollout_admin`/`set_rollout_flag`,
`list_health_for_admin`/`list_health_gauges_and_devices_for_admin` are all
direct-RPC, online-only calls, bypassing PowerSync's local-first path by
design. Notably, **the server-authoritative side of financial-projection
maintenance** (`apply_daily_event_count`, `apply_profit_cache`) is also
online-only — the client stages a local marker, but the actual financial
computation requires connectivity to apply.

**Known gap:** None confirmed as accidental; every online-only path found
appears to be identity/admin/platform-level or an intentional
server-authority boundary (Law 7), not a core selling/stock/payment
workflow silently requiring connectivity.

**Severity:** N/A (documented boundary, not a violation) — flagged here
only so this boundary stays visible rather than being assumed away by a
future reader of "offline-first."

**Follow-up:** None required; keep this list current as new online-only
RPCs are added.

---

## Law 7 — Authority is explicit and enforced at the correct boundary

**Status: Partial enforcement**

**Enforcement mechanisms:** `apply_profit_cache`/`apply_daily_event_count`
are server-authoritative RPCs, not plain client upserts
(`src/data/powersync/ops.ts:58,69`). `switch_active_operator` and device
registration are SECURITY DEFINER RPCs re-verifying identity server-side.

**Known gap (verified violation, self-documented in the codebase):**
`powersync.yaml:28-31` states directly: "WAFI-122's server-side role
enforcement is NOT live... Cost/expense data is currently visible to every
role via sync... client-side gating (`permissions.ts`) is the only
protection." `docs/architecture/WAFI-122-rpc-audit.md:1-9,55-64` confirms
only two SECURITY DEFINER RPCs existed as of migration 062, with an
explicit requirement that any future financial-write RPC document itself
there before merge — meaning this is a tracked, acknowledged gap, not a
newly-discovered one.

**Severity:** Medium-High — cost/expense visibility across roles is
currently enforced only client-side, which is precisely the pattern this
law forbids, for financially-sensitive data.

**Follow-up:** Already tracked pre-existing (WAFI-122); not resolved as of
this audit. This document doesn't open a new ticket — it confirms the
existing one remains open.

---

## Law 8 — Retry and replay safety matches the consequences of the operation

**Status: Fully enforced (within its documented scope)**

**Enforcement mechanisms:** `processProjectionAtMostOnce.ts:11-30`
explicitly documents itself as "at-most-once, NOT exactly-once," safe only
against sequential redelivery on a single device, and its own comment
states: "Any future subscriber whose action is a financial write must NOT
use this helper." `dead-letter.ts`'s `quarantineOp`/`retryDeadLetterOp` are
idempotent by design, safe because uploads are serialized. No DB-level
UNIQUE constraint backs `projection_processed_events` — protection is
check-then-insert in application code only, which the code's own comments
treat as acceptable specifically because current consumers are disposable
projections, not ledgers.

**Known gaps:** None found — every current use of the lightweight
at-most-once mechanism stays within its documented, appropriate scope. No
financial write was found using it.

**Follow-up:** None required now. This law's actual risk is that a
*future* financial-write subscriber reaches for the existing lightweight
helper because it's already there and convenient — worth a note in the
Constitution Check review process (see `AI_PRINCIPAL_ENGINEER_REVIEW.md`)
rather than a code fix today.

---

## Law 9 — Tenant isolation is enforced below the UI

**Status: Unverified / high-risk (one specific mechanism), Fully enforced (everything else)**

**Enforcement mechanisms:** Every core tenant-owned table gets shop-scoped
RLS via `auth_shop_id()` (`supabase/migrations/015_rls_tenant_scoping.sql:33-88`),
independently mirrored by matching `owner_user_id = auth.user_id()` scoping
in the PowerSync sync-rules layer (`powersync.yaml:40-140`) — two
independent enforcement points for the same boundary.

**Known risk (explicitly unverified, not a confirmed violation):** the
`generated_reports`/`generated_report_staff_sections` sync buckets rely on
`auth.parameters() ->> 'staff_id'` for their **permission** filter
(`can_view_reports`/owner-only staff-performance content), and are
self-flagged directly in `powersync.yaml:94-109,120-124` as
"UNVERIFIED/HIGH RISK... has NOT been re-tested against a live
device/session... do not trust it in production until it is." This is
explicitly a risk under active tracking, not a confirmed cross-tenant leak
— the underlying shop-level scoping (which shop's data syncs at all) is
separately enforced and not in question; only the finer-grained
staff-permission filter within a shop's own data is unverified.

**Severity:** High if the risk materializes (a parameter mechanism failing
open, as a related mechanism — `active_role` — previously did per
ADR-009/ADR-010, cited in the same file), but currently unconfirmed either
way.

**Follow-up:** Already tracked in-repo (the `powersync.yaml` comment
itself); needs live-device verification before this status can move to
either "fully enforced" or "verified violation." Not a new finding, but
worth carrying into this matrix so it's visible from the constitution's own
compliance tracking, not only from a YAML comment.

---

## Summary

| Law | Status |
|---|---|
| 1. Financial history immutable | Partial enforcement |
| 2. Ledgers append-only | Partial enforcement |
| 3. Historical meaning fixed at write time | Partial enforcement |
| 4. Projections rebuildable | Fully enforced |
| 5. One canonical business fact | Partial enforcement |
| 6. Offline-first core workflows | Partial enforcement (documented boundary) |
| 7. Explicit authority boundaries | Partial enforcement |
| 8. Retry/replay safety matches consequence | Fully enforced (within scope) |
| 9. Tenant isolation below the UI | Unverified/high-risk (one mechanism) |

No law is fully violated wholesale. Every gap found is scoped to a specific
table, file, or mechanism, not a systemic failure of the law itself — which
is itself evidence the constitution reflects real, mostly-followed
discipline rather than aspiration disconnected from practice.
