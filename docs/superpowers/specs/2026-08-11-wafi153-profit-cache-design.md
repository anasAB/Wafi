# WAFI-153 — Read Models/CQRS Optimization — Design Spec (v1: `profit_cache`)

**Status:** Draft for review
**Date:** 2026-08-11
**Ticket:** WAFI-153 (Macro-Phase 3, P1)
**Related:** WAFI-140/143/150 (event bus), WAFI-151 (Projection Rebuild & Event Recovery — in progress, this design adopts its contract), `docs/architecture/EVENT_SUBSCRIBERS.md`

## Scope

WAFI-153 lists five target read models: `dashboard_metrics`, `profit_cache`, `inventory_summary`,
`customer_summary`, `staff_summary`. This spec covers **one of them end-to-end** —
`profit_cache` — as the proof-of-pattern vertical slice. The other three (`inventory_summary`,
`customer_summary`, `staff_summary`) are out of scope here and become separate follow-on specs
that reuse the framework this one establishes.

**`dashboard_metrics` is deliberately not carried forward as a planned fourth table.** This v1
slice's `profit_cache` — revenue, COGS, expenses, refunds, discounts, invoice/return/costless
counts, all at daily grain for a shop — *is* what a "dashboard metrics" read model would contain;
the plan doc's two names describe one overlapping concept, not two distinct data needs. Building
a separate `dashboard_metrics` table later, once `profit_cache` already exists, would be exactly
the kind of duplicated-projection problem WAFI-033 exists to prevent, just moved one level up
from calculation logic to table design. When WAFI-153's next slice is scoped, the first question
should be "what does `dashboard_metrics` provide that `profit_cache` doesn't" — if the honest
answer is "nothing," it's dropped from the plan rather than built to satisfy the original list.
This spec doesn't delete it from `WAFI_Production_Readiness_Plan_v3.md` unilaterally — that's a
call for whoever scopes the next slice — but it records the challenge here so it isn't
forgotten and `dashboard_metrics` isn't built reflexively just because the plan named it.

**Goal:** `useDashboardMetrics.ts`'s live ad-hoc SQL (4-table JOINs re-run on every dashboard/
reports load, duplicated in spirit across `useRevenueIntelligence`/`useProfitIntelligence`) is
replaced by a single maintained, per-day, server-authoritative read model. Every financial
metric that composable currently computes is migrated — no metric is left half-duplicated on
both the old live-query path and the new projection (per WAFI-033, "no duplicated
calculations").

**One deliberate exception:** `missingCostCount` stays a live query. It answers "how many
active products right now have no cost price" — a current-state fact about product master
data, not a period-derived financial event aggregate. It has no originating event and doesn't
fit a per-day projection. Forcing it into `profit_cache` (or building a second
"current-state" projection for one metric) adds a table, an apply function, a ledger, and a
rebuild concern for no real benefit. `useDashboardMetrics.ts` is retired as *the financial
metrics calculation layer*; this one query survives, either inline where needed or in a small
dedicated composable (implementation plan decides which).

## Prior art this design reuses, not reinvents

WAFI-151 (once shipped) establishes the pattern this design follows for `daily_event_counts`:

- A Postgres apply function, keyed by `event_id`, that derives all dimensions from the
  authoritative `events` row (never trusts client-supplied values), records the event as
  applied in a per-projection ledger, and is the *only* write path (`REVOKE` on direct
  `INSERT`/`UPDATE`).
- A server-side ledger table keyed by `(projection_name, event_id)` —
  `projection_processed_events` — making "apply at most once per event" a Postgres constraint,
  not application logic.
- A client-side "marker" write: the local subscriber doesn't compute an absolute value and
  upload it — it writes a lightweight row carrying `source_event_id`, and
  `src/data/powersync/ops.ts`'s upload path special-cases that table to call the Postgres apply
  RPC instead of a generic upsert. Delivery reliability comes from PowerSync's upload queue
  (retries on failure), not a durable-subscriber retry ledger.
- `events.sequence` (total order, never used for skip decisions) and `events.event_projection_day`
  (day bucket, computed once at write time from the shop's timezone) as the two columns replay
  and incremental processing both key off.
- A CLI rebuild (`npm run projections:rebuild -- <projection> --shop <id> --from <date> --to
  <date>`) that deletes a scope's projection rows + ledger entries and replays via the same
  apply function, under a `(shop_id, projection_name)` advisory lock shared with incremental
  writes.

`profit_cache` adopts every one of these mechanisms directly. This spec does not redesign the
ledger, locking, rebuild CLI, or `sequence`/`event_projection_day` columns — it only adds a new
`projection_name` and a new apply function that plugs into that existing machinery.

## Schema

**Naming note:** `profit_cache` is the name WAFI-153 uses in the plan doc, but the table is
really a daily financial read model — it carries revenue, COGS, expenses, refunds, discounts,
and three counts, not just a profit figure. Kept as `profit_cache` here rather than renamed,
since the plan doc already names it and an unprompted rename adds churn with no functional
benefit; this note exists so a future reader isn't confused about scope by the name alone.

```sql
CREATE TABLE IF NOT EXISTS public.profit_cache (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id               uuid NOT NULL REFERENCES public.shops(id),
  day                   date NOT NULL,
  revenue_usd           bigint NOT NULL DEFAULT 0,  -- minor units (cents), never float
  revenue_syp           bigint NOT NULL DEFAULT 0,
  cogs_usd              bigint NOT NULL DEFAULT 0,
  cogs_reversal_usd     bigint NOT NULL DEFAULT 0,
  expenses_usd          bigint NOT NULL DEFAULT 0,
  refunds_usd           bigint NOT NULL DEFAULT 0,
  discount_usd          bigint NOT NULL DEFAULT 0,
  invoice_count         integer NOT NULL DEFAULT 0,
  return_count          integer NOT NULL DEFAULT 0,
  costless_sale_count   integer NOT NULL DEFAULT 0,
  source_event_id       uuid REFERENCES public.events(id),  -- nullable: NULL on backfilled rows
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, day)
);
```

**`source_event_id` — verified against WAFI-151's actual implementation, not assumed.**
Migration `083` adds this exact column to `daily_event_counts` itself (`ALTER TABLE ...
ADD COLUMN source_event_id uuid REFERENCES public.events(id)`) and `_apply_daily_event_count`'s
`INSERT` stores it alongside the aggregate on every apply. **The established WAFI-151 pattern is
"same table carries both the aggregate and the last-applied event's id," not a separate queue/
marker table** — `profit_cache` follows that exact precedent rather than introducing a second
mechanism. See Client-side implementation below for exactly how the local write and the upload
special-case use this column.

**What `source_event_id` is *not*, stated explicitly to head off a predictable future mistake:**
it is an observability/provenance field — "which event most recently touched this aggregate
row" — useful for debugging and for the client-side upload special-case (below) to know which
event to forward to the apply RPC. **It is not this projection's idempotency mechanism.**
Idempotency ("has this exact event already been applied to this projection?") is enforced
exclusively by the `(projection_name, event_id)` primary key on `projection_processed_events` —
that's what makes a duplicate `_apply_profit_cache(p_event_id)` call a safe no-op, not
`source_event_id`. A future engineer reasoning "we already have `source_event_id`, do we still
need the ledger?" would be wrong to remove it: `source_event_id` on a given day's row only ever
holds the *most recent* applying event's ID (a day aggregates many events over its lifetime), so
it cannot answer "has event X specifically been applied" for any event other than the last one —
only the ledger can.

**Why `revenue_syp` exists but no other column has an SYP counterpart:** `revenue_syp` is
retained only because the dashboard displays gross SYP sales figures (dual-currency is a Sacred
Rule for this product), matching `sale.completed`'s existing `totalSyp` field. Every profit
calculation — COGS, expenses, refunds, discounts — is USD-only, because `useDashboardMetrics.ts`'s
existing profit math is USD-only today (COGS/expenses/refunds have no SYP fields anywhere in the
current schema or event payloads). `profit_cache` doesn't change that; it carries the one SYP
figure that already exists for display and nothing more. A future ticket that makes profit
genuinely dual-currency would need its own design — not assumed or precluded here.

`revenue_usd`/`cogs_usd`/etc. as `bigint` minor units, not `numeric`/`float` — matching WAFI-151's
explicit "integer minor units, never floating point" rule so Postgres/SQLite replay can't diverge
on rounding. **This is a change from today's schema**, where `sales.total_usd` etc. are stored as
real/float — `profit_cache` does not inherit that representation; it's a deliberate improvement
scoped to the new table, not a retrofit of existing sales tables (out of scope here).

**Unit of every payload field feeding this table — verified against the actual code, not
assumed from field naming.** `src/data/powersync/schema.ts` declares `sales.total_usd`,
`unit_price_usd`, `unit_cost_usd`, `line_total_usd`, `sale_discount_amount_usd` — every
USD/SYP-suffixed column in the schema — as `column.real`, and `sales.service.ts` writes
`input.totalUsd` straight from cart totals into `total_usd` with no cents conversion anywhere
in that path. **`SaleCompletedPayload.totalUsd` and every other `*Usd`/`*Syp` field on every
existing event payload is fractional dollars (e.g. `19.99`), not cents.** This applies equally
to the new fields this ticket adds (`cogsUsd`, `discountUsd`, `cogsReversalUsd`,
`expense.recorded`'s existing `amountUsd`) — they're computed from the same real/float source
columns, so they inherit the same unit.

**Acceptance criterion:** before implementation, confirm and document the unit of every
financial payload field feeding `profit_cache` against its actual producer code and at least
one real fixture value — not inferred from the field name. **`_apply_profit_cache` must never
cast a dollar-denominated payload field directly to `bigint`** — every dollar value is
converted with `ROUND(value * 100)::bigint` at the point of extraction (shown in the apply
function below), and the historical backfill script (see Payload changes) applies the same
`* 100` conversion when reading `sales`/`sale_line_items`/`returns`/`expenses` directly. The
read side (`useProfitCache()`) converts back — `cents / 100.0` — before exposing any USD/SYP
figure to a caller, so every consumer still receives ordinary dollar values exactly as
`useDashboardMetrics()` provides today; the cents representation is an internal storage/
arithmetic detail of `profit_cache` alone; it never appears past `useProfitCache()`'s boundary.

**Rounding rule, stated as one sentence so producer/backfill/projection/read-side can't drift
apart on it:** every dollar-to-cent conversion, everywhere in this design (event producers,
the backfill generator, `_apply_profit_cache`), uses PostgreSQL `ROUND(value::numeric * 100)`
— banker's-rounding-free, standard round-half-away-from-zero under `numeric` semantics — and
nowhere else in the pipeline performs its own independent rounding. `useProfitCache()` sums
whole integer cents across all rows first, and divides by `100.0` exactly once, at the very end,
per metric — never sums floating-dollar values row by row (which would reintroduce the float
error this whole design exists to avoid). **Acceptance criterion:** test rounding against
`19.99` (ordinary case), `0.005` (the classic half-cent boundary case), a `0.1 + 0.2`-style
float-artifact value if the payload's source computation could ever produce one, `0` , and a
large value (e.g. `9999999.99`) — not just the one happy-path fixture already in the test list.

**Read-time derived fields (not stored, computed from the raw sums above):**

```
netRevenueUsd = revenue_usd - refunds_usd
netCogsUsd    = cogs_usd - cogs_reversal_usd
profitUsd     = netRevenueUsd - netCogsUsd - expenses_usd
```

Verified directly against `useDashboardMetrics.ts` lines 149-151: today's exposed `revenueUsd`
is already net-of-refunds (`revRow.total - refundsUsd`), and `cogsUsd` is already
net-of-reversal (`cogsRow.cogs - cogsReversalRow.cogs`); `profitUsd = revenueUsd - cogsUsd -
expensesUsd`. `profit_cache` stores the four raw components separately (`revenue_usd`,
`refunds_usd`, `cogs_usd`, `cogs_reversal_usd`) rather than pre-netting them, so each is
independently auditable/reportable (e.g. a "total refunds this month" figure), and the netting
happens once, at read time, in `useProfitCache()` — never duplicated across call sites.

**Worked check, catching an earlier draft's error:** sale $100 revenue / $60 COGS, fully
returned. `revenue_usd=100, refunds_usd=100, cogs_usd=60, cogs_reversal_usd=60` →
`netRevenueUsd=0, netCogsUsd=0, profitUsd=0`. Correct — an earlier version of this table
computed `profit_usd = revenue_usd - cogs_usd + cogs_reversal_usd - expenses_usd` directly on
the raw (gross) columns, which produced `100 - 60 + 60 = 100` for the same fixture — wrong by
the full sale amount. The fix is netting `revenue` and `cogs` separately *before* combining
them, not combining all four raw columns in one expression.

Client-side SQLite (`src/data/powersync/schema.ts`): mirrors the same columns, `column.integer`
for the minor-unit fields (SQLite has no fixed-point type; integer cents is exact), synced
(not `localOnly`) — every device must see the same shop-wide numbers.

## Event → metric mapping

| Metric | Source event | Payload field (new unless noted) | Projection operation |
|---|---|---|---|
| Revenue | `sale.completed` | `totalUsd`/`totalSyp` (existing) | `+= totalUsd/Syp` |
| COGS | `sale.completed` | `cogsUsd` **(new)** | `+= cogsUsd` |
| Discounts | `sale.completed` | `discountUsd` **(new)** | `+= discountUsd` |
| Invoice count | `sale.completed` | — | `+= 1` |
| Costless-sale count | `sale.completed` | `hasCostlessLine` **(new, boolean)** | `+= 1 if true` |
| Refunds | `sale.returned` | `refundAmountUsd` (existing) | `+= refundAmountUsd` |
| COGS reversal | `sale.returned` | `cogsReversalUsd` **(new)** | `+= cogsReversalUsd` |
| Return count | `sale.returned` | — | `+= 1` |
| Costless-sale count (decrement) | `sale.returned` | `isFullReturn`, `saleWasCostless` **(new, both boolean)**, `originalSaleProjectionDay` **(new)** | `-= 1` on `originalSaleProjectionDay` (see cross-day note below), only when both booleans are true |
| Expenses | `expense.recorded` | `amountUsd` (existing) | `+= amountUsd` |

**`originalSaleProjectionDay` — `sale.returned` carries the fact directly, no events-table
lookup at apply time.** An earlier draft had `_apply_profit_cache` query `events` by `saleId`
to find the original sale's day. Dropped in favor of the return-completion write path (which
already has the original sale row in hand, to compute `cogsReversalUsd`) stamping
`originalSaleProjectionDay` onto the `sale.returned` payload directly. This removes a
nondeterministic `LIMIT 1` with no `ORDER BY` (a real bug if duplicate events could ever exist),
an unindexed JSONB scan, and a dependency on the original event still existing in whatever
window is currently synced — replacing all three with an ordinary payload field, which is more
correctly event-sourced besides (the return event should be self-contained, not require
re-deriving facts from another event at apply time).

**`costless_sale_count` — exact semantics, stated explicitly:** counts *sales* containing ≥1
line item with no/zero unit cost at completion time — **not** a count of costless line items.
This matches `useDashboardMetrics.ts`'s current `costlessSalesInPeriod` in name and per-sale
granularity, including the case the first draft of this spec deferred: the existing live query
excludes a sale from this count once it's fully returned. Real parity requires the
`sale.returned` event to carry enough information to reverse that +1, not accept the drift —
resolved via two new payload fields (`isFullReturn`, `saleWasCostless`), computed at
return-completion write time (`returns.service.ts`, wherever the sale's cumulative
sold-vs-returned quantity is already known for the restock/COGS-reversal logic): `isFullReturn`
is true exactly when this return's cumulative returned quantity reaches the sale's total sold
quantity (at most one return for a given sale ever sets this true, since a sale cannot be
returned twice past 100%); `saleWasCostless` is a direct copy of the original sale's
`hasCostlessLine` flag, looked up from the sale's own event or from current sale/line-item state
at return time. The projection decrements `costless_sale_count` by 1 only when both are true.

**Cross-day attribution — the subtlety that makes this harder than a plain decrement.** A sale
and the return that fully returns it can (and often will) fall on different `event_projection_day`
values. `costless_sale_count`'s `+1` for a given sale is recorded against *that sale's* day; a
naive decrement on the *return's* day would corrupt two different days' rows — undercounting the
return's day (which never had a matching `+1`) and leaving the sale's day permanently
overcounted. WAFI-151 explicitly named this exact class of problem ("cross-day event effect
attribution... is a WAFI-153+ concern requiring its own handler-level design") and deferred it
generically; this spec resolves it narrowly, for this one case only: `_apply_profit_cache` reads
`originalSaleProjectionDay` directly off the `sale.returned` payload (no lookup — see above) and
applies the decrement to that day's row, not the return's. This is a targeted fix for one
handler, not a general cross-day attribution framework — the generic problem WAFI-151 deferred
remains deferred for any future projection that needs it.

**Ordering hazard, found and fixed, not merely accepted:** an earlier draft applied the
decrement via a bare `UPDATE ... WHERE day = originalSaleProjectionDay`. If the return event is
processed before its own `sale.completed` event — a real possibility, since the event bus makes
no ordering guarantee between a sale and a later return on it — that `UPDATE` matches zero rows
(no `profit_cache` row exists for that day yet) and silently loses the decrement forever, since
the ledger has already marked the return as applied and it is never retried. `sale.completed`'s
later `+1` would then land uncontested, leaving `costless_sale_count` off by one permanently.
The fix is an `INSERT ... ON CONFLICT DO UPDATE` (upsert) seeding `-1`, exactly like every other
branch in this function — so the decrement is never lost regardless of which event is applied
first: sale-first nets `+1` then `-1` = `0`; return-first nets `-1` then `+1` = `0`. Because
`originalSaleProjectionDay` now comes directly from the payload rather than a lookup that could
find nothing, there is no remaining no-op case for a well-formed event — a missing value is
caught by required-field validation instead (below), not silently skipped.

**`expense.recorded` semantics — reconciled against the actual event/table, not assumed:**
`ExpenseRecordedPayload` (`domainEvent.types.ts`) has exactly one currency field, `amountUsd`
— matching `useDashboardMetrics.ts`'s live query (`SUM(amount_usd) FROM expenses`) exactly, no
SYP component to reconcile. `ExpenseEventType` currently defines only `Recorded` — no
void/edit/reversal event type exists today, so expenses are effectively immutable from the
projection's point of view and a simple `+=` is correct parity. **If an expense edit/void event
is introduced later, `_apply_profit_cache` needs a new branch for it — this is called out here
so it isn't silently missed when that event type is added,** not a gap in this design for
today's event contract.

**`expense.recorded` is also bumped to `payload_version = 2`, even though its payload shape is
unchanged — for version-gate uniformity, not because a new field is needed.** An earlier draft
left `expense.recorded` at version 1 implicitly, which — combined with the version gate applying
identically to every event type — would have made *every* expense event, historical and current,
permanently no-op forever (`expenses_usd` never populated from events at all). Bumping all three
event types together means one generic version check (below) correctly covers all of them; no
type-specific version logic is needed. `ExpenseRecordedPayload`'s shape is unchanged; only its
`payloadVersion` stamp at publish time (`expense.service.ts`) changes.

**Event inventory, not an assumed-complete list.** The three event types above were identified
by reading `useDashboardMetrics.ts`'s live queries directly, but "we found three" is not the
same guarantee as "these are the only sources." **Acceptance criterion for implementation:**
before writing `_apply_profit_cache`, produce an explicit table of every metric this ticket
migrates → every table/column `useDashboardMetrics.ts` (and any other code computing the same
numbers) reads to produce it → the event type(s), if any, that already publish an equivalent
fact → confirmation that no additional event type (e.g. a discount-adjustment or expense-edit
event elsewhere in `domainEvent.types.ts`) mutates that same underlying data outside the three
types identified here. If one is found, it's added to the mapping table before implementation,
not discovered as a production gap after cutover. Concretely, before implementation, confirm:
no sale void/cancel/edit event exists; no return cancel/void event exists; no expense edit/
delete event exists; no discount-adjustment event exists; `sale_line_items.unit_cost_usd` is an
immutable historical snapshot, not mutable in place if a product's cost price changes later; and
the restock state used for COGS-reversal is fixed at return time, not re-derivable differently
later. This checklist is a prerequisite to verify against the current codebase, not something
this spec can discharge by assertion.

All *independent* financial aggregate updates (revenue, COGS, expenses, refunds, discounts,
invoice/return counts) are additive and order-independent once each event's immutable financial
snapshot and `event_projection_day` are established — the same class of guarantee
`daily_event_counts` relies on, so WAFI-151's sequence/ordering machinery applies to them without
new handler-level reasoning. **This is not a blanket claim covering every column.**
`costless_sale_count`'s state-transition adjustment (the fully-returned-costless decrement,
above) is genuine cross-event business logic, not a plain sum — it is handled explicitly by its
own upsert-based logic specifically *because* plain additivity doesn't hold for it, and that
handler was designed and tested to be order-independent on its own terms (see the ordering-hazard
fix above), not by inheriting the general commutative-sum guarantee.

**Discount semantics — verified against `sales.service.ts`, not left ambiguous:** lines
303/306 (`basePriceUsd: completed.totalUsd + sd.amountUsd`, `finalPriceUsd: completed.totalUsd`)
prove `totalUsd` is **already net of any sale-level discount** — it's the final amount the
customer pays, not the pre-discount list total. `discount_usd` in `profit_cache` is therefore
purely informational/reporting (e.g. "how much did we discount away this month"), never added
back into any profit calculation — `revenue_usd` already reflects the discounted price, exactly
matching `useDashboardMetrics.ts`'s existing treatment (`sale_discount_amount_usd` is summed and
reported separately, never used to adjust `revenue_usd`/`total_usd`).

**Payload changes required (`payload_version` bump to 2 on `sale.completed`, `sale.returned`,
*and* `expense.recorded` — see uniformity note above):**

- `SaleCompletedPayload` gains `cogsUsd`, `discountUsd`, `hasCostlessLine`. Computed at
  sale-completion write time (`sales.service.ts`) from the same `sale_line_items.unit_cost_usd`
  data `useDashboardMetrics.ts` currently joins live — moving that computation from "read time,
  every load" to "write time, once" is the whole point of this ticket.
- `ReturnedPayload` gains `cogsReversalUsd`, computed at return time using the **same
  restock-aware, per-(sale,product)-averaged logic** `useDashboardMetrics.ts` uses today (see
  existing subquery: un-restocked items don't reverse COGS; a product on two lines of the same
  sale is averaged once, not double-counted). This logic is moved from the read-time query into
  the return-completion write path, not reimplemented. `ReturnedPayload` also gains
  `isFullReturn`, `saleWasCostless`, and `originalSaleProjectionDay` (all three needed by the
  costless-count decrement above) — the return-completion write path already has the original
  sale row loaded to compute `cogsReversalUsd`, so stamping these three costs nothing extra.
- `ExpenseRecordedPayload`'s shape is unchanged; only its version stamp moves to 2, for the
  reason given above.

**Historical events do not contain these fields — resolved explicitly, not left ambiguous.**
Every `sale.completed`/`sale.returned` event recorded before this payload_version bump ships
lacks `cogsUsd`/`discountUsd`/`hasCostlessLine`/`cogsReversalUsd` by construction — there is no
way to recover them from the event payload alone (Option B from review, not Option A: existing
events are *not* already versioned with sufficient information).

**`_apply_profit_cache` implements a concrete three-way version gate, not a binary
current/skip check** (see the function body below): `payload_version = 1` (the shape that
exists today, before this ticket) is a **known historical version** — treated as a permanent,
expected no-op, ledger-recorded so it's never retried, never an error; `payload_version = 2`
(introduced by this ticket) is the **current supported version** — processed normally;
`payload_version > 2` is **unrecognized future schema** — loud failure (`RAISE EXCEPTION`),
matching WAFI-151's rule for an unexpected future version arriving before this function is
updated to understand it. Collapsing "known-old" and "unrecognized-future" into one "not
current" bucket would be wrong — the first is an expected, permanent condition for every
historical event; the second is exactly the drift-detection WAFI-151's loud-failure rule exists
to catch, and silently no-op'ing it would hide that drift instead of surfacing it.

**Consequence: `profit_cache` has pre-coverage history to close before cutover, and — this is
the redesign this section covers — "coverage" cannot be a one-time date-scoped migration.**
Backfilling is mandatory, not optional (the stated goal of this ticket is not achieved if
`useDashboardMetrics.ts`'s live query becomes a permanent, silent fallback for old date ranges
while `profit_cache` serves new ones), but a naive "backfill everything before date X, once" has
two compounding problems, both found during review, that force a different shape:

1. **Device upgrade lag breaks any fixed calendar cutoff.** `payload_version` is stamped by
   whatever app build a device is running when it creates an event, not by wall-clock date — a
   not-yet-upgraded device can create a genuine version-1 event *after* the nominal rollout
   date. A date-scoped backfill (`day < cutoff`) would skip that day (it's on-or-after the
   cutoff), and the version gate correctly no-ops the version-1 event forever — the sale falls
   into a permanent gap belonging to neither path.
2. **A day-level backfill can double-count a mixed-version day.** During the upgrade window, one
   calendar day can contain both a version-1 sale (from a lagging device) and a version-2 sale
   (from an upgraded device). A backfill that aggregates "everything in `sales` for that day"
   would include the version-2 sale — which `_apply_profit_cache` *also* applies from its event
   — double-counting it.

**Resolution: backfill is redefined as a per-fact eligibility query, not a per-day date
range — and it is a repeatable generator (`_backfill_profit_cache_shop(shop_id)`, a Postgres
function, not an ad-hoc one-off script — reusable from both the rollout CLI and
`rebuild_profit_cache_scope`, below), not a one-time migration.** A sale (or return, or
expense) is backfill-eligible if and only if no version-2-or-higher event for it has been
applied to `profit_cache` — concretely, no matching row in `events` with `payload_version >= 2`
for that fact:

```sql
-- Backfill-eligible sales for a shop (returns/expenses follow the identical shape, joined on
-- their own natural key against sale.returned/expense.recorded respectively):
SELECT s.* FROM public.sales s
WHERE s.shop_id = p_shop_id
  AND NOT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.type = 'sale.completed' AND e.payload->>'saleId' = s.id::text
      AND e.payload_version >= 2
  );
```

**Indexing note (implementation detail, not a correctness requirement):** as `events` grows,
this `NOT EXISTS` join benefits from an expression index matching the lookup shape, e.g.
`CREATE INDEX ON events ((payload->>'saleId')) WHERE type = 'sale.completed' AND
payload_version >= 2` (and the equivalent for `sale.returned`/`expense.recorded`'s own natural
keys) — noted here so it isn't missed at implementation time, not specified further since it
affects performance, not correctness, and the exact shape depends on final query plans.

This eligibility query is safe to *evaluate* at any time — it always reflects current reality
(which sales have an eligible event *right now*). **But that is a claim about the query, not
about `_backfill_profit_cache_shop` as a standalone write operation — and those are different
claims, found to be conflated in an earlier draft.** The eligibility query alone says nothing
about how to *merge* its result into `profit_cache` rows that may already carry a
version-2-event's contribution for the same shop/day. An additive upsert would double-count on
a second run (the version-2 contribution already present, plus the eligible facts added again);
a replacing upsert would erase the version-2 contribution. Neither is correct, and no third
upsert strategy resolves it in general — the same day's row is not attributable to "backfill
share" vs. "event share" separately without exactly the finer-grained provenance model already
rejected as disproportionate for v1 (see Rebuild).

**Resolution: `_backfill_profit_cache_shop` is never called standalone.** It is an internal
helper, only ever invoked from inside `rebuild_profit_cache_scope` (below), immediately after
that function deletes every existing row and ledger entry for the shop — i.e. it only ever runs
against a scope that is provably empty, never one that might already contain event-derived
contributions. There is no separate "run the backfill" operation distinct from "run a full
rebuild" — **rollout's initial backfill (step 4 below) and every subsequent self-heal both call
`rebuild_profit_cache_scope(shop_id)`, the same single entry point rebuild itself uses.**
`rebuild_profit_cache_scope` *is* what's safe to run repeatedly, at any time, forever — because
it always deletes before regenerating, by construction, never because of a merge-semantics
argument about upserting into a possibly-nonempty scope. This directly resolves the two
problems above without needing separate merge logic: a lagging device's late version-1 sale is
picked up on the next rebuild's backfill phase (no permanent gap); a mixed-version day never
double-counts, because a rebuild deletes the version-2 event's prior contribution before
backfill runs and then re-applies it via the replay phase — exactly once, not on top of itself.

**Rollout sequence:**

1. Deploy the payload_version 2 bump (`sale.completed`, `sale.returned`, `expense.recorded`).
2. Each device starts producing version-2 events as it upgrades; `_apply_profit_cache` processes
   them as they arrive. Not-yet-upgraded devices keep producing version-1 events, correctly
   no-op'd — no gap opens, because nothing has been backfilled yet to conflict with them.
3. Run **`rebuild_profit_cache_scope(shop_id)`** (below) — the same single entry point used for
   every subsequent rebuild/self-heal, not a separate "initial backfill" operation. It acquires
   the `(shop_id, 'profit_cache')` advisory lock itself, deletes any existing rows (none exist
   yet on first run), regenerates the eligible backfilled base, and replays every event so far —
   version-2 events already produced by upgraded devices in step 2 are captured correctly by
   the replay phase, not left stranded by a backfill-only operation that never touches events.
4. **Old-vs-new financial parity test (see Testing) is run against the resulting data** before
   proceeding — the backfill phase re-derives the same SQL logic `useDashboardMetrics.ts` has
   today, so this step verifies the migration didn't introduce a transcription error, not just
   that the general approach is sound.
5. **There is no separate watermark/exit-condition step, by design.** An earlier draft required
   tracking "zero remaining version-1 events" as a hard gate before cutover. That's now
   unnecessary: because `rebuild_profit_cache_scope` is safe to re-run indefinitely (always
   deletes before regenerating), residual lagging-device staleness self-heals on the next
   re-run rather than needing to be proven absent up front. **Operationally, this still needs a
   trigger, not an assumption that it happens automatically** — re-run
   `rebuild_profit_cache_scope` on a known cadence (e.g. daily, or whatever interval matches
   this product's low-frequency-deploy pace) until device-upgrade telemetry confirms every
   device is current, and immediately whenever shadow-mode logging (below) surfaces a
   discrepancy. The practical go/no-go signal for cutover is the **shadow-mode observation
   window** (below) staying clean across a real operating period — an empirical confidence
   check, not a mathematical proof of zero remaining version-1 events.
6. Consumers (the 6 call sites) switch to `useProfitCache()`.
7. `useDashboardMetrics.ts` and its dedicated tests are deleted, once the shadow-mode window
   (below) has stayed clean.

**`source_event_id = NULL` for backfilled rows — stated explicitly, not left implicit.**
Backfilled rows have no single originating event — they're reconstructed from aggregate table
state, not replayed from the log — so `NULL` is the only honest value, and the column is
nullable specifically to allow it. **`source_event_id NOT NULL` must never be added as a
constraint.** This is analogous to `audit_log`'s existing nullable `source_event_id` for its own
pre-event-bus legacy rows (per `EVENT_SUBSCRIBERS.md`'s idempotency section) — the same pattern,
not a new one invented here. **`source_event_id`'s role is now purely observability/debugging —
"which event most recently touched this row" — and is never used to decide rebuild scope or
correctness** (see Rebuild below, which was redesigned specifically because relying on this
column for that purpose broke under cross-day mutation of backfilled rows).

## Server-side implementation

Directly parallel to `apply_daily_event_count`/`_apply_daily_event_count`:

```sql
CREATE OR REPLACE FUNCTION public._apply_profit_cache(p_event_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_event public.events;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event % not found in authoritative log', p_event_id USING ERRCODE = 'P0002';
  END IF;

  -- payload_version gate: three-way, not a binary current/skip check (see design note below
  -- this function). 1 is the pre-COGS-fields version this ticket's migration ships against;
  -- 2 is the version this ticket introduces. Any version below 1 doesn't exist; any version
  -- above 2 is unrecognized future schema this function was never built for.
  IF v_event.payload_version IS NULL OR v_event.payload_version < 1 THEN
    RAISE EXCEPTION 'event % has invalid payload_version %', p_event_id, v_event.payload_version
      USING ERRCODE = 'P0003';
  ELSIF v_event.payload_version = 1 THEN
    -- Known historical shape: predates cogsUsd/discountUsd/etc. Not an error -- this is the
    -- coverage-start-date boundary itself. Still recorded in the ledger so it's never retried.
    INSERT INTO public.projection_processed_events (projection_name, event_id)
    VALUES ('profit_cache', p_event_id)
    ON CONFLICT DO NOTHING;
    RETURN;
  ELSIF v_event.payload_version > 2 THEN
    RAISE EXCEPTION 'event % has payload_version % newer than this function supports',
      p_event_id, v_event.payload_version USING ERRCODE = 'P0004';
  END IF;
  -- Only payload_version = 2 falls through past this point.

  -- Required-field validation, found missing from an earlier draft: a version=2 event with a
  -- required field absent (producer bug) must fail loudly, never silently become NULL. Without
  -- this check, `(payload->>'cogsUsd')::numeric` on a missing key returns NULL, NULL*100 is
  -- NULL, and `profit_cache.cogs_usd + EXCLUDED.cogs_usd` (NULL) corrupts the ENTIRE existing
  -- row's cogs_usd to NULL on the next conflict-update -- a missing field must never reach the
  -- arithmetic at all.
  IF v_event.type = 'sale.completed' AND (
       v_event.payload->>'cogsUsd' IS NULL OR v_event.payload->>'discountUsd' IS NULL
       OR v_event.payload->>'hasCostlessLine' IS NULL OR v_event.payload->>'totalUsd' IS NULL
       OR v_event.payload->>'totalSyp' IS NULL
     ) THEN
    RAISE EXCEPTION 'event % (sale.completed, payload_version 2) missing a required field', p_event_id
      USING ERRCODE = 'P0005';
  ELSIF v_event.type = 'sale.returned' AND (
       v_event.payload->>'refundAmountUsd' IS NULL OR v_event.payload->>'cogsReversalUsd' IS NULL
       OR v_event.payload->>'isFullReturn' IS NULL OR v_event.payload->>'saleWasCostless' IS NULL
       OR v_event.payload->>'originalSaleProjectionDay' IS NULL
     ) THEN
    RAISE EXCEPTION 'event % (sale.returned, payload_version 2) missing a required field', p_event_id
      USING ERRCODE = 'P0005';
  ELSIF v_event.type = 'expense.recorded' AND v_event.payload->>'amountUsd' IS NULL THEN
    RAISE EXCEPTION 'event % (expense.recorded) missing amountUsd', p_event_id USING ERRCODE = 'P0005';
  END IF;

  BEGIN
    INSERT INTO public.projection_processed_events (projection_name, event_id)
    VALUES ('profit_cache', p_event_id);
  EXCEPTION WHEN unique_violation THEN
    RETURN; -- already applied
  END;

  IF v_event.type = 'sale.completed' THEN
    -- ROUND(dollars * 100)::bigint -- every *Usd/*Syp payload field is fractional dollars
    -- (verified against sales.service.ts/schema.ts, see note above), never pre-converted to
    -- cents by the producer. Casting the raw JSONB text directly to bigint would silently
    -- truncate cents (19.99 -> 19) -- this conversion is not optional decoration.
    INSERT INTO public.profit_cache (shop_id, day, revenue_usd, revenue_syp, cogs_usd,
      discount_usd, invoice_count, costless_sale_count, source_event_id)
    VALUES (v_event.shop_id, v_event.event_projection_day,
      ROUND((v_event.payload->>'totalUsd')::numeric * 100)::bigint,
      ROUND((v_event.payload->>'totalSyp')::numeric * 100)::bigint,
      ROUND((v_event.payload->>'cogsUsd')::numeric * 100)::bigint,
      ROUND((v_event.payload->>'discountUsd')::numeric * 100)::bigint,
      1, CASE WHEN (v_event.payload->>'hasCostlessLine')::boolean THEN 1 ELSE 0 END,
      p_event_id)
    ON CONFLICT (shop_id, day) DO UPDATE SET
      revenue_usd = profit_cache.revenue_usd + EXCLUDED.revenue_usd,
      revenue_syp = profit_cache.revenue_syp + EXCLUDED.revenue_syp,
      cogs_usd = profit_cache.cogs_usd + EXCLUDED.cogs_usd,
      discount_usd = profit_cache.discount_usd + EXCLUDED.discount_usd,
      invoice_count = profit_cache.invoice_count + 1,
      costless_sale_count = profit_cache.costless_sale_count + EXCLUDED.costless_sale_count,
      source_event_id = EXCLUDED.source_event_id,
      updated_at = now();

  ELSIF v_event.type = 'sale.returned' THEN
    -- Refunds/COGS-reversal/return_count are bucketed by the RETURN's own day, matching
    -- useDashboardMetrics.ts's existing refund/return queries (both filter on the return's
    -- created_at, not the sale's). costless_sale_count's decrement is bucketed by the
    -- ORIGINAL SALE's day instead -- see "Return-aware costless tracking, cross-day
    -- attribution" below -- because that's the day the +1 was recorded against, and
    -- decrementing the wrong day's bucket would silently corrupt two different days.
    INSERT INTO public.profit_cache (shop_id, day, refunds_usd, cogs_reversal_usd, return_count,
      source_event_id)
    VALUES (v_event.shop_id, v_event.event_projection_day,
      ROUND((v_event.payload->>'refundAmountUsd')::numeric * 100)::bigint,
      ROUND((v_event.payload->>'cogsReversalUsd')::numeric * 100)::bigint, 1,
      p_event_id)
    ON CONFLICT (shop_id, day) DO UPDATE SET
      refunds_usd = profit_cache.refunds_usd + EXCLUDED.refunds_usd,
      cogs_reversal_usd = profit_cache.cogs_reversal_usd + EXCLUDED.cogs_reversal_usd,
      return_count = profit_cache.return_count + 1,
      source_event_id = EXCLUDED.source_event_id,
      updated_at = now();

    IF (v_event.payload->>'isFullReturn')::boolean AND (v_event.payload->>'saleWasCostless')::boolean THEN
      -- originalSaleProjectionDay comes straight from the payload (see design note above) --
      -- no lookup, no LIMIT 1 non-determinism, no dependency on the original event still
      -- existing in whatever window is currently synced. Required-field validation above
      -- already guarantees this value is present for a well-formed version-2 event.
      -- UPSERT, not a bare UPDATE -- if sale.completed hasn't been applied yet (events can
      -- arrive out of order; PowerSync/the event bus make no ordering guarantee between a
      -- sale and its later return), profit_cache may have no row for this day yet. A plain
      -- UPDATE would match zero rows and silently lose the decrement forever -- the ledger
      -- already marks this return event as processed, so it is never retried. The INSERT
      -- branch seeds costless_sale_count at -1 for that day; sale.completed's own INSERT
      -- (whenever it arrives, in either order) adds its +1 on top via the same ON CONFLICT
      -- path, netting to 0 regardless of which event is applied first.
      -- source_event_id is deliberately NOT updated here (unlike every other branch in this
      -- function) -- this decrement touches a day that isn't "this event's own day," and
      -- overwriting that day's source_event_id with the return's ID would misrepresent which
      -- event most recently touched that row's OWN metrics (revenue/COGS/etc., untouched by
      -- this branch). Since source_event_id is documented as observability-only (never a
      -- rebuild-scope or idempotency signal), this is a deliberate accuracy choice, not an
      -- oversight: the column stays a faithful "last event affecting this row's primary
      -- metrics," rather than becoming ambiguous about which of two different concerns it
      -- last reflects.
      INSERT INTO public.profit_cache (shop_id, day, costless_sale_count, source_event_id)
      VALUES (v_event.shop_id, (v_event.payload->>'originalSaleProjectionDay')::date, -1, NULL)
      ON CONFLICT (shop_id, day) DO UPDATE SET
        costless_sale_count = profit_cache.costless_sale_count - 1,
        updated_at = now();
    END IF;

  ELSIF v_event.type = 'expense.recorded' THEN
    INSERT INTO public.profit_cache (shop_id, day, expenses_usd, source_event_id)
    VALUES (v_event.shop_id, v_event.event_projection_day,
      ROUND((v_event.payload->>'amountUsd')::numeric * 100)::bigint,
      p_event_id)
    ON CONFLICT (shop_id, day) DO UPDATE SET
      expenses_usd = profit_cache.expenses_usd + EXCLUDED.expenses_usd,
      source_event_id = EXCLUDED.source_event_id,
      updated_at = now();
  END IF; -- any other event type: no-op, not an error (mirrors daily_event_counts' pattern)
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_profit_cache(p_event_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_shop_id uuid;
BEGIN
  SELECT shop_id INTO v_shop_id FROM public.events WHERE id = p_event_id;
  IF v_shop_id IS NULL OR v_shop_id IS DISTINCT FROM (SELECT public.auth_shop_id()) THEN
    RAISE EXCEPTION 'apply_profit_cache: caller is not authorized for this event''s shop' USING ERRCODE = 'P0001';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('profit_cache' || v_shop_id::text));
  PERFORM public._apply_profit_cache(p_event_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.apply_profit_cache(uuid) TO anon, authenticated;
ALTER TABLE public.profit_cache ENABLE ROW LEVEL SECURITY;
-- FORCE (not just ENABLE) if this project's convention is that the table owner should not
-- bypass RLS -- match whatever daily_event_counts actually does here; not introducing a new
-- convention for this one table.
-- ALTER TABLE public.profit_cache FORCE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.profit_cache FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.projection_processed_events FROM anon, authenticated;
-- SELECT is granted and shop-scoped by RLS -- required for PowerSync sync-down, matching the
-- daily_event_counts_select_all policy pattern exactly (074_events_bus_core.sql):
CREATE POLICY profit_cache_select_own_shop ON public.profit_cache
  FOR SELECT USING (shop_id = public.auth_shop_id());
GRANT SELECT ON TABLE public.profit_cache TO anon, authenticated, service_role;
-- rebuild_profit_cache_scope (below) is SECURITY DEFINER and unaffected by these REVOKEs, same
-- as _apply_profit_cache/apply_profit_cache -- both service-role/definer-owned functions bypass
-- RLS and the table-level REVOKEs by design, matching daily_event_counts' rebuild function.
-- Publication/sync-rule wiring: profit_cache is added to the same Postgres publication and
-- PowerSync sync-rule/schema entries as every other shop_data table (see Client-side
-- implementation below) -- no new publication mechanism, following the existing pattern.
-- _apply_profit_cache is never GRANTed to anon/authenticated -- reachable only via the
-- wrapper above, or directly by the rebuild function (Plan 2), which already holds the
-- shop+projection lock.
```

**Security contract: inherits WAFI-151's permission model in full, not a partial
reimplementation.** Every requirement WAFI-151 established for `daily_event_counts` applies
identically here: `SECURITY DEFINER` with `SET search_path = public` (pinning the search path
so a session-level `search_path` change can't redirect an unqualified reference inside the
function to a malicious schema); the internal `_apply_*` function is never directly executable
by `anon`/`authenticated`, only by the public wrapper (which re-validates the caller's shop
against the event's actual shop) or the rebuild function (which holds the same lock); direct
client `INSERT`/`UPDATE` against both the projection table *and* the `projection_processed_events`
ledger are revoked, not merely avoided by convention — a client cannot forge a "this event was
already applied" ledger entry any more than it can forge a projection row directly. Where this
spec's snippet above differs from WAFI-151's shape only in table/function names, that's the
extent of the difference — no new security decision is being made for `profit_cache` that
WAFI-151 didn't already make for `daily_event_counts`.

Three event types feed one row per day — the `IF/ELSIF` branches each do a partial
`INSERT ... ON CONFLICT DO UPDATE` touching only their own columns, so a shop with sales but no
expenses that day still gets a correct row from the first `sale.completed` event, with
`expenses_usd` defaulting to 0 until (if ever) an `expense.recorded` event for that day arrives.

**Rebuild — full-shop-scope only, not an arbitrary date sub-range. This is a deliberate
departure from `daily_event_counts`'s rebuild shape, forced by a real correctness problem an
arbitrary-range rebuild would have.** `daily_event_counts` is safe to rebuild for an arbitrary
`[from, to]` because every event affects exactly one day, in isolation — WAFI-151's stated
premise. `profit_cache` breaks that premise: the costless-count decrement (above) deliberately
writes to the *original sale's* day from a `sale.returned` event that can be on a *different*
day. Concretely: rebuilding only `[Aug 13, Aug 20]` (the return's day) would replay that
`sale.returned` event, which would reach across and mutate Aug 10's row (the sale's day) —
**outside the requested rebuild scope**, corrupting a day the operator never asked to touch and
directly violating WAFI-151's own AC #9 ("rebuilding a subset of days... does not... affect
other days"). Building the general "affected-day closure" logic to make arbitrary sub-ranges
safe (computing every day a rebuild's event set could reach into, transitively) is real
complexity disproportionate to one cross-day handler in v1.

**Resolution: `profit_cache`'s rebuild contract is full-scope only for v1, AND is a full
rematerialization — regenerate backfill, then replay events — not "delete event-derived rows,
replay events, leave backfilled rows alone."**

**Why the simpler "leave backfilled rows alone" version (an earlier draft's approach) is
unsafe, found during review, not merely theoretical:** the costless-count decrement
deliberately mutates a *different* day's row than the one its triggering event belongs to (the
whole point of the cross-day fix above). If that other day happens to be a backfilled row, a
rebuild that "only deletes/replays rows with `source_event_id IS NOT NULL`" would: skip
deleting the backfilled row (it's `NULL`) — correct so far — but then, on replay, re-apply the
*same* `sale.returned` event's decrement to that row a second time, because the row was never
reset to its clean backfilled state before replay began. Concretely: a pre-coverage costless
sale (backfilled, `costless_sale_count = 1`) with a later version-2 full return already applied
once (decremented to `0`) — a rebuild replays that same return event again, decrementing to
`-1`, permanently wrong. **The row's provenance is genuinely mixed** — part backfilled base,
part event-derived adjustment — and a single `source_event_id`/`NULL` distinction per row cannot
represent that safely once cross-day mutation of backfilled rows is possible. This is exactly
why `source_event_id` was redefined above as observability-only, never a rebuild-scope decision.

**The fix: rebuild always regenerates the backfilled base fresh, then replays events on top of
that clean base, every time** — never assumes previously-backfilled rows are still correct going
into a rebuild:

```sql
CREATE OR REPLACE FUNCTION public.rebuild_profit_cache_scope(p_shop_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_event_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('profit_cache' || p_shop_id::text));

  -- Full rematerialization: every row for this shop is regenerated from scratch, backfilled
  -- rows included -- not merely the event-derived subset. This is what makes replay-on-top-of
  -- backfill deterministic regardless of what mutated a backfilled row in a previous run.
  DELETE FROM public.profit_cache WHERE shop_id = p_shop_id;
  DELETE FROM public.projection_processed_events
    WHERE projection_name = 'profit_cache'
      AND event_id IN (SELECT id FROM public.events WHERE shop_id = p_shop_id);

  -- Phase 1: regenerate the backfilled base via the eligibility generator (see Payload changes).
  -- _backfill_profit_cache_shop is NEVER called outside this function -- it has no standalone
  -- merge-safety story against a scope that might already contain event-derived rows, and none
  -- is needed, because it only ever runs here, immediately after the DELETEs above guarantee an
  -- empty scope. Inserted with source_event_id = NULL.
  PERFORM public._backfill_profit_cache_shop(p_shop_id);

  -- Phase 2: replay every event for this shop, in sequence order, on top of that clean base.
  -- Version-1 events no-op (as always); version-2 events apply their full logic, including any
  -- cross-day decrement -- now landing on a freshly-regenerated backfilled row, not a
  -- possibly-already-adjusted one from a prior run.
  FOR v_event_id IN
    SELECT id FROM public.events WHERE shop_id = p_shop_id ORDER BY sequence ASC
  LOOP
    PERFORM public._apply_profit_cache(v_event_id);
  END LOOP;
END;
$$;
```

This makes rebuild deterministic under repeated runs and under cross-day mutation of backfilled
rows, at the cost of coupling rebuild to the backfill generator's continued existence — an
accepted tradeoff for v1 (see the alternative considered below).

**`npm run projections:rebuild -- profit_cache --shop <id>`** (no `--from`/`--to`) is the entire
CLI surface for this projection — full-scope-only remains correct independent of the
rematerialization fix above (a partial date range would still let the cross-day decrement reach
outside a requested sub-scope, per the earlier finding).

**Alternative considered and rejected for v1:** separate `profit_cache_backfill` and
`profit_cache_event_adjustments` tables (or an equivalent provenance/adjustment ledger), summed
via a view, would let rebuild regenerate only the event-adjustments layer without ever touching
backfill. More correct in the abstract, more complex in practice — two tables, a view, and a
finer-grained provenance model for one cross-day handler. Full rematerialization is simpler and
sufficient at this product's current scale (single pilot shop, no multi-year history); revisit
if a future shop's history makes full-shop rematerialization too slow.

## Client-side implementation

- **Sync:** `profit_cache` added to the PowerSync sync stream, shop-scoped (same pattern as
  every other table in the `shop_data` stream) — unlike `local_today_revenue_projection`, this
  table is not `localOnly`; every device for a shop must see the same numbers.
- **Local subscriber** (`src/services/events/profitCacheProjection.ts`, following the file-naming
  convention in `EVENT_SUBSCRIBERS.md` — named for what it does, not the ticket): subscribes to
  `sale.completed`, `sale.returned`, `expense.recorded` via `useEventSubscription` (lightweight
  category — losing a local marker write is recoverable via rebuild, matching the decision
  rule). On each event, does a read-then-insert-or-update against the local `(shop_id, day)`
  row exactly like `dashboardRevenueProjection.ts`'s existing pattern, but **only writes
  `source_event_id = event.id`** — no local computation of the metric columns. **Explicit
  invariant: the local marker write may mutate `source_event_id` only. It must never
  increment, decrement, or otherwise derive any financial/count column
  (`revenue_usd`, `cogs_usd`, `costless_sale_count`, etc.) — those are mutated exclusively by
  `apply_profit_cache()`, server-side. This holds even incidentally: a local
  read-then-insert-or-update must not carry forward or recompute a metric value as part of
  writing the marker, since doing so would be exactly the local-optimistic-state-diverging-
  from-server-state bug WAFI-151 fixed for `daily_event_counts`, reintroduced for
  `profit_cache` by a different route.** **This is the
  same "one table, two meanings" mechanism WAFI-151 established for `daily_event_counts`, not a
  new design**: verified directly against migration `083` (`ALTER TABLE daily_event_counts ADD
  COLUMN source_event_id...`) and `_apply_daily_event_count`'s `INSERT ... source_event_id`,
  both operating on the *same* table that also holds the aggregate — there is no separate queue
  table in the actual WAFI-151 implementation, so `profit_cache` doesn't invent one either.
  **Why multiple events on the same day don't collide locally:** PowerSync's upload queue
  records one op per local mutation, each carrying the `opData` snapshot as written *at that
  call* — a second event's write to the same local row is still a distinct queued op with its
  own `source_event_id`, processed serially by `ops.ts`. The local row's current on-screen value
  may lag between events (no local optimistic increment, matching
  `dailyEventCountsProjection.ts` post-fix exactly); the authoritative value arrives on the next
  sync-down after the server applies it.
- **`src/data/powersync/ops.ts`**: new special case for `profit_cache`, identical shape to the
  existing `daily_event_counts` one — PUT/PATCH with a `source_event_id` calls
  `supabase.rpc('apply_profit_cache', { p_event_id })`, never uploading the metric columns
  themselves; missing `source_event_id` is a no-op (pre-migration row).
- **Read side** (`src/features/dashboard/composables/useProfitCache.ts`, new): given a date
  range, `SELECT ... FROM profit_cache WHERE shop_id = ? AND day BETWEEN ? AND ?` and sums the
  handful of already-small day rows in JS — no JOINs, no `sale_line_items` scan.

  **Domain type, not a blind copy of the old composable's shape:** the composable returns a
  `PeriodProfitMetrics` type (`src/features/dashboard/types/profitMetrics.ts`, new) —
  `{ revenueUsd, refundsUsd, cogsUsd, cogsReversalUsd, expensesUsd, discountUsd, invoiceCount,
  returnCount, costlessSaleCount, netRevenueUsd, netCogsUsd, profitUsd, profitIsEstimated }` —
  defined as the read model's own canonical contract, with `netRevenueUsd`/`netCogsUsd`/
  `profitUsd` computed once inside the composable per the derivation above, not left for each
  call site to re-derive. It is *not* defined as "whatever `useDashboardMetrics()` happened to
  expose" — that would carry the old composable's incidental shape forward as if it were a
  deliberate contract. In practice the field names are chosen to match today's composable
  closely (`revenueUsd`, `cogsUsd`, etc.) purely so the six call-site migrations are low-risk
  mechanical swaps, not because preserving the old shape is a goal in itself; new fields
  (`refundsUsd`, `cogsReversalUsd`, `netRevenueUsd`, `netCogsUsd`) that the old composable never
  separately exposed are added where the raw-components design (above) makes them available.

  **Negative `costlessSaleCount` is a real, if transient, possibility** — the return-before-sale
  upsert (above) seeds `-1` before the matching `+1` arrives. A period summed while that's still
  in flight could show a negative count. This is not given a hard `CHECK (costless_sale_count >=
  0)` constraint (a future correction/adjustment mechanism may legitimately need negative
  deltas, and a transient `-1` mid-flight is expected, not corrupt data) — instead,
  `useProfitCache()` treats a negative summed `costlessSaleCount` as a data-quality signal:
  clamp the value exposed to UI at `0` (never show a negative count to a shop owner) while
  logging/flagging the anomaly for operator visibility, since a *persistently* negative count
  (not resolving once all in-flight events land) indicates a real bug worth investigating, not
  normal eventual consistency.
- **`missingCostCount`**: extracted to its own tiny composable or kept inline at each of its 2
  call sites (implementation plan decides) — the one live query that survives.

**Call sites migrated** (`useDashboardMetrics` → `useProfitCache` + optionally the extracted
missing-cost query): `HomePage.vue`, `ReportsPage.vue`, `AnomalyBanner.vue`,
`useAutomaticInsights.ts`, `useRevenueIntelligence.ts`, `useProfitIntelligence.ts`.
`useDashboardMetrics.ts` and its dedicated test files are deleted once all six are migrated and
passing against the new composable.

## Testing

Per `EVENT_SUBSCRIBERS.md`'s minimum bar plus WAFI-151's fixture-based contract-test
requirement:

1. Mapping-function tests for each of the three event types (produces a row / returns null for
   unrelated event types).
2. Delivery test: synthetic event → local marker row → (mocked) RPC call with correct
   `source_event_id`.
2b. **Same-day marker burst test:** fire two events for the same shop/day through the local
   subscriber before either uploads; assert PowerSync's upload queue produces two distinct
   queued ops, each with its own `source_event_id` (not coalesced into one), and that both
   result in a separate RPC call with the server ledger deduplicating correctly (not the local
   row silently overwriting/losing one).
2c. **Aggregate-column suppression test:** insert a local marker row with whatever default
   metric-column values the local write produces; assert `ops.ts`'s upload payload for that op
   never includes the metric columns (`revenue_usd`, `cogs_usd`, etc.) — only `source_event_id`
   drives the RPC call — proving a client cannot accidentally author an aggregate value via the
   normal upsert path.
3. Redelivery/dedup test at the Postgres layer: same `event_id` applied twice via
   `apply_profit_cache` → exactly one increment, one ledger row (mirrors WAFI-151 AC #0).
4. Multi-device race test: two "devices" (two separate RPC calls) for the *same* event_id →
   exactly one increment (proves the cross-device correctness this whole design exists for).
5. Rebuild parity test: apply a mixed event set incrementally, capture `profit_cache` state;
   delete + rebuild the same scope; assert identical resulting rows (WAFI-151 AC #3, applied to
   this projection).
6. COGS-reversal restock logic test: a return with one restocked + one non-restocked line
   produces the same `cogsReversalUsd` the existing `useDashboardMetrics.ts` subquery would —
   ported as a fixture, not re-derived from scratch.
7. Read-side composable test: seed `profit_cache` rows across a date range, assert
   `useProfitCache()` sums correctly and `profitIsEstimated` flips on `costlessSaleCount > 0`.
8. Full-parity regression: for each of the 6 migrated call sites, existing tests continue to
   pass against `useProfitCache` (test files updated to import the new composable, assertions
   unchanged where the metric contract is unchanged).
9. **Old-vs-new financial parity test (the primary migration safety net, required before
   `useDashboardMetrics.ts` is deleted):** seed a fixture with a realistic mixed event set and
   populate the *equivalent* underlying `sales`/`sale_line_items`/`returns`/`expenses` rows the
   old composable reads directly. Run both `useDashboardMetrics()`'s live query and
   `useProfitCache()` (fed by applying the same events through `_apply_profit_cache`) over the
   identical period, and assert every metric — revenue, refunds, COGS, COGS reversal, expenses,
   discounts, invoice/return/costless counts, profit — matches **exactly**, with no accepted
   divergence (the costless-count parity gap from the first draft is resolved above, not carried
   into this test as a documented exception). Scenarios, at minimum: same-day return; cross-day
   return (proves the day-attribution fix, not just the arithmetic); multiple sales in one day;
   multiple distinct products on one sale; duplicate product across two lines of one sale
   (exercises the existing per-(sale,product)-averaged COGS-reversal logic); a costless sale
   that is later fully returned (exercises the cross-day costless decrement end-to-end); a
   costless sale that is only partially returned (decrement must *not* fire); an expense; a
   discount; a zero-value sale if the domain permits one. This is what proves the migration
   doesn't silently change financial results, which is the entire premise of retiring the old
   composable.
10. **Backfill generator verification test:** run `_backfill_profit_cache_shop` against a
    fixture populated only in `sales`/`sale_line_items`/`returns`/`expenses` (no events at all,
    modeling genuine pre-coverage history) and assert the resulting `profit_cache` rows match
    `useDashboardMetrics()`'s live-query output for the same period exactly; separately, assert
    a second run against unchanged source data produces byte-identical rows (idempotency of the
    generator itself, required since both rollout and every rebuild depend on re-running it
    safely).
11. **Rebuild scope test:** confirm `rebuild_profit_cache_scope` accepts a `shop_id`-only
    argument (no `from`/`to`) and always regenerates the full backfilled base plus every event
    for the shop.
11e. **Event-before-rebuild mixed-day test (the direct regression test for the standalone-
    backfill merge-semantics gap):** apply a version-2 `sale.completed` event for Aug 10 first;
    separately seed a version-1 sale for Aug 10 in source tables only (no event); run
    `rebuild_profit_cache_scope`; assert Aug 10's `revenue_usd` equals the sum of both sales
    exactly once each — proving the delete-then-regenerate-then-replay sequence merges correctly
    regardless of which fact existed in `profit_cache` first, since deletion happens before
    either phase runs.
11f. **Repeated-rebuild idempotency test:** run `rebuild_profit_cache_scope` twice in immediate
    succession with no source data or event changes between runs; assert the second run
    produces byte-identical `profit_cache` rows to the first — the direct proof that "safe to
    run repeatedly" is actually true of the full rebuild function, not merely asserted.
11g. **Expense version/backfill test:** a version-1 expense event is ledger-recorded and
    produces no mutation; a version-2 expense event applies normally; an expense with no
    corresponding event at all is picked up by the backfill phase; an expense that already has
    an eligible version-2 event is excluded from the backfill phase (not double-counted) —
    all four asserted together against one rebuild run.
11b. **Cross-day rebuild safety test (the direct regression test for the finding that forced
    full-scope-only rebuild):** seed a sale on day 1 and its full return on day 10, both within
    the event-covered range; run a full-scope rebuild; assert day 1's `costless_sale_count`
    ends at 0, matching incremental processing exactly — this is what full-scope rebuild is
    *for*, proven directly rather than only argued architecturally.
11c. **Backfilled-row-mutated-by-later-event rebuild test — the direct regression test for the
    "leave backfilled rows alone" design that was found unsafe and replaced:** seed a
    pre-coverage costless sale in source tables only (no event); run the backfill generator
    (`costless_sale_count = 1`, `source_event_id = NULL`); apply a post-coverage version-2 full
    return event referencing it (decrements to `0`); run a full-scope rebuild; assert the final
    state is still `0`, **not `-1`** (the exact failure mode an earlier "delete only
    event-derived rows" design would have produced by re-applying the same decrement against a
    never-reset backfilled row).
11d. **Mixed-version-day backfill test:** seed one version-1 sale and one version-2 sale on the
    same calendar day for the same shop; run the backfill generator; assert it includes only
    the version-1 sale's contribution; apply the version-2 sale's event; assert the day's final
    `revenue_usd` equals the sum of both sales exactly once each — the direct regression test
    for the double-counting risk a date-scoped (rather than eligibility-scoped) backfill would
    have had.
12. **Return-before-sale ordering test (regression test for the ordering hazard found and fixed
    above):** apply a `sale.returned` event (full return of a costless sale) *before* its own
    `sale.completed` event has been applied; assert `costless_sale_count` nets to exactly `0`
    once both are applied, regardless of order — run both orderings (return-first and
    sale-first) and assert identical final state.
13. **payload_version three-way gate test:** a `payload_version = 1` event is ledger-recorded
    and produces no `profit_cache` mutation (not an error); a `payload_version = 2` event
    processes normally; a `payload_version = 3` (or any value > 2) event raises loudly with no
    partial mutation — all three asserted in the same test, not just the current-version case.
14. **Cents-conversion correctness test:** feed a `sale.completed` event with `totalUsd: 19.99`
    (a value chosen specifically because a naive `::bigint` cast would silently truncate it to
    `19`) and assert `profit_cache.revenue_usd = 1999`, and separately that `useProfitCache()`
    reads it back as `19.99`, not `19` or `1999`. This is the direct regression test for the
    unit-verification acceptance criterion above.

## Shadow mode & rollback

Given this is a financial dashboard's numbers, cutover doesn't have to be a single atomic
switch — a staged rollout costs little extra and catches a formula/producer bug against real
production data before users ever see a wrong number:

1. **Shadow comparison, behind a feature flag (WAFI-155's flag framework, or a simple boolean
   if that ticket hasn't landed yet):** for a period after backfill/reconciliation completes,
   run *both* `useDashboardMetrics()`'s live query and `useProfitCache()` for the same request,
   log any discrepancy (shop, period, metric, both values) without showing the new numbers to
   the user yet. A clean shadow period of some implementation-decided length (long enough to
   observe real returns/discounts/expenses, not just same-day sales) is the actual go/no-go
   gate for cutover — not just "the parity test suite passed."
2. **Flip the flag** once shadow logging shows no discrepancies: `useProfitCache()` becomes the
   real answer; `useDashboardMetrics()` keeps running in the background, still logged, for a
   second observation window — cheap insurance in case the flip itself exposed something the
   shadow period didn't (e.g. a caching/reactivity difference between the two composables).
3. **Retire `useDashboardMetrics.ts`** only after that second window is clean. Reverting to
   step 2 (flip the flag back) is the rollback path at any point before this step — trivial,
   since the old code path never stopped running until this point.

This is explicitly staged *after* the mandatory backfill/reconciliation sequence above, not a
replacement for it — shadow mode catches bugs in the formula/implementation; backfill/
reconciliation is what makes the two paths comparable over the same history in the first place.

## Out of scope

- `dashboard_metrics`, `inventory_summary`, `customer_summary`, `staff_summary` (separate specs)
- Retrofitting `sales`/`expenses`/etc. tables from float to integer minor units — only the new
  `profit_cache` table uses that representation
- `missingCostCount` migration to any projection (deliberately stays live — see Scope)
- Admin UI or customer-facing rebuild trigger (inherits WAFI-151's CLI-only trigger surface)
- The historical backfill generator (`_backfill_profit_cache_shop`, mandatory pre-cutover, also
  reused by rebuild) is a non-event-sourced, eligibility-based query against source tables — not
  a rebuild from the event log, which cannot produce COGS/discount facts events never recorded.
  Building a *general*, reusable backfill framework for future read models is out of scope;
  this generator is specific to `profit_cache`'s source tables and fact shape.
- Separate `profit_cache_backfill`/`profit_cache_event_adjustments` provenance tables (considered
  and rejected for v1 — see Rebuild) — full rematerialization is the chosen approach instead.

## Risks

| Risk | Mitigation |
|---|---|
| `sale.completed`/`sale.returned` payload changes ripple to every existing consumer of those events | `payload_version` bump; existing consumers (notifications, other projections) reviewed for whether they read the new fields (they don't need to) or need loud-failure handling for the new version |
| COGS-reversal restock logic re-derived incorrectly at write time vs. today's read-time query | Ported as a direct fixture-based test (existing SQL logic → equivalent write-time computation), not re-derived from memory |
| Three event types partially updating one row via separate `ON CONFLICT` branches race with each other for the same shop+day | Same `(shop_id, projection_name)` advisory lock as `daily_event_counts` serializes all writes to a scope, regardless of which event type triggered them |
| `profit_usd` stored as a column and drifting from its inputs | Not stored — always computed at read time by netting revenue/COGS first, then combining (worked-example test in this spec catches the gross-vs-net error class directly) |
| Six call sites migrated inconsistently, some left on old composable | Explicit call-site list in this spec; `useDashboardMetrics.ts` deletion is step 7 of the mandatory rollout sequence, gated on backfill (steps 3-4) actually completing, never assumed automatic on cutover |
| Historical events lack the new payload fields, silently producing wrong or missing profit_cache rows for old periods | Mandatory pre-cutover backfill (not optional) closes the gap once, directly from source tables; `_apply_profit_cache` no-ops (not loud-fails) on pre-rollout `payload_version` for any event somehow still reaching it after backfill |
| Cross-day costless-count decrement corrupts the wrong day's row, or double-decrements | Decrement is applied to the original sale's `event_projection_day` (looked up by `saleId`), never the return's own day; `isFullReturn` can be true for at most one return per sale |
| Return event processed before its own sale.completed event (no ordering guarantee between them) permanently loses the costless decrement | Decrement uses an upsert (`INSERT ... ON CONFLICT DO UPDATE`), not a bare `UPDATE` — nets to 0 regardless of which event applies first; verified by an explicit both-orderings test |
| An old event without the new payload fields reaches the apply function and crashes on a missing JSON key, or a genuinely-unrecognized future version is silently no-op'd and its drift hidden | Explicit three-way `payload_version` gate: known-old (1) = permanent no-op, current (2) = process, unrecognized-future (>2) = loud failure — never collapsed into a single "not current" bucket |
| Dollar-denominated payload fields (`totalUsd: 19.99`) cast directly to `bigint` silently truncate cents | Verified against `schema.ts`/`sales.service.ts` that every `*Usd`/`*Syp` field is fractional dollars, never pre-converted; every extraction uses `ROUND(value * 100)::bigint`, and the read side converts back before exposing dollars to callers |
| A future engineer removes `projection_processed_events`, assuming `source_event_id` already provides idempotency | `source_event_id` documented explicitly as provenance/observability-only, never the dedup mechanism and never the rebuild-scope decision; idempotency is the ledger's `(projection_name, event_id)` primary key alone |
| Backfill and an incremental writer race into the same shop's row | Backfill generator acquires the same `(shop_id, 'profit_cache')` advisory lock incremental writes and rebuild already share, for its whole duration |
| A `NOT NULL` constraint is later added to `source_event_id`, rejecting every backfilled row | Documented explicitly: `NULL` is the correct, permanent value for backfilled rows (no single originating event exists for them), analogous to `audit_log`'s existing nullable `source_event_id` |
| A partial date-range rebuild reaches across days via the cross-day costless decrement, corrupting a day outside the requested scope (violates WAFI-151 AC #9) | `profit_cache` rebuild is full-scope only for v1 — no `from`/`to` argument exists to request a sub-range in the first place |
| Rebuild that only deletes "event-derived" rows re-applies a cross-day event's mutation against a never-reset backfilled row a second time, corrupting it (found during review — the earlier `source_event_id IS NOT NULL` rebuild-boundary design) | Rebuild is a full rematerialization: regenerate the entire backfilled base via `_backfill_profit_cache_shop`, delete every row and ledger entry first, then replay all events on top of the clean base — never assumes a prior run's backfilled rows are still correct; verified by an explicit test (11c) |
| `expense.recorded` left at payload_version 1 implicitly, causing every expense event (historical and current) to permanently no-op forever | `expense.recorded` is explicitly bumped to payload_version 2 alongside `sale.completed`/`sale.returned`, for version-gate uniformity, documented as a deliberate decision not an oversight |
| A date-scoped backfill skips a lagging device's late version-1 event (falls in a date-range gap), or double-counts a mixed-version day's already-event-covered sale | Backfill redefined as a per-fact eligibility query (`NOT EXISTS` an eligible version-2+ event for that fact), not a date range — self-healing on every re-run, immune to both failure modes by construction (verified by tests 11d and the mixed-version scenario) |
| A standalone backfill run merges (additively or by replacement) into a scope that already contains event-derived contributions for the same day, either double-counting or erasing them (found during review — the earlier draft never specified this merge behavior at all) | `_backfill_profit_cache_shop` is never called standalone — it is only invoked from inside `rebuild_profit_cache_scope`, immediately after that function deletes the entire scope, so it only ever runs against a provably empty target; there is no merge-semantics question left to answer, verified by tests 11e/11f |
| "Backfill runs automatically forever" is assumed rather than operationally triggered, leaving a real gap open indefinitely | Rollout sequence states explicitly: re-run `rebuild_profit_cache_scope` on a known cadence until device-upgrade telemetry confirms currency, and immediately on any shadow-mode discrepancy — not an assumed background process |
| A version=2 event reaches `_apply_profit_cache` missing a required field (producer bug), and a raw cast silently turns it into NULL, corrupting the whole day's aggregate on the next conflict-update | Explicit `IS NULL` validation on every required field per event type (including the three new `sale.returned` fields), raised loudly before any ledger/aggregate mutation |
| Local marker mechanism assumed to need a new queue table, diverging from WAFI-151's actual shape | Verified against migration `083` directly: `daily_event_counts` already carries `source_event_id` on the same row as the aggregate; `profit_cache` copies that exact column and mechanism |
| A nondeterministic `LIMIT 1` events-table lookup (no `ORDER BY`) for the original sale's day, dependent on that event still being synced/present | Removed entirely — `originalSaleProjectionDay` is stamped directly onto the `sale.returned` payload at write time, no lookup at apply time |
| `costlessSaleCount` transiently negative mid-flight (return applied before its sale) is mistaken for corrupt data, or a hard CHECK constraint rejects a legitimate future correction needing a negative delta | No CHECK constraint; `useProfitCache()` clamps the exposed value at 0 and flags persistently-negative counts as an anomaly for operator visibility, rather than either hiding or hard-blocking the transient case |
