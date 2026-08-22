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

-- ============================================================================
-- Task 8: Metric #7 (stale devices) -- scheduled evaluator with a genuine
-- TWO-QUERY model. This is the round-3 correctness fix: a single
-- eligible-candidate query cannot ever notice a device that has been
-- deactivated (or deleted) while its alert was ALERTING, because such a
-- device drops out of the eligible-candidate predicate entirely. Recovery
-- therefore CANNOT be "re-run the candidate query and see if it's still
-- there" -- it must be its own independent query that starts from existing
-- ALERTING rows, not from the eligible-device population.
--
-- Eligible-device predicate: this is a translation of the WHERE-clause LOGIC
-- in the client-side PowerSync/SQLite check src/services/notifications/
-- syncStalenessCheck.ts, not a literal call to that file (it has no
-- server-side equivalent). Verified against the actual devices table schema
-- (migrations 001, 037, 042): shop_id = ? AND is_active = true. is_active is
-- `boolean NOT NULL DEFAULT true` server-side, so unlike the client-side
-- query (which tolerated legacy nulls on already-synced local rows), no
-- null-check is needed here. There is no "onboarding-complete" column
-- anywhere in the schema -- the design spec's mention of it does not map to
-- any real column and is not implemented.
--
-- Threshold source: notification_settings.threshold_json for
-- type='health_alert_stale_device', shape {"threshold": <hours>}. Same
-- Option-A skip semantics as every other evaluator in this feature:
-- missing/disabled settings row -> skip entirely, no claim attempt;
-- missing/non-numeric/negative threshold -> skip + RAISE WARNING, never
-- invent a default. Zero IS a valid threshold for this metric ("stale after
-- 0 hours" is a valid, if aggressive, configuration) -- deliberately NOT
-- rejecting zero the way metric #8 does; that rejection was specific to
-- metric #8's elapsed-hours-since-open semantics, not a general rule.
--
-- Query A (new-alert discovery): candidates are active devices with a
-- non-null last_seen_at that is at least the shop's configured threshold in
-- the past. On match: claim_health_alert_transition(..., 'stale_device', ...,
-- 'health_alert_stale_device', ..., 'WARNING', 'device') -- severity WARNING
-- per the spec's Alert Definitions table (not CRITICAL, which is reserved
-- for metric #8), entity_type='device', entity_id=the real device id (no
-- shop-level sentinel -- this is genuinely per-device).
--
-- Query B (reconciliation) -- THE critical piece. A SEPARATE query over
-- existing health_alert_state_b rows with alert_key='stale_device' AND
-- state='ALERTING' (NOT the devices candidate list). For each such row,
-- independently re-check whether the device is now fresh (last_seen_at
-- within the shop's CURRENT threshold -- re-read per shop, since a shop may
-- have changed its threshold since the alert fired) OR no longer eligible at
-- all (deactivated: is_active=false, or deleted: no matching devices row).
-- Either condition resolves via resolve_health_alert_transition. If a shop's
-- notification_settings are missing/disabled/invalid at reconciliation time,
-- freshness cannot be determined for that shop -- this function's choice is
-- to skip freshness-based resolution for that ALERTING row on this tick (do
-- NOT guess a default threshold) while still resolving it via the
-- disappearance branch if the device is inactive/deleted. This is a
-- documented judgment call, not an accident.
--
-- Both queries run every scheduled tick, from the same cron job. Both use the
-- same per-candidate exception-isolation pattern as the other evaluators in
-- this file (implicit PL/pgSQL subtransaction via BEGIN...EXCEPTION WHEN
-- OTHERS, no explicit ROLLBACK).
-- ============================================================================

-- ============================================================================
-- _scheduled_check_stale_devices
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
  -- Query A: new-alert discovery. Candidates are drawn from the eligible
  -- device population directly (is_active = true, belongs to a shop, has a
  -- last_seen_at, past the shop's threshold). A device that is inactive or
  -- deleted simply never appears here -- that is exactly why Query B exists.
  -- ==========================================================================
  FOR v_device IN
    SELECT id, shop_id, last_seen_at
      FROM public.devices
     WHERE is_active = true
       AND last_seen_at IS NOT NULL
  LOOP
    BEGIN
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

      -- Zero IS a valid threshold for this metric -- deliberately not
      -- rejected, unlike metric #8's zero-rejection rule.
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
  -- Query B: reconciliation. Starts from EXISTING ALERTING rows, not from the
  -- eligible-device population -- this is the only way a deactivated/deleted
  -- device (which has already dropped out of Query A's WHERE is_active=true
  -- filter) can ever be noticed and resolved.
  -- ==========================================================================
  FOR v_alert IN
    SELECT shop_id, entity_id
      FROM public.health_alert_state_b
     WHERE alert_key = 'stale_device'
       AND state = 'ALERTING'
  LOOP
    BEGIN
      -- Independently look up the device's current row, if any. No matching
      -- row at all = deleted; is_active = false = deactivated. Either is a
      -- "no longer eligible" disappearance case.
      SELECT id, is_active, last_seen_at INTO v_dev
        FROM public.devices
       WHERE id = v_alert.entity_id
         AND shop_id = v_alert.shop_id;

      IF NOT FOUND OR NOT v_dev.is_active THEN
        -- Disappearance branch: resolve regardless of threshold/freshness --
        -- there is no eligible device left to be stale.
        PERFORM public.resolve_health_alert_transition(
          v_alert.shop_id,
          'stale_device',
          v_alert.entity_id
        );
        CONTINUE;
      END IF;

      -- Device still exists and is active -- re-check freshness against the
      -- shop's CURRENT threshold (it may have changed since the alert
      -- fired). Re-read notification_settings independently of Query A.
      SELECT * INTO v_settings
        FROM public.notification_settings
       WHERE shop_id = v_alert.shop_id
         AND type = 'health_alert_stale_device';

      IF NOT FOUND OR NOT v_settings.enabled OR v_settings.threshold_json IS NULL THEN
        -- Cannot determine freshness without a valid, enabled threshold for
        -- this shop right now. Documented choice: skip freshness-based
        -- resolution for this ALERTING row on this tick rather than guessing
        -- a default threshold. (The disappearance branch above already
        -- covers the case where the device itself is gone.)
        CONTINUE;
      END IF;

      BEGIN
        v_threshold_hrs := (v_settings.threshold_json ->> 'threshold')::numeric;
      EXCEPTION WHEN OTHERS THEN
        v_threshold_hrs := NULL;
      END;

      IF v_threshold_hrs IS NULL OR v_threshold_hrs < 0 THEN
        -- Same "cannot determine freshness" reasoning as above.
        CONTINUE;
      END IF;

      IF v_dev.last_seen_at IS NULL THEN
        -- No last_seen_at at all: cannot be "fresh". Leave ALERTING.
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
-- Indexes supporting Query A and Query B. EXPLAIN was not run against
-- realistic data volume in this environment (Docker/local Postgres
-- unavailable here, same established limitation as prior tasks in this
-- feature) -- these are the straightforward covering indexes for each
-- query's WHERE clause, not verified against a real query plan; revisit if
-- production EXPLAIN output suggests otherwise.
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_devices_shop_active_last_seen
  ON public.devices (shop_id, is_active, last_seen_at);

CREATE INDEX IF NOT EXISTS idx_health_alert_state_b_stale_device_alerting
  ON public.health_alert_state_b (shop_id, entity_id)
  WHERE alert_key = 'stale_device' AND state = 'ALERTING';

-- ============================================================================
-- pg_cron registration for the stale-device evaluator. Same idempotent
-- unschedule-then-schedule pattern, same 15-minute cadence, own separate job
-- (same batch-efficiency rationale as the dead-letter job above).
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wafi148a_stale_device_check') THEN
    PERFORM cron.unschedule('wafi148a_stale_device_check');
  END IF;
END $$;

SELECT cron.schedule(
  'wafi148a_stale_device_check',
  '*/15 * * * *',
  $$ SELECT public._scheduled_check_stale_devices() $$
);
