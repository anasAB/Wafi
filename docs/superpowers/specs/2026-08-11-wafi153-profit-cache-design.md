# WAFI-153 — Read Models/CQRS Optimization — Design Spec (v1: `profit_cache`)

**Status:** Draft for review
**Date:** 2026-08-11
**Ticket:** WAFI-153 (Macro-Phase 3, P1)
**Related:** WAFI-140/143/150 (event bus), WAFI-151 (Projection Rebuild & Event Recovery — in progress, this design adopts its contract), `docs/architecture/EVENT_SUBSCRIBERS.md`

## Scope

WAFI-153 lists five target read models: `dashboard_metrics`, `profit_cache`, `inventory_summary`,
`customer_summary`, `staff_summary`. This spec covers **one of them end-to-end** —
`profit_cache` — as the proof-of-pattern vertical slice. The other four are out of scope here
and become separate follow-on specs that reuse the framework this one establishes.

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
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, day)
);
```

`revenue_usd`/`cogs_usd`/etc. as `bigint` minor units, not `numeric`/`float` — matching WAFI-151's
explicit "integer minor units, never floating point" rule so Postgres/SQLite replay can't diverge
on rounding. **This is a change from today's schema**, where `sales.total_usd` etc. are stored as
real/float — `profit_cache` does not inherit that representation; it's a deliberate improvement
scoped to the new table, not a retrofit of existing sales tables (out of scope here).

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
| Expenses | `expense.recorded` | `amountUsd` (existing) | `+= amountUsd` |

**`costless_sale_count` — exact semantics, stated explicitly:** counts *sales* containing ≥1
line item with no/zero unit cost at completion time — **not** a count of costless line items.
This matches `useDashboardMetrics.ts`'s current `costlessSalesInPeriod` in name and per-sale
granularity, with one accepted, documented divergence: the existing live query additionally
*excludes* a sale from this count if it was later fully returned (it compares sold vs. returned
quantity at read time). `hasCostlessLine` is snapshotted once, at `sale.completed` time — it
cannot know about a return that hasn't happened yet, so a fully-returned costless sale still
counts toward `costless_sale_count` under this design, where today's live query would exclude
it. This is a deliberate, minor simplification (the metric is a profit-estimate *caveat flag*,
not a headline financial figure, and `profitIsEstimated = costless_sale_count > 0` degrades
gracefully to "slightly more conservative than before," never wrong in the dangerous direction
of under-flagging). If this divergence proves material in practice, the fix is a
`sale.returned`-side decrement when the return is a full return of an already-costless sale —
deferred rather than built speculatively here.

**`expense.recorded` semantics — reconciled against the actual event/table, not assumed:**
`ExpenseRecordedPayload` (`domainEvent.types.ts`) has exactly one currency field, `amountUsd`
— matching `useDashboardMetrics.ts`'s live query (`SUM(amount_usd) FROM expenses`) exactly, no
SYP component to reconcile. `ExpenseEventType` currently defines only `Recorded` — no
void/edit/reversal event type exists today, so expenses are effectively immutable from the
projection's point of view and a simple `+=` is correct parity. **If an expense edit/void event
is introduced later, `_apply_profit_cache` needs a new branch for it — this is called out here
so it isn't silently missed when that event type is added,** not a gap in this design for
today's event contract.

All numeric projection updates are additive and order-independent once each event's immutable
financial snapshot and `event_projection_day` are established — the same class of guarantee
`daily_event_counts` relies on, so WAFI-151's sequence/ordering machinery applies without new
handler-level reasoning about ordering. (Precision note: this describes the arithmetic, not the
event semantics — `sale.returned`'s restock-aware COGS-reversal computation and the
`costless_sale_count` caveat above are genuine business logic, not "just a sum.")

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
events are *not* already versioned with sufficient information). `_apply_profit_cache` treats
any event whose `payload_version` predates this rollout as **not eligible for this projection**
— skip (no-op, ledger-recorded as processed so it isn't retried forever), not a loud failure,
because "this event predates profit tracking" is an expected, permanent condition for every
historical event, not a transient error to surface to an operator. (This differs from WAFI-151's
loud-failure rule, which is for an *unrecognized future* version arriving unexpectedly — an old,
known-and-expected version is a different case and gets a different response.)

**Consequence: `profit_cache` has a coverage start date** — the day this payload_version ships
— and no row for a shop's history before it. This is a real, accepted limitation, not deferred
ambiguity:

- `useProfitCache()` returns zeros (not an error) for any date range entirely before a shop's
  coverage start date. Reports/dashboard views spanning that boundary show a real, if
  incomplete, number for the covered portion — this is the same "period contains uncovered
  history" caveat class as `profitIsEstimated`, and should surface similarly (implementation
  plan decides exact UI treatment; not blocking this design).
- `useDashboardMetrics.ts` is **not** deleted the instant `useProfitCache` ships — it stays
  available (or its query logic is preserved in a small legacy-range helper) for any report
  request whose range predates the shop's coverage start date, until/unless a one-time backfill
  (below) closes the gap. Full retirement of the old live-query path is therefore contingent on
  that backfill actually running, not automatic on cutover day.
- **One-time backfill (optional, not required for correctness):** a migration script may
  compute equivalent `profit_cache` rows for pre-coverage days by querying `sales`/
  `sale_line_items`/`returns`/`expenses` directly (the same tables/logic `useDashboardMetrics.ts`
  uses today) and inserting synthesized rows once, rather than via `_apply_profit_cache`/the
  event log. These synthesized rows are **not rebuildable** from events (there's nothing in the
  event log to rebuild them from) — they must be tagged (e.g. a `source = 'backfill'` column, or
  a documented day-range boundary) so a future scoped rebuild over that range doesn't silently
  wipe them expecting events to replace them. Whether to run this backfill is an implementation-
  time product decision (how much pre-coverage history actually needs profit reporting), not
  decided by this spec.

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

  BEGIN
    INSERT INTO public.projection_processed_events (projection_name, event_id)
    VALUES ('profit_cache', p_event_id);
  EXCEPTION WHEN unique_violation THEN
    RETURN; -- already applied
  END;

  IF v_event.type = 'sale.completed' THEN
    INSERT INTO public.profit_cache (shop_id, day, revenue_usd, revenue_syp, cogs_usd,
      discount_usd, invoice_count, costless_sale_count)
    VALUES (v_event.shop_id, v_event.event_projection_day,
      (v_event.payload->>'totalUsd')::bigint, (v_event.payload->>'totalSyp')::bigint,
      (v_event.payload->>'cogsUsd')::bigint, (v_event.payload->>'discountUsd')::bigint,
      1, CASE WHEN (v_event.payload->>'hasCostlessLine')::boolean THEN 1 ELSE 0 END)
    ON CONFLICT (shop_id, day) DO UPDATE SET
      revenue_usd = profit_cache.revenue_usd + EXCLUDED.revenue_usd,
      revenue_syp = profit_cache.revenue_syp + EXCLUDED.revenue_syp,
      cogs_usd = profit_cache.cogs_usd + EXCLUDED.cogs_usd,
      discount_usd = profit_cache.discount_usd + EXCLUDED.discount_usd,
      invoice_count = profit_cache.invoice_count + 1,
      costless_sale_count = profit_cache.costless_sale_count + EXCLUDED.costless_sale_count,
      updated_at = now();

  ELSIF v_event.type = 'sale.returned' THEN
    INSERT INTO public.profit_cache (shop_id, day, refunds_usd, cogs_reversal_usd, return_count)
    VALUES (v_event.shop_id, v_event.event_projection_day,
      (v_event.payload->>'refundAmountUsd')::bigint, (v_event.payload->>'cogsReversalUsd')::bigint, 1)
    ON CONFLICT (shop_id, day) DO UPDATE SET
      refunds_usd = profit_cache.refunds_usd + EXCLUDED.refunds_usd,
      cogs_reversal_usd = profit_cache.cogs_reversal_usd + EXCLUDED.cogs_reversal_usd,
      return_count = profit_cache.return_count + 1,
      updated_at = now();

  ELSIF v_event.type = 'expense.recorded' THEN
    INSERT INTO public.profit_cache (shop_id, day, expenses_usd)
    VALUES (v_event.shop_id, v_event.event_projection_day, (v_event.payload->>'amountUsd')::bigint)
    ON CONFLICT (shop_id, day) DO UPDATE SET
      expenses_usd = profit_cache.expenses_usd + EXCLUDED.expenses_usd,
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

## Client-side implementation

- **Sync:** `profit_cache` added to the PowerSync sync stream, shop-scoped (same pattern as
  every other table in the `shop_data` stream) — unlike `local_today_revenue_projection`, this
  table is not `localOnly`; every device for a shop must see the same numbers.
- **Local subscriber** (`src/services/events/profitCacheProjection.ts`, following the file-naming
  convention in `EVENT_SUBSCRIBERS.md` — named for what it does, not the ticket): subscribes to
  `sale.completed`, `sale.returned`, `expense.recorded` via `useEventSubscription` (lightweight
  category — losing a local marker write is recoverable via rebuild, matching the decision rule).
  On each event, writes a local marker row carrying `source_event_id` — **no local aggregation
  logic**, mirroring `dailyEventCountsProjection.ts` post-WAFI-151: the device does not compute
  or upload an absolute value, it only asserts "this event needs applying."
- **`src/data/powersync/ops.ts`**: new special case for `profit_cache`, identical shape to the
  existing `daily_event_counts` one — PUT/PATCH with a `source_event_id` calls
  `supabase.rpc('apply_profit_cache', { p_event_id })`; missing `source_event_id` is a no-op
  (pre-migration row).
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
   `useDashboardMetrics.ts` is deleted):** seed a fixture with a realistic mixed event set —
   at minimum two `sale.completed` (one with a costless line), one `sale.returned` (partial,
   restock-aware), one `expense.recorded` — and populate the *equivalent* underlying
   `sales`/`sale_line_items`/`returns`/`expenses` rows the old composable reads directly. Run
   both `useDashboardMetrics()`'s live query and `useProfitCache()` (fed by applying the same
   events through `_apply_profit_cache`) over the identical period, and assert every shared
   metric — revenue, refunds, COGS, COGS reversal, expenses, discounts, invoice/return counts,
   profit — matches exactly (accounting for the documented `costless_sale_count` divergence
   above, asserted as a known, intentional difference rather than ignored). This is what proves
   the migration doesn't silently change financial results, which is the entire premise of
   retiring the old composable.

## Out of scope

- `dashboard_metrics`, `inventory_summary`, `customer_summary`, `staff_summary` (separate specs)
- Retrofitting `sales`/`expenses`/etc. tables from float to integer minor units — only the new
  `profit_cache` table uses that representation
- `missingCostCount` migration to any projection (deliberately stays live — see Scope)
- Admin UI or customer-facing rebuild trigger (inherits WAFI-151's CLI-only trigger surface)
- Backfilling `profit_cache` for pre-coverage-start-date history is optional and, if done, is a
  one-time non-event-sourced migration script (see Payload changes section) — not a rebuild from
  the event log, which cannot produce COGS/discount facts events never recorded. Whether to run
  it is a product decision deferred to implementation time.

## Risks

| Risk | Mitigation |
|---|---|
| `sale.completed`/`sale.returned` payload changes ripple to every existing consumer of those events | `payload_version` bump; existing consumers (notifications, other projections) reviewed for whether they read the new fields (they don't need to) or need loud-failure handling for the new version |
| COGS-reversal restock logic re-derived incorrectly at write time vs. today's read-time query | Ported as a direct fixture-based test (existing SQL logic → equivalent write-time computation), not re-derived from memory |
| Three event types partially updating one row via separate `ON CONFLICT` branches race with each other for the same shop+day | Same `(shop_id, projection_name)` advisory lock as `daily_event_counts` serializes all writes to a scope, regardless of which event type triggered them |
| `profit_usd` stored as a column and drifting from its inputs | Not stored — always computed at read time by netting revenue/COGS first, then combining (worked-example test in this spec catches the gross-vs-net error class directly) |
| Six call sites migrated inconsistently, some left on old composable | Explicit call-site list in this spec; `useDashboardMetrics.ts` deletion is gated on both full call-site migration *and* a resolved backfill/coverage-start decision for pre-coverage history, not assumed automatic on cutover |
| Historical events lack the new payload fields, silently producing wrong or missing profit_cache rows for old periods | `_apply_profit_cache` explicitly no-ops (not loud-fails) on pre-rollout `payload_version`; `useProfitCache()` returns zero, not a guess, for pre-coverage ranges; optional one-time backfill script is separate from and never overwritten by event-log rebuild |
