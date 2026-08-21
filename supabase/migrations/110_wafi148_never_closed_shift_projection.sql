-- supabase/migrations/110_wafi148_never_closed_shift_projection.sql
-- WAFI-148 metric 8: never-closed/zombie-shift count, server-authoritative,
-- event-sourced. Distinct from a merely-late close: only shift.closed events
-- carrying force_closed_by (WAFI-065's zombie force-close guard, migration
-- 025/026) count here.
--
-- events.type (not event_type) and events.payload is TEXT requiring an
-- explicit ::jsonb cast before ->> (migration 074_events_bus_core.sql; same
-- correction already applied in Task 4's migration 109).
--
-- The payload key is camelCase (`forceClosedBy`), matching ShiftClosedPayload
-- in src/services/events/domainEvent.types.ts and the event published by
-- src/services/staff.service.ts (WAFI-148 Task 5b) -- NOT snake_case.

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

  v_period := (v_event.occurred_at AT TIME ZONE v_timezone)::date;

  INSERT INTO public.health_metrics (shop_id, device_id, metric_key, period_start, value, updated_at)
  VALUES (v_event.shop_id, '00000000-0000-0000-0000-000000000000', 'never_closed_shift_count', v_period, 1, now())
  ON CONFLICT (shop_id, device_id, metric_key, period_start)
  DO UPDATE SET value = public.health_metrics.value + 1, updated_at = now();
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

  PERFORM public._apply_health_never_closed_shift(id)
    FROM public.events
   WHERE type = 'shift.closed'
   ORDER BY occurred_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public._apply_health_never_closed_shift(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._rebuild_health_never_closed_shift() FROM PUBLIC, anon, authenticated;
