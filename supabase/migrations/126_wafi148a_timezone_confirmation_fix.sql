-- ============================================================================
-- WAFI-148A: fix stale timezone guard (Bug 1)
--
-- shops.timezone is NOT NULL DEFAULT 'UTC' (migration 084) -- it is NEVER
-- NULL. The dead `IF v_timezone IS NULL THEN RETURN; END IF;` guard in
-- _apply_health_alert_drawer_mismatch and evaluate_health_alerts_foreground
-- (both re-created most recently by migration 125) can never trigger.
--
-- The real, current gate (established by migration 115, which predates this
-- feature) is shops.timezone_confirmed_at IS NULL -- see migration 115's
-- version of _apply_health_drawer_mismatch, and src/features/health/
-- composables/useOwnerHealth.ts (~line 238-241).
--
-- This migration CREATE OR REPLACEs both functions off of their current
-- (migration 125) bodies:
--   * _apply_health_alert_drawer_mismatch: gate on timezone_confirmed_at,
--     and use v_event.event_projection_day directly instead of
--     recomputing the period bucket from v_timezone -- guaranteeing its
--     bucket matches whatever _apply_health_drawer_mismatch (migration 115)
--     actually wrote for the same event.
--   * evaluate_health_alerts_foreground: gate on timezone_confirmed_at,
--     but keep computing v_period_start from "now()" using the real
--     timezone value, since there is no historical event to derive a
--     projection day from -- this one legitimately evaluates "right now".
-- ============================================================================

CREATE OR REPLACE FUNCTION public._apply_health_alert_drawer_mismatch(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event      public.events%ROWTYPE;
  v_period     date;
  v_value      numeric;
  v_settings   public.notification_settings%ROWTYPE;
  v_threshold  numeric;
  v_started_at timestamptz;
  v_tz_confirmed_at timestamptz;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND OR v_event.type != 'shift.closed' THEN
    RETURN;
  END IF;

  v_started_at := clock_timestamp();

  -- WAFI-155 gate (migration 123): claim path only, checked before any
  -- other logic including the settings/threshold lookup below.
  IF NOT public._health_alerting_enabled(v_event.shop_id) THEN
    PERFORM public._log_health_alert_evaluation('event', v_event.shop_id, v_started_at);
    RETURN;
  END IF;

  -- WAFI-148 fix: shops.timezone is NEVER NULL (NOT NULL DEFAULT 'UTC'
  -- since migration 084). The real gate is timezone_confirmed_at IS NOT
  -- NULL (migration 115).
  SELECT timezone_confirmed_at INTO v_tz_confirmed_at FROM public.shops WHERE id = v_event.shop_id;
  IF v_tz_confirmed_at IS NULL THEN
    PERFORM public._log_health_alert_evaluation('event', v_event.shop_id, v_started_at);
    RETURN; -- timezone not yet confirmed; mirrors _apply_health_drawer_mismatch's guard
  END IF;

  -- WAFI-148 fix: use the immutable, write-time event_projection_day
  -- directly rather than recomputing from timezone, so this bucket is
  -- guaranteed to match whatever _apply_health_drawer_mismatch
  -- (migration 115) actually wrote for the same event.
  v_period := v_event.event_projection_day;

  SELECT * INTO v_settings
    FROM public.notification_settings
   WHERE shop_id = v_event.shop_id
     AND type = 'health_alert_drawer_mismatches';

  IF NOT FOUND OR NOT v_settings.enabled THEN
    PERFORM public._log_health_alert_evaluation('event', v_event.shop_id, v_started_at);
    RETURN;
  END IF;

  IF v_settings.threshold_json IS NULL THEN
    RAISE WARNING 'health_alert_drawer_mismatches: no threshold_json configured for shop %; skipping evaluation', v_event.shop_id;
    PERFORM public._log_health_alert_evaluation('event', v_event.shop_id, v_started_at);
    RETURN;
  END IF;

  BEGIN
    v_threshold := (v_settings.threshold_json ->> 'threshold')::numeric;
  EXCEPTION WHEN OTHERS THEN
    v_threshold := NULL;
  END;

  IF v_threshold IS NULL OR v_threshold < 0 THEN
    RAISE WARNING 'health_alert_drawer_mismatches: invalid threshold_json for shop %; skipping evaluation', v_event.shop_id;
    PERFORM public._log_health_alert_evaluation('event', v_event.shop_id, v_started_at);
    RETURN;
  END IF;

  SELECT value INTO v_value
    FROM public.health_metrics
   WHERE shop_id = v_event.shop_id
     AND device_id = '00000000-0000-0000-0000-000000000000'
     AND metric_key = 'drawer_mismatch_count'
     AND period_start = v_period;

  IF v_value IS NULL OR v_value < v_threshold THEN
    PERFORM public._log_health_alert_evaluation('event', v_event.shop_id, v_started_at);
    RETURN;
  END IF;

  PERFORM public.claim_health_alert_period(
    v_event.shop_id,
    'drawer_mismatch_count',
    v_period,
    v_threshold,
    'health_alert_drawer_mismatches',
    'حالات عدم تطابق في الدرج',
    format('تم رصد %s حالات عدم تطابق في الدرج اليوم', v_value),
    'WARNING',
    v_event.id
  );

  PERFORM public._log_health_alert_evaluation('event', v_event.shop_id, v_started_at);
END;
$$;

REVOKE ALL ON FUNCTION public._apply_health_alert_drawer_mismatch(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._apply_health_alert_drawer_mismatch(uuid) FROM anon;
REVOKE ALL ON FUNCTION public._apply_health_alert_drawer_mismatch(uuid) FROM authenticated;

-- ============================================================================
-- evaluate_health_alerts_foreground -- fix stale timezone guard only.
-- Still legitimately computes v_period_start from now() using the real
-- timezone value once confirmation is verified (no historical event to
-- derive a projection day from for this "evaluate right now" function).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.evaluate_health_alerts_foreground()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shop_id      uuid;
  v_timezone     text;
  v_tz_confirmed_at timestamptz;
  v_period_start date;
  v_settings     public.notification_settings%ROWTYPE;
  v_threshold    numeric;
  v_sum          numeric;
  v_started_at   timestamptz;
BEGIN
  v_shop_id := public.auth_shop_id();
  IF v_shop_id IS NULL THEN
    RETURN;
  END IF;

  v_started_at := clock_timestamp();

  -- WAFI-155 gate: this whole function only ever claims (Shape A has no
  -- resolve paths), so gating the entire body here is correct and simple.
  IF NOT public._health_alerting_enabled(v_shop_id) THEN
    PERFORM public._log_health_alert_evaluation('foreground', v_shop_id, v_started_at);
    RETURN;
  END IF;

  -- WAFI-148 fix: shops.timezone is NEVER NULL (NOT NULL DEFAULT 'UTC'
  -- since migration 084). The real gate is timezone_confirmed_at IS NOT
  -- NULL (migration 115).
  SELECT timezone, timezone_confirmed_at INTO v_timezone, v_tz_confirmed_at
    FROM public.shops WHERE id = v_shop_id;
  IF v_tz_confirmed_at IS NULL THEN
    PERFORM public._log_health_alert_evaluation('foreground', v_shop_id, v_started_at);
    RETURN;
  END IF;

  v_period_start := (now() AT TIME ZONE v_timezone)::date;

  -- ==========================================================================
  -- Metric #1: sync failures
  -- ==========================================================================
  BEGIN
    SELECT * INTO v_settings
      FROM public.notification_settings
     WHERE shop_id = v_shop_id AND type = 'health_alert_sync_failures';

    IF FOUND AND v_settings.enabled THEN
      IF v_settings.threshold_json IS NULL THEN
        RAISE WARNING 'health_alert_sync_failures: no threshold_json configured for shop %; skipping', v_shop_id;
      ELSE
        BEGIN
          v_threshold := (v_settings.threshold_json ->> 'threshold')::numeric;
        EXCEPTION WHEN OTHERS THEN
          v_threshold := NULL;
        END;

        IF v_threshold IS NULL OR v_threshold < 0 THEN
          RAISE WARNING 'health_alert_sync_failures: invalid threshold_json for shop %; skipping', v_shop_id;
        ELSE
          SELECT COALESCE(SUM(value), 0) INTO v_sum
            FROM public.health_metrics
           WHERE shop_id = v_shop_id
             AND metric_key = 'sync_failure_terminal'
             AND period_start = v_period_start;

          IF v_sum >= v_threshold THEN
            PERFORM public.claim_health_alert_period(
              v_shop_id, 'sync_failure_terminal', v_period_start, v_threshold,
              'health_alert_sync_failures',
              'فشل في المزامنة',
              format('تم رصد %s عملية مزامنة فاشلة نهائياً اليوم', v_sum),
              'WARNING'
            );
          END IF;
        END IF;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'evaluate_health_alerts_foreground: sync_failures failed for shop %: %', v_shop_id, SQLERRM;
  END;

  -- ==========================================================================
  -- Metric #2: offline duration
  -- ==========================================================================
  BEGIN
    SELECT * INTO v_settings
      FROM public.notification_settings
     WHERE shop_id = v_shop_id AND type = 'health_alert_offline_duration';

    IF FOUND AND v_settings.enabled THEN
      IF v_settings.threshold_json IS NULL THEN
        RAISE WARNING 'health_alert_offline_duration: no threshold_json configured for shop %; skipping', v_shop_id;
      ELSE
        BEGIN
          v_threshold := (v_settings.threshold_json ->> 'threshold')::numeric;
        EXCEPTION WHEN OTHERS THEN
          v_threshold := NULL;
        END;

        IF v_threshold IS NULL OR v_threshold < 0 THEN
          RAISE WARNING 'health_alert_offline_duration: invalid threshold_json for shop %; skipping', v_shop_id;
        ELSE
          SELECT COALESCE(SUM(value), 0) INTO v_sum
            FROM public.health_metrics
           WHERE shop_id = v_shop_id
             AND metric_key = 'offline_duration_seconds'
             AND period_start = v_period_start;

          IF v_sum >= v_threshold THEN
            PERFORM public.claim_health_alert_period(
              v_shop_id, 'offline_duration_seconds', v_period_start, v_threshold,
              'health_alert_offline_duration',
              'انقطاع الاتصال',
              format('كان الجهاز غير متصل لمدة %s دقيقة اليوم', v_sum),
              'WARNING'
            );
          END IF;
        END IF;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'evaluate_health_alerts_foreground: offline_duration failed for shop %: %', v_shop_id, SQLERRM;
  END;

  -- ==========================================================================
  -- Metric #5: deferred job failures
  -- ==========================================================================
  BEGIN
    SELECT * INTO v_settings
      FROM public.notification_settings
     WHERE shop_id = v_shop_id AND type = 'health_alert_deferred_job_failures';

    IF FOUND AND v_settings.enabled THEN
      IF v_settings.threshold_json IS NULL THEN
        RAISE WARNING 'health_alert_deferred_job_failures: no threshold_json configured for shop %; skipping', v_shop_id;
      ELSE
        BEGIN
          v_threshold := (v_settings.threshold_json ->> 'threshold')::numeric;
        EXCEPTION WHEN OTHERS THEN
          v_threshold := NULL;
        END;

        IF v_threshold IS NULL OR v_threshold < 0 THEN
          RAISE WARNING 'health_alert_deferred_job_failures: invalid threshold_json for shop %; skipping', v_shop_id;
        ELSE
          SELECT COALESCE(SUM(value), 0) INTO v_sum
            FROM public.health_metrics
           WHERE shop_id = v_shop_id
             AND metric_key = 'deferred_job_failure_terminal'
             AND period_start = v_period_start;

          IF v_sum >= v_threshold THEN
            PERFORM public.claim_health_alert_period(
              v_shop_id, 'deferred_job_failure_terminal', v_period_start, v_threshold,
              'health_alert_deferred_job_failures',
              'فشل في المهام المؤجلة',
              format('تم رصد %s مهمة مؤجلة فاشلة نهائياً اليوم', v_sum),
              'WARNING'
            );
          END IF;
        END IF;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'evaluate_health_alerts_foreground: deferred_job_failures failed for shop %: %', v_shop_id, SQLERRM;
  END;

  -- ==========================================================================
  -- Metric #6: app errors
  -- ==========================================================================
  BEGIN
    SELECT * INTO v_settings
      FROM public.notification_settings
     WHERE shop_id = v_shop_id AND type = 'health_alert_app_errors';

    IF FOUND AND v_settings.enabled THEN
      IF v_settings.threshold_json IS NULL THEN
        RAISE WARNING 'health_alert_app_errors: no threshold_json configured for shop %; skipping', v_shop_id;
      ELSE
        BEGIN
          v_threshold := (v_settings.threshold_json ->> 'threshold')::numeric;
        EXCEPTION WHEN OTHERS THEN
          v_threshold := NULL;
        END;

        IF v_threshold IS NULL OR v_threshold < 0 THEN
          RAISE WARNING 'health_alert_app_errors: invalid threshold_json for shop %; skipping', v_shop_id;
        ELSE
          SELECT COALESCE(SUM(value), 0) INTO v_sum
            FROM public.health_metrics
           WHERE shop_id = v_shop_id
             AND metric_key = 'app_error_count'
             AND period_start = v_period_start;

          IF v_sum >= v_threshold THEN
            PERFORM public.claim_health_alert_period(
              v_shop_id, 'app_error_count', v_period_start, v_threshold,
              'health_alert_app_errors',
              'أخطاء في التطبيق',
              format('تم رصد %s خطأ في التطبيق اليوم', v_sum),
              'WARNING'
            );
          END IF;
        END IF;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'evaluate_health_alerts_foreground: app_errors failed for shop %: %', v_shop_id, SQLERRM;
  END;

  PERFORM public._log_health_alert_evaluation('foreground', v_shop_id, v_started_at);
END;
$$;

REVOKE ALL ON FUNCTION public.evaluate_health_alerts_foreground() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.evaluate_health_alerts_foreground() FROM anon;
GRANT EXECUTE ON FUNCTION public.evaluate_health_alerts_foreground() TO authenticated;
