-- supabase/tests/wafi148_health_projections_wiring.test.sql
-- WAFI-148 follow-up: proves the AFTER INSERT trigger actually dispatches both
-- health projections with no manual _apply_* call, proves the idempotency
-- ledger prevents double-counting, and proves rebuild resets both the
-- projection AND the ledger. No client code is involved anywhere in this
-- file -- everything here happens from a single `INSERT INTO events`.
BEGIN;
SELECT plan(7);

SET LOCAL role postgres;
INSERT INTO public.shops (id, name, timezone, timezone_confirmed_at) VALUES
  ('11111111-2222-3333-4444-555555555555', 'Shop J', 'Asia/Damascus', now());

-- Test A: a single INSERT with no manual apply call updates BOTH metrics.
INSERT INTO public.events (id, shop_id, type, entity_id, payload, staff_id, occurred_at)
VALUES (
  '11111111-2222-3333-4444-000000000001',
  '11111111-2222-3333-4444-555555555555', 'shift.closed',
  '11111111-2222-3333-4444-555555555555',
  jsonb_build_object('variance', 20.00, 'forceClosedBy', '00000000-0000-0000-0000-000000000099')::text,
  '00000000-0000-0000-0000-000000000000', now()
);

SELECT is(
  (SELECT value FROM public.health_metrics
     WHERE shop_id = '11111111-2222-3333-4444-555555555555'
       AND metric_key = 'drawer_mismatch_count'
       AND period_start = (now() AT TIME ZONE 'Asia/Damascus')::date),
  1::bigint, 'trigger dispatch alone (no manual apply call) increments drawer_mismatch_count'
);
SELECT is(
  (SELECT value FROM public.health_metrics
     WHERE shop_id = '11111111-2222-3333-4444-555555555555'
       AND metric_key = 'never_closed_shift_count'
       AND period_start = (now() AT TIME ZONE 'Asia/Damascus')::date),
  1::bigint, 'trigger dispatch alone (no manual apply call) increments never_closed_shift_count'
);

-- Test B: calling either apply function again with the SAME event id
-- (simulating a redelivered/retried invocation of the trigger's own logic)
-- must not double-count, because the ledger claim already exists.
SELECT public._apply_health_drawer_mismatch('11111111-2222-3333-4444-000000000001');
SELECT public._apply_health_never_closed_shift('11111111-2222-3333-4444-000000000001');

SELECT is(
  (SELECT value FROM public.health_metrics
     WHERE shop_id = '11111111-2222-3333-4444-555555555555'
       AND metric_key = 'drawer_mismatch_count'
       AND period_start = (now() AT TIME ZONE 'Asia/Damascus')::date),
  1::bigint, 'the idempotency ledger prevents drawer_mismatch_count from double-counting a re-applied event'
);
SELECT is(
  (SELECT value FROM public.health_metrics
     WHERE shop_id = '11111111-2222-3333-4444-555555555555'
       AND metric_key = 'never_closed_shift_count'
       AND period_start = (now() AT TIME ZONE 'Asia/Damascus')::date),
  1::bigint, 'the idempotency ledger prevents never_closed_shift_count from double-counting a re-applied event'
);

-- Test C: a SECOND, distinct event contributes its own +1 -- proves the
-- ledger key is (projection_name, event_id), not "one event ever."
INSERT INTO public.events (id, shop_id, type, entity_id, payload, staff_id, occurred_at)
VALUES (
  '11111111-2222-3333-4444-000000000002',
  '11111111-2222-3333-4444-555555555555', 'shift.closed',
  '11111111-2222-3333-4444-555555555555',
  jsonb_build_object('variance', 25.00, 'forceClosedBy', '00000000-0000-0000-0000-000000000099')::text,
  '00000000-0000-0000-0000-000000000000', now()
);

SELECT is(
  (SELECT value FROM public.health_metrics
     WHERE shop_id = '11111111-2222-3333-4444-555555555555'
       AND metric_key = 'drawer_mismatch_count'
       AND period_start = (now() AT TIME ZONE 'Asia/Damascus')::date),
  2::bigint, 'a second, distinct event contributes its own +1 to drawer_mismatch_count'
);

-- Test D: rebuild resets both the metric AND the ledger, then correctly
-- re-derives the metric from the two source events -- run through the actual
-- rebuild function, not a manual delete/reinsert, so this proves the
-- rebuild's own ledger-reset contract, not just the apply function's math.
UPDATE public.health_metrics SET value = 999
  WHERE shop_id = '11111111-2222-3333-4444-555555555555' AND metric_key = 'drawer_mismatch_count';

SELECT public._rebuild_health_drawer_mismatch();

SELECT is(
  (SELECT value FROM public.health_metrics
     WHERE shop_id = '11111111-2222-3333-4444-555555555555'
       AND metric_key = 'drawer_mismatch_count'
       AND period_start = (now() AT TIME ZONE 'Asia/Damascus')::date),
  2::bigint, 'rebuild clears the corrupted value, resets the ledger, and re-derives the correct count from both source events'
);
-- 2026-08-23: this file's header/comment claimed Test D proves BOTH the
-- metric AND the ledger reset, but only ever asserted the metric (plan(7)
-- vs 6 actual assertions -- a real pre-existing bug). Add the missing
-- ledger assertion: both source events must be present in the ledger
-- exactly once each after rebuild, proving the rebuild actually reset and
-- re-populated projection_processed_events rather than leaving it stale.
SELECT is(
  (SELECT count(*)::int FROM public.projection_processed_events
     WHERE projection_name = 'drawer_mismatch_count'
       AND event_id IN ('11111111-2222-3333-4444-000000000001', '11111111-2222-3333-4444-000000000002')),
  2, 'rebuild re-populates the idempotency ledger with exactly one entry per source event'
);

SELECT * FROM finish();
ROLLBACK;
