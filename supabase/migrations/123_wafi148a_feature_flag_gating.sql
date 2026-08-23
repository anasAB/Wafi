-- supabase/migrations/123_wafi148a_feature_flag_gating.sql
-- WAFI-148A Task 11: gate all 5 health-alert evaluators behind a new
-- WAFI-155 rollout flag, 'health_alerting'.
--
-- Part 1: widen set_rollout_flag's allowlist (migration 090) to accept
-- 'health_alerting'. CREATE OR REPLACE with the function's exact existing
-- body -- authorization check, NULL-grandfathering logic, the two-pass
-- jsonb_set pattern -- unchanged; only the allowlist literal grows by one
-- value. Same treatment for list_shops_for_rollout_admin, adding a
-- health_alerting output column for admin visibility, using the exact
-- fail-closed `= 'true'::jsonb` pattern already used for the other 3 flags.
--
-- Part 2: a new internal helper, _health_alerting_enabled(shop_id), that
-- evaluators call as the very first thing they do (before any settings/
-- threshold lookup). Fail-closed: NULL/missing/malformed reads as false,
-- matching list_shops_for_rollout_admin's contract exactly.
--
-- Part 3: wire the flag check into the claim/notify paths of all 5
-- evaluator functions built in migrations 119/120/122, via CREATE OR
-- REPLACE reproducing each function's full current body plus the flag
-- check -- migrations are append-only by convention in this project (see
-- e.g. migration 113's CREATE OR REPLACE of migration-109/110-originated
-- functions); 119/120/122 are not edited in place.
--
-- Deliberate asymmetry, per the design spec's feature-flag reconciliation
-- behavior ("disabling never deletes/resets alert state"): claim/notify
-- paths are gated; resolve/recovery paths are NOT gated and always run
-- regardless of the flag's state.
--   - _apply_health_alert_drawer_mismatch (claim)              -> GATED
--   - _resolve_overdue_shift_alert (resolve)                    -> NOT gated
--   - _scheduled_check_overdue_shifts (claim-only)               -> GATED
--   - _scheduled_check_dead_letter_count Query claim branch     -> GATED
--   - _scheduled_check_dead_letter_count Query resolve branch   -> NOT gated
--   - _scheduled_check_stale_devices Query A (claim)             -> GATED
--   - _scheduled_check_stale_devices Query B (resolve)           -> NOT gated
--   - evaluate_health_alerts_foreground (claim-only, Shape A)    -> GATED (whole fn)

-- ============================================================================
-- Part 1a: set_rollout_flag -- allowlist widened to include 'health_alerting'.
-- Body reproduced verbatim from migration 090 except for that one line.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_rollout_flag(
  p_shop_id  uuid,
  p_flag_key text,
  p_enabled  boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_base jsonb;
BEGIN
  -- Authorization first, before any parameter is validated -- an
  -- unauthorized caller must not learn whether p_shop_id/p_flag_key are
  -- even well-formed.
  IF NOT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = 'P0001';
  END IF;

  IF p_shop_id IS NULL THEN
    RAISE EXCEPTION 'shop id is required' USING ERRCODE = 'P0002';
  END IF;
  IF p_flag_key IS NULL OR p_enabled IS NULL THEN
    RAISE EXCEPTION 'flag key and enabled value are required' USING ERRCODE = 'P0003';
  END IF;

  IF p_flag_key NOT IN ('dashboard_v2', 'pos_brain', 'insights', 'health_alerting') THEN
    RAISE EXCEPTION 'unknown rollout flag: %', p_flag_key USING ERRCODE = 'P0003';
  END IF;

  -- FOR UPDATE locks the row for the rest of this transaction and lets us
  -- read `features` before deciding how to mutate it -- a single UPDATE
  -- expression can't do this in two jsonb_set passes (below) without
  -- reading the column's pre-mutation value first.
  SELECT features INTO v_base FROM shops WHERE id = p_shop_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop not found: %', p_shop_id USING ERRCODE = 'P0002';
  END IF;

  -- A NULL (or otherwise non-object) features blob means resolveFlag()
  -- (flagRegistry.ts) currently grants this shop every pack. Materialize
  -- that same all-on state before applying the rollout path -- not
  -- migration 041's one-time backfill literal, which used different values
  -- for a different, already-known set of shops at a different time.
  IF v_base IS NULL OR jsonb_typeof(v_base) IS DISTINCT FROM 'object' THEN
    v_base := '{"staff_pack": true, "customer_pack": true, "reporting_pack": true, "electronics_pro": true}'::jsonb;
  END IF;

  -- protect_shop_server_only_columns (075) reverts `features` on ANY
  -- request carrying a JWT, with no exception for a trusted SECURITY
  -- DEFINER RPC's own write -- SECURITY DEFINER changes privilege-checking
  -- identity, not this custom GUC, which stays set for the whole request
  -- regardless of which function runs inside it. Authorization has already
  -- been verified above; this is a narrowly scoped, single-statement
  -- override, transaction-local (is_local=true) so it cannot leak into any
  -- other request. Do not copy this pattern elsewhere without the same
  -- preceding authorization guarantee.
  PERFORM set_config('request.jwt.claims', '', true);

  -- jsonb_set requires every path segment except the LAST to already
  -- exist, or it silently no-ops (Postgres docs: "if any step of the path
  -- other than the last is missing ... no change is made" -- create_missing
  -- only ever creates the final segment). No shop's features starts with a
  -- `rollout` key, so a single jsonb_set(v_base, '{rollout,<key>}', ...)
  -- would silently do nothing on every real first write. Two sequential
  -- calls: first ensure `rollout` exists as an object (creating it from
  -- '{}' if v_base has none), then set the nested key on a base that is
  -- now guaranteed to already contain it.
  -- Guard against a corrupted, non-object `rollout` value the same way the
  -- `features` root is guarded above (line 69) -- a scalar/array left behind
  -- by manual corruption would otherwise be passed straight into the outer
  -- jsonb_set as the "existing" value, and jsonb_set silently no-ops when an
  -- intermediate path segment isn't an object. NULL (the normal "rollout
  -- doesn't exist yet" case) is left alone; coalesce below still handles it.
  IF jsonb_typeof(v_base -> 'rollout') IS NOT NULL
     AND jsonb_typeof(v_base -> 'rollout') IS DISTINCT FROM 'object' THEN
    v_base := jsonb_set(v_base, ARRAY['rollout'], '{}'::jsonb, true);
  END IF;

  UPDATE shops
     SET features = jsonb_set(
           jsonb_set(v_base, ARRAY['rollout'], coalesce(v_base -> 'rollout', '{}'::jsonb), true),
           ARRAY['rollout', p_flag_key],
           to_jsonb(p_enabled),
           true)
   WHERE id = p_shop_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_rollout_flag(uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_rollout_flag(uuid, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_rollout_flag(uuid, text, boolean) TO authenticated;

-- ============================================================================
-- Part 1b: list_shops_for_rollout_admin -- add health_alerting output column,
-- same fail-closed pattern as the existing 3 flags.
--
-- Postgres does not allow CREATE OR REPLACE FUNCTION to change the row type
-- defined by OUT parameters / RETURNS TABLE -- it requires DROP FUNCTION
-- first, confirmed by a real `supabase db reset` run (SQLSTATE 42P13,
-- "cannot change return type of existing function"). The DROP is safe here:
-- the function has no dependent views/triggers, and its replacement below
-- restores it (widened by one column) in the same statement batch/transaction.
-- ============================================================================
DROP FUNCTION IF EXISTS public.list_shops_for_rollout_admin(text);

CREATE OR REPLACE FUNCTION public.list_shops_for_rollout_admin(p_query text DEFAULT NULL)
RETURNS TABLE (
  shop_id         uuid,
  shop_name       text,
  dashboard_v2    boolean,
  pos_brain       boolean,
  insights        boolean,
  health_alerting boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = 'P0001';
  END IF;

  -- Fail-closed flag parsing, matching the TypeScript resolver's contract:
  -- only the JSON literal `true` reads as enabled. `= 'true'::jsonb` on a
  -- non-boolean value evaluates to NULL rather than throwing, so
  -- coalesce(..., false) safely reduces every malformed case to "off".
  RETURN QUERY
  SELECT s.id, s.name,
         coalesce(s.features -> 'rollout' -> 'dashboard_v2'    = 'true'::jsonb, false),
         coalesce(s.features -> 'rollout' -> 'pos_brain'       = 'true'::jsonb, false),
         coalesce(s.features -> 'rollout' -> 'insights'        = 'true'::jsonb, false),
         coalesce(s.features -> 'rollout' -> 'health_alerting' = 'true'::jsonb, false)
    FROM shops s
   WHERE NULLIF(trim(p_query), '') IS NULL
      OR s.name ILIKE '%' || trim(p_query) || '%'
   ORDER BY s.name, s.id
   LIMIT 100;
END;
$$;

REVOKE ALL ON FUNCTION public.list_shops_for_rollout_admin(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_shops_for_rollout_admin(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_shops_for_rollout_admin(text) TO authenticated;

-- ============================================================================
-- Part 2: shared internal helper. Not client-callable -- internal-only, same
-- lockdown style as migration 118's claim/resolve functions (no GRANT to
-- authenticated at all).
-- ============================================================================
CREATE OR REPLACE FUNCTION public._health_alerting_enabled(p_shop_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(s.features -> 'rollout' -> 'health_alerting' = 'true'::jsonb, false)
    FROM public.shops s
   WHERE s.id = p_shop_id;
$$;

REVOKE ALL ON FUNCTION public._health_alerting_enabled(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._health_alerting_enabled(uuid) FROM anon;
REVOKE ALL ON FUNCTION public._health_alerting_enabled(uuid) FROM authenticated;

-- ============================================================================
-- Part 3a: _apply_health_alert_drawer_mismatch (migration 119, metric #4).
-- Full body reproduced with the flag check added as the very first thing
-- after the existing event-lookup guard.
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

  -- WAFI-155 gate (WAFI-148A Task 11): claim path only, checked before any
  -- other logic including the settings/threshold lookup below.
  IF NOT public._health_alerting_enabled(v_event.shop_id) THEN
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

-- Note: _resolve_overdue_shift_alert (migration 119) is intentionally NOT
-- reproduced/modified here. Recovery paths are never gated -- disabling the
-- flag must never leave overdue-shift alert state stuck. It keeps its
-- migration-119 body untouched, and
-- _dispatch_health_projections_on_shift_closed (also migration 119) already
-- calls it unconditionally; no CREATE OR REPLACE of either is needed.

-- ============================================================================
-- Part 3b: _scheduled_check_overdue_shifts (migration 120, metric #8 claim
-- path). Flag check added as the first line inside the per-shift loop's
-- BEGIN block, before the settings/threshold lookup. This function has no
-- resolve branch (recovery is owned by the shift.closed trigger extension),
-- so gating the whole per-candidate body is correct.
-- ============================================================================
CREATE OR REPLACE FUNCTION public._scheduled_check_overdue_shifts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shift        record;
  v_settings     public.notification_settings%ROWTYPE;
  v_threshold_hrs numeric;
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
END;
$$;

REVOKE ALL ON FUNCTION public._scheduled_check_overdue_shifts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._scheduled_check_overdue_shifts() FROM anon;
REVOKE ALL ON FUNCTION public._scheduled_check_overdue_shifts() FROM authenticated;

-- ============================================================================
-- Part 3c: _scheduled_check_dead_letter_count (migration 120, metric #3).
-- This function has BOTH a claim branch and a resolve branch in the SAME
-- loop iteration -- the flag check applies ONLY to the claim branch (the
-- IF max_value >= threshold path), not the ELSE resolve branch, and not the
-- whole iteration.
-- ============================================================================
CREATE OR REPLACE FUNCTION public._scheduled_check_dead_letter_count()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row          record;
  v_settings     public.notification_settings%ROWTYPE;
  v_threshold    numeric;
  v_sentinel     uuid := '00000000-0000-0000-0000-000000000000';
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
        -- WAFI-155 gate: claim branch only. A flag-off shop simply never
        -- claims a new alert here -- it does NOT fall through to the
        -- resolve branch (that would be wrong for the case where an
        -- existing ALERTING row genuinely still exceeds a re-lowered
        -- threshold; resolve must only run based on the actual value vs
        -- threshold comparison below, not as a side effect of the gate).
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
END;
$$;

REVOKE ALL ON FUNCTION public._scheduled_check_dead_letter_count() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._scheduled_check_dead_letter_count() FROM anon;
REVOKE ALL ON FUNCTION public._scheduled_check_dead_letter_count() FROM authenticated;

-- ============================================================================
-- Part 3d: _scheduled_check_stale_devices (migration 120, metric #7).
-- Query A (new-alert discovery / claim) is gated as the first line inside its
-- loop's BEGIN block. Query B (reconciliation / resolve, including the
-- disappearance branch) is NOT gated -- it must always be able to notice and
-- resolve a device that recovered or was deactivated/deleted, even while the
-- flag happens to be off.
-- ============================================================================
CREATE OR REPLACE FUNCTION public._scheduled_check_stale_devices()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_device       record;
  v_alert        record;
  v_settings     public.notification_settings%ROWTYPE;
  v_threshold_hrs numeric;
  v_dev          record;
  v_is_fresh     boolean;
BEGIN
  -- ==========================================================================
  -- Query A: new-alert discovery (claim path) -- gated.
  -- ==========================================================================
  FOR v_device IN
    SELECT id, shop_id, last_seen_at
      FROM public.devices
     WHERE is_active = true
       AND last_seen_at IS NOT NULL
  LOOP
    BEGIN
      -- WAFI-155 gate: claim path only, checked before any other logic.
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

  -- ==========================================================================
  -- Query B: reconciliation (resolve path) -- NOT gated. Must always be able
  -- to resolve, even while the flag is off.
  -- ==========================================================================
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
END;
$$;

REVOKE ALL ON FUNCTION public._scheduled_check_stale_devices() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._scheduled_check_stale_devices() FROM anon;
REVOKE ALL ON FUNCTION public._scheduled_check_stale_devices() FROM authenticated;

-- ============================================================================
-- Part 3e: evaluate_health_alerts_foreground (migration 122, metrics
-- #1/#2/#5/#6, Shape A). No resolve paths exist for Shape A at all, so gating
-- the whole function body is correct and simple: the check is added once,
-- right after deriving v_shop_id and before the timezone lookup.
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
BEGIN
  v_shop_id := public.auth_shop_id();
  IF v_shop_id IS NULL THEN
    RETURN;
  END IF;

  -- WAFI-155 gate: this whole function only ever claims (Shape A has no
  -- resolve paths), so gating the entire body here is correct and simple.
  IF NOT public._health_alerting_enabled(v_shop_id) THEN
    RETURN;
  END IF;

  SELECT timezone INTO v_timezone FROM public.shops WHERE id = v_shop_id;
  IF v_timezone IS NULL THEN
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
