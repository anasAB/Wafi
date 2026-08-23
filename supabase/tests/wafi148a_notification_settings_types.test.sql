-- supabase/tests/wafi148a_notification_settings_types.test.sql
-- WAFI-148A Task 9: notification_settings.type has NO CHECK constraint
-- (migration 080) -- deliberately not adding one here (see migration 121's
-- header for why enumerating every type string used across the whole app is
-- out of scope and too risky). Instead this test is the safety net for the
-- 8 new health-alert type identifiers specifically: it proves each one is
-- used SELF-CONSISTENTLY inside the evaluator function that owns it -- the
-- string used to look up notification_settings (the WHERE type = '...'
-- clause) is byte-for-byte the same string used later in that same
-- function's RAISE WARNING messages and its claim_health_alert_period /
-- claim_health_alert_transition call. A typo in any one of those spots would
-- silently create a disconnected type namespace (the settings lookup would
-- never match what the UI/claim path writes/expects) without this test
-- catching it.
--
-- Scope: only the 4 evaluators actually shipped so far (migrations 119 and
-- 120), covering 4 of the 8 identifiers (#3, #4, #7, #8). The other 4
-- (#1, #2, #5, #6) have no evaluator yet -- Task 10 is responsible for using
-- the exact strings recorded in migration 121's header / the design spec
-- when those are built; this test cannot check code that does not exist.
--
-- Method: pg_get_functiondef() over each function's already-installed body,
-- regexp-matched for the 'health_alert_...' identifier pattern, asserting
-- the DISTINCT set of matches found in that one function is exactly the
-- single expected string. If any occurrence used a different (typo'd)
-- string, the distinct set would have more than one member and this test
-- would fail.
--
-- Run via: npx supabase test db

BEGIN;
SELECT plan(8);

SET LOCAL role postgres;

-- ============================================================================
-- Section 1: self-consistency within each of the 4 shipped evaluators
-- ============================================================================

-- Test 1-2: _apply_health_alert_drawer_mismatch (migration 119) -- metric #4
SELECT ok(
  EXISTS (
    SELECT 1
      FROM pg_proc
     WHERE proname = '_apply_health_alert_drawer_mismatch'
       AND pronamespace = 'public'::regnamespace
  ),
  '_apply_health_alert_drawer_mismatch exists (metric #4 evaluator, migration 119)'
);

SELECT is(
  (
    -- Excludes the health_alert_state_a/health_alert_state_b/
    -- health_alert_evaluation_log TABLE names -- standalone identifiers
    -- (not substrings of a longer function-call name, so \m...\M alone
    -- doesn't filter them) that legitimately appear in these functions'
    -- bodies (FROM/INSERT INTO clauses) but are not notification_settings
    -- type strings.
    SELECT array_agg(DISTINCT m[1] ORDER BY m[1])
      FROM pg_proc,
           regexp_matches(pg_get_functiondef(pg_proc.oid), '\mhealth_alert_[a-z_]+\M', 'g') AS m
     WHERE m[1] NOT IN ('health_alert_state_a', 'health_alert_state_b', 'health_alert_evaluation_log')
       AND proname = '_apply_health_alert_drawer_mismatch'
       AND pronamespace = 'public'::regnamespace
  ),
  ARRAY['health_alert_drawer_mismatches'],
  '_apply_health_alert_drawer_mismatch uses exactly one health_alert_* string, spelled health_alert_drawer_mismatches, everywhere in its body (settings lookup, warnings, and the claim call all agree)'
);

-- Test 3-4: _scheduled_check_overdue_shifts (migration 120) -- metric #8
SELECT ok(
  EXISTS (
    SELECT 1
      FROM pg_proc
     WHERE proname = '_scheduled_check_overdue_shifts'
       AND pronamespace = 'public'::regnamespace
  ),
  '_scheduled_check_overdue_shifts exists (metric #8 evaluator, migration 120)'
);

SELECT is(
  (
    -- Excludes the health_alert_state_a/health_alert_state_b/
    -- health_alert_evaluation_log TABLE names -- standalone identifiers
    -- (not substrings of a longer function-call name, so \m...\M alone
    -- doesn't filter them) that legitimately appear in these functions'
    -- bodies (FROM/INSERT INTO clauses) but are not notification_settings
    -- type strings.
    SELECT array_agg(DISTINCT m[1] ORDER BY m[1])
      FROM pg_proc,
           regexp_matches(pg_get_functiondef(pg_proc.oid), '\mhealth_alert_[a-z_]+\M', 'g') AS m
     WHERE m[1] NOT IN ('health_alert_state_a', 'health_alert_state_b', 'health_alert_evaluation_log')
       AND proname = '_scheduled_check_overdue_shifts'
       AND pronamespace = 'public'::regnamespace
  ),
  ARRAY['health_alert_overdue_shift'],
  '_scheduled_check_overdue_shifts uses exactly one health_alert_* string, spelled health_alert_overdue_shift, everywhere in its body'
);

-- Test 5-6: _scheduled_check_dead_letter_count (migration 120) -- metric #3
SELECT ok(
  EXISTS (
    SELECT 1
      FROM pg_proc
     WHERE proname = '_scheduled_check_dead_letter_count'
       AND pronamespace = 'public'::regnamespace
  ),
  '_scheduled_check_dead_letter_count exists (metric #3 evaluator, migration 120)'
);

SELECT is(
  (
    -- Excludes the health_alert_state_a/health_alert_state_b/
    -- health_alert_evaluation_log TABLE names -- standalone identifiers
    -- (not substrings of a longer function-call name, so \m...\M alone
    -- doesn't filter them) that legitimately appear in these functions'
    -- bodies (FROM/INSERT INTO clauses) but are not notification_settings
    -- type strings.
    SELECT array_agg(DISTINCT m[1] ORDER BY m[1])
      FROM pg_proc,
           regexp_matches(pg_get_functiondef(pg_proc.oid), '\mhealth_alert_[a-z_]+\M', 'g') AS m
     WHERE m[1] NOT IN ('health_alert_state_a', 'health_alert_state_b', 'health_alert_evaluation_log')
       AND proname = '_scheduled_check_dead_letter_count'
       AND pronamespace = 'public'::regnamespace
  ),
  ARRAY['health_alert_dead_letter_count'],
  '_scheduled_check_dead_letter_count uses exactly one health_alert_* string, spelled health_alert_dead_letter_count, everywhere in its body'
);

-- Test 7-8: _scheduled_check_stale_devices (migration 120) -- metric #7
SELECT ok(
  EXISTS (
    SELECT 1
      FROM pg_proc
     WHERE proname = '_scheduled_check_stale_devices'
       AND pronamespace = 'public'::regnamespace
  ),
  '_scheduled_check_stale_devices exists (metric #7 evaluator, migration 120)'
);

SELECT is(
  (
    -- Excludes the health_alert_state_a/health_alert_state_b/
    -- health_alert_evaluation_log TABLE names -- standalone identifiers
    -- (not substrings of a longer function-call name, so \m...\M alone
    -- doesn't filter them) that legitimately appear in these functions'
    -- bodies (FROM/INSERT INTO clauses) but are not notification_settings
    -- type strings.
    SELECT array_agg(DISTINCT m[1] ORDER BY m[1])
      FROM pg_proc,
           regexp_matches(pg_get_functiondef(pg_proc.oid), '\mhealth_alert_[a-z_]+\M', 'g') AS m
     WHERE m[1] NOT IN ('health_alert_state_a', 'health_alert_state_b', 'health_alert_evaluation_log')
       AND proname = '_scheduled_check_stale_devices'
       AND pronamespace = 'public'::regnamespace
  ),
  ARRAY['health_alert_stale_device'],
  '_scheduled_check_stale_devices uses exactly one health_alert_* string, spelled health_alert_stale_device, everywhere in its body'
);

SELECT * FROM finish();
ROLLBACK;
