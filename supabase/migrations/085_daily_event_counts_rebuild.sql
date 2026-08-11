-- supabase/migrations/085_daily_event_counts_rebuild.sql

-- WAFI-151 Plan 2: the actual rebuild primitive. One Postgres function per
-- scope, invoked once by the CLI -- never a client-side loop of per-event
-- RPC calls (each of those would commit independently and cannot provide
-- the all-or-nothing rollback this needs).
CREATE OR REPLACE FUNCTION public.rebuild_daily_event_counts_scope(
  p_shop_id uuid,
  p_from date,
  p_to date
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows_deleted integer;
  v_events_replayed integer := 0;
  v_event_id uuid;
BEGIN
  -- Same lock (and same bounded 5s timeout, matching Task 1's update to
  -- apply_daily_event_count) incremental apply already takes -- a rebuild
  -- and an incremental write for this shop's daily_event_counts can never
  -- interleave, and neither this function nor the incremental path blocks
  -- indefinitely if the other is holding it.
  SET LOCAL lock_timeout = '5s';
  PERFORM pg_advisory_xact_lock(hashtext('daily_event_counts' || p_shop_id::text));

  DELETE FROM public.daily_event_counts
  WHERE shop_id = p_shop_id
    AND day BETWEEN p_from AND p_to;
  GET DIAGNOSTICS v_rows_deleted = ROW_COUNT;

  -- Reconcile the ledger for this scope too -- otherwise replayed events are
  -- rejected by _apply_daily_event_count as "already applied" and the
  -- rebuild silently no-ops.
  DELETE FROM public.projection_processed_events pe
  WHERE pe.projection_name = 'daily_event_counts'
    AND pe.event_id IN (
      SELECT id FROM public.events
      WHERE shop_id = p_shop_id AND event_projection_day BETWEEN p_from AND p_to
    );

  FOR v_event_id IN
    SELECT id FROM public.events
    WHERE shop_id = p_shop_id
      AND event_projection_day BETWEEN p_from AND p_to
    ORDER BY sequence ASC
  LOOP
    PERFORM public._apply_daily_event_count(v_event_id);
    v_events_replayed := v_events_replayed + 1;
  END LOOP;

  -- Validation: no negative counts, no row outside the requested scope, one
  -- row per (shop, day, event_type) -- the UNIQUE constraint already
  -- guarantees the last one, but check the others explicitly. Any failure
  -- here raises, which rolls back the whole function (implicit -- a
  -- function body is one transaction), leaving prior state fully intact.
  IF EXISTS (
    SELECT 1 FROM public.daily_event_counts
    WHERE shop_id = p_shop_id AND day BETWEEN p_from AND p_to AND count < 0
  ) THEN
    RAISE EXCEPTION 'rebuild_daily_event_counts_scope: negative count produced for shop %, range % to %', p_shop_id, p_from, p_to;
  END IF;

  RETURN jsonb_build_object('rows_deleted', v_rows_deleted, 'events_replayed', v_events_replayed);
END;
$$;

-- Engineer-invoked only (per design spec's Trigger Surface) -- granted so the
-- CLI can call it via supabase.rpc(), but there is no app-facing UI or code
-- path that calls this function; that boundary is enforced by not wiring it
-- into any client feature, not by withholding the grant (the caller still
-- needs to be an authenticated user with legitimate access to p_shop_id in
-- practice, but this function does not itself re-check that against
-- auth_shop_id() the way apply_daily_event_count does, since --all needs to
-- rebuild EVERY shop and an engineer's own account is not scoped to all of
-- them -- this is why it's a manually-invoked CLI operation, not something
-- ever called from the app).
GRANT EXECUTE ON FUNCTION public.rebuild_daily_event_counts_scope(uuid, date, date) TO service_role;
