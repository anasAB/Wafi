# WAFI-153 profit_cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `profit_cache` read model end-to-end per `docs/superpowers/specs/2026-08-11-wafi153-profit-cache-design.md` — server apply/rebuild functions, three event-payload version bumps, a client subscriber + composable, and migration of all 6 call sites off `useDashboardMetrics.ts`.

**Architecture:** Directly mirrors WAFI-151's `daily_event_counts` pattern (migrations 083/085): a Postgres `_apply_profit_cache`/`apply_profit_cache` pair keyed by `event_id`, a `(shop_id, day)` daily row per shop touched by three event types (`sale.completed`, `sale.returned`, `expense.recorded`), a `(shop_id, 'profit_cache')` advisory lock shared by incremental apply and rebuild, and a full-scope-only `rebuild_profit_cache_scope` that always regenerates a backfilled base then replays every event on top. Client side: a lightweight `useEventSubscription`-based marker writer (writes only `source_event_id`, never computes metrics locally), an `ops.ts` upload special-case routing to the `apply_profit_cache` RPC, and a new `useProfitCache()` composable that reads the synced table and derives `netRevenueUsd`/`netCogsUsd`/`profitUsd` at read time.

**Tech Stack:** Postgres/Supabase migrations (SQL, PL/pgSQL), pgTAP (`npx supabase test db`), Vue 3 Composition API, PowerSync (`src/data/powersync/schema.ts`, `ops.ts`), Vitest.

## Global Constraints

- Migration numbering: latest existing migration is `085_daily_event_counts_rebuild.sql`. This plan's migrations are `086_profit_cache_apply.sql` and `087_profit_cache_rebuild.sql`. If another migration claims either number first, renumber before applying.
- Every dollar value in every event payload (`totalUsd`, `cogsUsd`, `discountUsd`, `refundAmountUsd`, `cogsReversalUsd`, `amountUsd`, etc.) is fractional dollars (e.g. `19.99`), never pre-converted to cents — verified against `src/data/powersync/schema.ts` (`column.real`) and `sales.service.ts`. `_apply_profit_cache` converts with `ROUND(value::numeric * 100)::bigint` at the point of extraction; nothing else in the pipeline does its own independent rounding. `useProfitCache()` converts back (`cents / 100.0`) exactly once, at the end, per metric, after summing whole integer cents.
- `profit_cache` columns are `bigint` minor units (cents) server-side and `column.integer` client-side (SQLite has no fixed-point type) — never `numeric`/`real`/`float` for the new table, even though every *source* table (`sales`, `expenses`, etc.) still uses float.
- `source_event_id` is observability/provenance only — "which event most recently touched this row." It is never the idempotency mechanism (that's `projection_processed_events`'s `(projection_name, event_id)` primary key) and never the rebuild-scope decision (rebuild is always full-shop-scope, always deletes before regenerating). Do not add a `NOT NULL` constraint to it — `NULL` is the correct, permanent value for backfilled rows.
- `_apply_profit_cache` implements the three-way `payload_version` gate exactly as specified: `< 1` → `RAISE EXCEPTION` (`P0003`); `= 1` → known-historical, ledger-recorded permanent no-op; `= 2` → process normally; `> 2` → `RAISE EXCEPTION` (`P0004`, unrecognized future schema). Never collapse `= 1` and `> 2` into one "not current" bucket.
- `rebuild_profit_cache_scope(p_shop_id uuid)` takes no `from`/`to` arguments — full-shop-scope only, because the costless-count cross-day decrement can reach outside any requested sub-range. `_backfill_profit_cache_shop` is never called standalone; it is only ever invoked from inside `rebuild_profit_cache_scope`, immediately after that function deletes every row + ledger entry for the shop.
- Local subscriber writes (`src/services/events/profitCacheProjection.ts`) may mutate `source_event_id` only — never increment/decrement/derive any financial or count column locally, even incidentally via a read-then-carry-forward. All metric mutation happens exclusively in `apply_profit_cache` server-side.
- Never commit with `--no-verify` or skip hooks. Follow the exact style of migrations 083/085 and `dailyEventCountsProjection.ts`/`ops.ts`'s existing `daily_event_counts` special case.
- `useDashboardMetrics.ts` is not deleted by this plan — it is deleted only after the shadow-mode window (out of scope here, a rollout-operations step). This plan's last task migrates the 6 call sites to consume `useProfitCache()` for every metric it exposes today except `missingCostCount`, and adds a `useProfitCache`-based replacement — `useDashboardMetrics.ts` itself is left in place, but its dedicated tests are updated to reflect that call sites no longer import it (per-task detail below).

---

### Task 1: Migration 086 — `profit_cache` table + `_apply_profit_cache`/`apply_profit_cache`

**Files:**
- Create: `supabase/migrations/086_profit_cache_apply.sql`

**Interfaces:**
- Produces: table `public.profit_cache` (columns per spec: `id, shop_id, day, revenue_usd, revenue_syp, cogs_usd, cogs_reversal_usd, expenses_usd, refunds_usd, discount_usd, invoice_count, return_count, costless_sale_count, source_event_id, updated_at`, `UNIQUE(shop_id, day)`); functions `public._apply_profit_cache(p_event_id uuid) RETURNS void` (internal, EXECUTE revoked from PUBLIC) and `public.apply_profit_cache(p_event_id uuid) RETURNS void` (SECURITY DEFINER, granted to `anon, authenticated`).

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/086_profit_cache_apply.sql

-- WAFI-153. Directly mirrors WAFI-151's daily_event_counts pattern (083/085):
-- a Postgres apply function, keyed by event_id, deriving every dimension from
-- the authoritative events row, recording exactly-once application in the
-- existing projection_processed_events ledger (083), with source_event_id
-- carried on the SAME row as the aggregate (not a separate queue table) --
-- observability/provenance only, never the idempotency or rebuild-scope
-- mechanism (see design spec for the full rationale).

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
  source_event_id       uuid REFERENCES public.events(id),  -- NULL on backfilled rows, permanently
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, day)
);

CREATE OR REPLACE FUNCTION public._apply_profit_cache(p_event_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_event public.events;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event % not found in authoritative log', p_event_id USING ERRCODE = 'P0002';
  END IF;

  -- payload_version gate: three-way, not a binary current/skip check. 1 is the
  -- pre-COGS-fields shape that predates this ticket; 2 is the version this
  -- ticket introduces; anything else is invalid or unrecognized-future.
  IF v_event.payload_version IS NULL OR v_event.payload_version < 1 THEN
    RAISE EXCEPTION 'event % has invalid payload_version %', p_event_id, v_event.payload_version
      USING ERRCODE = 'P0003';
  ELSIF v_event.payload_version = 1 THEN
    -- Known historical shape: predates cogsUsd/discountUsd/etc. Not an error --
    -- this is the coverage-start-date boundary itself. Still ledger-recorded
    -- so it is never retried.
    INSERT INTO public.projection_processed_events (projection_name, event_id)
    VALUES ('profit_cache', p_event_id)
    ON CONFLICT DO NOTHING;
    RETURN;
  ELSIF v_event.payload_version > 2 THEN
    RAISE EXCEPTION 'event % has payload_version % newer than this function supports',
      p_event_id, v_event.payload_version USING ERRCODE = 'P0004';
  END IF;
  -- Only payload_version = 2 falls through past this point.

  -- Required-field validation: a version=2 event missing a required field
  -- (producer bug) must fail loudly, never silently become NULL -- a missing
  -- key on ->> returns NULL, NULL*100 is NULL, and
  -- profit_cache.cogs_usd + EXCLUDED.cogs_usd (NULL) would corrupt the ENTIRE
  -- existing row's cogs_usd to NULL on the next conflict-update.
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
      -- originalSaleProjectionDay comes straight from the payload -- no lookup,
      -- no ORDER-BY-less LIMIT 1, no dependency on the original event still
      -- being synced. UPSERT (not a bare UPDATE): if sale.completed hasn't
      -- been applied yet, profit_cache may have no row for this day -- a
      -- plain UPDATE would match zero rows and silently lose the decrement
      -- forever (the ledger already marks this return processed, never retried).
      -- source_event_id is deliberately NOT touched here -- this branch
      -- mutates a day that isn't "this event's own day."
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
  END IF; -- any other event type: no-op, not an error
END;
$$;

-- Postgres grants EXECUTE on every newly created function to PUBLIC by
-- default; explicitly revoke it (matches 083's pattern for _apply_daily_event_count).
REVOKE ALL ON FUNCTION public._apply_profit_cache(uuid) FROM public;

CREATE OR REPLACE FUNCTION public.apply_profit_cache(p_event_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_shop_id uuid;
BEGIN
  SELECT shop_id INTO v_shop_id FROM public.events WHERE id = p_event_id;
  IF v_shop_id IS NULL THEN
    RETURN; -- matches apply_daily_event_count: nothing to authorize against a nonexistent event
  END IF;
  IF v_shop_id IS DISTINCT FROM (SELECT public.auth_shop_id()) THEN
    RAISE EXCEPTION 'apply_profit_cache: caller is not authorized for this event''s shop' USING ERRCODE = 'P0001';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('profit_cache' || v_shop_id::text));
  PERFORM public._apply_profit_cache(p_event_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_profit_cache(uuid) TO anon, authenticated;

ALTER TABLE public.profit_cache ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.profit_cache FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.projection_processed_events FROM anon, authenticated;

CREATE POLICY profit_cache_select_own_shop ON public.profit_cache
  FOR SELECT USING (shop_id = public.auth_shop_id());
GRANT SELECT ON TABLE public.profit_cache TO anon, authenticated, service_role;
```

- [ ] **Step 2: Apply the migration to the local/dev Supabase instance**

Run: `npx supabase db reset` (or `npx supabase migration up` if the dev DB should keep existing data)
Expected: migration `086_profit_cache_apply.sql` applies with no errors; `profit_cache` table exists (`\d public.profit_cache` in `psql` shows the 15 columns above).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/086_profit_cache_apply.sql
git commit -m "feat(WAFI-153): add profit_cache table and apply_profit_cache RPC"
```

---

### Task 2: Migration 087 — backfill generator + `rebuild_profit_cache_scope`

**Files:**
- Create: `supabase/migrations/087_profit_cache_rebuild.sql`

**Interfaces:**
- Consumes: `public.profit_cache` (Task 1), `public._apply_profit_cache` (Task 1), `public.projection_processed_events` (migration 083).
- Produces: `public._backfill_profit_cache_shop(p_shop_id uuid) RETURNS void` (internal, called only from `rebuild_profit_cache_scope`), `public.rebuild_profit_cache_scope(p_shop_id uuid) RETURNS void` (SECURITY DEFINER, granted to `service_role` only — CLI/operator-only, mirroring 085's `rebuild_daily_event_counts_scope` grant).

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/087_profit_cache_rebuild.sql

-- WAFI-153. profit_cache's rebuild contract is full-shop-scope only (no
-- from/to), and is a full rematerialization (regenerate backfill, then
-- replay events) -- NOT "delete event-derived rows, replay, leave backfilled
-- rows alone." The costless-count decrement can mutate a DIFFERENT day's row
-- than its triggering event's own day, so a partial-range rebuild or a
-- "leave backfilled rows alone" rebuild can both corrupt state outside their
-- intended scope. See design spec's Rebuild section for the full argument.

-- Backfill-eligible sales/returns/expenses: a fact is eligible iff no
-- version-2-or-higher event for it has already been applied. This makes the
-- generator self-healing on every re-run and immune to device-upgrade-lag
-- date-cutoff gaps and mixed-version-day double-counting -- see design spec.
-- Never called standalone: it has no merge-safety story against a
-- possibly-nonempty scope, and none is needed, because rebuild_profit_cache_scope
-- always deletes the entire scope immediately before calling this.
CREATE OR REPLACE FUNCTION public._backfill_profit_cache_shop(p_shop_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_sale record;
  v_return record;
  v_expense record;
BEGIN
  -- Sales: revenue/cogs/discount/invoice_count/costless_sale_count, keyed by
  -- created_at's UTC date (backfilled rows have no shop-timezone-precise
  -- event_projection_day to reuse -- this is the same best-available-data
  -- limitation Plan 2 accepted for events.event_projection_day backfill).
  FOR v_sale IN
    SELECT s.id, s.shop_id, (s.created_at AT TIME ZONE 'UTC')::date AS day,
      s.total_usd, s.total_syp,
      COALESCE((SELECT SUM(sli.quantity * COALESCE(sli.unit_cost_usd, 0))
                FROM public.sale_line_items sli WHERE sli.sale_id = s.id), 0) AS cogs_usd,
      COALESCE(s.sale_discount_amount_usd, 0)
        + COALESCE((SELECT SUM(COALESCE(sli.discount_amount_usd, 0))
                    FROM public.sale_line_items sli WHERE sli.sale_id = s.id), 0) AS discount_usd,
      EXISTS (SELECT 1 FROM public.sale_line_items sli
              WHERE sli.sale_id = s.id AND (sli.unit_cost_usd IS NULL OR sli.unit_cost_usd = 0)) AS has_costless_line
    FROM public.sales s
    WHERE s.shop_id = p_shop_id
      AND NOT EXISTS (
        SELECT 1 FROM public.events e
        WHERE e.type = 'sale.completed' AND e.payload->>'saleId' = s.id::text
          AND e.payload_version >= 2
      )
  LOOP
    INSERT INTO public.profit_cache (shop_id, day, revenue_usd, revenue_syp, cogs_usd,
      discount_usd, invoice_count, costless_sale_count, source_event_id)
    VALUES (v_sale.shop_id, v_sale.day,
      ROUND(v_sale.total_usd::numeric * 100)::bigint,
      ROUND(v_sale.total_syp::numeric * 100)::bigint,
      ROUND(v_sale.cogs_usd::numeric * 100)::bigint,
      ROUND(v_sale.discount_usd::numeric * 100)::bigint,
      1, CASE WHEN v_sale.has_costless_line THEN 1 ELSE 0 END, NULL)
    ON CONFLICT (shop_id, day) DO UPDATE SET
      revenue_usd = profit_cache.revenue_usd + EXCLUDED.revenue_usd,
      revenue_syp = profit_cache.revenue_syp + EXCLUDED.revenue_syp,
      cogs_usd = profit_cache.cogs_usd + EXCLUDED.cogs_usd,
      discount_usd = profit_cache.discount_usd + EXCLUDED.discount_usd,
      invoice_count = profit_cache.invoice_count + 1,
      costless_sale_count = profit_cache.costless_sale_count + EXCLUDED.costless_sale_count,
      updated_at = now();
  END LOOP;

  -- Returns: refunds/cogs_reversal/return_count on the return's own day, plus
  -- the cross-day costless decrement on the ORIGINAL SALE's day -- same rule
  -- _apply_profit_cache uses, ported here for backfill-only facts.
  FOR v_return IN
    SELECT r.id, r.shop_id, (r.created_at AT TIME ZONE 'UTC')::date AS day,
      r.refund_amount_usd,
      COALESCE((SELECT SUM(rli.qty_returned * COALESCE(c.unit_cost_usd, 0))
                FROM public.return_line_items rli
                LEFT JOIN (
                  SELECT sale_id, product_id, AVG(unit_cost_usd) AS unit_cost_usd
                  FROM public.sale_line_items GROUP BY sale_id, product_id
                ) c ON c.sale_id = r.original_sale_id AND c.product_id = rli.product_id
                WHERE rli.return_id = r.id AND rli.restock = 1), 0) AS cogs_reversal_usd,
      (SELECT COUNT(*) = 0 FROM public.sale_line_items sli
       WHERE sli.sale_id = r.original_sale_id
         AND sli.quantity > COALESCE((SELECT SUM(rli2.qty_returned) FROM public.return_line_items rli2
                                       JOIN public.returns r2 ON r2.id = rli2.return_id
                                       WHERE r2.original_sale_id = r.original_sale_id
                                         AND rli2.product_id = sli.product_id), 0)
      ) AS is_full_return,
      EXISTS (SELECT 1 FROM public.sale_line_items sli
              WHERE sli.sale_id = r.original_sale_id AND (sli.unit_cost_usd IS NULL OR sli.unit_cost_usd = 0)) AS sale_was_costless,
      (SELECT (s.created_at AT TIME ZONE 'UTC')::date FROM public.sales s WHERE s.id = r.original_sale_id) AS original_sale_day
    FROM public.returns r
    WHERE r.shop_id = p_shop_id
      AND NOT EXISTS (
        SELECT 1 FROM public.events e
        WHERE e.type = 'sale.returned' AND e.payload->>'returnId' = r.id::text
          AND e.payload_version >= 2
      )
  LOOP
    INSERT INTO public.profit_cache (shop_id, day, refunds_usd, cogs_reversal_usd, return_count, source_event_id)
    VALUES (v_return.shop_id, v_return.day,
      ROUND(v_return.refund_amount_usd::numeric * 100)::bigint,
      ROUND(v_return.cogs_reversal_usd::numeric * 100)::bigint, 1, NULL)
    ON CONFLICT (shop_id, day) DO UPDATE SET
      refunds_usd = profit_cache.refunds_usd + EXCLUDED.refunds_usd,
      cogs_reversal_usd = profit_cache.cogs_reversal_usd + EXCLUDED.cogs_reversal_usd,
      return_count = profit_cache.return_count + 1,
      updated_at = now();

    IF v_return.is_full_return AND v_return.sale_was_costless AND v_return.original_sale_day IS NOT NULL THEN
      INSERT INTO public.profit_cache (shop_id, day, costless_sale_count, source_event_id)
      VALUES (v_return.shop_id, v_return.original_sale_day, -1, NULL)
      ON CONFLICT (shop_id, day) DO UPDATE SET
        costless_sale_count = profit_cache.costless_sale_count - 1,
        updated_at = now();
    END IF;
  END LOOP;

  -- Expenses: single amount, no cross-day concern.
  FOR v_expense IN
    SELECT e.id, e.shop_id, e.expense_date AS day, e.amount_usd
    FROM public.expenses e
    WHERE e.shop_id = p_shop_id
      AND NOT EXISTS (
        SELECT 1 FROM public.events ev
        WHERE ev.type = 'expense.recorded' AND ev.payload->>'expenseId' = e.id::text
          AND ev.payload_version >= 2
      )
  LOOP
    INSERT INTO public.profit_cache (shop_id, day, expenses_usd, source_event_id)
    VALUES (v_expense.shop_id, v_expense.day, ROUND(v_expense.amount_usd::numeric * 100)::bigint, NULL)
    ON CONFLICT (shop_id, day) DO UPDATE SET
      expenses_usd = profit_cache.expenses_usd + EXCLUDED.expenses_usd,
      updated_at = now();
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public._backfill_profit_cache_shop(uuid) FROM public;

CREATE OR REPLACE FUNCTION public.rebuild_profit_cache_scope(p_shop_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_event_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('profit_cache' || p_shop_id::text));

  DELETE FROM public.profit_cache WHERE shop_id = p_shop_id;
  DELETE FROM public.projection_processed_events
    WHERE projection_name = 'profit_cache'
      AND event_id IN (SELECT id FROM public.events WHERE shop_id = p_shop_id);

  -- Phase 1: regenerate the backfilled base against a now-provably-empty scope.
  PERFORM public._backfill_profit_cache_shop(p_shop_id);

  -- Phase 2: replay every event for this shop, in sequence order, on top of
  -- that clean base. Version-1 events no-op; version-2 events apply fully.
  FOR v_event_id IN
    SELECT id FROM public.events WHERE shop_id = p_shop_id ORDER BY sequence ASC
  LOOP
    PERFORM public._apply_profit_cache(v_event_id);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rebuild_profit_cache_scope(uuid) TO service_role;
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db reset`
Expected: migration `087_profit_cache_rebuild.sql` applies with no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/087_profit_cache_rebuild.sql
git commit -m "feat(WAFI-153): add profit_cache backfill generator and full-scope rebuild"
```

---

### Task 3: `sale.completed` payload — add `cogsUsd`, `discountUsd`, `hasCostlessLine`; bump to version 2

**Files:**
- Modify: `src/services/events/domainEvent.types.ts` (`SaleCompletedPayload`, lines 122-137)
- Modify: `src/services/sales.service.ts` (`toEvent`, lines 359-380)
- Test: `src/services/sales.service.test.ts` (existing test file — add assertions for the new fields; if this file doesn't exist, check `src/services/__tests__/sales.service.test.ts` first)

**Interfaces:**
- Produces: `SaleCompletedPayload` gains `cogsUsd: number`, `discountUsd: number`, `hasCostlessLine: boolean` (all fractional-dollar/boolean, matching every other field's unit). `toEvent`'s `payloadVersion` becomes `2`.

- [ ] **Step 1: Write the failing test**

Add to the sales service test file (find the existing `describe('completeSale')`-style block and add):

```ts
it('includes cogsUsd, discountUsd, hasCostlessLine on the sale.completed payload, at payload_version 2', async () => {
  // Arrange a sale with two lines: one costed ($5 cost, $10 price, $1 line discount),
  // one costless (no unit_cost_usd) — exercises hasCostlessLine=true and a non-zero cogsUsd/discountUsd.
  const publishSpy = vi.fn()
  vi.mocked(publishEvent).mockImplementation(publishSpy) // adjust to however this test file mocks publishEvent today

  await completeSale({
    shopId: 'shop-1',
    deviceId: 'device-1',
    staffId: 'staff-1',
    lines: [
      { productId: 'p1', quantity: 1, unitPriceUsd: 10, unitCostUsd: 5, lineTotalUsd: 9, discountType: 'flat', discountValue: 1, discountAmountUsd: 1 },
      { productId: 'p2', quantity: 1, unitPriceUsd: 8, unitCostUsd: 0, lineTotalUsd: 8 },
    ],
    // ...other required completeSale input fields per this file's existing fixtures
  } as any)

  const completedCall = publishSpy.mock.calls.find(([e]) => e.type === 'sale.completed')
  expect(completedCall[0].payloadVersion).toBe(2)
  expect(completedCall[0].payload.cogsUsd).toBe(5)       // 1 * 5 + 1 * 0
  expect(completedCall[0].payload.discountUsd).toBe(1)   // line discount only, no sale-level discount in this fixture
  expect(completedCall[0].payload.hasCostlessLine).toBe(true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/sales.service.test.ts -t "cogsUsd, discountUsd, hasCostlessLine"`
Expected: FAIL — `cogsUsd`/`discountUsd`/`hasCostlessLine` are `undefined` on the payload, `payloadVersion` is `1`.

- [ ] **Step 3: Update `SaleCompletedPayload`**

In `src/services/events/domainEvent.types.ts`, in the `SaleCompletedPayload` interface (currently lines 122-137), add three fields after `discountApplied`:

```ts
export interface SaleCompletedPayload {
  saleId: string
  shopId: string
  staffId: string
  totalUsd: number
  totalSyp: number
  paymentSummary: {
    cashUsd: number
    cashSyp: number
    cardTotal: number
    creditTotal: number
    methodCount: number
  }
  itemCount: number
  discountApplied: boolean
  /** WAFI-153: sum of quantity * unitCostUsd across every line, fractional dollars. */
  cogsUsd: number
  /** WAFI-153: sum of every line-level discount_amount_usd plus any sale-level discount, fractional dollars. */
  discountUsd: number
  /** WAFI-153: true iff at least one line had no/zero unit cost at completion time. */
  hasCostlessLine: boolean
}
```

- [ ] **Step 4: Compute the new fields in `toEvent` and bump `payloadVersion`**

In `src/services/sales.service.ts`, replace the `toEvent` block (lines 359-380):

```ts
    toEvent: (completed) => ({
      type: SalesEventType.Completed,
      entityId: completed.saleId,
      payload: {
        saleId: completed.saleId, shopId: input.shopId, staffId: input.staffId ?? '',
        totalUsd: completed.totalUsd, totalSyp: completed.totalSyp,
        paymentSummary: {
          cashUsd: entries.filter(e => e.method === 'cash_usd').reduce((s, e) => s + e.amountUsd, 0),
          cashSyp: entries.filter(e => e.method === 'cash_syp').reduce((s, e) => s + e.amountUsd, 0),
          cardTotal: entries.filter(e => e.method === 'card').reduce((s, e) => s + e.amountUsd, 0),
          creditTotal: isCredit ? completed.totalUsd : 0,
          methodCount: entries.length || 1,
        },
        itemCount: completed.lines.length,
        discountApplied: completed.lines.some(l => l.discountType) || !!completed.saleDiscount,
        // WAFI-153: computed once at write time, replacing useDashboardMetrics.ts's
        // per-load JOIN against sale_line_items.unit_cost_usd.
        cogsUsd: completed.lines.reduce((sum, l) => sum + l.quantity * (l.unitCostUsd ?? 0), 0),
        discountUsd: completed.lines.reduce((sum, l) => sum + (l.discountAmountUsd ?? 0), 0)
          + (completed.saleDiscount?.amountUsd ?? 0),
        hasCostlessLine: completed.lines.some(l => !l.unitCostUsd),
      } satisfies SaleCompletedPayload,
      payloadVersion: 2,
      staffId: input.staffId ?? '',
      shopId: input.shopId,
      occurredAt: now,
    }),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/services/sales.service.test.ts -t "cogsUsd, discountUsd, hasCostlessLine"`
Expected: PASS

- [ ] **Step 6: Run the full sales service test file to check for regressions**

Run: `npx vitest run src/services/sales.service.test.ts`
Expected: all PASS (any test asserting `payloadVersion: 1` on `sale.completed` needs updating to `2`)

- [ ] **Step 7: Commit**

```bash
git add src/services/events/domainEvent.types.ts src/services/sales.service.ts src/services/sales.service.test.ts
git commit -m "feat(WAFI-153): add cogsUsd/discountUsd/hasCostlessLine to sale.completed, bump to payload_version 2"
```

---

### Task 4: `sale.returned` payload — add `cogsReversalUsd`, `isFullReturn`, `saleWasCostless`, `originalSaleProjectionDay`; bump to version 2

**Files:**
- Modify: `src/services/events/domainEvent.types.ts` (`ReturnedPayload`, lines 180-185)
- Modify: `src/features/returns/composables/useReturnSheet.ts`
- Test: `src/features/returns/composables/useReturnSheet.test.ts` (existing test file — check `src/features/returns/composables/__tests__/` if not found at this path)

**Interfaces:**
- Consumes: `local sale_line_items` table (already queried in `useReturnSheet.ts`'s `load()`), local `events` table (new lookup, described below).
- Produces: `ReturnedPayload` gains `cogsReversalUsd: number`, `isFullReturn: boolean`, `saleWasCostless: boolean`, `originalSaleProjectionDay: string` (ISO date `YYYY-MM-DD`). `toEvent`'s `payloadVersion` becomes `2`.

- [ ] **Step 1: Write the failing test**

Add to the returns composable test file:

```ts
it('includes cogsReversalUsd, isFullReturn, saleWasCostless, originalSaleProjectionDay on sale.returned, at payload_version 2', async () => {
  // Fixture: a costless sale (unit_cost_usd = 0) fully returned with restock=true.
  // Seed local db: sales row (created_at known day), sale_line_items (qty 2, unit_cost_usd 0),
  // events row for the original sale.completed with event_projection_day = '2026-08-10'.
  await seedSaleAndLineItems(db, { saleId: 'sale-1', qty: 2, unitCostUsd: 0, createdAt: '2026-08-10T10:00:00Z' })
  await seedEvent(db, { type: 'sale.completed', payload: { saleId: 'sale-1' }, event_projection_day: '2026-08-10' })

  const publishSpy = vi.fn()
  vi.mocked(publishEvent).mockImplementation(publishSpy)

  const sheet = useReturnSheet('sale-1')
  await sheet.load()
  sheet.lines.value.forEach(l => { l.selected = true; l.qtyToReturn = l.originalQty })
  sheet.refundMethod.value = 'cash_usd'
  await sheet.confirm()

  const returnedCall = publishSpy.mock.calls.find(([e]) => e.type === 'sale.returned')
  expect(returnedCall[0].payloadVersion).toBe(2)
  expect(returnedCall[0].payload.cogsReversalUsd).toBe(0)          // costless sale, restocked
  expect(returnedCall[0].payload.isFullReturn).toBe(true)
  expect(returnedCall[0].payload.saleWasCostless).toBe(true)
  expect(returnedCall[0].payload.originalSaleProjectionDay).toBe('2026-08-10')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/returns/composables/useReturnSheet.test.ts -t "cogsReversalUsd, isFullReturn"`
Expected: FAIL — new fields undefined, `payloadVersion` is `1`.

- [ ] **Step 3: Update `ReturnedPayload`**

In `src/services/events/domainEvent.types.ts`, replace the `ReturnedPayload` interface (lines 180-185):

```ts
export interface ReturnedPayload {
  returnId: string
  saleId: string
  refundAmountUsd: number
  restockedItemCount: number
  /** WAFI-153: restock-aware, per-(sale,product)-averaged COGS reversal, fractional dollars. */
  cogsReversalUsd: number
  /** WAFI-153: true iff this return's cumulative returned qty reaches the sale's total sold qty. */
  isFullReturn: boolean
  /** WAFI-153: copy of the original sale's hasCostlessLine flag. */
  saleWasCostless: boolean
  /** WAFI-153: the original sale's event_projection_day (YYYY-MM-DD), for the cross-day costless decrement. */
  originalSaleProjectionDay: string
}
```

- [ ] **Step 4: Compute the new fields in `useReturnSheet.ts`**

In `src/features/returns/composables/useReturnSheet.ts`:

4a. Inside the `db.writeTransaction` callback in `confirm()` (after the `isFullSaleReturn` computation at line 271-273), lift `isFullSaleReturn` out to the outer `confirm()` scope so `toEvent` can read it — change the write function's return value:

```ts
          // (unchanged block above, still inside db.writeTransaction)
```

Replace the `return { cancelledPlanId, warning }` at line 317 with:

```ts
        return { cancelledPlanId, warning, isFullSaleReturn }
```

And change the destructuring of `executeBusinessOperation`'s result (currently `const { warning } = await executeBusinessOperation(`) to:

```ts
    const { warning, isFullSaleReturn } = await executeBusinessOperation(
```

4b. Before the `db.writeTransaction` call (so it's available to both the transaction and `toEvent`, and doesn't require a second DB round-trip inside the transaction), compute `cogsReversalUsd` and `saleWasCostless` from a per-(sale,product)-averaged cost lookup — add right after `const selectedLines = lines.value.filter(l => l.selected)` (line 158):

```ts
    // WAFI-153: restock-aware, per-(sale,product)-averaged COGS reversal --
    // ports useDashboardMetrics.ts's existing read-time subquery (WAFI-005
    // dedup: a product on two lines of the same sale is averaged once, not
    // double-counted) to write time.
    const costRows = await db.getAll<{ product_id: string; unit_cost_usd: number }>(
      `SELECT product_id, AVG(unit_cost_usd) AS unit_cost_usd FROM sale_line_items WHERE sale_id = ? GROUP BY product_id`,
      [saleId],
    )
    const costMap = new Map(costRows.map(r => [r.product_id, r.unit_cost_usd ?? 0]))
    const cogsReversalUsd = selectedLines
      .filter(l => l.restock && !l.isOpenItem)
      .reduce((sum, l) => sum + l.qtyToReturn * (costMap.get(l.productId) ?? 0), 0)

    const costlessRow = await db.getOptional<{ c: number }>(
      `SELECT COUNT(*) AS c FROM sale_line_items WHERE sale_id = ? AND (unit_cost_usd IS NULL OR unit_cost_usd = 0)`,
      [saleId],
    )
    const saleWasCostless = (costlessRow?.c ?? 0) > 0

    // WAFI-153: the original sale.completed event's event_projection_day,
    // read once here (write time), never re-derived at apply time -- avoids
    // a nondeterministic LIMIT-1-no-ORDER-BY lookup inside the apply function.
    const originalSaleEventRow = await db.getOptional<{ event_projection_day: string }>(
      `SELECT event_projection_day FROM events WHERE type = 'sale.completed' AND payload->>'saleId' = ? ORDER BY sequence ASC LIMIT 1`,
      [saleId],
    )
    const originalSaleProjectionDay = originalSaleEventRow?.event_projection_day
```

4c. Replace the `toEvent` block (lines 328-339):

```ts
        toEvent: () => ({
          type: ReturnsEventType.Returned,
          entityId: returnId,
          payload: {
            returnId, saleId, refundAmountUsd,
            restockedItemCount: selectedLines.filter(l => l.restock && !l.isOpenItem).length,
            cogsReversalUsd,
            isFullReturn: isFullSaleReturn,
            saleWasCostless,
            originalSaleProjectionDay: originalSaleProjectionDay ?? now.slice(0, 10),
          } satisfies ReturnedPayload,
          payloadVersion: 2,
          staffId: useSessionStore().activeStaff?.id ?? '',
          shopId,
          occurredAt: now,
        }),
```

Note: the `originalSaleProjectionDay ?? now.slice(0, 10)` fallback only matters if the original `sale.completed` event was never synced/created locally (e.g. a pre-event-bus legacy sale) — falling back to the return's own day in that edge case is an accepted approximation, since `profit_cache`'s required-field validation (Task 1) rejects `NULL` outright and the alternative is a hard failure on every return of pre-event-bus sales.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/features/returns/composables/useReturnSheet.test.ts -t "cogsReversalUsd, isFullReturn"`
Expected: PASS

- [ ] **Step 6: Run the full returns composable test file to check for regressions**

Run: `npx vitest run src/features/returns/composables/useReturnSheet.test.ts`
Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add src/services/events/domainEvent.types.ts src/features/returns/composables/useReturnSheet.ts src/features/returns/composables/useReturnSheet.test.ts
git commit -m "feat(WAFI-153): add cogsReversalUsd/isFullReturn/saleWasCostless/originalSaleProjectionDay to sale.returned, bump to payload_version 2"
```

---

### Task 5: `expense.recorded` — bump to `payload_version` 2 (no field change)

**Files:**
- Modify: `src/services/expense.service.ts` (lines 105-115)
- Test: `src/services/expense.service.test.ts` (existing test file)

**Interfaces:**
- Produces: `expense.recorded`'s `payloadVersion` becomes `2`. `ExpenseRecordedPayload`'s shape is unchanged.

- [ ] **Step 1: Write the failing test**

```ts
it('publishes expense.recorded at payload_version 2', async () => {
  const publishSpy = vi.fn()
  vi.mocked(publishEvent).mockImplementation(publishSpy) // adjust to this file's existing mock style

  await recordExpense({ shopId: 'shop-1', category: 'rent', amountUsd: 100, staffId: 'staff-1', photoUrl: undefined } as any)

  const recordedCall = publishSpy.mock.calls.find(([e]) => e.type === 'expense.recorded')
  expect(recordedCall[0].payloadVersion).toBe(2)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/expense.service.test.ts -t "payload_version 2"`
Expected: FAIL — `payloadVersion` is `1`.

- [ ] **Step 3: Bump the version**

In `src/services/expense.service.ts`, in the `toEvent` block (lines 105-115), change `payloadVersion: 1` to `payloadVersion: 2`. No other change — `ExpenseRecordedPayload`'s shape is unchanged; only the version stamp moves, for version-gate uniformity with `sale.completed`/`sale.returned` (see design spec's rationale: leaving this at version 1 would make the version gate permanently no-op every expense event, historical and current, forever).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/expense.service.test.ts -t "payload_version 2"`
Expected: PASS

- [ ] **Step 5: Run the full expense service test file to check for regressions**

Run: `npx vitest run src/services/expense.service.test.ts`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/expense.service.ts src/services/expense.service.test.ts
git commit -m "feat(WAFI-153): bump expense.recorded to payload_version 2 for version-gate uniformity"
```

---

### Task 6: Client schema, local subscriber, `ops.ts` special case, `App.vue` wiring

**Files:**
- Modify: `src/data/powersync/schema.ts` (add `profit_cache` table + register in schema export)
- Modify: `src/data/powersync/ops.ts` (add `profit_cache` special case)
- Create: `src/services/events/profitCacheProjection.ts`
- Modify: `src/App.vue` (wire `startProfitCacheProjection`)
- Test: `src/services/events/__tests__/profitCacheProjection.test.ts` (new, mirroring the existing `dailyEventCountsProjection` test in the same `__tests__` directory)

**Interfaces:**
- Produces: `startProfitCacheProjection(shopId: string): { stop: () => void }`.

- [ ] **Step 1: Add the `profit_cache` table to the PowerSync schema**

In `src/data/powersync/schema.ts`, add (near the `daily_event_counts` table definition, around line 394-400):

```ts
const profit_cache = new Table({
  shop_id:              column.text,
  day:                  column.text,
  revenue_usd:          column.integer,
  revenue_syp:          column.integer,
  cogs_usd:             column.integer,
  cogs_reversal_usd:    column.integer,
  expenses_usd:         column.integer,
  refunds_usd:          column.integer,
  discount_usd:         column.integer,
  invoice_count:        column.integer,
  return_count:         column.integer,
  costless_sale_count:  column.integer,
  source_event_id:      column.text,
})
```

Add `profit_cache,` to the schema export object (near line 567, alongside `daily_event_counts,`). All amount columns are `column.integer` (whole cents, matching the server's `bigint` — SQLite has no fixed-point type, so integer cents is exact) — **not** `column.real`, unlike `local_today_revenue_projection`.

- [ ] **Step 2: Write the failing test for the local subscriber**

Create `src/services/events/__tests__/profitCacheProjection.test.ts`, modeled on the existing `dailyEventCountsProjection` test in the same directory (read it first to match its mocking style for `db`/`useEventSubscription`):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { startProfitCacheProjection } from '../profitCacheProjection'
import { db } from '@/data/powersync/db'
import { SalesEventType, ReturnsEventType, ExpenseEventType } from '../domainEvent.types'

vi.mock('@/data/powersync/db')

describe('startProfitCacheProjection', () => {
  beforeEach(() => vi.resetAllMocks())

  it('writes only source_event_id on a new local row for a sale.completed event, never a metric column', async () => {
    vi.mocked(db.getOptional).mockResolvedValue(undefined)
    const executeSpy = vi.mocked(db.execute).mockResolvedValue({} as any)

    startProfitCacheProjection('shop-1')
    // Invoke the registered handler directly via the mocked useEventSubscription call args,
    // matching how dailyEventCountsProjection.test.ts already drives its handler.
    const handler = getRegisteredHandler(SalesEventType.Completed) // helper already exists in this test dir's shared setup, or inline the useEventSubscription mock here
    await handler({ id: 'evt-1', occurred_at: '2026-08-10T10:00:00Z', payload: {} } as any)

    const insertCall = executeSpy.mock.calls.find(([sql]) => sql.includes('INSERT INTO profit_cache'))
    expect(insertCall).toBeTruthy()
    expect(insertCall![0]).not.toMatch(/revenue_usd|cogs_usd|expenses_usd/i)
    expect(insertCall![1]).toContain('evt-1') // source_event_id present
  })
})
```

(If this repo's `useEventSubscription` mocking convention differs from the sketch above, match `src/services/events/__tests__/dailyEventCountsProjection.test.ts`'s actual pattern exactly rather than the sketch — that file is the authoritative example in this codebase.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/services/events/__tests__/profitCacheProjection.test.ts`
Expected: FAIL — `profitCacheProjection.ts` doesn't exist yet (module not found).

- [ ] **Step 4: Write `profitCacheProjection.ts`**

```ts
// src/services/events/profitCacheProjection.ts
import { db } from '@/data/powersync/db'
import { useEventSubscription, type EventRow } from '@/services/events/useEventSubscription'
import {
  SalesEventType, ReturnsEventType, ExpenseEventType,
  type SaleCompletedPayload, type ReturnedPayload, type ExpenseRecordedPayload,
} from '@/services/events/domainEvent.types'
import { processProjectionAtMostOnce, SubscriberId } from '@/services/events/processProjectionAtMostOnce'

/**
 * WAFI-153. Lightweight local marker writer for profit_cache, following
 * dailyEventCountsProjection.ts's exact shape: subscribes to the three
 * source events, and on each one does a read-then-insert-or-update against
 * the local (shop_id, day) row -- but writes ONLY source_event_id, never a
 * metric column. All financial/count mutation happens exclusively in
 * apply_profit_cache() server-side (see ops.ts's special case for how the
 * upload of this write is routed there). This is deliberate, not an
 * oversight: writing a local metric value here would reintroduce the
 * local-optimistic-state-diverging-from-server-state bug WAFI-151 fixed for
 * daily_event_counts, by a different route.
 */
export function startProfitCacheProjection(shopId: string): { stop: () => void } {
  const stops: Array<() => void> = []

  async function writeMarker(day: string, eventId: string): Promise<void> {
    const existing = await db.getOptional<{ id: string }>(
      `SELECT id FROM profit_cache WHERE shop_id = ? AND day = ?`,
      [shopId, day],
    )
    if (existing) {
      await db.execute(`UPDATE profit_cache SET source_event_id = ? WHERE id = ?`, [eventId, existing.id])
    } else {
      await db.execute(
        `INSERT INTO profit_cache (id, shop_id, day, source_event_id) VALUES (?, ?, ?, ?)`,
        [crypto.randomUUID(), shopId, day, eventId],
      )
    }
  }

  stops.push(useEventSubscription<SaleCompletedPayload>(
    SalesEventType.Completed,
    async (row: EventRow<SaleCompletedPayload>) => {
      await processProjectionAtMostOnce(SubscriberId.ProfitCache, row.id, async () => {
        await writeMarker(row.occurred_at.slice(0, 10), row.id)
      })
    },
    { shopId },
  ).stop)

  stops.push(useEventSubscription<ReturnedPayload>(
    ReturnsEventType.Returned,
    async (row: EventRow<ReturnedPayload>) => {
      await processProjectionAtMostOnce(SubscriberId.ProfitCache, row.id, async () => {
        // Marks the return's OWN day only -- the cross-day costless decrement
        // is a server-side-only concern (apply_profit_cache reads
        // originalSaleProjectionDay from the payload); the local marker never
        // needs to know about it, since it carries no metric value.
        await writeMarker(row.occurred_at.slice(0, 10), row.id)
      })
    },
    { shopId },
  ).stop)

  stops.push(useEventSubscription<ExpenseRecordedPayload>(
    ExpenseEventType.Recorded,
    async (row: EventRow<ExpenseRecordedPayload>) => {
      await processProjectionAtMostOnce(SubscriberId.ProfitCache, row.id, async () => {
        await writeMarker(row.occurred_at.slice(0, 10), row.id)
      })
    },
    { shopId },
  ).stop)

  return { stop: () => stops.forEach(s => s()) }
}
```

- [ ] **Step 5: Add `ProfitCache` to `SubscriberId`**

Open `src/services/events/processProjectionAtMostOnce.ts`, find the `SubscriberId` enum/object (it already has `DailyEventCounts`), and add `ProfitCache = 'profit_cache'` alongside it.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/services/events/__tests__/profitCacheProjection.test.ts`
Expected: PASS

- [ ] **Step 7: Add the `profit_cache` special case to `ops.ts`**

In `src/data/powersync/ops.ts`, add a new block before the generic `switch` (after the existing `daily_event_counts` block, currently ending at line 60):

```ts
// WAFI-153: profit_cache is server-authoritative for the same reason
// daily_event_counts is -- the local marker write above never computes an
// absolute metric value, only source_event_id, so the upload path calls the
// apply RPC instead of a generic upsert.
if (table === 'profit_cache' && (type === UpdateType.PUT || type === UpdateType.PATCH)) {
  if (!opData?.source_event_id) return null
  return (
    await supabase.rpc('apply_profit_cache', { p_event_id: opData.source_event_id })
  ).error
}
```

- [ ] **Step 8: Write a test for the `ops.ts` special case**

Find the existing `daily_event_counts` test in `src/data/powersync/ops.test.ts` (or wherever `ops.ts`'s tests live) and add an analogous case:

```ts
it('routes a profit_cache PUT with source_event_id to apply_profit_cache RPC, never uploading metric columns', async () => {
  const rpcSpy = vi.spyOn(supabase, 'rpc').mockResolvedValue({ error: null } as any)
  const err = await uploadOp('profit_cache', UpdateType.PUT, { source_event_id: 'evt-1', revenue_usd: 999 })
  expect(rpcSpy).toHaveBeenCalledWith('apply_profit_cache', { p_event_id: 'evt-1' })
  expect(err).toBeNull()
})

it('no-ops a profit_cache PUT with no source_event_id', async () => {
  const rpcSpy = vi.spyOn(supabase, 'rpc')
  const err = await uploadOp('profit_cache', UpdateType.PUT, {})
  expect(rpcSpy).not.toHaveBeenCalled()
  expect(err).toBeNull()
})
```

(Match this file's actual exported test helper for driving an upload op — `uploadOp` above is illustrative; use whatever the existing `daily_event_counts` tests in this file actually call.)

- [ ] **Step 9: Run the ops test file to verify it passes**

Run: `npx vitest run src/data/powersync/ops.test.ts`
Expected: all PASS, including the two new cases.

- [ ] **Step 10: Wire `startProfitCacheProjection` into `App.vue`**

In `src/App.vue`, add the import alongside the existing projection imports (near line 22):

```ts
import { startProfitCacheProjection } from '@/services/events/profitCacheProjection'
```

And add the call inside `onMounted`, alongside `startDashboardRevenueProjection` (near line 146):

```ts
  startProfitCacheProjection(useDeviceStore().shopId)
```

- [ ] **Step 11: Commit**

```bash
git add src/data/powersync/schema.ts src/data/powersync/ops.ts src/services/events/profitCacheProjection.ts src/services/events/processProjectionAtMostOnce.ts src/services/events/__tests__/profitCacheProjection.test.ts src/data/powersync/ops.test.ts src/App.vue
git commit -m "feat(WAFI-153): add profit_cache client schema, local subscriber, ops.ts upload special-case"
```

---

### Task 7: Publication / PowerSync sync-rule wiring for `profit_cache`

**Files:**
- Modify: whichever migration or config file currently adds `daily_event_counts` to the Postgres publication and PowerSync sync-rule YAML (locate via `Grep` for `daily_event_counts` across `supabase/` and any `sync-rules.yaml`/`powersync.yaml` in the repo root or `supabase/`)

**Interfaces:**
- Produces: `profit_cache` synced shop-scoped, identically to every other `shop_data`-stream table.

- [ ] **Step 1: Find the publication/sync-rule wiring**

Run: use Grep for `daily_event_counts` across `supabase/migrations/*.sql` and any `*.yaml`/`*.yml` file in the repo (sync rules are typically not a migration but a PowerSync-side config file or Supabase dashboard setting reflected in a checked-in YAML).

- [ ] **Step 2: Add `profit_cache` to the same publication (if in a migration)**

If `daily_event_counts` is added to a Postgres publication via `ALTER PUBLICATION ... ADD TABLE public.daily_event_counts;` in some migration, add the equivalent for `profit_cache` in migration `086_profit_cache_apply.sql` (append to Task 1's migration file, near the RLS/grant block at the end):

```sql
ALTER PUBLICATION powersync ADD TABLE public.profit_cache;
```

(Confirm the actual publication name — it may not be literally `powersync`; use whatever migration 074/083 actually used for `daily_event_counts`.)

- [ ] **Step 3: Add `profit_cache` to the sync-rule YAML (if a separate file)**

If sync rules live in a checked-in YAML (e.g. `supabase/sync-rules.yaml`), add `profit_cache` to the same `shop_data` bucket definition `daily_event_counts` is in, following that file's existing shape exactly (shop-scoped `WHERE shop_id = shop_id()` or equivalent).

- [ ] **Step 4: Verify sync locally**

Run: whatever this repo's existing manual verification step is for a newly-synced table (check `docs/architecture/EVENT_SUBSCRIBERS.md` or the WAFI-151 plan's equivalent step for the exact command — likely a PowerSync dev-instance restart plus a manual `SELECT * FROM profit_cache` against a synced local DB after a test event fires).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/086_profit_cache_apply.sql <sync-rule file if separate>
git commit -m "feat(WAFI-153): add profit_cache to the shop_data publication/sync-rule stream"
```

---

### Task 8: `useProfitCache()` composable + `PeriodProfitMetrics` type

**Files:**
- Create: `src/features/dashboard/types/profitMetrics.ts`
- Create: `src/features/dashboard/composables/useProfitCache.ts`
- Test: `src/features/dashboard/composables/useProfitCache.test.ts`

**Interfaces:**
- Consumes: local `profit_cache` table (Task 6).
- Produces: `useProfitCache()` returning `{ metrics: Ref<PeriodProfitMetrics>, loading: Ref<boolean>, load: (period: 'today'|'week'|'month'|'quarter') => Promise<void>, loadRange: (from: string, to: string) => Promise<void> }` — matching `useDashboardMetrics()`'s `load`/`loadRange` shape so the 6 call-site migrations (Task 9) are mechanical.

- [ ] **Step 1: Write the type**

```ts
// src/features/dashboard/types/profitMetrics.ts
export interface PeriodProfitMetrics {
  revenueUsd: number
  refundsUsd: number
  cogsUsd: number
  cogsReversalUsd: number
  expensesUsd: number
  discountUsd: number
  invoiceCount: number
  returnCount: number
  costlessSaleCount: number
  netRevenueUsd: number
  netCogsUsd: number
  profitUsd: number
  profitIsEstimated: boolean
}

export const EMPTY_PROFIT_METRICS: PeriodProfitMetrics = {
  revenueUsd: 0, refundsUsd: 0, cogsUsd: 0, cogsReversalUsd: 0, expensesUsd: 0,
  discountUsd: 0, invoiceCount: 0, returnCount: 0, costlessSaleCount: 0,
  netRevenueUsd: 0, netCogsUsd: 0, profitUsd: 0, profitIsEstimated: false,
}
```

- [ ] **Step 2: Write the failing test**

```ts
// src/features/dashboard/composables/useProfitCache.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useProfitCache } from './useProfitCache'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

vi.mock('@/data/powersync/db')
vi.mock('@/store/device.store')

describe('useProfitCache', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(useDeviceStore).mockReturnValue({ shopId: 'shop-1' } as any)
  })

  it('sums whole-cent rows across a date range and derives net figures at read time', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { revenue_usd: 10000, revenue_syp: 0, cogs_usd: 6000, cogs_reversal_usd: 0, expenses_usd: 0,
        refunds_usd: 0, discount_usd: 0, invoice_count: 1, return_count: 0, costless_sale_count: 0 },
      { revenue_usd: 10000, revenue_syp: 0, cogs_usd: 6000, cogs_reversal_usd: 6000, expenses_usd: 0,
        refunds_usd: 10000, discount_usd: 0, invoice_count: 1, return_count: 1, costless_sale_count: 0 },
    ] as any)

    const { metrics, loadRange } = useProfitCache()
    await loadRange('2026-08-01', '2026-08-31')

    // Sale 1: $100 rev, $60 cogs, no return. Sale 2: $100 rev fully refunded, $60 cogs fully reversed.
    expect(metrics.value.revenueUsd).toBe(200)
    expect(metrics.value.refundsUsd).toBe(100)
    expect(metrics.value.netRevenueUsd).toBe(100)   // 200 - 100
    expect(metrics.value.cogsUsd).toBe(120)
    expect(metrics.value.cogsReversalUsd).toBe(60)
    expect(metrics.value.netCogsUsd).toBe(60)        // 120 - 60
    expect(metrics.value.profitUsd).toBe(40)         // 100 - 60 - 0 expenses
  })

  it('clamps a negative summed costlessSaleCount to 0 for display, without throwing', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { revenue_usd: 0, revenue_syp: 0, cogs_usd: 0, cogs_reversal_usd: 0, expenses_usd: 0,
        refunds_usd: 0, discount_usd: 0, invoice_count: 0, return_count: 0, costless_sale_count: -1 },
    ] as any)

    const { metrics, loadRange } = useProfitCache()
    await loadRange('2026-08-01', '2026-08-31')

    expect(metrics.value.costlessSaleCount).toBe(0)
  })

  it('sets profitIsEstimated true when costlessSaleCount > 0', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { revenue_usd: 0, revenue_syp: 0, cogs_usd: 0, cogs_reversal_usd: 0, expenses_usd: 0,
        refunds_usd: 0, discount_usd: 0, invoice_count: 0, return_count: 0, costless_sale_count: 2 },
    ] as any)

    const { metrics, loadRange } = useProfitCache()
    await loadRange('2026-08-01', '2026-08-31')

    expect(metrics.value.profitIsEstimated).toBe(true)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/features/dashboard/composables/useProfitCache.test.ts`
Expected: FAIL — `useProfitCache.ts` doesn't exist yet.

- [ ] **Step 4: Write `useProfitCache.ts`**

```ts
// src/features/dashboard/composables/useProfitCache.ts
import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { logger } from '@/services/events/logger'
import { EMPTY_PROFIT_METRICS, type PeriodProfitMetrics } from '../types/profitMetrics'

type ProfitCacheRow = {
  revenue_usd: number; revenue_syp: number; cogs_usd: number; cogs_reversal_usd: number
  expenses_usd: number; refunds_usd: number; discount_usd: number
  invoice_count: number; return_count: number; costless_sale_count: number
}

function toRange(period: 'today' | 'week' | 'month' | 'quarter'): [string, string] {
  const now = new Date()
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const start = new Date(now)
  if (period === 'week') start.setDate(now.getDate() - 6)
  else if (period === 'month') start.setDate(now.getDate() - 29)
  else if (period === 'quarter') start.setDate(now.getDate() - 89)
  return [iso(start), iso(now)]
}

export function useProfitCache() {
  const metrics = ref<PeriodProfitMetrics>({ ...EMPTY_PROFIT_METRICS })
  const loading = ref(false)

  async function loadRange(from: string, to: string): Promise<void> {
    loading.value = true
    try {
      const { shopId } = useDeviceStore()
      const rows = await db.getAll<ProfitCacheRow>(
        `SELECT revenue_usd, revenue_syp, cogs_usd, cogs_reversal_usd, expenses_usd,
                refunds_usd, discount_usd, invoice_count, return_count, costless_sale_count
         FROM profit_cache WHERE shop_id = ? AND day BETWEEN ? AND ?`,
        [shopId, from, to],
      )

      // Sum whole integer CENTS across all rows first; divide by 100 exactly
      // once, at the very end, per metric -- never sum floating-dollar values
      // row by row (that would reintroduce the float error this whole design
      // exists to avoid).
      const sums = rows.reduce((acc, r) => ({
        revenueCents:  acc.revenueCents  + r.revenue_usd,
        revenueSyp:    acc.revenueSyp    + r.revenue_syp,
        cogsCents:     acc.cogsCents     + r.cogs_usd,
        cogsRevCents:  acc.cogsRevCents  + r.cogs_reversal_usd,
        expensesCents: acc.expensesCents + r.expenses_usd,
        refundsCents:  acc.refundsCents  + r.refunds_usd,
        discountCents: acc.discountCents + r.discount_usd,
        invoiceCount:  acc.invoiceCount  + r.invoice_count,
        returnCount:   acc.returnCount   + r.return_count,
        costlessCount: acc.costlessCount + r.costless_sale_count,
      }), {
        revenueCents: 0, revenueSyp: 0, cogsCents: 0, cogsRevCents: 0, expensesCents: 0,
        refundsCents: 0, discountCents: 0, invoiceCount: 0, returnCount: 0, costlessCount: 0,
      })

      const revenueUsd       = sums.revenueCents / 100.0
      const refundsUsd       = sums.refundsCents / 100.0
      const cogsUsd          = sums.cogsCents / 100.0
      const cogsReversalUsd  = sums.cogsRevCents / 100.0
      const expensesUsd      = sums.expensesCents / 100.0
      const discountUsd      = sums.discountCents / 100.0
      const netRevenueUsd    = revenueUsd - refundsUsd
      const netCogsUsd       = cogsUsd - cogsReversalUsd
      const profitUsd        = netRevenueUsd - netCogsUsd - expensesUsd

      // A transiently negative summed count (return-before-sale upsert mid-flight)
      // is expected eventual consistency, not corrupt data -- clamp for display,
      // but log so a PERSISTENTLY negative count is visible to an operator.
      if (sums.costlessCount < 0) {
        logger.warn('[useProfitCache] negative costlessSaleCount for range', { from, to, value: sums.costlessCount })
      }

      metrics.value = {
        revenueUsd, refundsUsd, cogsUsd, cogsReversalUsd, expensesUsd, discountUsd,
        invoiceCount: sums.invoiceCount, returnCount: sums.returnCount,
        costlessSaleCount: Math.max(0, sums.costlessCount),
        netRevenueUsd, netCogsUsd, profitUsd,
        profitIsEstimated: sums.costlessCount > 0,
      }
    } finally {
      loading.value = false
    }
  }

  async function load(period: 'today' | 'week' | 'month' | 'quarter'): Promise<void> {
    const [from, to] = toRange(period)
    await loadRange(from, to)
  }

  return { metrics, loading, load, loadRange }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/features/dashboard/composables/useProfitCache.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/features/dashboard/types/profitMetrics.ts src/features/dashboard/composables/useProfitCache.ts src/features/dashboard/composables/useProfitCache.test.ts
git commit -m "feat(WAFI-153): add useProfitCache composable reading the profit_cache read model"
```

---

### Task 9: `missingCostCount` extraction

**Files:**
- Create: `src/features/dashboard/composables/useMissingCostCount.ts`
- Test: `src/features/dashboard/composables/useMissingCostCount.test.ts`

**Interfaces:**
- Produces: `useMissingCostCount(): { missingCostCount: Ref<number>, load: () => Promise<void> }`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useMissingCostCount } from './useMissingCostCount'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

vi.mock('@/data/powersync/db')
vi.mock('@/store/device.store')

describe('useMissingCostCount', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(useDeviceStore).mockReturnValue({ shopId: 'shop-1' } as any)
  })

  it('loads the count of active products with no/zero cost price', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ count: 3 } as any)
    const { missingCostCount, load } = useMissingCostCount()
    await load()
    expect(missingCostCount.value).toBe(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/dashboard/composables/useMissingCostCount.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write `useMissingCostCount.ts`**

Ported verbatim from `useDashboardMetrics.ts`'s existing query (lines 101-106) — this is the one metric the design spec keeps live, since it's a current-state fact about product master data, not a period-derived financial event aggregate:

```ts
// src/features/dashboard/composables/useMissingCostCount.ts
import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

export function useMissingCostCount() {
  const missingCostCount = ref(0)

  async function load(): Promise<void> {
    const { shopId } = useDeviceStore()
    const row = await db.getOptional<{ count: number }>(
      `SELECT COUNT(*) as count FROM products
       WHERE shop_id = ? AND is_active = 1 AND (deleted = 0 OR deleted IS NULL)
         AND (cost_price_usd = 0 OR cost_price_usd IS NULL)`,
      [shopId],
    )
    missingCostCount.value = row?.count ?? 0
  }

  return { missingCostCount, load }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/dashboard/composables/useMissingCostCount.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/composables/useMissingCostCount.ts src/features/dashboard/composables/useMissingCostCount.test.ts
git commit -m "feat(WAFI-153): extract missingCostCount into its own composable"
```

---

### Task 10: Migrate the 6 call sites to `useProfitCache()` + `useMissingCostCount()`

**Files:**
- Modify: `src/pages/HomePage.vue` (line 44)
- Modify: `src/features/dashboard/components/ReportsPage.vue` (lines 31-32)
- Modify: `src/features/dashboard/components/AnomalyBanner.vue` (lines 32, 38)
- Modify: `src/composables/useAutomaticInsights.ts` (lines 25, 38)
- Modify: `src/features/dashboard/composables/useRevenueIntelligence.ts` (lines 47-52)
- Modify: `src/features/dashboard/composables/useProfitIntelligence.ts` (lines 39-40)
- Test: each file's existing test (if any) — update assertions where field names changed (e.g. old `grossIncomeUsd` has no direct `useProfitCache` equivalent; check each call site for whether it uses that field and substitute `netRevenueUsd + refundsUsd` if genuinely needed, or drop if unused — inspect each file's actual usage before assuming)

**Interfaces:**
- Consumes: `useProfitCache()` (Task 8), `useMissingCostCount()` (Task 9).

- [ ] **Step 1: Read each call site's actual field usage before editing**

For each of the 6 files, grep the file for every property accessed off its `useDashboardMetrics()` instance (e.g. `metrics.revenueUsd`, `metrics.profitUsd`, `metrics.missingCostCount`) — the exact field list per call site was not fully enumerated during research and must be confirmed file-by-file before substitution, since `PeriodProfitMetrics` renames `grossIncomeUsd` (not carried forward — see below) and does not carry `missingCostCount` at all.

`grossIncomeUsd` (`revenueUsd + refundsUsd`, i.e. gross before refunds) has no field on `PeriodProfitMetrics` — `PeriodProfitMetrics.revenueUsd` is itself the gross figure (unlike `useDashboardMetrics.revenueUsd`, which is net-of-refunds). Any call site reading `grossIncomeUsd` should read `metrics.revenueUsd` directly instead; any call site reading `useDashboardMetrics`'s `revenueUsd` (net-of-refunds) should read `metrics.netRevenueUsd`. Do not conflate the two — confirm which one each call site actually needs by reading its usage, not by assuming the old field name maps 1:1.

- [ ] **Step 2: Migrate `HomePage.vue`**

Change the import and instantiation at line 44 from `useDashboardMetrics()` to `useProfitCache()` + `useMissingCostCount()`, then update every field access in this file's template/script per Step 1's mapping (`revenueUsd` → `netRevenueUsd` if net-of-refunds was intended, `profitUsd`/`cogsUsd`/`expensesUsd`/`invoiceCount`/`returnCount`/`discountUsd`/`profitIsEstimated` map 1:1 by name, `missingCostCount` → the new composable's `missingCostCount`).

- [ ] **Step 3: Run `HomePage.vue`'s existing tests (if any) and fix failures**

Run: `npx vitest run src/pages/HomePage.test.ts` (adjust path to wherever this file's test actually lives, if it exists)
Expected: PASS after field-name updates.

- [ ] **Step 4: Repeat Steps 1-3 for `ReportsPage.vue`**

Both `metrics` and `previousMetrics` instances need migrating.

- [ ] **Step 5: Repeat Steps 1-3 for `AnomalyBanner.vue`**

`dashboardMetrics.load('today')` becomes `profitCache.load('today')` (or `useProfitCache()`'s `load`, matching the renamed variable).

- [ ] **Step 6: Repeat Steps 1-3 for `useAutomaticInsights.ts`**

Both `currentMetrics` and the conditionally-instantiated `comparisonMetrics` need migrating.

- [ ] **Step 7: Repeat Steps 1-3 for `useRevenueIntelligence.ts`**

Both `currentMetrics`/`previousMetrics`, currently `loadRange`'d in a `Promise.all` — `useProfitCache()`'s `loadRange(from, to)` has the identical signature, so this is a direct swap.

- [ ] **Step 8: Repeat Steps 1-3 for `useProfitIntelligence.ts`**

Both `currentMetrics`/`previousMetrics`.

- [ ] **Step 9: Run the full test suite to catch cross-file regressions**

Run: `npx vitest run`
Expected: all PASS. Pay particular attention to any snapshot or fixture test asserting on the old `useDashboardMetrics` field shape from any of these 6 files' consumers.

- [ ] **Step 10: Manual smoke test**

Per this project's UI-testing discipline: start the dev server (`npm run dev`), open the Home page and Reports page, confirm profit/revenue/COGS/expense figures render and match what they showed before this change for the same date range (compare against `useDashboardMetrics`'s numbers for the same period, since both paths still exist and read the same underlying events at this point in the rollout — full formal parity testing is Task 12's job, this is a fast sanity check).

- [ ] **Step 11: Commit**

```bash
git add src/pages/HomePage.vue src/features/dashboard/components/ReportsPage.vue src/features/dashboard/components/AnomalyBanner.vue src/composables/useAutomaticInsights.ts src/features/dashboard/composables/useRevenueIntelligence.ts src/features/dashboard/composables/useProfitIntelligence.ts
git commit -m "feat(WAFI-153): migrate the 6 dashboard/reports call sites to useProfitCache + useMissingCostCount"
```

Note: `useDashboardMetrics.ts` itself is **not deleted** by this task — per the design spec's staged rollout, it stays in place (unused by app code after this task, but still present) until the shadow-mode observation window (Task 12 builds the parity test that gates this; actually retiring the file is an operational step outside this plan's scope, since it depends on production data observation, not just tests passing).

---

### Task 11: pgTAP tests — apply function

**Files:**
- Create: `supabase/tests/wafi153_profit_cache_apply.test.sql`

**Interfaces:**
- Consumes: `public.apply_profit_cache`, `public._apply_profit_cache` (Task 1).

- [ ] **Step 1: Write the test file**

Mirror `supabase/tests/wafi151_daily_event_counts_apply.test.sql`'s harness pattern exactly (seed `auth.users` + `public.shops`, seed `public.events` directly as `postgres`, `SET LOCAL ROLE authenticated` with `request.jwt.claims` for shop-owner calls):

```sql
-- supabase/tests/wafi153_profit_cache_apply.test.sql
-- Run via: npx supabase test db
BEGIN;
SELECT plan(14);

-- Fixture setup: one shop, owned by one auth user.
INSERT INTO auth.users (id, email) VALUES ('11111111-1111-1111-1111-111111111111', 'owner@test.local');
INSERT INTO public.shops (id, owner_user_id, name, timezone)
  VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Test Shop', 'UTC');

-- Event 1: version=2 sale.completed, $19.99 revenue, $10.00 cogs, $0 discount, costless=false.
INSERT INTO public.events (id, shop_id, type, payload, payload_version, occurred_at, staff_id)
VALUES ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'sale.completed',
  '{"saleId":"s1","totalUsd":19.99,"totalSyp":0,"cogsUsd":10.00,"discountUsd":0,"hasCostlessLine":false}'::jsonb,
  2, now(), '11111111-1111-1111-1111-111111111111');

SET LOCAL ROLE service_role;
SELECT public._apply_profit_cache('33333333-3333-3333-3333-333333333333');
RESET ROLE;

-- Test 1: cents conversion is exact, not truncated (19.99 -> 1999, never 19).
SELECT is(
  (SELECT revenue_usd FROM public.profit_cache WHERE shop_id = '22222222-2222-2222-2222-222222222222'),
  1999::bigint, 'revenue_usd is 1999 cents for a $19.99 sale, not truncated to 1900'
);

-- Test 2: ledger row created.
SELECT is(
  (SELECT count(*)::int FROM public.projection_processed_events
   WHERE projection_name = 'profit_cache' AND event_id = '33333333-3333-3333-3333-333333333333'),
  1, 'ledger records the applied event exactly once'
);

-- Test 3: redelivery is a no-op (same event applied twice -> one increment, one ledger row).
SET LOCAL ROLE service_role;
SELECT public._apply_profit_cache('33333333-3333-3333-3333-333333333333');
RESET ROLE;
SELECT is(
  (SELECT revenue_usd FROM public.profit_cache WHERE shop_id = '22222222-2222-2222-2222-222222222222'),
  1999::bigint, 'redelivering the same event_id does not double-increment'
);

-- Test 4: payload_version = 1 is a permanent, ledger-recorded no-op, not an error.
INSERT INTO public.events (id, shop_id, type, payload, payload_version, occurred_at, staff_id)
VALUES ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222', 'sale.completed',
  '{"saleId":"s2","totalUsd":5.00,"totalSyp":0}'::jsonb, 1, now(), '11111111-1111-1111-1111-111111111111');
SELECT lives_ok(
  $$ SELECT public._apply_profit_cache('44444444-4444-4444-4444-444444444444') $$,
  'a payload_version=1 event does not raise'
);
SELECT is(
  (SELECT revenue_usd FROM public.profit_cache WHERE shop_id = '22222222-2222-2222-2222-222222222222'),
  1999::bigint, 'a payload_version=1 event produces no profit_cache mutation'
);
SELECT is(
  (SELECT count(*)::int FROM public.projection_processed_events
   WHERE projection_name = 'profit_cache' AND event_id = '44444444-4444-4444-4444-444444444444'),
  1, 'a payload_version=1 event is still ledger-recorded so it is never retried'
);

-- Test 5: payload_version = 3 raises loudly (P0004).
INSERT INTO public.events (id, shop_id, type, payload, payload_version, occurred_at, staff_id)
VALUES ('55555555-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222', 'sale.completed',
  '{"saleId":"s3","totalUsd":5.00,"totalSyp":0,"cogsUsd":0,"discountUsd":0,"hasCostlessLine":false}'::jsonb,
  3, now(), '11111111-1111-1111-1111-111111111111');
SELECT throws_ok(
  $$ SELECT public._apply_profit_cache('55555555-5555-5555-5555-555555555555') $$,
  'P0004', NULL, 'a payload_version > 2 event raises loudly'
);

-- Test 6: a version=2 sale.completed missing a required field (cogsUsd) raises P0005, no partial mutation.
INSERT INTO public.events (id, shop_id, type, payload, payload_version, occurred_at, staff_id)
VALUES ('66666666-6666-6666-6666-666666666666', '22222222-2222-2222-2222-222222222222', 'sale.completed',
  '{"saleId":"s4","totalUsd":5.00,"totalSyp":0,"discountUsd":0,"hasCostlessLine":false}'::jsonb,
  2, now(), '11111111-1111-1111-1111-111111111111');
SELECT throws_ok(
  $$ SELECT public._apply_profit_cache('66666666-6666-6666-6666-666666666666') $$,
  'P0005', NULL, 'a version=2 event missing a required field raises loudly'
);
SELECT is(
  (SELECT revenue_usd FROM public.profit_cache WHERE shop_id = '22222222-2222-2222-2222-222222222222'),
  1999::bigint, 'the missing-field event caused no partial mutation to the existing row'
);

-- Test 7: sale.returned full-return-of-costless-sale decrements the ORIGINAL SALE's day, not the return's.
INSERT INTO public.events (id, shop_id, type, payload, payload_version, occurred_at, staff_id)
VALUES ('77777777-7777-7777-7777-777777777777', '22222222-2222-2222-2222-222222222222', 'sale.completed',
  '{"saleId":"s5","totalUsd":8.00,"totalSyp":0,"cogsUsd":0,"discountUsd":0,"hasCostlessLine":true}'::jsonb,
  2, '2026-08-10T10:00:00Z', '11111111-1111-1111-1111-111111111111');
UPDATE public.events SET event_projection_day = '2026-08-10' WHERE id = '77777777-7777-7777-7777-777777777777';
SET LOCAL ROLE service_role;
SELECT public._apply_profit_cache('77777777-7777-7777-7777-777777777777');
RESET ROLE;
SELECT is(
  (SELECT costless_sale_count FROM public.profit_cache WHERE shop_id = '22222222-2222-2222-2222-222222222222' AND day = '2026-08-10'),
  1, 'sale.completed increments costless_sale_count on its own day'
);

INSERT INTO public.events (id, shop_id, type, payload, payload_version, occurred_at, staff_id)
VALUES ('88888888-8888-8888-8888-888888888888', '22222222-2222-2222-2222-222222222222', 'sale.returned',
  '{"returnId":"r1","saleId":"s5","refundAmountUsd":8.00,"cogsReversalUsd":0,"isFullReturn":true,"saleWasCostless":true,"originalSaleProjectionDay":"2026-08-10"}'::jsonb,
  2, '2026-08-20T10:00:00Z', '11111111-1111-1111-1111-111111111111');
UPDATE public.events SET event_projection_day = '2026-08-20' WHERE id = '88888888-8888-8888-8888-888888888888';
SET LOCAL ROLE service_role;
SELECT public._apply_profit_cache('88888888-8888-8888-8888-888888888888');
RESET ROLE;
SELECT is(
  (SELECT costless_sale_count FROM public.profit_cache WHERE shop_id = '22222222-2222-2222-2222-222222222222' AND day = '2026-08-10'),
  0, 'a full return of a costless sale decrements the SALE''S day (Aug 10), not the return''s day (Aug 20)'
);
SELECT is(
  (SELECT count(*)::int FROM public.profit_cache WHERE shop_id = '22222222-2222-2222-2222-222222222222' AND day = '2026-08-20' AND return_count = 1),
  1, 'the return''s own day gets its refund/return_count metrics'
);

-- Test 8: return-before-sale ordering nets to 0 regardless of order.
INSERT INTO public.events (id, shop_id, type, payload, payload_version, occurred_at, staff_id)
VALUES ('99999999-9999-9999-9999-999999999999', '22222222-2222-2222-2222-222222222222', 'sale.returned',
  '{"returnId":"r2","saleId":"s6","refundAmountUsd":5.00,"cogsReversalUsd":0,"isFullReturn":true,"saleWasCostless":true,"originalSaleProjectionDay":"2026-09-01"}'::jsonb,
  2, '2026-09-05T10:00:00Z', '11111111-1111-1111-1111-111111111111');
UPDATE public.events SET event_projection_day = '2026-09-05' WHERE id = '99999999-9999-9999-9999-999999999999';
SET LOCAL ROLE service_role;
SELECT public._apply_profit_cache('99999999-9999-9999-9999-999999999999');
RESET ROLE;
SELECT is(
  (SELECT costless_sale_count FROM public.profit_cache WHERE shop_id = '22222222-2222-2222-2222-222222222222' AND day = '2026-09-01'),
  -1, 'return-before-sale seeds -1 via upsert, never silently loses the decrement'
);

INSERT INTO public.events (id, shop_id, type, payload, payload_version, occurred_at, staff_id)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'sale.completed',
  '{"saleId":"s6","totalUsd":5.00,"totalSyp":0,"cogsUsd":0,"discountUsd":0,"hasCostlessLine":true}'::jsonb,
  2, '2026-09-01T10:00:00Z', '11111111-1111-1111-1111-111111111111');
UPDATE public.events SET event_projection_day = '2026-09-01' WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
SET LOCAL ROLE service_role;
SELECT public._apply_profit_cache('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
RESET ROLE;
SELECT is(
  (SELECT costless_sale_count FROM public.profit_cache WHERE shop_id = '22222222-2222-2222-2222-222222222222' AND day = '2026-09-01'),
  0, 'sale.completed arriving after its own return nets to 0 (return-first ordering)'
);

-- Test 9: direct client INSERT/UPDATE against profit_cache is rejected (grant-level).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111')::text, true);
SELECT throws_ok(
  $$ INSERT INTO public.profit_cache (shop_id, day) VALUES ('22222222-2222-2222-2222-222222222222', '2026-01-01') $$,
  '42501', NULL, 'a direct client INSERT against profit_cache is rejected at the grant level'
);
RESET ROLE;

-- Test 10: _apply_profit_cache is not callable directly by authenticated (only via the wrapper).
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public._apply_profit_cache('33333333-3333-3333-3333-333333333333') $$,
  '42501', NULL, '_apply_profit_cache is not directly callable by authenticated'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the tests**

Run: `npx supabase test db`
Expected: all 14 assertions PASS (adjust the `plan(14)` count if the final assertion count in the file above differs once written — count each `SELECT is/throws_ok/lives_ok` call exactly).

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/wafi153_profit_cache_apply.test.sql
git commit -m "test(WAFI-153): pgTAP coverage for _apply_profit_cache (version gate, idempotency, cross-day decrement, ordering, grants)"
```

---

### Task 12: pgTAP tests — backfill + rebuild

**Files:**
- Create: `supabase/tests/wafi153_profit_cache_rebuild.test.sql`

**Interfaces:**
- Consumes: `public.rebuild_profit_cache_scope`, `public._backfill_profit_cache_shop` (Task 2).

- [ ] **Step 1: Write the test file**

Mirror `supabase/tests/wafi151_daily_event_counts_rebuild.test.sql`'s structure (rollback-safety-via-throwaway-function-copy pattern, incremental-vs-replay parity):

```sql
-- supabase/tests/wafi153_profit_cache_rebuild.test.sql
-- Run via: npx supabase test db
BEGIN;
SELECT plan(6);

INSERT INTO auth.users (id, email) VALUES ('11111111-1111-1111-1111-111111111111', 'owner@test.local');
INSERT INTO public.shops (id, owner_user_id, name, timezone)
  VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Test Shop', 'UTC');

-- Test 1: mixed-version-day backfill -- one version-1 sale (backfill-only) and
-- one version-2 sale (event-derived) on the same day; backfill includes only
-- the version-1 sale's contribution; final revenue after full rebuild sums both once each.
INSERT INTO public.sales (id, shop_id, total_usd, total_syp, created_at)
  VALUES ('b1111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 10.00, 0, '2026-08-10T09:00:00Z');
INSERT INTO public.events (id, shop_id, type, payload, payload_version, occurred_at, staff_id)
VALUES ('c1111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'sale.completed',
  '{"saleId":"b1111111-1111-1111-1111-111111111111","totalUsd":10.00,"totalSyp":0}'::jsonb,
  1, '2026-08-10T09:00:00Z', '11111111-1111-1111-1111-111111111111');

INSERT INTO public.sales (id, shop_id, total_usd, total_syp, created_at)
  VALUES ('b2222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 20.00, 0, '2026-08-10T11:00:00Z');
INSERT INTO public.events (id, shop_id, type, payload, payload_version, occurred_at, staff_id)
VALUES ('c2222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'sale.completed',
  '{"saleId":"b2222222-2222-2222-2222-222222222222","totalUsd":20.00,"totalSyp":0,"cogsUsd":0,"discountUsd":0,"hasCostlessLine":false}'::jsonb,
  2, '2026-08-10T11:00:00Z', '11111111-1111-1111-1111-111111111111');
UPDATE public.events SET event_projection_day = '2026-08-10';

SET LOCAL ROLE service_role;
SELECT public.rebuild_profit_cache_scope('22222222-2222-2222-2222-222222222222');
RESET ROLE;

SELECT is(
  (SELECT revenue_usd FROM public.profit_cache WHERE shop_id = '22222222-2222-2222-2222-222222222222' AND day = '2026-08-10'),
  3000::bigint, 'mixed-version day: rebuild sums the backfilled v1 sale ($10) and the replayed v2 sale ($20) exactly once each = $30'
);

-- Test 2: repeated-rebuild idempotency.
SET LOCAL ROLE service_role;
SELECT public.rebuild_profit_cache_scope('22222222-2222-2222-2222-222222222222');
RESET ROLE;
SELECT is(
  (SELECT revenue_usd FROM public.profit_cache WHERE shop_id = '22222222-2222-2222-2222-222222222222' AND day = '2026-08-10'),
  3000::bigint, 'a second immediate rebuild produces byte-identical rows'
);

-- Test 3: cross-day rebuild safety -- sale day 1, full return day 10, both
-- within the covered range; full-scope rebuild must reproduce incremental's result (0).
INSERT INTO public.sales (id, shop_id, total_usd, total_syp, created_at)
  VALUES ('b3333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 15.00, 0, '2026-09-01T09:00:00Z');
INSERT INTO public.events (id, shop_id, type, payload, payload_version, occurred_at, staff_id)
VALUES ('c3333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'sale.completed',
  '{"saleId":"b3333333-3333-3333-3333-333333333333","totalUsd":15.00,"totalSyp":0,"cogsUsd":0,"discountUsd":0,"hasCostlessLine":true}'::jsonb,
  2, '2026-09-01T09:00:00Z', '11111111-1111-1111-1111-111111111111');
UPDATE public.events SET event_projection_day = '2026-09-01' WHERE id = 'c3333333-3333-3333-3333-333333333333';

INSERT INTO public.events (id, shop_id, type, payload, payload_version, occurred_at, staff_id)
VALUES ('c4444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222', 'sale.returned',
  '{"returnId":"r3","saleId":"b3333333-3333-3333-3333-333333333333","refundAmountUsd":15.00,"cogsReversalUsd":0,"isFullReturn":true,"saleWasCostless":true,"originalSaleProjectionDay":"2026-09-01"}'::jsonb,
  2, '2026-09-10T09:00:00Z', '11111111-1111-1111-1111-111111111111');
UPDATE public.events SET event_projection_day = '2026-09-10' WHERE id = 'c4444444-4444-4444-4444-444444444444';

SET LOCAL ROLE service_role;
SELECT public.rebuild_profit_cache_scope('22222222-2222-2222-2222-222222222222');
RESET ROLE;
SELECT is(
  (SELECT costless_sale_count FROM public.profit_cache WHERE shop_id = '22222222-2222-2222-2222-222222222222' AND day = '2026-09-01'),
  0, 'full-scope rebuild reproduces the incremental cross-day result: sale day''s costless_sale_count ends at 0'
);

-- Test 4: backfilled-row-mutated-by-a-later-event rebuild safety -- a
-- pre-coverage costless sale (backfill-only, no event) with a later v2 full
-- return referencing it must end at 0 after rebuild, not -1.
INSERT INTO public.sales (id, shop_id, total_usd, total_syp, created_at)
  VALUES ('b5555555-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222', 12.00, 0, '2026-10-01T09:00:00Z');
-- No event for this sale at all -- pure pre-coverage history, backfill-only.

INSERT INTO public.events (id, shop_id, type, payload, payload_version, occurred_at, staff_id)
VALUES ('c5555555-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222', 'sale.returned',
  '{"returnId":"r4","saleId":"b5555555-5555-5555-5555-555555555555","refundAmountUsd":12.00,"cogsReversalUsd":0,"isFullReturn":true,"saleWasCostless":true,"originalSaleProjectionDay":"2026-10-01"}'::jsonb,
  2, '2026-10-05T09:00:00Z', '11111111-1111-1111-1111-111111111111');
UPDATE public.events SET event_projection_day = '2026-10-05' WHERE id = 'c5555555-5555-5555-5555-555555555555';

SET LOCAL ROLE service_role;
SELECT public.rebuild_profit_cache_scope('22222222-2222-2222-2222-222222222222');
RESET ROLE;
SELECT is(
  (SELECT costless_sale_count FROM public.profit_cache WHERE shop_id = '22222222-2222-2222-2222-222222222222' AND day = '2026-10-01'),
  0, 'a full rematerialization never re-applies the same decrement twice against a never-reset backfilled row (must be 0, not -1)'
);

-- Test 5: rebuild_profit_cache_scope is not callable by authenticated (service_role only).
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.rebuild_profit_cache_scope('22222222-2222-2222-2222-222222222222') $$,
  '42501', NULL, 'rebuild_profit_cache_scope is service_role-only, not callable by authenticated'
);
RESET ROLE;

-- Test 6: an expense with an eligible v2 event is excluded from backfill (not double-counted).
INSERT INTO public.expenses (id, shop_id, amount_usd, expense_date)
  VALUES ('e1111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 7.00, '2026-11-01');
INSERT INTO public.events (id, shop_id, type, payload, payload_version, occurred_at, staff_id)
VALUES ('c6666666-6666-6666-6666-666666666666', '22222222-2222-2222-2222-222222222222', 'expense.recorded',
  '{"expenseId":"e1111111-1111-1111-1111-111111111111","amountUsd":7.00}'::jsonb,
  2, '2026-11-01T09:00:00Z', '11111111-1111-1111-1111-111111111111');
UPDATE public.events SET event_projection_day = '2026-11-01' WHERE id = 'c6666666-6666-6666-6666-666666666666';

SET LOCAL ROLE service_role;
SELECT public.rebuild_profit_cache_scope('22222222-2222-2222-2222-222222222222');
RESET ROLE;
SELECT is(
  (SELECT expenses_usd FROM public.profit_cache WHERE shop_id = '22222222-2222-2222-2222-222222222222' AND day = '2026-11-01'),
  700::bigint, 'an expense with an eligible v2 event is applied exactly once (event-derived, not also backfilled)'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the tests**

Run: `npx supabase test db`
Expected: all 6 assertions PASS (adjust `plan(6)` if the final count differs once written).

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/wafi153_profit_cache_rebuild.test.sql
git commit -m "test(WAFI-153): pgTAP coverage for backfill eligibility, full rematerialization, cross-day rebuild safety"
```

---

### Task 13: Old-vs-new financial parity test (Vitest, mandatory pre-cutover safety net)

**Files:**
- Create: `src/features/dashboard/composables/__tests__/profitCacheParity.test.ts`

**Interfaces:**
- Consumes: `useDashboardMetrics()` (existing), `useProfitCache()` (Task 8), a local test harness that seeds `sales`/`sale_line_items`/`returns`/`return_line_items`/`expenses` AND applies the equivalent events through `_apply_profit_cache` (via a test Supabase/pg connection, or a local mock of `profit_cache` rows computed the same way — use whatever this repo's existing integration-test harness for Postgres-backed composables already does; check `src/features/dashboard/composables/useDashboardMetrics.test.ts` for the existing fixture-seeding pattern first and reuse it).

- [ ] **Step 1: Write the parity test**

```ts
// src/features/dashboard/composables/__tests__/profitCacheParity.test.ts
import { describe, it, expect } from 'vitest'
import { useDashboardMetrics } from '../useDashboardMetrics'
import { useProfitCache } from '../useProfitCache'
// Import whatever this repo's existing fixture-seeding helpers are for
// sales/sale_line_items/returns/return_line_items/expenses -- reuse
// useDashboardMetrics.test.ts's exact seeding functions rather than
// reimplementing them, so both paths are proven against literally the same rows.

describe('useDashboardMetrics vs useProfitCache — old-vs-new financial parity', () => {
  const scenarios = [
    'same-day return',
    'cross-day return',
    'multiple sales in one day',
    'multiple distinct products on one sale',
    'duplicate product across two lines of one sale',
    'a costless sale later fully returned',
    'a costless sale only partially returned',
    'an expense',
    'a discount',
    'a zero-value sale',
  ]

  it.each(scenarios)('matches exactly for: %s', async (scenario) => {
    // Seed the scenario's sales/sale_line_items/returns/return_line_items/expenses rows
    // AND the equivalent sale.completed/sale.returned/expense.recorded events
    // (payload_version 2, with cogsUsd/discountUsd/hasCostlessLine/cogsReversalUsd/
    // isFullReturn/saleWasCostless/originalSaleProjectionDay computed the same way
    // Task 3/4 compute them at write time), per this scenario's fixture — see the
    // scenario-specific fixture builders to add below.
    // await seedScenario(scenario)
    // await applyEventsToProfitCache(scenario) // runs _apply_profit_cache for each seeded event

    const old = useDashboardMetrics()
    await old.loadRange('2026-01-01', '2026-12-31')

    const next = useProfitCache()
    await next.loadRange('2026-01-01', '2026-12-31')

    expect(next.metrics.value.revenueUsd - next.metrics.value.refundsUsd).toBeCloseTo(old.revenueUsd.value, 2)
    expect(next.metrics.value.cogsUsd - next.metrics.value.cogsReversalUsd).toBeCloseTo(old.cogsUsd.value, 2)
    expect(next.metrics.value.expensesUsd).toBeCloseTo(old.expensesUsd.value, 2)
    expect(next.metrics.value.profitUsd).toBeCloseTo(old.profitUsd.value, 2)
    expect(next.metrics.value.invoiceCount).toBe(old.invoiceCount.value)
    expect(next.metrics.value.returnCount).toBe(old.returnCount.value)
    // costlessSaleCount parity: old composable's costlessSalesInPeriod already
    // excludes fully-returned sales (WAFI-054) -- profit_cache's cross-day
    // decrement is what closes that same gap, per the design spec. Both must agree.
  })
})
```

**Note on this task's completeness:** the `seedScenario`/`applyEventsToProfitCache` helpers above are deliberately left as call sites, not fully written out here, because they depend on this repo's actual existing fixture-seeding infrastructure for `useDashboardMetrics.test.ts` (not yet read in full during this plan's research pass). Before running this task, the implementing engineer must: (1) open `src/features/dashboard/composables/useDashboardMetrics.test.ts` (or wherever its tests live), (2) reuse its exact seeding helpers for `sales`/`sale_line_items`/`returns`/`return_line_items`/`expenses`, (3) write one fixture-builder function per scenario in the list above that also inserts the matching `events` rows at `payload_version = 2` with every new field populated per Tasks 3/4's formulas, and (4) either call a real `_apply_profit_cache` against a test Postgres instance per event, or (if this repo's test suite is Vitest-only with no live Postgres in CI) mock `db.getAll` for `useProfitCache` to return rows computed by applying the same arithmetic Task 1's SQL performs, in TypeScript, from the seeded fixture — matching whatever integration-test strategy `useDashboardMetrics.test.ts` itself already uses (SQLite in-memory vs mocked `db`).

- [ ] **Step 2: Run test to verify it fails initially, then passes after wiring the seed helpers**

Run: `npx vitest run src/features/dashboard/composables/__tests__/profitCacheParity.test.ts`
Expected: FAIL until the seed helpers (Step 1's note) are wired against this repo's actual fixture infrastructure; PASS once wired, for every scenario in the list.

- [ ] **Step 3: Commit**

```bash
git add src/features/dashboard/composables/__tests__/profitCacheParity.test.ts
git commit -m "test(WAFI-153): old-vs-new financial parity test across 10 scenarios, the primary migration safety net"
```

---

### Task 14: Rebuild CLI wiring

**Files:**
- Modify: `scripts/projections/rebuild.ts`
- Modify: `scripts/projections/__tests__/rebuild.test.ts`

**Interfaces:**
- Consumes: `public.rebuild_profit_cache_scope` (Task 2).
- Produces: `npm run projections:rebuild -- profit_cache --shop <id>` (no `--from`/`--to` — full-scope-only, unlike `daily_event_counts`).

- [ ] **Step 1: Write the failing test**

Add to `scripts/projections/__tests__/rebuild.test.ts` (read the file first to match its existing fake-injection pattern for `deps.rebuildScope`):

```ts
it('calls rebuild_profit_cache_scope with only p_shop_id for the profit_cache projection', async () => {
  const rebuildScope = vi.fn().mockResolvedValue(undefined)
  await runRebuild(['profit_cache', '--shop', 'shop-1'], { rebuildScope })
  expect(rebuildScope).toHaveBeenCalledWith('rebuild_profit_cache_scope', { p_shop_id: 'shop-1' })
})

it('rejects --from/--to for the profit_cache projection (full-scope-only)', async () => {
  await expect(runRebuild(['profit_cache', '--shop', 'shop-1', '--from', '2026-01-01', '--to', '2026-01-31'], {}))
    .rejects.toThrow(/profit_cache.*does not support --from\/--to/i)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/projections/__tests__/rebuild.test.ts`
Expected: FAIL — `profit_cache` not in `KNOWN_PROJECTIONS`, `--from`/`--to` rejection doesn't exist.

- [ ] **Step 3: Update `rebuild.ts`**

In `scripts/projections/rebuild.ts`:
- Widen `KNOWN_PROJECTIONS` (line 16) from `['daily_event_counts'] as const` to `['daily_event_counts', 'profit_cache'] as const`, and widen the `projection` field's type in `ScopedRebuildArgs`/`AllRebuildArgs`/`ParsedArgs` (lines 4, 11) to the resulting union.
- In `parseArgs` (lines 18-55), after parsing `--from`/`--to`, add a check: if `projection === 'profit_cache'` and either `from` or `to` is set, throw `new Error('profit_cache does not support --from/--to: rebuild is always full-shop-scope')`.
- In the RPC dispatch inside `deps.rebuildScope` (line 113), branch on `args.projection`: `daily_event_counts` calls `rebuild_daily_event_counts_scope` with `{ p_shop_id, p_from, p_to }` as today; `profit_cache` calls `rebuild_profit_cache_scope` with `{ p_shop_id: shopId }` only.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/projections/__tests__/rebuild.test.ts`
Expected: PASS, including pre-existing `daily_event_counts` cases (no regression).

- [ ] **Step 5: Commit**

```bash
git add scripts/projections/rebuild.ts scripts/projections/__tests__/rebuild.test.ts
git commit -m "feat(WAFI-153): wire profit_cache into the projections:rebuild CLI (full-scope-only, no --from/--to)"
```

---

## Explicitly out of scope for this plan (per the design spec)

- Retrofitting `sales`/`expenses`/etc. tables from float to integer minor units.
- Building the operational rollout sequence itself (running `rebuild_profit_cache_scope` on a cadence, shadow-mode flag wiring, deleting `useDashboardMetrics.ts`) — these are production-data-dependent operational steps, not implementation tasks; this plan builds every mechanism the rollout sequence needs, but does not execute the rollout.
- The `events` table publication/sync-rule exact file (Task 7 requires locating and confirming this at implementation time — it was not pinned down during research).
- Admin UI or customer-facing rebuild trigger.
