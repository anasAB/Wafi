-- supabase/tests/wafi148a_shape_b_evaluators.test.sql
-- WAFI-148A Task 5: proves the scheduled overdue-shift evaluator
-- (_scheduled_check_overdue_shifts / metric #8, migration 120) behaves
-- correctly: bootstrap alert, no-repeat on a second run, disabled-type skip,
-- invalid-threshold skip (including the explicitly-invalid zero case),
-- per-candidate failure isolation, timezone-independence of the
-- elapsed-duration comparison, and a closed shift being absent from the
-- open-shift candidate query.
--
-- This file is intentionally structured so Tasks 6 and 7 (dispatched after
-- this task, also targeting migration 120) can append their own sections
-- below without disturbing these fixtures/shops -- each section below uses
-- its own dedicated shop id.
--
-- Run via: npx supabase test db

BEGIN;
SELECT plan(37);

SET LOCAL role postgres;

-- WAFI-148A Task 11: migration 123 gates the claim paths of
-- _scheduled_check_overdue_shifts, _scheduled_check_dead_letter_count, and
-- _scheduled_check_stale_devices behind the WAFI-155 'health_alerting'
-- rollout flag, fail-closed (default disabled). This file's fixtures predate
-- that gate and rely on claims firing by default, so default every new
-- shops row in this transaction to flag-enabled -- rolled back with the rest
-- of the transaction, so this has no effect outside this test file.
ALTER TABLE public.shops ALTER COLUMN features
  SET DEFAULT jsonb_build_object('rollout', jsonb_build_object('health_alerting', true));

-- ============================================================================
-- Section 1: bootstrap + no-repeat (Shop N)
-- ============================================================================
INSERT INTO public.shops (id, name, timezone) VALUES
  ('66666666-7777-8888-9999-aaaaaaaaaaaa', 'Shop N', 'Asia/Damascus');

INSERT INTO public.devices (id, shop_id, code) VALUES
  ('66666666-7777-8888-9999-bbbbbbbbbbbb', '66666666-7777-8888-9999-aaaaaaaaaaaa', 'DEV-N-1');

INSERT INTO public.notification_settings (shop_id, type, enabled, threshold_json)
VALUES (
  '66666666-7777-8888-9999-aaaaaaaaaaaa',
  'health_alert_overdue_shift',
  true,
  jsonb_build_object('threshold', 8)
);

-- An open shift, opened 10 hours ago -- past the 8-hour threshold, never
-- before evaluated.
INSERT INTO public.cashier_shifts (id, shop_id, device_id, opened_at, opening_cash_usd, status)
VALUES (
  '66666666-7777-8888-9999-cccccccccccc',
  '66666666-7777-8888-9999-aaaaaaaaaaaa',
  '66666666-7777-8888-9999-bbbbbbbbbbbb',
  now() - interval '10 hours',
  0, 'open'
);

SELECT public._scheduled_check_overdue_shifts();

-- Test 1: bootstrap case produces exactly one notification, CRITICAL,
-- entity_type='shift'.
SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = '66666666-7777-8888-9999-aaaaaaaaaaaa' AND type = 'health_alert_overdue_shift'),
  1,
  'bootstrap: an open shift past threshold produces exactly one notification'
);
SELECT is(
  (SELECT severity FROM public.notifications
     WHERE shop_id = '66666666-7777-8888-9999-aaaaaaaaaaaa' AND type = 'health_alert_overdue_shift'),
  'CRITICAL',
  'bootstrap notification severity is CRITICAL'
);
SELECT is(
  (SELECT entity_type FROM public.notifications
     WHERE shop_id = '66666666-7777-8888-9999-aaaaaaaaaaaa' AND type = 'health_alert_overdue_shift'),
  'shift',
  'bootstrap notification entity_type is shift'
);
SELECT is(
  (SELECT entity_id FROM public.notifications
     WHERE shop_id = '66666666-7777-8888-9999-aaaaaaaaaaaa' AND type = 'health_alert_overdue_shift'),
  '66666666-7777-8888-9999-cccccccccccc',
  'bootstrap notification entity_id is the real shift_id, not a shop-level sentinel'
);
SELECT is(
  (SELECT state FROM public.health_alert_state_b
     WHERE shop_id = '66666666-7777-8888-9999-aaaaaaaaaaaa' AND alert_key = 'overdue_shift'
       AND entity_id = '66666666-7777-8888-9999-cccccccccccc'),
  'ALERTING',
  'health_alert_state_b row transitioned to ALERTING for this shift'
);

-- Test 2 (no-repeat): a second scheduled run, same still-open overdue shift,
-- produces zero ADDITIONAL notifications.
SELECT public._scheduled_check_overdue_shifts();

SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = '66666666-7777-8888-9999-aaaaaaaaaaaa' AND type = 'health_alert_overdue_shift'),
  1,
  'no-repeat: a second scheduled run on the same still-open overdue shift produces zero additional notifications'
);

-- ============================================================================
-- Section 2: disabled-type skip (Shop O)
-- ============================================================================
INSERT INTO public.shops (id, name, timezone) VALUES
  ('77777777-8888-9999-aaaa-bbbbbbbbbbbb', 'Shop O (disabled)', 'Asia/Damascus');

INSERT INTO public.devices (id, shop_id, code) VALUES
  ('77777777-8888-9999-aaaa-cccccccccccc', '77777777-8888-9999-aaaa-bbbbbbbbbbbb', 'DEV-O-1');

INSERT INTO public.notification_settings (shop_id, type, enabled, threshold_json)
VALUES (
  '77777777-8888-9999-aaaa-bbbbbbbbbbbb',
  'health_alert_overdue_shift',
  false,
  jsonb_build_object('threshold', 1)
);

INSERT INTO public.cashier_shifts (id, shop_id, device_id, opened_at, opening_cash_usd, status)
VALUES (
  '77777777-8888-9999-aaaa-dddddddddddd',
  '77777777-8888-9999-aaaa-bbbbbbbbbbbb',
  '77777777-8888-9999-aaaa-cccccccccccc',
  now() - interval '48 hours',
  0, 'open'
);

SELECT public._scheduled_check_overdue_shifts();

SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = '77777777-8888-9999-aaaa-bbbbbbbbbbbb' AND type = 'health_alert_overdue_shift'),
  0,
  'disabled-type: a disabled notification_settings row never claims, regardless of how overdue the shift is'
);

-- ============================================================================
-- Section 3: invalid-threshold skip, including the explicitly-invalid zero
-- case (Shop P for zero, Shop Q for non-numeric)
-- ============================================================================
INSERT INTO public.shops (id, name, timezone) VALUES
  ('88888888-9999-aaaa-bbbb-cccccccccccc', 'Shop P (zero threshold)', 'Asia/Damascus');

INSERT INTO public.devices (id, shop_id, code) VALUES
  ('88888888-9999-aaaa-bbbb-dddddddddddd', '88888888-9999-aaaa-bbbb-cccccccccccc', 'DEV-P-1');

INSERT INTO public.notification_settings (shop_id, type, enabled, threshold_json)
VALUES (
  '88888888-9999-aaaa-bbbb-cccccccccccc',
  'health_alert_overdue_shift',
  true,
  jsonb_build_object('threshold', 0)
);

INSERT INTO public.cashier_shifts (id, shop_id, device_id, opened_at, opening_cash_usd, status)
VALUES (
  '88888888-9999-aaaa-bbbb-eeeeeeeeeeee',
  '88888888-9999-aaaa-bbbb-cccccccccccc',
  '88888888-9999-aaaa-bbbb-dddddddddddd',
  now() - interval '1 hour',
  0, 'open'
);

SELECT public._scheduled_check_overdue_shifts();

SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = '88888888-9999-aaaa-bbbb-cccccccccccc' AND type = 'health_alert_overdue_shift'),
  0,
  'invalid-threshold: a zero threshold is explicitly invalid for this metric and is skipped, not treated as "always overdue"'
);

-- ============================================================================
-- Section 4: per-candidate isolation. Shop R's configured threshold is a
-- numeric value so large that casting it to an interval
-- ((v_threshold_hrs || ' hours')::interval) overflows PostgreSQL's internal
-- interval range and RAISEs an uncaught error -- this is deliberately NOT
-- the numeric-cast failure already handled by the evaluator's inner
-- BEGIN...EXCEPTION block (that one only wraps the threshold_json ->>
-- 'threshold' parse); this overflow happens one line later, in the actual
-- overdue-comparison arithmetic, and is only caught by the evaluator's OUTER
-- per-candidate BEGIN...EXCEPTION WHEN OTHERS block. Shop T, evaluated in
-- the very same scheduled run, has a normal threshold and a genuinely
-- overdue shift, and must still be evaluated and alerted -- proving the
-- failure on Shop R's candidate did not abort the loop.
-- ============================================================================
INSERT INTO public.shops (id, name, timezone) VALUES
  ('99999999-aaaa-bbbb-cccc-dddddddddddd', 'Shop R (malformed candidate)', 'Asia/Damascus');

INSERT INTO public.devices (id, shop_id, code) VALUES
  ('99999999-aaaa-bbbb-cccc-eeeeeeeeeeee', '99999999-aaaa-bbbb-cccc-dddddddddddd', 'DEV-R-1');

-- A threshold so large that ('...' || ' hours')::interval overflows
-- Postgres's internal interval range (interval is stored as a 64-bit
-- microsecond count internally) -- this raises, uncaught by the inner
-- numeric-parse exception block, and must be caught by the OUTER
-- per-candidate block instead.
INSERT INTO public.notification_settings (shop_id, type, enabled, threshold_json)
VALUES (
  '99999999-aaaa-bbbb-cccc-dddddddddddd',
  'health_alert_overdue_shift',
  true,
  jsonb_build_object('threshold', 100000000000000000000)
);

INSERT INTO public.cashier_shifts (id, shop_id, device_id, opened_at, opening_cash_usd, status)
VALUES (
  '99999999-aaaa-bbbb-cccc-ffffffffffff',
  '99999999-aaaa-bbbb-cccc-dddddddddddd',
  '99999999-aaaa-bbbb-cccc-eeeeeeeeeeee',
  now() - interval '6 hours', 0, 'open'
);

-- Shop T: a normal, healthy candidate evaluated in the same run.
INSERT INTO public.shops (id, name, timezone) VALUES
  ('99999999-aaaa-bbbb-cccc-222222222222', 'Shop T (healthy sibling candidate)', 'Asia/Damascus');

INSERT INTO public.devices (id, shop_id, code) VALUES
  ('99999999-aaaa-bbbb-cccc-333333333333', '99999999-aaaa-bbbb-cccc-222222222222', 'DEV-T-1');

INSERT INTO public.notification_settings (shop_id, type, enabled, threshold_json)
VALUES (
  '99999999-aaaa-bbbb-cccc-222222222222',
  'health_alert_overdue_shift',
  true,
  jsonb_build_object('threshold', 4)
);

INSERT INTO public.cashier_shifts (id, shop_id, device_id, opened_at, opening_cash_usd, status)
VALUES (
  '99999999-aaaa-bbbb-cccc-444444444444',
  '99999999-aaaa-bbbb-cccc-222222222222',
  '99999999-aaaa-bbbb-cccc-333333333333',
  now() - interval '5 hours', 0, 'open'
);

SELECT public._scheduled_check_overdue_shifts();

-- Test: the malformed Shop R candidate's overflow error does not prevent
-- Shop T's healthy candidate, evaluated later in the same loop, from being
-- alerted.
SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = '99999999-aaaa-bbbb-cccc-222222222222' AND type = 'health_alert_overdue_shift'
       AND entity_id = '99999999-aaaa-bbbb-cccc-444444444444'),
  1,
  'per-candidate isolation: a malformed candidate (interval-overflow threshold) does not block evaluation/alerting of a sibling candidate in the same run'
);
SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = '99999999-aaaa-bbbb-cccc-dddddddddddd' AND type = 'health_alert_overdue_shift'
       AND entity_id = '99999999-aaaa-bbbb-cccc-ffffffffffff'),
  0,
  'per-candidate isolation: the malformed candidate itself did not get a notification (its own evaluation raised and was caught)'
);

-- ============================================================================
-- Section 5: timezone-independence (Shop S, non-UTC timezone e.g. a
-- negative-offset zone, to contrast with Asia/Damascus used elsewhere)
-- ============================================================================
INSERT INTO public.shops (id, name, timezone) VALUES
  ('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'Shop S (non-UTC, negative offset)', 'America/New_York');

INSERT INTO public.devices (id, shop_id, code) VALUES
  ('aaaaaaaa-bbbb-cccc-dddd-ffffffffffff', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'DEV-S-1');

INSERT INTO public.notification_settings (shop_id, type, enabled, threshold_json)
VALUES (
  'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  'health_alert_overdue_shift',
  true,
  jsonb_build_object('threshold', 8)
);

-- Opened 9 real elapsed hours ago. If the evaluator incorrectly bucketed by
-- shop-local calendar day (e.g. only compared against "today" in
-- America/New_York) rather than absolute elapsed time, this could produce a
-- wrong result depending on wall-clock/day-boundary interaction; the
-- absolute-interval comparison used here must fire correctly regardless.
INSERT INTO public.cashier_shifts (id, shop_id, device_id, opened_at, opening_cash_usd, status)
VALUES (
  'aaaaaaaa-bbbb-cccc-dddd-111111111111',
  'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  'aaaaaaaa-bbbb-cccc-dddd-ffffffffffff',
  now() - interval '9 hours',
  0, 'open'
);

SELECT public._scheduled_check_overdue_shifts();

SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' AND type = 'health_alert_overdue_shift'),
  1,
  'timezone-independence: a shop in a non-UTC (negative offset) timezone still alerts correctly on absolute elapsed duration, not a shop-local-day bucket'
);

-- ============================================================================
-- Section 6: a CLOSED shift, otherwise "overdue" by opened_at, is simply
-- absent from the candidate query (WHERE status = 'open') -- the scheduled
-- check must never claim/notify for it. This is distinct from the
-- resolve-on-close path (owned exclusively by the shift.closed trigger
-- extension, migration 119/Task 4); here we assert the scheduled check
-- alone, with no shift.closed event involved, correctly does nothing for a
-- shift that is already closed.
-- ============================================================================
INSERT INTO public.shops (id, name, timezone) VALUES
  ('bbbbbbbb-cccc-dddd-eeee-ffffffffffff', 'Shop U (closed shift)', 'Asia/Damascus');

INSERT INTO public.devices (id, shop_id, code) VALUES
  ('bbbbbbbb-cccc-dddd-eeee-111111111111', 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff', 'DEV-U-1');

INSERT INTO public.notification_settings (shop_id, type, enabled, threshold_json)
VALUES (
  'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
  'health_alert_overdue_shift',
  true,
  jsonb_build_object('threshold', 4)
);

-- Opened 48 hours ago (well past the 4-hour threshold) but already closed --
-- must not appear in the status='open' candidate query at all.
INSERT INTO public.cashier_shifts (id, shop_id, device_id, opened_at, closed_at, opening_cash_usd, closing_cash_usd, status)
VALUES (
  'bbbbbbbb-cccc-dddd-eeee-222222222222',
  'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
  'bbbbbbbb-cccc-dddd-eeee-111111111111',
  now() - interval '48 hours',
  now() - interval '1 hour',
  0, 0, 'closed'
);

SELECT public._scheduled_check_overdue_shifts();

SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff' AND type = 'health_alert_overdue_shift'),
  0,
  'a closed shift, otherwise overdue by opened_at, is absent from the status=open candidate query -- no notification'
);

-- ============================================================================
-- Task 7: metric #3 (dead-letter count) evaluator
-- (_scheduled_check_dead_letter_count / migration 120). Sections 7-10 below
-- each use their own dedicated shop id(s), per this file's stated convention.
-- ============================================================================

-- ============================================================================
-- Section 7: bootstrap (Shop V) -- gauge already over threshold at first
-- evaluation produces exactly one notification, using the exact sentinel
-- entity_id constant from Task 3/migration 117.
-- ============================================================================
INSERT INTO public.shops (id, name, timezone) VALUES
  ('cccccccc-dddd-eeee-ffff-000000000001', 'Shop V (dead-letter bootstrap)', 'Asia/Damascus');

INSERT INTO public.devices (id, shop_id, code) VALUES
  ('cccccccc-dddd-eeee-ffff-000000000002', 'cccccccc-dddd-eeee-ffff-000000000001', 'DEV-V-1');

INSERT INTO public.notification_settings (shop_id, type, enabled, threshold_json)
VALUES (
  'cccccccc-dddd-eeee-ffff-000000000001',
  'health_alert_dead_letter_count',
  true,
  jsonb_build_object('threshold', 5)
);

INSERT INTO public.health_gauges (shop_id, device_id, gauge_key, value, observed_at)
VALUES (
  'cccccccc-dddd-eeee-ffff-000000000001',
  'cccccccc-dddd-eeee-ffff-000000000002',
  'dead_letter_count', 10, now()
);

SELECT public._scheduled_check_dead_letter_count();

SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = 'cccccccc-dddd-eeee-ffff-000000000001' AND type = 'health_alert_dead_letter_count'),
  1,
  'dead-letter bootstrap: a gauge already over threshold at first evaluation produces exactly one notification'
);
SELECT is(
  (SELECT severity FROM public.notifications
     WHERE shop_id = 'cccccccc-dddd-eeee-ffff-000000000001' AND type = 'health_alert_dead_letter_count'),
  'CRITICAL',
  'dead-letter bootstrap notification severity is CRITICAL'
);
SELECT is(
  (SELECT entity_id FROM public.notifications
     WHERE shop_id = 'cccccccc-dddd-eeee-ffff-000000000001' AND type = 'health_alert_dead_letter_count'),
  '00000000-0000-0000-0000-000000000000',
  'dead-letter bootstrap notification entity_id is the exact shop-level sentinel constant, not a real device id'
);
SELECT is(
  (SELECT state FROM public.health_alert_state_b
     WHERE shop_id = 'cccccccc-dddd-eeee-ffff-000000000001' AND alert_key = 'dead_letter_count'
       AND entity_id = '00000000-0000-0000-0000-000000000000'),
  'ALERTING',
  'health_alert_state_b row transitioned to ALERTING using the sentinel entity_id'
);

-- ============================================================================
-- Section 8: recovery-then-realert (Shop W) -- gauge rises, falls back under
-- threshold, rises again -> exactly two notifications (one per
-- HEALTHY->ALERTING transition), zero while continuously above threshold
-- across multiple ticks.
-- ============================================================================
INSERT INTO public.shops (id, name, timezone) VALUES
  ('cccccccc-dddd-eeee-ffff-000000000010', 'Shop W (dead-letter recovery/re-alert)', 'Asia/Damascus');

INSERT INTO public.devices (id, shop_id, code) VALUES
  ('cccccccc-dddd-eeee-ffff-000000000011', 'cccccccc-dddd-eeee-ffff-000000000010', 'DEV-W-1');

INSERT INTO public.notification_settings (shop_id, type, enabled, threshold_json)
VALUES (
  'cccccccc-dddd-eeee-ffff-000000000010',
  'health_alert_dead_letter_count',
  true,
  jsonb_build_object('threshold', 5)
);

-- Tick 1: rises above threshold -> first ALERTING transition, one notification.
INSERT INTO public.health_gauges (shop_id, device_id, gauge_key, value, observed_at)
VALUES ('cccccccc-dddd-eeee-ffff-000000000010', 'cccccccc-dddd-eeee-ffff-000000000011', 'dead_letter_count', 8, now());

SELECT public._scheduled_check_dead_letter_count();

-- Tick 2: still above threshold, unchanged -- must NOT produce an additional
-- notification while continuously above threshold.
SELECT public._scheduled_check_dead_letter_count();

SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = 'cccccccc-dddd-eeee-ffff-000000000010' AND type = 'health_alert_dead_letter_count'),
  1,
  'recovery/re-alert: continuously above threshold across multiple ticks produces only the one initial notification'
);

-- Tick 3: falls back under threshold -> resolves to HEALTHY, silently (no notification).
UPDATE public.health_gauges
   SET value = 2, observed_at = now()
 WHERE shop_id = 'cccccccc-dddd-eeee-ffff-000000000010'
   AND device_id = 'cccccccc-dddd-eeee-ffff-000000000011';

SELECT public._scheduled_check_dead_letter_count();

SELECT is(
  (SELECT state FROM public.health_alert_state_b
     WHERE shop_id = 'cccccccc-dddd-eeee-ffff-000000000010' AND alert_key = 'dead_letter_count'
       AND entity_id = '00000000-0000-0000-0000-000000000000'),
  'HEALTHY',
  'recovery/re-alert: gauge falling back under threshold resolves the alert state to HEALTHY'
);
SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = 'cccccccc-dddd-eeee-ffff-000000000010' AND type = 'health_alert_dead_letter_count'),
  1,
  'recovery/re-alert: the recovery tick itself is silent -- still only one notification total'
);

-- Tick 4: rises again above threshold -> second HEALTHY->ALERTING transition,
-- exactly one more notification (two total).
UPDATE public.health_gauges
   SET value = 9, observed_at = now()
 WHERE shop_id = 'cccccccc-dddd-eeee-ffff-000000000010'
   AND device_id = 'cccccccc-dddd-eeee-ffff-000000000011';

SELECT public._scheduled_check_dead_letter_count();

SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = 'cccccccc-dddd-eeee-ffff-000000000010' AND type = 'health_alert_dead_letter_count'),
  2,
  'recovery/re-alert: rising above threshold again after recovery produces exactly one more notification (two total)'
);

-- ============================================================================
-- Section 9: multi-device MAX aggregation (Shop X) -- two devices, one with a
-- high value (over threshold) and one with a low value (under threshold).
-- The alert must fire based on MAX(value), not the average or sum across
-- devices -- this is the correctness-critical test for the spec-gap ruling.
-- ============================================================================
INSERT INTO public.shops (id, name, timezone) VALUES
  ('cccccccc-dddd-eeee-ffff-000000000020', 'Shop X (multi-device MAX aggregation)', 'Asia/Damascus');

INSERT INTO public.devices (id, shop_id, code) VALUES
  ('cccccccc-dddd-eeee-ffff-000000000021', 'cccccccc-dddd-eeee-ffff-000000000020', 'DEV-X-1'),
  ('cccccccc-dddd-eeee-ffff-000000000022', 'cccccccc-dddd-eeee-ffff-000000000020', 'DEV-X-2');

INSERT INTO public.notification_settings (shop_id, type, enabled, threshold_json)
VALUES (
  'cccccccc-dddd-eeee-ffff-000000000020',
  'health_alert_dead_letter_count',
  true,
  jsonb_build_object('threshold', 5)
);

-- Device 1: high value, over threshold. Device 2: low value, under threshold.
-- Sum would be 12+1=13 (also over) and average would be 6.5 (also over), so
-- this alone would not distinguish MAX from those aggregations -- the
-- distinguishing assertion is Section 9b below (both under threshold
-- individually, but a naive SUM would push them over).
INSERT INTO public.health_gauges (shop_id, device_id, gauge_key, value, observed_at) VALUES
  ('cccccccc-dddd-eeee-ffff-000000000020', 'cccccccc-dddd-eeee-ffff-000000000021', 'dead_letter_count', 12, now()),
  ('cccccccc-dddd-eeee-ffff-000000000020', 'cccccccc-dddd-eeee-ffff-000000000022', 'dead_letter_count', 1, now());

SELECT public._scheduled_check_dead_letter_count();

SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = 'cccccccc-dddd-eeee-ffff-000000000020' AND type = 'health_alert_dead_letter_count'),
  1,
  'multi-device MAX: alert fires when at least one device is over threshold, even though the other device is well under'
);

-- Section 9b: SUM-would-fire-but-MAX-should-not case (Shop Y). Two devices
-- each individually UNDER threshold (3 and 3, threshold 5), but whose SUM (6)
-- would be over threshold. MAX (3) is correctly under threshold -- no alert.
INSERT INTO public.shops (id, name, timezone) VALUES
  ('cccccccc-dddd-eeee-ffff-000000000030', 'Shop Y (MAX vs SUM distinguishing case)', 'Asia/Damascus');

INSERT INTO public.devices (id, shop_id, code) VALUES
  ('cccccccc-dddd-eeee-ffff-000000000031', 'cccccccc-dddd-eeee-ffff-000000000030', 'DEV-Y-1'),
  ('cccccccc-dddd-eeee-ffff-000000000032', 'cccccccc-dddd-eeee-ffff-000000000030', 'DEV-Y-2');

INSERT INTO public.notification_settings (shop_id, type, enabled, threshold_json)
VALUES (
  'cccccccc-dddd-eeee-ffff-000000000030',
  'health_alert_dead_letter_count',
  true,
  jsonb_build_object('threshold', 5)
);

INSERT INTO public.health_gauges (shop_id, device_id, gauge_key, value, observed_at) VALUES
  ('cccccccc-dddd-eeee-ffff-000000000030', 'cccccccc-dddd-eeee-ffff-000000000031', 'dead_letter_count', 3, now()),
  ('cccccccc-dddd-eeee-ffff-000000000030', 'cccccccc-dddd-eeee-ffff-000000000032', 'dead_letter_count', 3, now());

SELECT public._scheduled_check_dead_letter_count();

SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = 'cccccccc-dddd-eeee-ffff-000000000030' AND type = 'health_alert_dead_letter_count'),
  0,
  'multi-device MAX: two devices individually under threshold produce no alert, even though their SUM would exceed it'
);

-- ============================================================================
-- Section 10: disabled-type skip (Shop Z).
-- ============================================================================
INSERT INTO public.shops (id, name, timezone) VALUES
  ('cccccccc-dddd-eeee-ffff-000000000040', 'Shop Z (dead-letter disabled)', 'Asia/Damascus');

INSERT INTO public.devices (id, shop_id, code) VALUES
  ('cccccccc-dddd-eeee-ffff-000000000041', 'cccccccc-dddd-eeee-ffff-000000000040', 'DEV-Z-1');

INSERT INTO public.notification_settings (shop_id, type, enabled, threshold_json)
VALUES (
  'cccccccc-dddd-eeee-ffff-000000000040',
  'health_alert_dead_letter_count',
  false,
  jsonb_build_object('threshold', 1)
);

INSERT INTO public.health_gauges (shop_id, device_id, gauge_key, value, observed_at)
VALUES ('cccccccc-dddd-eeee-ffff-000000000040', 'cccccccc-dddd-eeee-ffff-000000000041', 'dead_letter_count', 99, now());

SELECT public._scheduled_check_dead_letter_count();

SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = 'cccccccc-dddd-eeee-ffff-000000000040' AND type = 'health_alert_dead_letter_count'),
  0,
  'dead-letter disabled-type: a disabled notification_settings row never claims, regardless of gauge value'
);

-- ============================================================================
-- Task 8: metric #7 (stale devices) evaluator
-- (_scheduled_check_stale_devices / migration 120). Sections 11-15 below each
-- use their own dedicated shop id(s).
-- ============================================================================

-- ============================================================================
-- Section 11: new-candidate discovery (Shop AA) -- an eligible, active device
-- past the threshold produces exactly one notification: WARNING severity
-- (not CRITICAL -- that's reserved for metric #8), entity_type='device',
-- entity_id is the real device id (no shop-level sentinel).
-- ============================================================================
INSERT INTO public.shops (id, name, timezone) VALUES
  ('dddddddd-eeee-ffff-0000-000000000001', 'Shop AA (stale device bootstrap)', 'Asia/Damascus');

INSERT INTO public.devices (id, shop_id, code, is_active, last_seen_at) VALUES
  ('dddddddd-eeee-ffff-0000-000000000002', 'dddddddd-eeee-ffff-0000-000000000001', 'DEV-AA-1', true, now() - interval '30 hours');

INSERT INTO public.notification_settings (shop_id, type, enabled, threshold_json)
VALUES (
  'dddddddd-eeee-ffff-0000-000000000001',
  'health_alert_stale_device',
  true,
  jsonb_build_object('threshold', 24)
);

SELECT public._scheduled_check_stale_devices();

SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = 'dddddddd-eeee-ffff-0000-000000000001' AND type = 'health_alert_stale_device'),
  1,
  'stale-device bootstrap: an active device past the threshold produces exactly one notification'
);
SELECT is(
  (SELECT severity FROM public.notifications
     WHERE shop_id = 'dddddddd-eeee-ffff-0000-000000000001' AND type = 'health_alert_stale_device'),
  'WARNING',
  'stale-device bootstrap notification severity is WARNING, not CRITICAL'
);
SELECT is(
  (SELECT entity_type FROM public.notifications
     WHERE shop_id = 'dddddddd-eeee-ffff-0000-000000000001' AND type = 'health_alert_stale_device'),
  'device',
  'stale-device bootstrap notification entity_type is device'
);
SELECT is(
  (SELECT entity_id FROM public.notifications
     WHERE shop_id = 'dddddddd-eeee-ffff-0000-000000000001' AND type = 'health_alert_stale_device'),
  'dddddddd-eeee-ffff-0000-000000000002',
  'stale-device bootstrap notification entity_id is the real device id, not a shop-level sentinel'
);

-- ============================================================================
-- Section 12: recovery via freshness (Shop BB) -- a device that was stale and
-- ALERTING becomes fresh again (last_seen_at updated) -> Query B resolves the
-- alert to HEALTHY on the next tick.
-- ============================================================================
INSERT INTO public.shops (id, name, timezone) VALUES
  ('dddddddd-eeee-ffff-0000-000000000010', 'Shop BB (stale device recovery via freshness)', 'Asia/Damascus');

INSERT INTO public.devices (id, shop_id, code, is_active, last_seen_at) VALUES
  ('dddddddd-eeee-ffff-0000-000000000011', 'dddddddd-eeee-ffff-0000-000000000010', 'DEV-BB-1', true, now() - interval '30 hours');

INSERT INTO public.notification_settings (shop_id, type, enabled, threshold_json)
VALUES (
  'dddddddd-eeee-ffff-0000-000000000010',
  'health_alert_stale_device',
  true,
  jsonb_build_object('threshold', 24)
);

-- Tick 1: stale -> ALERTING.
SELECT public._scheduled_check_stale_devices();

SELECT is(
  (SELECT state FROM public.health_alert_state_b
     WHERE shop_id = 'dddddddd-eeee-ffff-0000-000000000010' AND alert_key = 'stale_device'
       AND entity_id = 'dddddddd-eeee-ffff-0000-000000000011'),
  'ALERTING',
  'recovery-via-freshness setup: the stale device is ALERTING after tick 1'
);

-- Device syncs again -- now fresh.
UPDATE public.devices SET last_seen_at = now()
 WHERE id = 'dddddddd-eeee-ffff-0000-000000000011';

-- Tick 2: Query B must notice the now-fresh device (still is_active=true, so
-- it would ALSO still be excluded from claiming again by Query A's threshold
-- comparison, but resolution here is specifically Query B's job).
SELECT public._scheduled_check_stale_devices();

SELECT is(
  (SELECT state FROM public.health_alert_state_b
     WHERE shop_id = 'dddddddd-eeee-ffff-0000-000000000010' AND alert_key = 'stale_device'
       AND entity_id = 'dddddddd-eeee-ffff-0000-000000000011'),
  'HEALTHY',
  'recovery-via-freshness: a stale ALERTING device that becomes fresh again is resolved to HEALTHY on the next tick'
);

-- ============================================================================
-- Section 13: recovery via disappearance (Shop CC) -- THE round-3 fix. A
-- stale device is ALERTING; it is then deactivated (is_active=false). This
-- test explicitly proves Query B (not Query A) does the resolving: first we
-- confirm the deactivated device is genuinely absent from a manual run of
-- Query A's own predicate (is_active = true), THEN we run the full evaluator
-- and confirm the existing ALERTING row was resolved anyway. If only Query A
-- ran, this device would never be reconsidered at all (it has dropped out of
-- the candidate population), so the resolution could only come from Query B.
-- ============================================================================
INSERT INTO public.shops (id, name, timezone) VALUES
  ('dddddddd-eeee-ffff-0000-000000000020', 'Shop CC (stale device recovery via disappearance)', 'Asia/Damascus');

INSERT INTO public.devices (id, shop_id, code, is_active, last_seen_at) VALUES
  ('dddddddd-eeee-ffff-0000-000000000021', 'dddddddd-eeee-ffff-0000-000000000020', 'DEV-CC-1', true, now() - interval '30 hours');

INSERT INTO public.notification_settings (shop_id, type, enabled, threshold_json)
VALUES (
  'dddddddd-eeee-ffff-0000-000000000020',
  'health_alert_stale_device',
  true,
  jsonb_build_object('threshold', 24)
);

-- Tick 1: stale -> ALERTING.
SELECT public._scheduled_check_stale_devices();

SELECT is(
  (SELECT state FROM public.health_alert_state_b
     WHERE shop_id = 'dddddddd-eeee-ffff-0000-000000000020' AND alert_key = 'stale_device'
       AND entity_id = 'dddddddd-eeee-ffff-0000-000000000021'),
  'ALERTING',
  'recovery-via-disappearance setup: the stale device is ALERTING after tick 1'
);

-- Device is deactivated (lost/retired device workflow).
UPDATE public.devices SET is_active = false
 WHERE id = 'dddddddd-eeee-ffff-0000-000000000021';

-- Prove the deactivated device is genuinely absent from Query A's own
-- predicate (is_active = true) -- i.e. Query A alone could never resolve it,
-- because it never even sees this row again.
SELECT is(
  (SELECT count(*)::int FROM public.devices
     WHERE id = 'dddddddd-eeee-ffff-0000-000000000021' AND is_active = true),
  0,
  'recovery-via-disappearance: the deactivated device is genuinely absent from Query A''s own is_active=true predicate'
);

-- Tick 2: run the full evaluator. The disappearance can only be noticed by
-- Query B (which starts from the existing ALERTING row), not Query A.
SELECT public._scheduled_check_stale_devices();

SELECT is(
  (SELECT state FROM public.health_alert_state_b
     WHERE shop_id = 'dddddddd-eeee-ffff-0000-000000000020' AND alert_key = 'stale_device'
       AND entity_id = 'dddddddd-eeee-ffff-0000-000000000021'),
  'HEALTHY',
  'recovery-via-disappearance: a deactivated device''s stale ALERTING row is resolved to HEALTHY by Query B, despite being absent from Query A''s candidate predicate'
);

-- ============================================================================
-- Section 14: multi-device shop (Shop DD) -- two devices, one stale+ALERTING,
-- one fresh, tracked independently with no cross-device interference.
-- ============================================================================
INSERT INTO public.shops (id, name, timezone) VALUES
  ('dddddddd-eeee-ffff-0000-000000000030', 'Shop DD (multi-device independence)', 'Asia/Damascus');

INSERT INTO public.devices (id, shop_id, code, is_active, last_seen_at) VALUES
  ('dddddddd-eeee-ffff-0000-000000000031', 'dddddddd-eeee-ffff-0000-000000000030', 'DEV-DD-1', true, now() - interval '30 hours'),
  ('dddddddd-eeee-ffff-0000-000000000032', 'dddddddd-eeee-ffff-0000-000000000030', 'DEV-DD-2', true, now() - interval '1 hour');

INSERT INTO public.notification_settings (shop_id, type, enabled, threshold_json)
VALUES (
  'dddddddd-eeee-ffff-0000-000000000030',
  'health_alert_stale_device',
  true,
  jsonb_build_object('threshold', 24)
);

SELECT public._scheduled_check_stale_devices();

SELECT is(
  (SELECT state FROM public.health_alert_state_b
     WHERE shop_id = 'dddddddd-eeee-ffff-0000-000000000030' AND alert_key = 'stale_device'
       AND entity_id = 'dddddddd-eeee-ffff-0000-000000000031'),
  'ALERTING',
  'multi-device independence: the stale device (DEV-DD-1) is ALERTING'
);
SELECT is(
  (SELECT count(*)::int FROM public.health_alert_state_b
     WHERE shop_id = 'dddddddd-eeee-ffff-0000-000000000030' AND alert_key = 'stale_device'
       AND entity_id = 'dddddddd-eeee-ffff-0000-000000000032'),
  0,
  'multi-device independence: the fresh device (DEV-DD-2) never got a health_alert_state_b row at all -- no cross-device interference'
);

-- ============================================================================
-- Section 15: disabled-type skip for Query A (Shop EE) -- a disabled
-- notification_settings row never claims a new alert, regardless of how
-- stale the device is.
-- ============================================================================
INSERT INTO public.shops (id, name, timezone) VALUES
  ('dddddddd-eeee-ffff-0000-000000000040', 'Shop EE (stale device disabled)', 'Asia/Damascus');

INSERT INTO public.devices (id, shop_id, code, is_active, last_seen_at) VALUES
  ('dddddddd-eeee-ffff-0000-000000000041', 'dddddddd-eeee-ffff-0000-000000000040', 'DEV-EE-1', true, now() - interval '999 hours');

INSERT INTO public.notification_settings (shop_id, type, enabled, threshold_json)
VALUES (
  'dddddddd-eeee-ffff-0000-000000000040',
  'health_alert_stale_device',
  false,
  jsonb_build_object('threshold', 1)
);

SELECT public._scheduled_check_stale_devices();

SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = 'dddddddd-eeee-ffff-0000-000000000040' AND type = 'health_alert_stale_device'),
  0,
  'stale-device disabled-type: a disabled notification_settings row never claims, regardless of how stale the device is'
);

SELECT * FROM finish();
ROLLBACK;
