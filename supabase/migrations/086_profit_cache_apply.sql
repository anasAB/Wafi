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
