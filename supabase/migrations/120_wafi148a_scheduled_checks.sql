-- supabase/migrations/120_wafi148a_scheduled_checks.sql
-- WAFI-148A Task 5: first pg_cron-based evaluator in this feature -- metric #8
-- (overdue shift), Shape B (health_alert_state_b), scheduled rather than
-- event-triggered.
--
-- Migration numbering note: this file is intentionally numbered 120, not 121
-- as the plan document literally says. Task 9 was pre-assigned migration 120
-- before this task was dispatched, which would have created an out-of-order
-- creation risk (a later-numbered file existing before an earlier-numbered
-- one). The plan owner's ruling: this task uses 120 instead; Tasks 6/7 (which
-- extend this same file) also use 120; Task 8 uses 121; Task 9 uses 122.
--
-- Gate 0 (this feature's pre-flight ruling): multiple shifts CAN be open
-- concurrently per shop -- the only uniqueness guard on cashier_shifts is
-- per-device, not per-shop. So entity_id for this metric is the real
-- shift_id, one health_alert_state_b row/alert per open shift. This is NOT a
-- shop-level sentinel case.
--
-- Candidate query: cashier_shifts WHERE status = 'open'. This matches the
-- existing idx_cashier_shifts_status (shop_id, status, opened_at DESC)
-- index exactly, and is equivalent in practice to closed_at IS NULL (nothing
-- currently writes the migration-026-added 'abandoned' status).
--
-- Threshold source: notification_settings.threshold_json for
-- type='health_alert_overdue_shift', shape {"threshold": <hours>}. Same
-- Option-A skip semantics as every other evaluator in this feature: a
-- missing settings row, a disabled row, or a missing/non-numeric/non-positive
-- threshold value all skip evaluation for that shop entirely (no claim
-- attempt), with a RAISE WARNING for the invalid (but present) case. Zero is
-- explicitly invalid for this metric, not merely "immediately overdue" --
-- per the design spec, an evaluator must never invent or accept a default
-- threshold of 0.
--
-- Elapsed-duration comparison, NOT shop-local-day bucketing: overdue-ness is
-- measured as now() - opened_at >= threshold_hours, an absolute timestamptz
-- comparison. This is deliberately different from the day-bucket period
-- metrics elsewhere in this feature (metrics 1/2/5/6/etc via
-- claim_health_alert_period's period_start) -- a shift's "how long has it
-- been open" question does not care what timezone the shop is in, and this
-- function never computes or references a shop-local period_start.
--
-- Recovery: NOT this function's job. Recovery for metric #8 is owned
-- exclusively by the shift.closed trigger extension
-- (_resolve_overdue_shift_alert, migration 119/Task 4). Once a shift closes
-- it no longer appears in the status='open' candidate query, which is
-- sufficient -- the resolve already happened via the trigger at close time.
-- This function intentionally contains no resolve/HEALTHY-transition logic.

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ============================================================================
-- _scheduled_check_overdue_shifts
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
  -- One candidate query for all shops; per-shop threshold config is
  -- re-resolved for each candidate row below (thresholds are per-shop, and
  -- a single scheduled run spans every shop with an open shift).
  FOR v_shift IN
    SELECT id, shop_id, opened_at
      FROM public.cashier_shifts
     WHERE status = 'open'
  LOOP
    -- Failure isolation (design spec, Option A / same pattern as
    -- generate_scheduled_reports in migration 103): one candidate's
    -- exception is caught here and does not abort evaluation of the
    -- remaining candidates in this loop. This is an implicit PL/pgSQL
    -- subtransaction boundary -- no explicit ROLLBACK statement is used
    -- (invalid inside a PL/pgSQL exception handler; that was a documented
    -- mistake in an earlier design round of this feature).
    BEGIN
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

      -- Zero is explicitly invalid for this metric (per the design spec),
      -- not merely "immediately overdue" -- never invent a default here.
      IF v_threshold_hrs IS NULL OR v_threshold_hrs <= 0 THEN
        RAISE WARNING 'health_alert_overdue_shift: invalid threshold_json for shop %; skipping shift %', v_shift.shop_id, v_shift.id;
        CONTINUE;
      END IF;

      -- Absolute elapsed-duration comparison, deliberately not a
      -- shop-local-day bucket comparison. Timezone-independent by
      -- construction: now() and opened_at are both timestamptz.
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
      -- Rollback-surviving observability: RAISE WARNING goes to the server
      -- log outside this candidate's own subtransaction, so it survives
      -- even though the subtransaction itself is discarded.
      RAISE WARNING '_scheduled_check_overdue_shifts failed for shift=%, shop=%: %',
        v_shift.id, v_shift.shop_id, SQLERRM;
    END;
  END LOOP;
END;
$$;

-- Locked down the same way generate_scheduled_reports (migration 103) is
-- locked down: it is invoked only by pg_cron (which runs as the database
-- owner), never a direct entry point for authenticated/anon clients.
REVOKE ALL ON FUNCTION public._scheduled_check_overdue_shifts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._scheduled_check_overdue_shifts() FROM anon;
REVOKE ALL ON FUNCTION public._scheduled_check_overdue_shifts() FROM authenticated;

-- ============================================================================
-- pg_cron registration. Idempotent re-apply: unschedule-if-exists before
-- cron.schedule, matching the exact pattern in migration 105.
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wafi148a_overdue_shift_check') THEN
    PERFORM cron.unschedule('wafi148a_overdue_shift_check');
  END IF;
END $$;

SELECT cron.schedule(
  'wafi148a_overdue_shift_check',
  '*/15 * * * *', -- every 15 minutes; conservative starting point, tunable later, not architectural
  $$ SELECT public._scheduled_check_overdue_shifts() $$
);

-- ============================================================================
-- Task 7: Metric #3 (dead-letter count) -- scheduled evaluator
--
-- Spec-gap ruling (plan owner, carried exactly): health_gauges (migration 107)
-- is stored PER-DEVICE (PRIMARY KEY (shop_id, device_id, gauge_key)), but the
-- design spec's alert_key='dead_letter_count' convention (migration 117) uses
-- a single shop-level sentinel entity_id ('00000000-0000-0000-0000-000000000000').
-- Resolution: aggregate via MAX(value) ... GROUP BY shop_id across all of a
-- shop's devices -- not SUM -- alerting when the worst single device is bad,
-- without requiring combined counts across devices to cross the threshold.
-- This deliberately does NOT reuse the client-side dashboard query pattern in
-- useOwnerHealth.ts (~lines 268-272), which GROUPs BY gauge_key with a bare,
-- non-aggregated value column -- imprecise for multi-device shops and not a
-- safe precedent for this server-side evaluator.
--
-- Candidate query: SELECT shop_id, MAX(value) FROM health_gauges WHERE
-- gauge_key='dead_letter_count' GROUP BY shop_id. A shop with zero gauge rows
-- has never reported and is correctly excluded -- no synthetic zero-row is
-- invented for it.
--
-- Threshold source: notification_settings.threshold_json for
-- type='health_alert_dead_letter_count' (per the design spec's now-formalized
-- Notification Integration section, metric #3). Same Option-A skip semantics
-- as every other evaluator in this feature: missing/disabled settings row ->
-- skip entirely, no claim attempt; missing/non-numeric/negative threshold ->
-- skip + RAISE WARNING, never invent a default. Unlike metric #8, zero IS a
-- valid threshold here in principle ("alert on any dead letter at all") --
-- this function does not reject a zero threshold.
--
-- Recovery: UNLIKE metric #8, this function owns its own recovery logic --
-- there is no other trigger/mechanism that would ever resolve a recovered
-- dead-letter gauge back to HEALTHY. Each per-shop loop iteration either
-- claims (max_value >= threshold) or resolves (max_value < threshold); both
-- claim_health_alert_transition and resolve_health_alert_transition are safe
-- no-ops when not applicable (per their contracts in migration 118), so no
-- separate "check current state first" branch is needed.
-- ============================================================================

-- ============================================================================
-- _scheduled_check_dead_letter_count
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
  -- One row per shop with any dead_letter_count gauge data at all, aggregated
  -- via MAX across that shop's devices (see spec-gap ruling above).
  FOR v_row IN
    SELECT shop_id, MAX(value) AS max_value
      FROM public.health_gauges
     WHERE gauge_key = 'dead_letter_count'
     GROUP BY shop_id
  LOOP
    -- Per-candidate failure isolation, same pattern as
    -- _scheduled_check_overdue_shifts above: an exception here does not abort
    -- evaluation of the remaining shops in this loop. No explicit ROLLBACK
    -- (invalid inside a PL/pgSQL exception handler).
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

      -- Zero IS a valid threshold for this metric ("alert on any dead letter
      -- at all") -- deliberately not rejected here, unlike metric #8's
      -- zero-rejection rule (which was specific to that metric's semantics).
      IF v_threshold IS NULL OR v_threshold < 0 THEN
        RAISE WARNING 'health_alert_dead_letter_count: invalid threshold_json for shop %; skipping', v_row.shop_id;
        CONTINUE;
      END IF;

      IF v_row.max_value >= v_threshold THEN
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
      ELSE
        -- Recovery owned exclusively by this function (see header note) --
        -- safe no-op when there is no existing ALERTING row to resolve.
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
-- pg_cron registration for the dead-letter-count evaluator. Same idempotent
-- unschedule-then-schedule pattern. Same 15-minute cadence as the
-- overdue-shift job -- a separate job (batch-efficiency decision, not
-- architectural) rather than folding into the same job, so a failure/slowdown
-- in one evaluator's candidate set never delays the other's schedule tick.
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wafi148a_dead_letter_check') THEN
    PERFORM cron.unschedule('wafi148a_dead_letter_check');
  END IF;
END $$;

SELECT cron.schedule(
  'wafi148a_dead_letter_check',
  '*/15 * * * *',
  $$ SELECT public._scheduled_check_dead_letter_count() $$
);
