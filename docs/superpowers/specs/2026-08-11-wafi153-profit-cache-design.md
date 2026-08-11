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
  source_event_id       uuid REFERENCES public.events(id),
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
| Costless-sale count (decrement) | `sale.returned` | `isFullReturn`, `saleWasCostless` **(new, both boolean)** | `-= 1` on the *original sale's* day (see cross-day note below), only when both are true |
| Expenses | `expense.recorded` | `amountUsd` (existing) | `+= amountUsd` |

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
generically; this spec resolves it narrowly, for this one case only: `_apply_profit_cache`
looks up the original `sale.completed` event by `saleId` to get its `event_projection_day`, and
applies the decrement to that day's row, not the return's. This is a targeted fix for one
handler, not a general cross-day attribution framework — the generic problem WAFI-151 deferred
remains deferred for any future projection that needs it.

**Ordering hazard, found and fixed, not merely accepted:** an earlier draft applied the
decrement via a bare `UPDATE ... WHERE day = v_sale_day`. If the return event is processed
before its own `sale.completed` event — a real possibility, since the event bus makes no
ordering guarantee between a sale and a later return on it — that `UPDATE` matches zero rows
(no `profit_cache` row exists for that day yet) and silently loses the decrement forever, since
the ledger has already marked the return as applied and it is never retried. `sale.completed`'s
later `+1` would then land uncontested, leaving `costless_sale_count` off by one permanently.
The fix is an `INSERT ... ON CONFLICT DO UPDATE` (upsert) seeding `-1` if no row exists yet,
exactly like every other branch in this function — so the decrement is never lost regardless of
which event is applied first: sale-first nets `+1` then `-1` = `0`; return-first nets `-1` then
`+1` = `0`. The only remaining no-op case is `v_sale_day IS NULL` — the original `sale.completed`
event doesn't exist in the log at all, a data-integrity question upstream of this projection,
not an ordering question this design needs to solve.

**`expense.recorded` semantics — reconciled against the actual event/table, not assumed:**
`ExpenseRecordedPayload` (`domainEvent.types.ts`) has exactly one currency field, `amountUsd`
— matching `useDashboardMetrics.ts`'s live query (`SUM(amount_usd) FROM expenses`) exactly, no
SYP component to reconcile. `ExpenseEventType` currently defines only `Recorded` — no
void/edit/reversal event type exists today, so expenses are effectively immutable from the
projection's point of view and a simple `+=` is correct parity. **If an expense edit/void event
is introduced later, `_apply_profit_cache` needs a new branch for it — this is called out here
so it isn't silently missed when that event type is added,** not a gap in this design for
today's event contract.

**Event inventory, not an assumed-complete list.** The three event types above were identified
by reading `useDashboardMetrics.ts`'s live queries directly, but "we found three" is not the
same guarantee as "these are the only sources." **Acceptance criterion for implementation:**
before writing `_apply_profit_cache`, produce an explicit table of every metric this ticket
migrates → every table/column `useDashboardMetrics.ts` (and any other code computing the same
numbers) reads to produce it → the event type(s), if any, that already publish an equivalent
fact → confirmation that no additional event type (e.g. a discount-adjustment or expense-edit
event elsewhere in `domainEvent.types.ts`) mutates that same underlying data outside the three
types identified here. If one is found, it's added to the mapping table before implementation,
not discovered as a production gap after cutover.

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

**Payload changes required (payload_version bump on `sale.completed` and `sale.returned`):**

- `SaleCompletedPayload` gains `cogsUsd`, `discountUsd`, `hasCostlessLine`. Computed at
  sale-completion write time (`sales.service.ts`) from the same `sale_line_items.unit_cost_usd`
  data `useDashboardMetrics.ts` currently joins live — moving that computation from "read time,
  every load" to "write time, once" is the whole point of this ticket.
- `ReturnedPayload` gains `cogsReversalUsd`, computed at return time using the **same
  restock-aware, per-(sale,product)-averaged logic** `useDashboardMetrics.ts` uses today (see
  existing subquery: un-restocked items don't reverse COGS; a product on two lines of the same
  sale is averaged once, not double-counted). This logic is moved from the read-time query into
  the return-completion write path, not reimplemented.

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

**Consequence: `profit_cache` has a coverage start date** — the day this payload_version ships.
**Backfilling pre-coverage history is mandatory before cutover, not optional** — the stated
goal of this ticket ("replaced by a single... read model," "no metric is left
half-duplicated," WAFI-033) is not achieved if `useDashboardMetrics.ts`'s live query becomes a
permanent, silent fallback for old date ranges while `profit_cache` serves new ones. A Reports
"This year" view spanning both would otherwise need to know, per day, which of two calculation
paths to trust — exactly the split-brain WAFI-153 exists to eliminate. Required rollout
sequence:

1. Deploy the new event payload version (`sale.completed`, `sale.returned` gain the new fields).
2. New events from this point carry the required facts; `_apply_profit_cache` begins processing them.
3. Run a **one-time historical backfill migration**: a script that computes `profit_cache`-
   equivalent rows for every pre-coverage day by querying `sales`/`sale_line_items`/`returns`/
   `expenses` directly — the same tables/logic `useDashboardMetrics.ts` uses today — and inserts
   them once. This is **not** run through `_apply_profit_cache`/the event log (there is nothing
   in old events to replay); it's a separate, one-time direct-to-table migration.
4. **Old-vs-new financial parity test (see Testing) is run against the backfilled data itself**
   before proceeding — the backfill script re-derives the same SQL logic `useDashboardMetrics.ts`
   has today, so this step verifies the migration didn't introduce a transcription error, not
   just that the general approach is sound.
5. Once backfill covers a shop's entire reportable history, `profit_cache` is authoritative for
   every date range that shop's users can request — no boundary where "which path answers this"
   depends on the date.
6. Consumers (the 6 call sites) switch to `useProfitCache()`.
7. `useDashboardMetrics.ts` and its dedicated tests are deleted.

`useDashboardMetrics.ts` is not deleted at step 6 speculatively "once backfill runs eventually" —
step 7 is gated on step 3/4 having actually completed for the shop(s) in question. For a
single-pilot-shop product at this stage (see project context: one brother's-shop customer, no
multi-year history yet), the backfill is small in practice; this sequencing exists so the
architecture is correct in principle regardless of how much history a future shop brings.

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
      DECLARE
        v_sale_day date;
      BEGIN
        SELECT event_projection_day INTO v_sale_day FROM public.events
          WHERE type = 'sale.completed' AND payload->>'saleId' = v_event.payload->>'saleId'
          LIMIT 1;
        IF v_sale_day IS NOT NULL THEN
          -- UPSERT, not a bare UPDATE -- if sale.completed hasn't been applied yet (events can
          -- arrive out of order; PowerSync/the event bus make no ordering guarantee between a
          -- sale and its later return), profit_cache has no row for v_sale_day yet. A plain
          -- UPDATE would match zero rows and silently lose the decrement forever -- the ledger
          -- already marks this return event as processed, so it is never retried. The INSERT
          -- branch seeds costless_sale_count at -1 for that day; sale.completed's own INSERT
          -- (whenever it arrives, in either order) adds its +1 on top via the same ON CONFLICT
          -- path, netting to 0 regardless of which event is applied first.
          INSERT INTO public.profit_cache (shop_id, day, costless_sale_count, source_event_id)
          VALUES (v_event.shop_id, v_sale_day, -1, p_event_id)
          ON CONFLICT (shop_id, day) DO UPDATE SET
            costless_sale_count = profit_cache.costless_sale_count - 1,
            updated_at = now();
        END IF; -- v_sale_day IS NULL: original sale.completed event doesn't exist in the log at
                -- all (data integrity issue upstream, not an ordering issue) -- nothing to key
                -- the decrement to; this is the one case that remains a silent no-op.
      END;
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
REVOKE INSERT, UPDATE ON TABLE public.profit_cache FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.projection_processed_events FROM anon, authenticated;
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

**Rebuild:** reuses WAFI-151's generic `rebuild_<projection>_scope(shop_id, from, to)` shape —
`rebuild_profit_cache_scope` deletes the scope's `profit_cache` rows and
`projection_processed_events WHERE projection_name = 'profit_cache'` entries, then replays all
in-scope events `ORDER BY sequence ASC` through `_apply_profit_cache`, exactly like
`daily_event_counts`'s rebuild function. No new rebuild-engine logic — one new function
following the established shape, wired into the same CLI (`npm run projections:rebuild --
profit_cache --shop <id> --from <date> --to <date>`).

**Rebuild boundary rule, explicit rather than left to accident:** the event-replay rebuild
contract only covers `profit_cache` rows from a shop's coverage start date forward — rebuilding
is defined as "replay the events that produced this state," and pre-coverage, backfilled rows
were never produced by events. `rebuild_profit_cache_scope` **rejects** (fails fast, no
mutation) any request whose `from` date precedes the shop's recorded coverage start date, rather
than silently deleting backfilled rows it cannot regenerate from the event log. This is a
one-line guard, not the tagged-row/`source` column approach an earlier draft considered — no
row in `profit_cache` needs to know its own provenance; the boundary lives in the rebuild
function's argument validation instead, keeping every row in the table uniform. If a backfilled
day's data is ever found wrong, its fix is re-running (a corrected) backfill for that day, not
`projections:rebuild`.

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
10. **Backfill verification test:** run the historical backfill script against a fixture
    populated only in `sales`/`sale_line_items`/`returns`/`expenses` (no events at all, modeling
    genuine pre-coverage history) and assert the resulting `profit_cache` rows match
    `useDashboardMetrics()`'s live-query output for the same period exactly — this is the
    step-4 verification the mandatory rollout sequence (see Payload changes) requires before
    cutover proceeds.
11. **Rebuild boundary test:** attempt `projections:rebuild -- profit_cache` with a `from` date
    preceding the shop's coverage start date; assert it fails fast with no mutation, rather than
    deleting backfilled rows it can't regenerate.
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

## Out of scope

- `dashboard_metrics`, `inventory_summary`, `customer_summary`, `staff_summary` (separate specs)
- Retrofitting `sales`/`expenses`/etc. tables from float to integer minor units — only the new
  `profit_cache` table uses that representation
- `missingCostCount` migration to any projection (deliberately stays live — see Scope)
- Admin UI or customer-facing rebuild trigger (inherits WAFI-151's CLI-only trigger surface)
- The historical backfill (mandatory pre-cutover per the rollout sequence above) is a one-time
  non-event-sourced migration script — not a rebuild from the event log, which cannot produce
  COGS/discount facts events never recorded. Building a *general*, reusable backfill framework
  for future read models is out of scope; this is a one-off script for this one migration.

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
| Rebuild silently deletes backfilled historical rows it can't regenerate from events | `rebuild_profit_cache_scope` rejects any `from` date before the shop's coverage start date, verified by an explicit test |
| Local marker mechanism assumed to need a new queue table, diverging from WAFI-151's actual shape | Verified against migration `083` directly: `daily_event_counts` already carries `source_event_id` on the same row as the aggregate; `profit_cache` copies that exact column and mechanism |
