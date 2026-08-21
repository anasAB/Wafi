-- supabase/migrations/113_wafi148_health_projections_wiring.sql
-- WAFI-148 follow-up: wires _apply_health_drawer_mismatch and
-- _apply_health_never_closed_shift (migrations 109/110) to actually run when a
-- shift.closed event lands, and closes the missing-idempotency-ledger gap
-- flagged in the final whole-branch review.
--
-- Trigger, not the client-round-trip pattern daily_event_counts/profit_cache
-- use: both projections read entirely from data that already exists
-- server-side (the events table itself) and need nothing from any client, so
-- a plain AFTER INSERT trigger on public.events is simpler and more robust
-- here -- it requires no device to ever be online to witness the event, no
-- local marker table, and no ops.ts upload-routing special case. This is a
-- deliberate divergence from the client-round-trip precedent, not an
-- oversight: that pattern exists for projections whose local marker sync IS
-- the mechanism, which does not apply to these two.
--
-- Both apply functions now run inside the SAME transaction as the triggering
-- event insert (per Postgres trigger semantics) -- if either projection
-- fails, the whole insert rolls back, so the event table and both
-- projections can never diverge.

-- Idempotency ledger: reuses the existing shared projection_processed_events
-- table (migration 083), same idiom as _apply_daily_event_count (084) --
-- claim (projection_name, event_id) before the additive upsert; a duplicate
-- claim (unique_violation on the composite PK) means this event was already
-- applied, so return without re-incrementing.
CREATE OR REPLACE FUNCTION public._apply_health_drawer_mismatch(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event   public.events%ROWTYPE;
  v_variance numeric;
  v_period  date;
  v_timezone text;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND OR v_event.type != 'shift.closed' THEN
    RETURN;
  END IF;

  v_variance := (v_event.payload::jsonb ->> 'variance')::numeric;
  IF v_variance IS NULL OR abs(v_variance) <= 15 THEN
    RETURN;
  END IF;

  SELECT timezone INTO v_timezone FROM public.shops WHERE id = v_event.shop_id;
  IF v_timezone IS NULL THEN
    RETURN; -- no timezone configured yet; metric doesn't compute for this shop
  END IF;

  BEGIN
    INSERT INTO public.projection_processed_events (projection_name, event_id)
    VALUES ('drawer_mismatch_count', p_event_id);
  EXCEPTION WHEN unique_violation THEN
    RETURN;
  END;

  v_period := (v_event.occurred_at AT TIME ZONE v_timezone)::date;

  INSERT INTO public.health_metrics (shop_id, device_id, metric_key, period_start, value, updated_at)
  VALUES (v_event.shop_id, '00000000-0000-0000-0000-000000000000', 'drawer_mismatch_count', v_period, 1, now())
  ON CONFLICT (shop_id, device_id, metric_key, period_start)
  DO UPDATE SET value = public.health_metrics.value + 1, updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public._apply_health_never_closed_shift(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event    public.events%ROWTYPE;
  v_period   date;
  v_timezone text;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND OR v_event.type != 'shift.closed' THEN
    RETURN;
  END IF;

  IF v_event.payload::jsonb ->> 'forceClosedBy' IS NULL THEN
    RETURN; -- a normal close, not a zombie force-close
  END IF;

  SELECT timezone INTO v_timezone FROM public.shops WHERE id = v_event.shop_id;
  IF v_timezone IS NULL THEN
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.projection_processed_events (projection_name, event_id)
    VALUES ('never_closed_shift_count', p_event_id);
  EXCEPTION WHEN unique_violation THEN
    RETURN;
  END;

  v_period := (v_event.occurred_at AT TIME ZONE v_timezone)::date;

  INSERT INTO public.health_metrics (shop_id, device_id, metric_key, period_start, value, updated_at)
  VALUES (v_event.shop_id, '00000000-0000-0000-0000-000000000000', 'never_closed_shift_count', v_period, 1, now())
  ON CONFLICT (shop_id, device_id, metric_key, period_start)
  DO UPDATE SET value = public.health_metrics.value + 1, updated_at = now();
END;
$$;

-- Rebuild functions must clear BOTH the projection and the ledger -- clearing
-- only health_metrics would leave the ledger claiming every historical event
-- was "already processed," so the replay below would silently apply nothing.
CREATE OR REPLACE FUNCTION public._rebuild_health_drawer_mismatch()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.health_metrics WHERE metric_key = 'drawer_mismatch_count';
  DELETE FROM public.projection_processed_events WHERE projection_name = 'drawer_mismatch_count';

  PERFORM public._apply_health_drawer_mismatch(id)
    FROM public.events
   WHERE type = 'shift.closed'
   ORDER BY occurred_at ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public._rebuild_health_never_closed_shift()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.health_metrics WHERE metric_key = 'never_closed_shift_count';
  DELETE FROM public.projection_processed_events WHERE projection_name = 'never_closed_shift_count';

  PERFORM public._apply_health_never_closed_shift(id)
    FROM public.events
   WHERE type = 'shift.closed'
   ORDER BY occurred_at ASC;
END;
$$;

-- The dispatch trigger. WHEN (NEW.type = 'shift.closed') filters at the
-- trigger-invocation level (not inside the function body), so the function
-- itself never runs for any other event type and can assume its precondition.
CREATE OR REPLACE FUNCTION public._dispatch_health_projections_on_shift_closed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public._apply_health_drawer_mismatch(NEW.id);
  PERFORM public._apply_health_never_closed_shift(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS health_projections_on_shift_closed ON public.events;
CREATE TRIGGER health_projections_on_shift_closed
  AFTER INSERT ON public.events
  FOR EACH ROW
  WHEN (NEW.type = 'shift.closed')
  EXECUTE FUNCTION public._dispatch_health_projections_on_shift_closed();

REVOKE ALL ON FUNCTION public._dispatch_health_projections_on_shift_closed() FROM PUBLIC, anon, authenticated;
