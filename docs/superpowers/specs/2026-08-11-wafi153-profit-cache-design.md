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

`profit_usd` is **not stored** — it's `revenue_usd - cogs_usd + cogs_reversal_usd - expenses_usd`,
computed at read time (a cheap subtraction over already-summed day rows, not a database column
that could drift from its inputs).

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

All operations are commutative sums — same class as `daily_event_counts`, so WAFI-151's
sequence/ordering guarantees apply without new handler-level reasoning about ordering.

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

Existing consumers of the old (unversioned) payload shape must tolerate the new optional fields
being absent on already-synced historical events — handled by the same `payload_version`
loud-failure rule WAFI-151 establishes (an apply function encountering an older
`payload_version` it wasn't built for fails loudly rather than guessing).

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
```

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
  handful of already-small day rows in JS — no JOINs, no `sale_line_items` scan. Exposes the
  same reactive shape (`revenueUsd`, `cogsUsd`, `profitUsd`, `expensesUsd`, `refundsUsd`,
  `discountUsd`, `invoiceCount`, `returnCount`, `costlessSalesInPeriod`, `profitIsEstimated`) as
  today's `useDashboardMetrics()`, so call sites swap the import with no shape change.
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

## Out of scope

- `dashboard_metrics`, `inventory_summary`, `customer_summary`, `staff_summary` (separate specs)
- Retrofitting `sales`/`expenses`/etc. tables from float to integer minor units — only the new
  `profit_cache` table uses that representation
- `missingCostCount` migration to any projection (deliberately stays live — see Scope)
- Admin UI or customer-facing rebuild trigger (inherits WAFI-151's CLI-only trigger surface)
- Backfilling `profit_cache` for pre-existing historical events — first production use is a full
  rebuild from the event log for each shop (same "don't trust old data" stance WAFI-151 takes
  for `daily_event_counts`), sequenced as an explicit rollout step, not assumed automatic

## Risks

| Risk | Mitigation |
|---|---|
| `sale.completed`/`sale.returned` payload changes ripple to every existing consumer of those events | `payload_version` bump; existing consumers (notifications, other projections) reviewed for whether they read the new fields (they don't need to) or need loud-failure handling for the new version |
| COGS-reversal restock logic re-derived incorrectly at write time vs. today's read-time query | Ported as a direct fixture-based test (existing SQL logic → equivalent write-time computation), not re-derived from memory |
| Three event types partially updating one row via separate `ON CONFLICT` branches race with each other for the same shop+day | Same `(shop_id, projection_name)` advisory lock as `daily_event_counts` serializes all writes to a scope, regardless of which event type triggered them |
| `profit_usd` stored as a column and drifting from its inputs | Not stored — always computed at read time from the summed components |
| Six call sites migrated inconsistently, some left on old composable | Explicit call-site list in this spec; `useDashboardMetrics.ts` deletion is the acceptance gate, not a "nice to have" |
