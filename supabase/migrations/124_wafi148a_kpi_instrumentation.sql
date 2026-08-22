-- supabase/migrations/124_wafi148a_kpi_instrumentation.sql
-- WAFI-148A Task 14: Gate 3 KPI instrumentation -- "alert evaluation
-- freshness" for all 5 evaluators built so far (Tasks 4, 5, 7, 8, 10),
-- carrying forward migration 123's WAFI-155 feature-flag gating unchanged.
--
-- This is PURELY ADDITIVE instrumentation. It does not change any
-- evaluator's alerting behavior, claim logic, feature-flag gating, or test
-- outcomes -- it only adds one log row per function invocation. No existing
-- test in this feature should need to change because of this migration.
-- Every function body below is migration 123's body verbatim, plus the
-- logging calls.
--
-- Table: one row per evaluator INVOCATION (not per-metric, not
-- per-candidate/shop within a scheduled tick). Rationale per evaluator:
--   - _apply_health_alert_drawer_mismatch: one row per shift.closed event
--     dispatch (evaluation_source = 'event'), shop_id populated (single shop
--     per invocation). Logged even when the WAFI-155 flag is off, or config
--     is missing/disabled -- those are still "evaluation attempts" for
--     freshness purposes, same as every other skip case in this feature.
--   - _scheduled_check_overdue_shifts / _scheduled_check_dead_letter_count /
--     _scheduled_check_stale_devices: one row per pg_cron tick
--     (evaluation_source = 'scheduled'), shop_id NULL -- these functions
--     loop over many shops/candidates in one invocation, and the KPI is
--     about how often the evaluator itself runs, not how many rows it
--     touched. There is no single shop per invocation.
--   - evaluate_health_alerts_foreground: one row per RPC call
--     (evaluation_source = 'foreground'), shop_id populated (single calling
--     shop per invocation, via auth_shop_id()).
--
-- RLS: enabled, no policies -- nothing can read this table via the client
-- API yet (a future admin RPC could read it for an actual KPI dashboard,
-- out of scope for this task). Writes happen exclusively via the SECURITY
-- DEFINER evaluator functions themselves (through the
-- _log_health_alert_evaluation helper below), never via direct client
-- INSERT/UPDATE/DELETE.
CREATE TABLE IF NOT EXISTS public.health_alert_evaluation_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id           uuid REFERENCES public.shops(id),
  evaluation_source text NOT NULL CHECK (evaluation_source IN ('event','scheduled','foreground')),
  started_at        timestamptz NOT NULL,
  completed_at      timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_health_alert_evaluation_log_source_started
  ON public.health_alert_evaluation_log (evaluation_source, started_at);

CREATE INDEX IF NOT EXISTS idx_health_alert_evaluation_log_shop_started
  ON public.health_alert_evaluation_log (shop_id, started_at)
  WHERE shop_id IS NOT NULL;

ALTER TABLE public.health_alert_evaluation_log ENABLE ROW LEVEL SECURITY;
-- No policies yet, deliberately -- see header note. RLS with zero policies
-- denies all client API access without needing to be revisited/loosened
-- later; a future task simply ADDs a SELECT policy for an admin/KPI-
-- dashboard read path.

REVOKE ALL ON public.health_alert_evaluation_log FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- _log_health_alert_evaluation: shared helper, called by every evaluator
-- below at each of its exit points. One call = one row. Not a client entry
-- point -- only ever called from other SECURITY DEFINER evaluator functions.
-- ============================================================================
CREATE OR REPLACE FUNCTION public._log_health_alert_evaluation(
  p_evaluation_source text,
  p_shop_id           uuid,
  p_started_at        timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.health_alert_evaluation_log (shop_id, evaluation_source, started_at, completed_at)
  VALUES (p_shop_id, p_evaluation_source, p_started_at, now());
END;
$$;

REVOKE ALL ON FUNCTION public._log_health_alert_evaluation(text, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._log_health_alert_evaluation(text, uuid, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public._log_health_alert_evaluation(text, uuid, timestamptz) FROM authenticated;

-- ============================================================================
-- _apply_health_alert_drawer_mismatch (migration 119, WAFI-155-gated by
-- migration 123) -- evaluation_source = 'event'. v_started_at is captured
-- AFTER the absolute-precondition guard (event not found / not a
-- shift.closed event -- that guard means this invocation was never really
-- an "alert evaluation attempt" at all, so it is not logged). Every
-- subsequent exit point -- including the WAFI-155 flag-off case and every
-- config-skip case -- logs exactly one row.
-- ============================================================================
CREATE OR REPLACE FUNCTION public._apply_health_alert_drawer_mismatch(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event      public.events%ROWTYPE;
  v_timezone   text;
  v_period     date;
  v_value      numeric;
  v_settings   public.notification_settings%ROWTYPE;
  v_threshold  numeric;
  v_started_at timestamptz;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND OR v_event.type != 'shift.closed' THEN
    RETURN;
  END IF;

  v_started_at := now();

  -- WAFI-155 gate (migration 123): claim path only, checked before any
  -- other logic including the settings/threshold lookup below.
  IF NOT public._health_alerting_enabled(v_event.shop_id) THEN
    PERFORM public._log_health_alert_evaluation('event', v_event.shop_id, v_started_at);
    RETURN;
  END IF;

  SELECT timezone INTO v_timezone FROM public.shops WHERE id = v_event.shop_id;
  IF v_timezone IS NULL THEN
    PERFORM public._log_health_alert_evaluation('event', v_event.shop_id, v_started_at);
    RETURN; -- no timezone configured yet; mirrors _apply_health_drawer_mismatch's guard
  END IF;

  v_period := (v_event.occurred_at AT TIME ZONE v_timezone)::date;

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
-- _scheduled_check_overdue_shifts (migration 120, WAFI-155-gated by
-- migration 123) -- evaluation_source = 'scheduled', shop_id NULL. One log
-- row per cron tick (this function's single invocation), regardless of how
-- many shifts it examines or how many are flag-gated/skip-config.
-- ============================================================================
CREATE OR REPLACE FUNCTION public._scheduled_check_overdue_shifts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shift         record;
  v_settings      public.notification_settings%ROWTYPE;
  v_threshold_hrs numeric;
  v_started_at    timestamptz := now();
BEGIN
  FOR v_shift IN
    SELECT id, shop_id, opened_at
      FROM public.cashier_shifts
     WHERE status = 'open'
  LOOP
    BEGIN
      -- WAFI-155 gate: claim-only function, checked before any other logic.
      IF NOT public._health_alerting_enabled(v_shift.shop_id) THEN
        CONTINUE;
      END IF;

      SELECT * INTO v_settings
        FROM public.notification_settings
       WHERE shop_id = v_shift.shop_id
         AND type = 'health_alert_overdue_shift';

      IF NOT FOUND OR NOT v_settings.enabled THEN
        CONTINUE;
      END IF;

      IF v_settings.threshold_json IS NULL THEN
        RAISE WARNING 'health_alert_overdue_shift: no threshold_json configured for shop %; skipping shift %', v_shift.shop_id, v_shift.id;
        CONTINUE;
      END IF;

      BEGIN
        v_threshold_hrs := (v_settings.threshold_json ->> 'threshold')::numeric;
      EXCEPTION WHEN OTHERS THEN
        v_threshold_hrs := NULL;
      END;

      IF v_threshold_hrs IS NULL OR v_threshold_hrs <= 0 THEN
        RAISE WARNING 'health_alert_overdue_shift: invalid threshold_json for shop %; skipping shift %', v_shift.shop_id, v_shift.id;
        CONTINUE;
      END IF;

      IF now() - v_shift.opened_at >= (v_threshold_hrs || ' hours')::interval THEN
        PERFORM public.claim_health_alert_transition(
          v_shift.shop_id,
          'overdue_shift',
          v_shift.id,
          'health_alert_overdue_shift',
          'وردية مفتوحة لفترة طويلة',
          format('هذه الوردية مفتوحة منذ أكثر من %s ساعة دون إغلاق', v_threshold_hrs),
          'CRITICAL',
          'shift'
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '_scheduled_check_overdue_shifts failed for shift=%, shop=%: %',
        v_shift.id, v_shift.shop_id, SQLERRM;
    END;
  END LOOP;

  PERFORM public._log_health_alert_evaluation('scheduled', NULL, v_started_at);
END;
$$;

REVOKE ALL ON FUNCTION public._scheduled_check_overdue_shifts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._scheduled_check_overdue_shifts() FROM anon;
REVOKE ALL ON FUNCTION public._scheduled_check_overdue_shifts() FROM authenticated;

-- ============================================================================
-- _scheduled_check_dead_letter_count (migration 120, WAFI-155-gated by
-- migration 123: claim branch only, resolve branch NOT gated) --
-- evaluation_source = 'scheduled', shop_id NULL. One log row per cron tick.
-- ============================================================================
CREATE OR REPLACE FUNCTION public._scheduled_check_dead_letter_count()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row         record;
  v_settings    public.notification_settings%ROWTYPE;
  v_threshold   numeric;
  v_sentinel    uuid := '00000000-0000-0000-0000-000000000000';
  v_started_at  timestamptz := now();
BEGIN
  FOR v_row IN
    SELECT shop_id, MAX(value) AS max_value
      FROM public.health_gauges
     WHERE gauge_key = 'dead_letter_count'
     GROUP BY shop_id
  LOOP
    BEGIN
      SELECT * INTO v_settings
        FROM public.notification_settings
       WHERE shop_id = v_row.shop_id
         AND type = 'health_alert_dead_letter_count';

      IF NOT FOUND OR NOT v_settings.enabled THEN
        CONTINUE;
      END IF;

      IF v_settings.threshold_json IS NULL THEN
        RAISE WARNING 'health_alert_dead_letter_count: no threshold_json configured for shop %; skipping', v_row.shop_id;
        CONTINUE;
      END IF;

      BEGIN
        v_threshold := (v_settings.threshold_json ->> 'threshold')::numeric;
      EXCEPTION WHEN OTHERS THEN
        v_threshold := NULL;
      END;

      IF v_threshold IS NULL OR v_threshold < 0 THEN
        RAISE WARNING 'health_alert_dead_letter_count: invalid threshold_json for shop %; skipping', v_row.shop_id;
        CONTINUE;
      END IF;

      IF v_row.max_value >= v_threshold THEN
        -- WAFI-155 gate: claim branch only (see migration 123).
        IF public._health_alerting_enabled(v_row.shop_id) THEN
          PERFORM public.claim_health_alert_transition(
            v_row.shop_id,
            'dead_letter_count',
            v_sentinel,
            'health_alert_dead_letter_count',
            'رسائل معلقة في قائمة الانتظار',
            format('يوجد %s رسالة معلقة في جهاز واحد على الأقل في متجرك', v_row.max_value),
            'CRITICAL',
            NULL
          );
        END IF;
      ELSE
        -- Resolve branch: NOT gated. Always runs regardless of the flag.
        PERFORM public.resolve_health_alert_transition(
          v_row.shop_id,
          'dead_letter_count',
          v_sentinel
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '_scheduled_check_dead_letter_count failed for shop=%: %',
        v_row.shop_id, SQLERRM;
    END;
  END LOOP;

  PERFORM public._log_health_alert_evaluation('scheduled', NULL, v_started_at);
END;
$$;

REVOKE ALL ON FUNCTION public._scheduled_check_dead_letter_count() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._scheduled_check_dead_letter_count() FROM anon;
REVOKE ALL ON FUNCTION public._scheduled_check_dead_letter_count() FROM authenticated;

-- ============================================================================
-- _scheduled_check_stale_devices (migration 120, WAFI-155-gated by migration
-- 123: Query A claim path gated, Query B resolve path NOT gated) --
-- evaluation_source = 'scheduled', shop_id NULL. One log row per cron tick
-- (covers BOTH Query A and Query B, since they are one function invocation).
-- ============================================================================
CREATE OR REPLACE FUNCTION public._scheduled_check_stale_devices()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_device        record;
  v_alert         record;
  v_settings      public.notification_settings%ROWTYPE;
  v_threshold_hrs numeric;
  v_dev           record;
  v_is_fresh      boolean;
  v_started_at    timestamptz := now();
BEGIN
  -- Query A: new-alert discovery (claim path) -- gated.
  FOR v_device IN
    SELECT id, shop_id, last_seen_at
      FROM public.devices
     WHERE is_active = true
       AND last_seen_at IS NOT NULL
  LOOP
    BEGIN
      IF NOT public._health_alerting_enabled(v_device.shop_id) THEN
        CONTINUE;
      END IF;

      SELECT * INTO v_settings
        FROM public.notification_settings
       WHERE shop_id = v_device.shop_id
         AND type = 'health_alert_stale_device';

      IF NOT FOUND OR NOT v_settings.enabled THEN
        CONTINUE;
      END IF;

      IF v_settings.threshold_json IS NULL THEN
        RAISE WARNING 'health_alert_stale_device: no threshold_json configured for shop %; skipping device %', v_device.shop_id, v_device.id;
        CONTINUE;
      END IF;

      BEGIN
        v_threshold_hrs := (v_settings.threshold_json ->> 'threshold')::numeric;
      EXCEPTION WHEN OTHERS THEN
        v_threshold_hrs := NULL;
      END;

      IF v_threshold_hrs IS NULL OR v_threshold_hrs < 0 THEN
        RAISE WARNING 'health_alert_stale_device: invalid threshold_json for shop %; skipping device %', v_device.shop_id, v_device.id;
        CONTINUE;
      END IF;

      IF now() - v_device.last_seen_at >= (v_threshold_hrs || ' hours')::interval THEN
        PERFORM public.claim_health_alert_transition(
          v_device.shop_id,
          'stale_device',
          v_device.id,
          'health_alert_stale_device',
          'جهاز غير متصل منذ فترة طويلة',
          format('هذا الجهاز لم يتزامن منذ أكثر من %s ساعة', v_threshold_hrs),
          'WARNING',
          'device'
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '_scheduled_check_stale_devices (Query A) failed for device=%, shop=%: %',
        v_device.id, v_device.shop_id, SQLERRM;
    END;
  END LOOP;

  -- Query B: reconciliation (resolve path) -- NOT gated.
  FOR v_alert IN
    SELECT shop_id, entity_id
      FROM public.health_alert_state_b
     WHERE alert_key = 'stale_device'
       AND state = 'ALERTING'
  LOOP
    BEGIN
      SELECT id, is_active, last_seen_at INTO v_dev
        FROM public.devices
       WHERE id = v_alert.entity_id
         AND shop_id = v_alert.shop_id;

      IF NOT FOUND OR NOT v_dev.is_active THEN
        PERFORM public.resolve_health_alert_transition(
          v_alert.shop_id,
          'stale_device',
          v_alert.entity_id
        );
        CONTINUE;
      END IF;

      SELECT * INTO v_settings
        FROM public.notification_settings
       WHERE shop_id = v_alert.shop_id
         AND type = 'health_alert_stale_device';

      IF NOT FOUND OR NOT v_settings.enabled OR v_settings.threshold_json IS NULL THEN
        CONTINUE;
      END IF;

      BEGIN
        v_threshold_hrs := (v_settings.threshold_json ->> 'threshold')::numeric;
      EXCEPTION WHEN OTHERS THEN
        v_threshold_hrs := NULL;
      END;

      IF v_threshold_hrs IS NULL OR v_threshold_hrs < 0 THEN
        CONTINUE;
      END IF;

      IF v_dev.last_seen_at IS NULL THEN
        v_is_fresh := false;
      ELSE
        v_is_fresh := (now() - v_dev.last_seen_at < (v_threshold_hrs || ' hours')::interval);
      END IF;

      IF v_is_fresh THEN
        PERFORM public.resolve_health_alert_transition(
          v_alert.shop_id,
          'stale_device',
          v_alert.entity_id
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '_scheduled_check_stale_devices (Query B) failed for device=%, shop=%: %',
        v_alert.entity_id, v_alert.shop_id, SQLERRM;
    END;
  END LOOP;

  PERFORM public._log_health_alert_evaluation('scheduled', NULL, v_started_at);
END;
$$;

REVOKE ALL ON FUNCTION public._scheduled_check_stale_devices() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._scheduled_check_stale_devices() FROM anon;
REVOKE ALL ON FUNCTION public._scheduled_check_stale_devices() FROM authenticated;

-- ============================================================================
-- evaluate_health_alerts_foreground (migration 122, WAFI-155-gated as a
-- whole function by migration 123) -- evaluation_source = 'foreground',
-- shop_id populated. v_started_at is captured AFTER the absolute-
-- precondition guard (no authenticated shop at all -- v_shop_id IS NULL,
-- meaning there is no session to attribute an evaluation attempt to). Every
-- subsequent exit point -- including the WAFI-155 flag-off case and the
-- no-timezone case -- logs exactly one row.
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

  v_started_at := now();

  -- WAFI-155 gate: this whole function only ever claims (Shape A has no
  -- resolve paths), so gating the entire body here is correct and simple.
  IF NOT public._health_alerting_enabled(v_shop_id) THEN
    PERFORM public._log_health_alert_evaluation('foreground', v_shop_id, v_started_at);
    RETURN;
  END IF;

  SELECT timezone INTO v_timezone FROM public.shops WHERE id = v_shop_id;
  IF v_timezone IS NULL THEN
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

  PERFORM public._log_health_alert_evaluation('foreground', v_shop_id, v_started_at);
END;
$$;

REVOKE ALL ON FUNCTION public.evaluate_health_alerts_foreground() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.evaluate_health_alerts_foreground() FROM anon;
GRANT EXECUTE ON FUNCTION public.evaluate_health_alerts_foreground() TO authenticated;
