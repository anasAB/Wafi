-- supabase/migrations/109_wafi148_drawer_mismatch_projection.sql
-- WAFI-148 metric 4: drawer mismatch count, server-authoritative, event-sourced.
-- Reuses the existing $15 threshold from WAFI-066/156's drawer_variance rule --
-- this projection does NOT redefine that threshold, it only counts occurrences.
-- device_id is a fixed sentinel (all-zeros) since this is a shop-level, not
-- per-device, metric.
--
-- NOTE ON DEVIATION FROM THE TASK BRIEF: the brief's SQL referenced
-- `public.events.event_type`, but the actual events table (migration
-- 074_events_bus_core.sql) has no such column -- the event-kind column is
-- named `type`. The brief's SQL also read `v_event.payload ->> 'variance'`
-- directly, but `payload` is a TEXT column (the client JSON.stringify's it
-- through a PowerSync TEXT column, per 074's comment), not JSONB -- so `->>`
-- requires an explicit `::jsonb` cast first, matching the established
-- precedent in 086_profit_cache_apply.sql (`v_event.payload::jsonb->>'cogsUsd'`).
-- Both are corrected below; the counting logic, threshold, and rebuildability
-- semantics are otherwise exactly as specified in the brief.

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

  v_period := (v_event.occurred_at AT TIME ZONE v_timezone)::date;

  INSERT INTO public.health_metrics (shop_id, device_id, metric_key, period_start, value, updated_at)
  VALUES (v_event.shop_id, '00000000-0000-0000-0000-000000000000', 'drawer_mismatch_count', v_period, 1, now())
  ON CONFLICT (shop_id, device_id, metric_key, period_start)
  DO UPDATE SET value = public.health_metrics.value + 1, updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public._rebuild_health_drawer_mismatch()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.health_metrics WHERE metric_key = 'drawer_mismatch_count';

  PERFORM public._apply_health_drawer_mismatch(id)
    FROM public.events
   WHERE type = 'shift.closed'
   ORDER BY occurred_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public._apply_health_drawer_mismatch(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._rebuild_health_drawer_mismatch() FROM PUBLIC, anon, authenticated;
