-- supabase/tests/wafi148a_shift_closed_extension.test.sql
-- WAFI-148A Task 4: proves the shift.closed dispatch trigger's two new
-- evaluators (_apply_health_alert_drawer_mismatch, _resolve_overdue_shift_alert),
-- wired in migration 119, behave correctly end-to-end from a single
-- `INSERT INTO events` -- no manual _apply_* call needed for the primary
-- path, matching the style of wafi148_health_projections_wiring.test.sql.
--
-- Known test gap (documented, not faked): the #8 resolve path
-- (_resolve_overdue_shift_alert) is tested here only in isolation, against a
-- manually-inserted health_alert_state_b row simulating what Task 5's
-- overdue-shift evaluator will eventually produce -- Task 5 does not exist
-- yet. A true round-trip (Task 5 evaluator flags a shift ALERTING, then a
-- later shift.closed event on the SAME shift resolves it) is deferred to a
-- follow-up once Task 5 ships.

BEGIN;
SELECT plan(13);

SET LOCAL role postgres;

-- WAFI-148A Task 11: migration 123 gates the claim path of
-- _apply_health_alert_drawer_mismatch behind the WAFI-155 'health_alerting'
-- rollout flag, fail-closed (default disabled). This file's fixtures predate
-- that gate and rely on claims firing by default, so default every new
-- shops row in this transaction to flag-enabled -- rolled back with the rest
-- of the transaction, so this has no effect outside this test file.
ALTER TABLE public.shops ALTER COLUMN features
  SET DEFAULT jsonb_build_object('rollout', jsonb_build_object('health_alerting', true));

INSERT INTO public.shops (id, name, timezone, timezone_confirmed_at) VALUES
  ('22222222-3333-4444-5555-666666666666', 'Shop K', 'Asia/Damascus', now());

-- Threshold config: enabled, threshold = 2. Chosen so that the FIRST
-- shift.closed event (bringing today's drawer_mismatch_count to 1) does NOT
-- fire, and the SECOND event (bringing the count to 2) DOES fire -- this is
-- also the ordering-sensitive case (test 3 below).
INSERT INTO public.notification_settings (shop_id, type, enabled, threshold_json)
VALUES (
  '22222222-3333-4444-5555-666666666666',
  'health_alert_drawer_mismatches',
  true,
  jsonb_build_object('threshold', 2)
);

-- ========================================================================
-- Test 1: a shift.closed event that leaves today's count BELOW threshold
-- (count becomes 1, threshold is 2) does not fire an alert.
-- ========================================================================
INSERT INTO public.events (id, shop_id, type, entity_id, payload, staff_id, occurred_at)
VALUES (
  '22222222-3333-4444-5555-000000000001',
  '22222222-3333-4444-5555-666666666666', 'shift.closed',
  '22222222-3333-4444-5555-666666666666',
  jsonb_build_object('variance', 20.00, 'shiftId', '22222222-3333-4444-5555-666666666666')::text,
  '00000000-0000-0000-0000-000000000000', now()
);

SELECT is(
  (SELECT value FROM public.health_metrics
     WHERE shop_id = '22222222-3333-4444-5555-666666666666'
       AND metric_key = 'drawer_mismatch_count'
       AND period_start = (now() AT TIME ZONE 'Asia/Damascus')::date),
  1::bigint, 'first shift.closed event brings drawer_mismatch_count to 1'
);
SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = '22222222-3333-4444-5555-666666666666' AND type = 'health_alert_drawer_mismatches'),
  0,
  'count of 1 is below threshold of 2 -- no notification fired'
);

-- ========================================================================
-- Test 2 + Test 3 (ordering): a SECOND shift.closed event pushes today's
-- count to 2, meeting the threshold. This is also the ordering-sensitive
-- case: if _apply_health_alert_drawer_mismatch read a STALE
-- pre-projection value (i.e. it ran BEFORE _apply_health_drawer_mismatch's
-- increment for THIS event), it would see 1, not 2, and incorrectly not
-- fire. Because migration 119 appends the alert evaluator AFTER the
-- existing projection call in _dispatch_health_projections_on_shift_closed,
-- it observes the post-projection value of 2 and fires correctly.
-- ========================================================================
INSERT INTO public.events (id, shop_id, type, entity_id, payload, staff_id, occurred_at)
VALUES (
  '22222222-3333-4444-5555-000000000002',
  '22222222-3333-4444-5555-666666666666', 'shift.closed',
  '22222222-3333-4444-5555-666666666666',
  jsonb_build_object('variance', 25.00, 'shiftId', '22222222-3333-4444-5555-777777777777')::text,
  '00000000-0000-0000-0000-000000000000', now()
);

SELECT is(
  (SELECT value FROM public.health_metrics
     WHERE shop_id = '22222222-3333-4444-5555-666666666666'
       AND metric_key = 'drawer_mismatch_count'
       AND period_start = (now() AT TIME ZONE 'Asia/Damascus')::date),
  2::bigint, 'second shift.closed event brings drawer_mismatch_count to 2'
);
SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = '22222222-3333-4444-5555-666666666666' AND type = 'health_alert_drawer_mismatches'),
  1,
  'ORDERING: post-projection count of 2 meets threshold -- exactly one notification fired for the second event (would be 0 if evaluated pre-projection)'
);
SELECT is(
  (SELECT source_event_id FROM public.notifications
     WHERE shop_id = '22222222-3333-4444-5555-666666666666' AND type = 'health_alert_drawer_mismatches'),
  '22222222-3333-4444-5555-000000000002'::uuid,
  'source_event_id on the notification is the triggering (second) event id'
);

-- ========================================================================
-- Test 4 (Shape A dedup): a THIRD shift.closed event the same day, count
-- still >= threshold, results in zero additional notifications -- Task 3's
-- claim_health_alert_period already claimed (shop, metric_key, period) for
-- today.
-- ========================================================================
INSERT INTO public.events (id, shop_id, type, entity_id, payload, staff_id, occurred_at)
VALUES (
  '22222222-3333-4444-5555-000000000003',
  '22222222-3333-4444-5555-666666666666', 'shift.closed',
  '22222222-3333-4444-5555-666666666666',
  jsonb_build_object('variance', 30.00, 'shiftId', '22222222-3333-4444-5555-888888888888')::text,
  '00000000-0000-0000-0000-000000000000', now()
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = '22222222-3333-4444-5555-666666666666' AND type = 'health_alert_drawer_mismatches'),
  1,
  'a third same-day event still >= threshold results in zero additional notifications (Shape A dedup)'
);

-- ========================================================================
-- Test 5 (duplicate/replayed event): calling the evaluator directly a
-- second time with the SAME event id (simulating a trigger replay) must not
-- produce a duplicate notification. This composes two independent
-- guarantees: (a) the WAFI-148 idempotency ledger means
-- _apply_health_drawer_mismatch itself no-ops on replay, so the count is
-- unchanged; (b) even if it were NOT idempotent, claim_health_alert_period's
-- per-(shop,metric,period) claim would still prevent a second notification.
-- ========================================================================
SELECT public._apply_health_alert_drawer_mismatch('22222222-3333-4444-5555-000000000002');

SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = '22222222-3333-4444-5555-666666666666' AND type = 'health_alert_drawer_mismatches'),
  1,
  'replaying the same event id through the evaluator directly does not create a duplicate notification'
);

-- ========================================================================
-- Test 6 (disabled type): a different shop with notification_settings
-- disabled for this type never claims, even though its count clearly meets
-- a would-be threshold.
-- ========================================================================
INSERT INTO public.shops (id, name, timezone) VALUES
  ('33333333-4444-5555-6666-777777777777', 'Shop L (disabled)', 'Asia/Damascus');

INSERT INTO public.notification_settings (shop_id, type, enabled, threshold_json)
VALUES (
  '33333333-4444-5555-6666-777777777777',
  'health_alert_drawer_mismatches',
  false,
  jsonb_build_object('threshold', 1)
);

INSERT INTO public.events (id, shop_id, type, entity_id, payload, staff_id, occurred_at)
VALUES (
  '33333333-4444-5555-6666-000000000001',
  '33333333-4444-5555-6666-777777777777', 'shift.closed',
  '33333333-4444-5555-6666-777777777777',
  jsonb_build_object('variance', 40.00, 'shiftId', '33333333-4444-5555-6666-999999999999')::text,
  '00000000-0000-0000-0000-000000000000', now()
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = '33333333-4444-5555-6666-777777777777' AND type = 'health_alert_drawer_mismatches'),
  0,
  'a disabled notification_settings row for this type never claims, regardless of the count'
);
SELECT is(
  (SELECT count(*)::int FROM public.health_alert_state_a
     WHERE shop_id = '33333333-4444-5555-6666-777777777777' AND metric_key = 'drawer_mismatch_count'),
  0,
  'disabled type leaves no health_alert_state_a row either (never attempted the claim)'
);

-- Also cover the "no settings row at all" case on a third shop, distinct
-- from "disabled" -- both are documented Option-A skip cases.
INSERT INTO public.shops (id, name, timezone) VALUES
  ('44444444-5555-6666-7777-888888888888', 'Shop M (no settings row)', 'Asia/Damascus');

INSERT INTO public.events (id, shop_id, type, entity_id, payload, staff_id, occurred_at)
VALUES (
  '44444444-5555-6666-7777-000000000001',
  '44444444-5555-6666-7777-888888888888', 'shift.closed',
  '44444444-5555-6666-7777-888888888888',
  jsonb_build_object('variance', 50.00, 'shiftId', '44444444-5555-6666-7777-999999999999')::text,
  '00000000-0000-0000-0000-000000000000', now()
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = '44444444-5555-6666-7777-888888888888' AND type = 'health_alert_drawer_mismatches'),
  0,
  'a shop with no notification_settings row at all never claims either'
);

-- ========================================================================
-- Test 7 (_resolve_overdue_shift_alert isolation): a pre-existing ALERTING
-- health_alert_state_b row (simulating what Task 5's evaluator will
-- eventually produce) for the shift referenced in a shift.closed event's
-- payload.shiftId is resolved to HEALTHY by the same trigger dispatch.
-- ========================================================================
INSERT INTO public.health_alert_state_b (shop_id, alert_key, entity_id, state, state_changed_at)
VALUES (
  '22222222-3333-4444-5555-666666666666', 'overdue_shift',
  '55555555-6666-7777-8888-999999999999', 'ALERTING', now()
);

INSERT INTO public.events (id, shop_id, type, entity_id, payload, staff_id, occurred_at)
VALUES (
  '22222222-3333-4444-5555-000000000004',
  '22222222-3333-4444-5555-666666666666', 'shift.closed',
  '55555555-6666-7777-8888-999999999999',
  jsonb_build_object('variance', 5.00, 'shiftId', '55555555-6666-7777-8888-999999999999')::text,
  '00000000-0000-0000-0000-000000000000', now()
);

SELECT is(
  (SELECT state FROM public.health_alert_state_b
     WHERE shop_id = '22222222-3333-4444-5555-666666666666' AND alert_key = 'overdue_shift'
       AND entity_id = '55555555-6666-7777-8888-999999999999'),
  'HEALTHY',
  'a shift.closed event resolves a pre-existing ALERTING overdue_shift row (simulated Task 5 state) to HEALTHY, in the same trigger dispatch'
);

-- Safe no-op: a shift.closed event for a shift with no health_alert_state_b
-- row at all (the common case until Task 5 ships) does not error and
-- creates no row.
SELECT is(
  (SELECT count(*)::int FROM public.health_alert_state_b
     WHERE alert_key = 'overdue_shift' AND entity_id = '22222222-3333-4444-5555-666666666666'),
  0,
  '_resolve_overdue_shift_alert is a safe no-op for a shift with no pre-existing health_alert_state_b row (test-1''s shiftId)'
);

-- ============================================================================
-- WAFI-148A Task 14: secondary correctness assertion -- the claim-then-
-- notify transaction invariant. notifications.created_at and
-- health_alert_state_a.alerted_at are written inside the SAME
-- claim_health_alert_period call (migration 118), so for the drawer-mismatch
-- alert claimed by the second shift.closed event above (test 2/3), the two
-- timestamps must be effectively equal (same transaction -- exactly equal or
-- off by microseconds at most). This is a correctness/atomicity check, not a
-- product KPI.
-- ============================================================================
SELECT ok(
  (SELECT abs(extract(epoch FROM
     (SELECT created_at FROM public.notifications
        WHERE shop_id = '22222222-3333-4444-5555-666666666666' AND type = 'health_alert_drawer_mismatches')
     -
     (SELECT alerted_at FROM public.health_alert_state_a
        WHERE shop_id = '22222222-3333-4444-5555-666666666666' AND metric_key = 'drawer_mismatch_count')
  ))) < 0.01,
  'claim-then-notify atomicity: notifications.created_at and health_alert_state_a.alerted_at for the drawer-mismatch alert differ by less than 10ms (same transaction)'
);

SELECT * FROM finish();
ROLLBACK;
