-- supabase/migrations/119_wafi148a_shift_closed_trigger_extension.sql
-- WAFI-148A Task 4: extends the existing shift.closed dispatch trigger
-- (migration 113) with two new evaluators, run AFTER the existing WAFI-148
-- projection writes so both read post-projection state within the same
-- transaction:
--
--   1. _apply_health_alert_drawer_mismatch: metric #4 (drawer mismatches),
--      Shape A alert. Reads the CURRENT health_metrics.value for
--      'drawer_mismatch_count' -- which _apply_health_drawer_mismatch (113)
--      has already incremented earlier in this same trigger dispatch -- and
--      claims a Shape A alert via claim_health_alert_period if the value
--      meets/exceeds the configured threshold.
--
--   2. _resolve_overdue_shift_alert: metric #8 (overdue shifts), Shape B
--      recovery path. Resolves any ALERTING health_alert_state_b row for
--      this shift back to HEALTHY. Metric #8's own evaluator (the thing that
--      transitions a shift TO 'ALERTING') ships in Task 5 -- until then this
--      is a documented no-op for shifts that were never flagged, which is
--      the expected/common case.
--
-- Both new calls are added to _dispatch_health_projections_on_shift_closed
-- AFTER the two pre-existing PERFORM calls, preserving the ordering
-- guarantee: projection writes (existing) -> alert evaluation (new). This is
-- the load-bearing sequencing spec's Transactional Guarantees #5 requires --
-- see the ordering pgTAP test in the sibling test file for a scenario that
-- would fail if this ordering were violated.
--
-- Threshold source: notification_settings.threshold_json for
-- type='health_alert_drawer_mismatches' (a new type introduced here; no
-- product-owned default threshold exists yet -- spec Gate 2 is still open).
-- A missing settings row, a disabled row (enabled=false), or a
-- missing/non-numeric/negative threshold value all skip evaluation entirely
-- (no claim attempt) per the spec's Option-A behavior: disabled/unconfigured
-- types never claim state. threshold_json shape: {"threshold": <numeric>}.

-- ============================================================================
-- _apply_health_alert_drawer_mismatch
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
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND OR v_event.type != 'shift.closed' THEN
    RETURN;
  END IF;

  SELECT timezone INTO v_timezone FROM public.shops WHERE id = v_event.shop_id;
  IF v_timezone IS NULL THEN
    RETURN; -- no timezone configured yet; mirrors _apply_health_drawer_mismatch's guard
  END IF;

  v_period := (v_event.occurred_at AT TIME ZONE v_timezone)::date;

  -- Threshold config: a missing row, a disabled row, or an unparseable/
  -- invalid threshold all mean "do not evaluate this shop for this type" --
  -- return without ever calling claim_health_alert_period.
  SELECT * INTO v_settings
    FROM public.notification_settings
   WHERE shop_id = v_event.shop_id
     AND type = 'health_alert_drawer_mismatches';

  IF NOT FOUND OR NOT v_settings.enabled THEN
    RETURN;
  END IF;

  IF v_settings.threshold_json IS NULL THEN
    RAISE WARNING 'health_alert_drawer_mismatches: no threshold_json configured for shop %; skipping evaluation', v_event.shop_id;
    RETURN;
  END IF;

  BEGIN
    v_threshold := (v_settings.threshold_json ->> 'threshold')::numeric;
  EXCEPTION WHEN OTHERS THEN
    v_threshold := NULL;
  END;

  IF v_threshold IS NULL OR v_threshold < 0 THEN
    RAISE WARNING 'health_alert_drawer_mismatches: invalid threshold_json for shop %; skipping evaluation', v_event.shop_id;
    RETURN;
  END IF;

  -- Reads the value AFTER _apply_health_drawer_mismatch has already run
  -- earlier in this same trigger dispatch (see
  -- _dispatch_health_projections_on_shift_closed below) -- this is the
  -- post-projection read the ordering test in the sibling test file exists
  -- to verify.
  SELECT value INTO v_value
    FROM public.health_metrics
   WHERE shop_id = v_event.shop_id
     AND device_id = '00000000-0000-0000-0000-000000000000'
     AND metric_key = 'drawer_mismatch_count'
     AND period_start = v_period;

  IF v_value IS NULL OR v_value < v_threshold THEN
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
END;
$$;

REVOKE ALL ON FUNCTION public._apply_health_alert_drawer_mismatch(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._apply_health_alert_drawer_mismatch(uuid) FROM anon;
REVOKE ALL ON FUNCTION public._apply_health_alert_drawer_mismatch(uuid) FROM authenticated;

-- ============================================================================
-- _resolve_overdue_shift_alert
-- ============================================================================
CREATE OR REPLACE FUNCTION public._resolve_overdue_shift_alert(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event    public.events%ROWTYPE;
  v_shift_id uuid;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND OR v_event.type != 'shift.closed' THEN
    RETURN;
  END IF;

  v_shift_id := (v_event.payload::jsonb ->> 'shiftId')::uuid;
  IF v_shift_id IS NULL THEN
    RETURN;
  END IF;

  -- resolve_health_alert_transition (migration 118) is a plain unconditional
  -- UPDATE ... WHERE, silent and safe as a no-op when no matching
  -- health_alert_state_b row exists yet (the common case until Task 5's #8
  -- evaluator ships and starts creating ALERTING rows).
  PERFORM public.resolve_health_alert_transition(v_event.shop_id, 'overdue_shift', v_shift_id);
END;
$$;

REVOKE ALL ON FUNCTION public._resolve_overdue_shift_alert(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._resolve_overdue_shift_alert(uuid) FROM anon;
REVOKE ALL ON FUNCTION public._resolve_overdue_shift_alert(uuid) FROM authenticated;

-- ============================================================================
-- Extend the existing dispatch trigger function (migration 113). CREATE OR
-- REPLACE of the SAME function -- the trigger definition itself
-- (health_projections_on_shift_closed) is untouched, since it already fires
-- this function on every shift.closed insert.
-- ============================================================================
CREATE OR REPLACE FUNCTION public._dispatch_health_projections_on_shift_closed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public._apply_health_drawer_mismatch(NEW.id);
  PERFORM public._apply_health_never_closed_shift(NEW.id);
  PERFORM public._apply_health_alert_drawer_mismatch(NEW.id);
  PERFORM public._resolve_overdue_shift_alert(NEW.id);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._dispatch_health_projections_on_shift_closed() FROM PUBLIC, anon, authenticated;
