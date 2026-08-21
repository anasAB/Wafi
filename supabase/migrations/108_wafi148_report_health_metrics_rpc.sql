-- WAFI-148: the single write path for client-derived health telemetry.
--
-- Security boundary (per the design spec):
--  - device_id/shop_id are verified against the authenticated session's
--    auth_shop_id(), never trusted from the payload beyond p_device_id itself
--    (which must belong to the caller's own shop).
--  - metric_key/gauge_key are an explicit allowlist (CHECK constraints on
--    the tables themselves, migration 107) -- a client payload can NEVER
--    reach a class-S key because those keys are only ever written by the
--    SECURITY DEFINER apply functions in migrations 109/110, which don't
--    go through this RPC at all.
--  - period_start must fall within [today - 6 days, today] in the shop's
--    own timezone -- mirrors the client's 7-day local retention window.
--  - last_seen_at is updated only after every check above passes.

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

  SELECT timezone INTO v_timezone FROM public.shops WHERE id = v_shop_id;
  IF v_timezone IS NULL THEN
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

  -- Side effect only after every check above has passed.
  UPDATE public.devices SET last_seen_at = now() WHERE id = p_device_id AND shop_id = v_shop_id;

  RETURN jsonb_build_object(
    'accepted_counters', v_accepted_counters,
    'accepted_gauges', v_accepted_gauges
  );
END;
$$;

REVOKE ALL ON FUNCTION public.report_health_metrics(uuid, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.report_health_metrics(uuid, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.report_health_metrics(uuid, jsonb, jsonb) TO authenticated;
