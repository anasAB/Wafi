-- supabase/migrations/125_wafi148a_final_review_fixes.sql
-- WAFI-148A Task 15: fixes from the final whole-branch review (4 findings).
-- CREATE OR REPLACE's the 6 functions touched by migration 124, based on
-- migration 124's bodies verbatim except for the specific changes below.
-- Never edits 119/120/123/124 in place.
--
-- Finding 1 (CRITICAL): resolve paths must never be gated on
-- notification_settings.enabled/threshold validity -- only claim paths are
-- gated (see design spec "Recovery is independent of ..."). Two evaluators
-- fixed:
--   - _scheduled_check_stale_devices Query B: previously
--     `IF NOT FOUND OR NOT v_settings.enabled OR v_settings.threshold_json IS
--     NULL THEN CONTINUE;` blocked freshness-based resolution whenever the
--     type was disabled. Restructured so device disappearance/deactivation
--     ALWAYS resolves (independent of settings), and the freshness branch is
--     evaluated whenever a valid threshold exists, regardless of `enabled`.
--     When no valid threshold exists at all, the row simply stays ALERTING
--     (not stuck forever: either the device is eventually
--     deactivated/deleted, or a valid threshold shows up on a later tick).
--   - _scheduled_check_dead_letter_count: previously the settings-guard
--     (`IF NOT FOUND OR NOT v_settings.enabled THEN CONTINUE`) sat above the
--     claim/resolve IF/ELSE, making the resolve branch unreachable whenever
--     the type was disabled. Restructured into an explicit two-query shape
--     mirroring _scheduled_check_stale_devices (Finding 3 below folds into
--     this restructuring):
--       Query A: claim-only, over current health_gauges rows, gated on
--       enabled + valid threshold (as before).
--       Query B: reconciliation, over existing ALERTING
--       health_alert_state_b rows for this alert_key -- resolves
--       unconditionally when the shop's dead_letter_count gauge has
--       disappeared entirely (Finding 3), and resolves whenever the current
--       MAX(value) is under a valid configured threshold, regardless of
--       enabled (Finding 1). If no valid threshold is configured, the row
--       stays ALERTING (can't determine freshness) unless the gauge itself
--       has disappeared.
--
-- Finding 3 (IMPORTANT): _scheduled_check_dead_letter_count had no
-- independent reconciliation query, so a shop whose health_gauges rows are
-- pruned/stop reporting could never have an existing ALERTING row resolved.
-- Fixed by Query B above (gauge-disappeared case).
--
-- Finding 4 (IMPORTANT): now() is transaction-start-frozen in Postgres, so
-- completed_at == started_at for every KPI log row, making the
-- "how long did evaluation take" half of the instrumentation meaningless.
-- Fixed by using clock_timestamp() (real wall-clock time at the call site)
-- for v_started_at at function entry and for the completed_at value passed
-- into _log_health_alert_evaluation, in ALL 5 evaluators plus the shared
-- helper itself. No other timestamp usage (state_changed_at, alerted_at,
-- event timestamps, threshold/freshness comparisons) is touched -- those are
-- correctly meant to stay transaction-consistent.
--
-- Finding 2 (IMPORTANT): round-trip tests for #7 and #3 (mirroring the
-- existing #8 round-trip test) are added to
-- supabase/tests/wafi148a_shape_b_evaluators.test.sql in this same change,
-- proving these fixes against the pre-fix code (they fail before, pass
-- after).
--
-- _apply_health_alert_drawer_mismatch, _scheduled_check_overdue_shifts, and
-- evaluate_health_alerts_foreground are re-created here UNCHANGED except for
-- the clock_timestamp() swap (Finding 4) -- no other behavior changes.

-- ============================================================================
-- _log_health_alert_evaluation: now takes the real completed_at from the
-- caller (clock_timestamp() at the call site) instead of computing its own
-- now() here, since now() would just re-freeze to the transaction start
-- again. Signature unchanged; only the INSERT's completed_at value source
-- changes conceptually (callers now pass clock_timestamp() results via
-- p_started_at pairing below) -- concretely, we keep the same 3-arg
-- signature but capture completed_at via clock_timestamp() at insert time
-- inside this helper, which IS the call site for the "evaluation just
-- finished" moment, so clock_timestamp() here is correct and sufficient.
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
  VALUES (p_shop_id, p_evaluation_source, p_started_at, clock_timestamp());
END;
$$;

REVOKE ALL ON FUNCTION public._log_health_alert_evaluation(text, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._log_health_alert_evaluation(text, uuid, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public._log_health_alert_evaluation(text, uuid, timestamptz) FROM authenticated;

-- ============================================================================
-- _apply_health_alert_drawer_mismatch -- UNCHANGED except v_started_at now
-- uses clock_timestamp() instead of now() (Finding 4). No other line
-- changed.
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

  v_started_at := clock_timestamp();

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
-- _scheduled_check_overdue_shifts -- UNCHANGED except v_started_at now uses
-- clock_timestamp() instead of now() (Finding 4). No other line changed.
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
  v_started_at    timestamptz := clock_timestamp();
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
-- _scheduled_check_dead_letter_count -- RESTRUCTURED (Findings 1 & 3).
-- Now shaped as two independent queries, mirroring
-- _scheduled_check_stale_devices:
--   Query A: claim-only, over current health_gauges rows (unchanged
--   candidate query/threshold-parsing logic), gated on enabled + valid
--   threshold, exactly like before -- but it ONLY claims now, it never
--   resolves.
--   Query B: reconciliation, over existing ALERTING health_alert_state_b
--   rows for alert_key='dead_letter_count'. For each: look up the shop's
--   CURRENT MAX(value) over health_gauges for gauge_key='dead_letter_count'.
--     - No gauge rows at all (gauge stopped reporting entirely) -> resolve
--       unconditionally (Finding 3).
--     - Gauge rows exist: resolve if current MAX(value) is under a valid
--       configured threshold, regardless of notification_settings.enabled
--       (Finding 1) -- resolving is never gated on the flag.
--     - If no valid threshold is configured (missing settings row,
--       threshold_json NULL, or unparseable/invalid threshold), we cannot
--       determine freshness from configuration alone, so the row stays
--       ALERTING (unless the gauge-disappeared case above already applies).
-- Also incorporates the clock_timestamp() fix for v_started_at (Finding 4).
-- ============================================================================
CREATE OR REPLACE FUNCTION public._scheduled_check_dead_letter_count()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row         record;
  v_alert       record;
  v_settings    public.notification_settings%ROWTYPE;
  v_threshold   numeric;
  v_sentinel    uuid := '00000000-0000-0000-0000-000000000000';
  v_started_at  timestamptz := clock_timestamp();
  v_max_value   numeric;
  v_has_gauge   boolean;
BEGIN
  -- Query A: new-alert discovery (claim path) -- gated, over current gauge rows.
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
        -- WAFI-155 gate: claim path only.
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
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '_scheduled_check_dead_letter_count (Query A) failed for shop=%: %',
        v_row.shop_id, SQLERRM;
    END;
  END LOOP;

  -- Query B: reconciliation (resolve path) -- NOT gated on enabled. Covers
  -- both "gauge value dropped back down" and "gauge stopped reporting
  -- entirely" (Finding 3).
  FOR v_alert IN
    SELECT shop_id, entity_id
      FROM public.health_alert_state_b
     WHERE alert_key = 'dead_letter_count'
       AND state = 'ALERTING'
  LOOP
    BEGIN
      SELECT MAX(value) INTO v_max_value
        FROM public.health_gauges
       WHERE shop_id = v_alert.shop_id
         AND gauge_key = 'dead_letter_count';

      v_has_gauge := (v_max_value IS NOT NULL);

      IF NOT v_has_gauge THEN
        -- Gauge stopped reporting entirely for this shop -- nothing left to
        -- alert on. Resolve unconditionally, independent of settings state.
        PERFORM public.resolve_health_alert_transition(
          v_alert.shop_id,
          'dead_letter_count',
          v_alert.entity_id
        );
        CONTINUE;
      END IF;

      SELECT * INTO v_settings
        FROM public.notification_settings
       WHERE shop_id = v_alert.shop_id
         AND type = 'health_alert_dead_letter_count';

      IF NOT FOUND OR v_settings.threshold_json IS NULL THEN
        -- Cannot determine "is it healthy" without a valid threshold --
        -- stay ALERTING. Deliberately NOT gated on v_settings.enabled: a
        -- disabled type with a valid threshold can still resolve below.
        CONTINUE;
      END IF;

      BEGIN
        v_threshold := (v_settings.threshold_json ->> 'threshold')::numeric;
      EXCEPTION WHEN OTHERS THEN
        v_threshold := NULL;
      END;

      IF v_threshold IS NULL OR v_threshold < 0 THEN
        CONTINUE;
      END IF;

      IF v_max_value < v_threshold THEN
        PERFORM public.resolve_health_alert_transition(
          v_alert.shop_id,
          'dead_letter_count',
          v_alert.entity_id
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '_scheduled_check_dead_letter_count (Query B) failed for shop=%: %',
        v_alert.shop_id, SQLERRM;
    END;
  END LOOP;

  PERFORM public._log_health_alert_evaluation('scheduled', NULL, v_started_at);
END;
$$;

REVOKE ALL ON FUNCTION public._scheduled_check_dead_letter_count() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._scheduled_check_dead_letter_count() FROM anon;
REVOKE ALL ON FUNCTION public._scheduled_check_dead_letter_count() FROM authenticated;

-- ============================================================================
-- _scheduled_check_stale_devices -- Query A UNCHANGED. Query B RESTRUCTURED
-- (Finding 1): device disappearance/deactivation now resolves
-- unconditionally (moved above/independent of the settings lookup); the
-- freshness branch is now evaluated whenever a valid threshold exists,
-- regardless of notification_settings.enabled (previously
-- `NOT v_settings.enabled` in the same OR-chain as the missing-threshold
-- check blocked freshness-based resolution whenever the type was disabled).
-- Also incorporates the clock_timestamp() fix for v_started_at (Finding 4).
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
  v_started_at    timestamptz := clock_timestamp();
BEGIN
  -- Query A: new-alert discovery (claim path) -- gated. Unchanged.
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

  -- Query B: reconciliation (resolve path) -- NOT gated on enabled.
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
        -- Device deleted or deactivated -- resolve unconditionally,
        -- independent of settings state (Finding 1).
        PERFORM public.resolve_health_alert_transition(
          v_alert.shop_id,
          'stale_device',
          v_alert.entity_id
        );
        CONTINUE;
      END IF;

      -- Device still exists and is active: only a freshness-based resolve
      -- is possible, and only if a valid threshold is configured. This is
      -- deliberately NOT gated on v_settings.enabled -- a disabled type with
      -- a valid threshold can still resolve via freshness.
      SELECT * INTO v_settings
        FROM public.notification_settings
       WHERE shop_id = v_alert.shop_id
         AND type = 'health_alert_stale_device';

      IF NOT FOUND OR v_settings.threshold_json IS NULL THEN
        -- Cannot determine freshness without a valid threshold -- stay
        -- ALERTING (not stuck forever: the device will eventually be
        -- deactivated/deleted, or a valid threshold will show up later).
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
-- evaluate_health_alerts_foreground -- UNCHANGED except v_started_at now
-- uses clock_timestamp() instead of now() (Finding 4). No other line
-- changed.
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

  v_started_at := clock_timestamp();

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
