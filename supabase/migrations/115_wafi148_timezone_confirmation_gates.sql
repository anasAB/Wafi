-- supabase/migrations/115_wafi148_timezone_confirmation_gates.sql
-- WAFI-148 follow-up, continues migration 114: replaces every
-- `timezone IS NULL` gate (dead code -- the column is NOT NULL) with the real
-- readiness predicate, timezone_confirmed_at IS NOT NULL. Also switches the
-- two event-sourced projections to read events.event_projection_day (the
-- immutable, write-time day bucket already computed by the existing
-- events_set_projection_day trigger, migration 084) instead of recomputing
-- `occurred_at AT TIME ZONE current-shops.timezone` themselves -- this is
-- what makes a later timezone change unable to retroactively reshuffle
-- historical drawer-mismatch/never-closed-shift periods, with no new
-- mechanism needed. Adds confirm_shop_timezone(), the RPC bootstrap and
-- Shop Settings both call to actually set the confirmation.

-- report_health_metrics: gate on confirmation, not the (always-true) NOT NULL
-- timezone column.
CREATE OR REPLACE FUNCTION public.report_health_metrics(
  p_device_id uuid,
  p_counters  jsonb,
  p_gauges    jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shop_id      uuid;
  v_timezone     text;
  v_confirmed_at timestamptz;
  v_today        date;
  v_window_start date;
  v_counter      jsonb;
  v_gauge        jsonb;
  v_metric_key   text;
  v_period       date;
  v_value        bigint;
  v_accepted_counters jsonb := '[]'::jsonb;
  v_accepted_gauges   jsonb := '[]'::jsonb;
BEGIN
  v_shop_id := public.auth_shop_id();
  IF v_shop_id IS NULL THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.devices WHERE id = p_device_id AND shop_id = v_shop_id AND is_active IS NOT FALSE
  ) THEN
    RAISE EXCEPTION 'device does not belong to the authenticated shop' USING ERRCODE = 'P0001';
  END IF;

  SELECT timezone, timezone_confirmed_at INTO v_timezone, v_confirmed_at
    FROM public.shops WHERE id = v_shop_id;
  IF v_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'shop timezone is not configured' USING ERRCODE = 'P0001';
  END IF;

  v_today := (now() AT TIME ZONE v_timezone)::date;
  v_window_start := v_today - INTERVAL '6 days';

  FOR v_counter IN SELECT * FROM jsonb_array_elements(p_counters)
  LOOP
    v_metric_key := v_counter ->> 'metric_key';
    v_period     := (v_counter ->> 'period_start')::date;
    v_value      := (v_counter ->> 'value')::bigint;

    IF v_metric_key NOT IN (
      'sync_failure_terminal', 'sync_terminal_total', 'offline_duration_seconds',
      'deferred_job_failure_terminal', 'deferred_job_terminal_total',
      'app_error_count', 'active_device_day', 'telemetry_periods_dropped'
    ) THEN
      RAISE EXCEPTION 'unknown or unwritable metric_key: %', v_metric_key USING ERRCODE = 'P0001';
    END IF;

    IF v_period < v_window_start OR v_period > v_today THEN
      RAISE EXCEPTION 'period_start outside the allowed reporting window' USING ERRCODE = 'P0001';
    END IF;

    IF v_value < 0 THEN
      RAISE EXCEPTION 'value must be non-negative' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.health_metrics (shop_id, device_id, metric_key, period_start, value, updated_at)
    VALUES (v_shop_id, p_device_id, v_metric_key, v_period, v_value, now())
    ON CONFLICT (shop_id, device_id, metric_key, period_start)
    DO UPDATE SET value = GREATEST(public.health_metrics.value, EXCLUDED.value),
                  updated_at = now();

    v_accepted_counters := v_accepted_counters ||
      jsonb_build_object('metric_key', v_metric_key, 'period_start', v_period);
  END LOOP;

  FOR v_gauge IN SELECT * FROM jsonb_array_elements(p_gauges)
  LOOP
    IF (v_gauge ->> 'gauge_key') != 'dead_letter_count' THEN
      RAISE EXCEPTION 'unknown or unwritable gauge_key: %', (v_gauge ->> 'gauge_key') USING ERRCODE = 'P0001';
    END IF;
    IF (v_gauge ->> 'value')::bigint < 0 THEN
      RAISE EXCEPTION 'value must be non-negative' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.health_gauges (shop_id, device_id, gauge_key, value, observed_at)
    VALUES (v_shop_id, p_device_id, v_gauge ->> 'gauge_key',
            (v_gauge ->> 'value')::bigint, (v_gauge ->> 'observed_at')::timestamptz)
    ON CONFLICT (shop_id, device_id, gauge_key)
    DO UPDATE SET value = EXCLUDED.value, observed_at = EXCLUDED.observed_at;

    v_accepted_gauges := v_accepted_gauges ||
      jsonb_build_object('gauge_key', v_gauge ->> 'gauge_key', 'period_start', NULL);
  END LOOP;

  UPDATE public.devices SET last_seen_at = now() WHERE id = p_device_id AND shop_id = v_shop_id;

  RETURN jsonb_build_object(
    'accepted_counters', v_accepted_counters,
    'accepted_gauges', v_accepted_gauges
  );
END;
$$;

-- Drawer mismatch: gate on confirmation; use event_projection_day directly
-- instead of recomputing from occurred_at + current shop timezone.
CREATE OR REPLACE FUNCTION public._apply_health_drawer_mismatch(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event        public.events%ROWTYPE;
  v_variance     numeric;
  v_confirmed_at timestamptz;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND OR v_event.type != 'shift.closed' THEN
    RETURN;
  END IF;

  v_variance := (v_event.payload::jsonb ->> 'variance')::numeric;
  IF v_variance IS NULL OR abs(v_variance) <= 15 THEN
    RETURN;
  END IF;

  SELECT timezone_confirmed_at INTO v_confirmed_at FROM public.shops WHERE id = v_event.shop_id;
  IF v_confirmed_at IS NULL THEN
    RETURN; -- timezone not yet confirmed; metric doesn't compute for this shop
  END IF;

  BEGIN
    INSERT INTO public.projection_processed_events (projection_name, event_id)
    VALUES ('drawer_mismatch_count', p_event_id);
  EXCEPTION WHEN unique_violation THEN
    RETURN;
  END;

  -- event_projection_day is the immutable, write-time day bucket (migration
  -- 084's events_set_projection_day trigger) -- never recomputed here from
  -- occurred_at + the CURRENT shop timezone, so a later timezone change can
  -- never retroactively reshuffle this event's historical period.
  INSERT INTO public.health_metrics (shop_id, device_id, metric_key, period_start, value, updated_at)
  VALUES (v_event.shop_id, '00000000-0000-0000-0000-000000000000', 'drawer_mismatch_count',
          v_event.event_projection_day, 1, now())
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
  v_event        public.events%ROWTYPE;
  v_confirmed_at timestamptz;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND OR v_event.type != 'shift.closed' THEN
    RETURN;
  END IF;

  IF v_event.payload::jsonb ->> 'forceClosedBy' IS NULL THEN
    RETURN; -- a normal close, not a zombie force-close
  END IF;

  SELECT timezone_confirmed_at INTO v_confirmed_at FROM public.shops WHERE id = v_event.shop_id;
  IF v_confirmed_at IS NULL THEN
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.projection_processed_events (projection_name, event_id)
    VALUES ('never_closed_shift_count', p_event_id);
  EXCEPTION WHEN unique_violation THEN
    RETURN;
  END;

  INSERT INTO public.health_metrics (shop_id, device_id, metric_key, period_start, value, updated_at)
  VALUES (v_event.shop_id, '00000000-0000-0000-0000-000000000000', 'never_closed_shift_count',
          v_event.event_projection_day, 1, now())
  ON CONFLICT (shop_id, device_id, metric_key, period_start)
  DO UPDATE SET value = public.health_metrics.value + 1, updated_at = now();
END;
$$;

-- Rebuild functions: unchanged in shape (still clear + replay), but now
-- inherit event_projection_day-based bucketing through the apply functions
-- above -- no separate timezone parameter needed here at all.
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
   ORDER BY sequence ASC;
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
   ORDER BY sequence ASC;
END;
$$;

-- Owner/Settings-facing RPC: the sole write path for shops.timezone +
-- timezone_confirmed_at. Mirrors update_business_rule's exact authorization
-- shape (095_wafi156_update_business_rule.sql): auth_shop_id() derives the
-- caller's OWN shop (never a client-supplied shop_id, so a client cannot
-- target another shop), auth_role() = 'owner' gate checked in the function
-- body itself (not merely a UI route), matching the same "don't trust a
-- stale/tampered active_role claim beyond what the JWT asserts" rationale.
-- Rejects anything that isn't a real IANA zone name (pg_timezone_names is
-- Postgres's own canonical list) -- 'UTC+2', 'CET', or a typo'd zone are all
-- rejected the same way; 'UTC' itself IS a valid, acceptable choice, since
-- the point is requiring explicit confirmation, not disallowing UTC.
CREATE OR REPLACE FUNCTION public.confirm_shop_timezone(p_timezone text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shop_id uuid;
BEGIN
  v_shop_id := public.auth_shop_id();
  IF v_shop_id IS NULL THEN
    RETURN 'forbidden';
  END IF;

  IF public.auth_role() != 'owner' THEN
    RETURN 'forbidden';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_timezone) THEN
    RETURN 'invalid_timezone';
  END IF;

  UPDATE public.shops
     SET timezone = p_timezone,
         timezone_confirmed_at = now()
   WHERE id = v_shop_id;

  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_shop_timezone(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_shop_timezone(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.confirm_shop_timezone(text) TO authenticated;
