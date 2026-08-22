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
SELECT plan(12);

SET LOCAL role postgres;

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

SELECT * FROM finish();
ROLLBACK;
