-- supabase/migrations/083_daily_event_counts_atomic_increment.sql

-- WAFI-151 Plan 1. Two distinct bugs fixed here:
--
-- 1) daily_event_counts was uploaded via PowerSync's generic upsert-by-row-id
--    path. Two devices for the same shop computing the same (shop_id, event_type,
--    day) independently mint different random ids, so the upsert's implicit
--    ON CONFLICT (id) never fires -- but the INSERT still violates the pre-existing
--    UNIQUE(shop_id, event_type, day) constraint, which Postgres enforces regardless
--    of the upsert's conflict target. That raises 23505, which ops.ts::isPermanentError
--    classifies as permanent, so connector.ts quarantines it into sync_dead_letter --
--    and retrying doesn't help, since the retried op still conflicts the same way.
--    Net effect: the second device's write is silently, permanently lost.
--
-- 2) Independently: even once a write lands, nothing stops two DIFFERENT devices
--    from each correctly, locally processing the same synced event and each
--    issuing their own increment -- the existing ledger (local_event_processed_ledger)
--    is per-device SQLite and cannot see across devices. Fixing (1) alone would
--    just mean writes land reliably AND double-count reliably.
--
-- Fix: route all mutation through a function that derives projection dimensions
-- from the authoritative event row (never trusts the client) and is idempotent
-- per (projection_name, event_id) via a new server-side ledger.

CREATE TABLE IF NOT EXISTS public.projection_processed_events (
  projection_name text NOT NULL,
  event_id        uuid NOT NULL REFERENCES public.events(id),
  processed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (projection_name, event_id)
);

ALTER TABLE public.projection_processed_events ENABLE ROW LEVEL SECURITY;
-- No client-facing policies: this table is only ever touched by SECURITY DEFINER
-- functions running as their own role, never queried directly by anon/authenticated.

-- Provenance column: lets ops.ts forward which event triggered a given local
-- mutation without the server ever trusting client-supplied projection dimensions.
-- Not used by any constraint or function logic below -- informational only.
ALTER TABLE public.daily_event_counts ADD COLUMN IF NOT EXISTS source_event_id uuid REFERENCES public.events(id);

-- Internal apply logic. NEVER granted to anon/authenticated -- reachable only via
-- the wrapper below, or directly by a future rebuild function (WAFI-151 Plan 2),
-- which will already hold the same advisory lock before calling this.
CREATE OR REPLACE FUNCTION public._apply_daily_event_count(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_event public.events;
  v_day date;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN
    -- Do NOT raise here. A nonexistent event is not necessarily a bug on this
    -- call's part -- the event may have been legitimately rejected upstream by
    -- the rate limiter (076_events_rate_limit.sql) or otherwise quarantined, in
    -- which case a dependent daily_event_counts op will forever reference an
    -- event that will never exist. P0002 is not in ops.ts::isPermanentError's
    -- permanent classes, so raising here would make connector.ts treat this as
    -- transient and re-queue the WHOLE upload batch (sales, payments, shift
    -- closes included) behind it forever. This projection is explicitly
    -- best-effort; silently dropping it is the correct failure mode, and
    -- Plan 2's reconciliation rebuild is the stated recovery path for anything
    -- this drops.
    RETURN;
  END IF;

  IF v_event.type <> 'sale.completed' THEN
    RETURN; -- not eligible for this projection; not an error, just a no-op
  END IF;

  -- WAFI-151 Plan 2 introduces events.event_projection_day for deterministic,
  -- timezone-stable day bucketing. Until that column exists, this matches the
  -- existing client behavior exactly (row.occurred_at.slice(0, 10) in
  -- dailyEventCountsProjection.ts) so this fix doesn't change day attribution --
  -- only correctness of the increment itself. Swap to event_projection_day when
  -- Plan 2's migration lands.
  v_day := (v_event.occurred_at AT TIME ZONE 'UTC')::date;

  BEGIN
    INSERT INTO public.projection_processed_events (projection_name, event_id)
    VALUES ('daily_event_counts', p_event_id);
  EXCEPTION WHEN unique_violation THEN
    RETURN; -- already applied by this or another device -- exactly-once, silent no-op on repeat
  END;

  INSERT INTO public.daily_event_counts (id, shop_id, event_type, day, count, source_event_id)
  VALUES (gen_random_uuid(), v_event.shop_id, v_event.type, v_day, 1, p_event_id)
  ON CONFLICT (shop_id, event_type, day)
  DO UPDATE SET count = public.daily_event_counts.count + 1;
END;
$$;

-- Postgres grants EXECUTE on every newly created function to PUBLIC by default;
-- explicitly revoke it here so the "no grant to anon/authenticated" comment
-- above actually holds -- without this, the implicit PUBLIC grant means any
-- authenticated/anon role could call this function directly, bypassing the
-- authorization + advisory-lock wrapper below.
REVOKE ALL ON FUNCTION public._apply_daily_event_count(uuid) FROM public;

-- Client-facing wrapper: the only entry point clients may call. Authorizes the
-- caller against the EVENT's actual shop (never a client-claimed shop_id), then
-- takes the same shop+projection advisory lock a future rebuild will hold, so an
-- incremental apply can never land mid-rebuild.
CREATE OR REPLACE FUNCTION public.apply_daily_event_count(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shop_id uuid;
BEGIN
  SELECT shop_id INTO v_shop_id FROM public.events WHERE id = p_event_id;
  IF v_shop_id IS NULL THEN
    -- Silently no-op, matching _apply_daily_event_count's own behavior for a
    -- nonexistent event (see comment there). This wrapper's job is authorizing
    -- the caller against the event's shop -- there is nothing to authorize (or
    -- protect by raising) against an event that does not exist, and raising
    -- here would surface the same unbounded sync-queue-jam risk (P0002 is not
    -- classified as permanent by ops.ts::isPermanentError).
    RETURN;
  END IF;
  IF v_shop_id IS DISTINCT FROM (SELECT public.auth_shop_id()) THEN
    RAISE EXCEPTION 'apply_daily_event_count: caller is not authorized for this event''s shop' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('daily_event_counts' || v_shop_id::text));
  PERFORM public._apply_daily_event_count(p_event_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_daily_event_count(uuid) TO anon, authenticated;
-- _apply_daily_event_count intentionally has EXECUTE explicitly revoked from
-- PUBLIC above -- not merely "not granted" -- so no role can call it directly.

-- Direct client writes are revoked, not just routed around in application code --
-- this is what makes apply_daily_event_count the ONLY mutation path, not merely
-- the recommended one. (SELECT stays granted; UPDATE/INSERT removed. DELETE was
-- never granted -- see 074_events_bus_core.sql. service_role intentionally keeps
-- its INSERT/UPDATE grant -- it is a server-only role, never reachable by client
-- code, so it is not part of the client mutation-path lockdown this migration
-- enforces.)
REVOKE INSERT, UPDATE ON TABLE public.daily_event_counts FROM anon, authenticated;

-- Migration 074 created these RLS policies (shop-scoped INSERT/UPDATE for
-- authenticated/anon) back when direct writes were still the mutation path.
-- The table-grant REVOKE above already makes them unreachable, but a dead
-- policy is a landmine: if some future migration re-grants INSERT/UPDATE on
-- this table (066_fill_missing_table_grants.sql shows this exact pattern
-- happening elsewhere in this repo), these stale policies would silently
-- reopen direct writes with no test catching it. Drop them outright so there
-- is nothing left to reopen.
DROP POLICY IF EXISTS daily_event_counts_insert_all ON public.daily_event_counts;
DROP POLICY IF EXISTS daily_event_counts_update_all ON public.daily_event_counts;
