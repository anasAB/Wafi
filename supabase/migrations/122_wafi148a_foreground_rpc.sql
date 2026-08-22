-- supabase/migrations/122_wafi148a_foreground_rpc.sql
-- WAFI-148A Task 10: client-callable foreground evaluator RPC for metrics
-- #1 (sync failures), #2 (offline duration), #5 (deferred-job failures), and
-- #6 (app errors). These are Shape A (health_alert_state_a, period-bounded,
-- claim_health_alert_period, migration 118) -- unlike Shape B's stale_device
-- and overdue_shift, they are simple raw-count thresholds that never resolve
-- back to HEALTHY; a claimed period stays claimed for that day.
--
-- Alert semantics (design spec, explicit v1 simplification -- "threshold
-- attainment, not historical crossing", "day-cumulative semantics accepted"):
-- for each of the 4 metrics, independently:
--     SUM(health_metrics.value) WHERE shop_id=?, metric_key=?, period_start=?
--     >= notification_settings.threshold_json->>'threshold'
-- This is DELIBERATELY NOT the same computation as useOwnerHealth.ts (the
-- WAFI-148 dashboard), which computes failure-RATE (failures/total) for its
-- informational health signal, and divides app_error_count by
-- active_device_day. The dashboard's rate-based logic is a richer
-- informational computation; this RPC's threshold-on-the-raw-metric logic is
-- a deliberately simpler v1 alerting rule. They are not meant to agree and
-- must not be reconciled.
--
-- Storage-grain vs alert-grain: health_metrics is stored PER-DEVICE (real
-- device_id, PRIMARY KEY (shop_id, device_id, metric_key, period_start)),
-- but each of these 4 alert thresholds applies SHOP-WIDE. A plain
-- SUM(value) WHERE shop_id=?, metric_key=?, period_start=? -- with no
-- GROUP BY -- already collapses correctly across every device for that
-- fully-specified (shop_id, metric_key, period_start) key set; GROUP BY is
-- not needed because this function evaluates one shop (the caller's own,
-- via auth_shop_id()) at a time, not all shops in one scan the way the
-- pg_cron evaluators in migration 120 do.
--
-- Authorization: mirrors report_health_metrics (migration 108) exactly --
-- v_shop_id is derived from public.auth_shop_id(), NEVER accepted as a
-- parameter. This function takes NO shop_id argument at all; it evaluates
-- all 4 metrics for the calling session's own shop in a single call.
-- SECURITY DEFINER so it can read notification_settings/health_metrics
-- across RLS and write via claim_health_alert_period; GRANT EXECUTE TO
-- authenticated (this one IS a direct client entry point, unlike the
-- internal-only claim_* functions and the pg_cron-only _scheduled_check_*
-- functions).
--
-- Timezone gate: identical rule to WAFI-148 itself and every other evaluator
-- in this feature -- shops.timezone IS NULL means metrics don't compute for
-- that shop; this function returns early with no evaluation attempted and no
-- error raised (a shop mid-onboarding, before timezone confirmation, is not
-- a failure case).
--
-- Threshold source / skip semantics: Option A, same as every other
-- evaluator in this feature -- missing or disabled notification_settings row
-- for a given type -> skip that metric entirely, no claim attempt, no
-- warning (this is the expected/normal state for a type nobody has
-- configured yet). A present row with a missing/non-numeric/negative
-- threshold_json->>'threshold' -> skip that metric + RAISE WARNING (a
-- data problem worth surfacing), never invent a default. Zero IS an
-- accepted threshold for all 4 of these metrics (none carries metric #8's
-- "zero is invalid" rule) -- "alert on any occurrence at all" is a
-- legitimate owner choice here.
--
-- Failure isolation: each of the 4 metrics is evaluated inside its own
-- BEGIN...EXCEPTION WHEN OTHERS...END block (no explicit ROLLBACK -- invalid
-- inside a PL/pgSQL exception handler, a documented mistake from an earlier
-- design round of this feature), so one metric's unexpected failure can
-- never prevent the other 3 from being evaluated in the same call.
--
-- source_event_id: omitted/NULL for all 4 -- these metrics are
-- foreground-triggered aggregates, not derived from a single domain event.

CREATE OR REPLACE FUNCTION public.evaluate_health_alerts_foreground()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shop_id      uuid;
  v_timezone     text;
  v_period_start date;
  v_settings     public.notification_settings%ROWTYPE;
  v_threshold    numeric;
  v_sum          numeric;
BEGIN
  v_shop_id := public.auth_shop_id();
  IF v_shop_id IS NULL THEN
    RETURN;
  END IF;

  SELECT timezone INTO v_timezone FROM public.shops WHERE id = v_shop_id;
  IF v_timezone IS NULL THEN
    -- Same rule as WAFI-148 itself: metrics don't compute for a shop
    -- without a configured timezone. Not an error -- a normal state for a
    -- shop mid-onboarding.
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
              'انقطاع طويل عن الإنترنت',
              format('بلغت مدة عدم الاتصال بالإنترنت اليوم %s ثانية', v_sum),
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
  -- Metric #5: deferred-job failures
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
              'فشل في تنفيذ عملية مؤجلة',
              format('فشلت %s عملية مؤجلة نهائياً اليوم', v_sum),
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
  -- Metric #6: app errors. Deliberately NOT divided by active_device_day --
  -- the dashboard's rate computation is a different, richer signal; this
  -- alert is SUM(app_error_count) >= threshold, full stop.
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
              'أخطاء متكررة في التطبيق',
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
END;
$$;

REVOKE ALL ON FUNCTION public.evaluate_health_alerts_foreground() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.evaluate_health_alerts_foreground() FROM anon;
GRANT EXECUTE ON FUNCTION public.evaluate_health_alerts_foreground() TO authenticated;
