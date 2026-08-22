-- supabase/tests/wafi148a_kpi_instrumentation.test.sql
-- WAFI-148A Task 14: proves the health_alert_evaluation_log instrumentation
-- (migration 124) added to all 5 evaluators built so far behaves correctly:
--   - one log row per INVOCATION, not per-metric/candidate/shop within a
--     single call
--   - shop_id populated for event/foreground sources, NULL for scheduled
--   - completed_at >= started_at always holds
--
-- This is purely additive instrumentation -- it does not touch alerting
-- behavior, so this file only exercises the logging side effect, not
-- claim/notify correctness (already covered by the sibling evaluator test
-- files).
--
-- Run via: npx supabase test db

BEGIN;
SELECT plan(9);

SET LOCAL role postgres;

-- Flag-enabled by default for this transaction, same pattern as the other
-- WAFI-148A test files (migration 123 gates claim paths behind WAFI-155
-- 'health_alerting', fail-closed).
ALTER TABLE public.shops ALTER COLUMN features
  SET DEFAULT jsonb_build_object('rollout', jsonb_build_object('health_alerting', true));

-- ============================================================================
-- Section 1: 'event' source -- _apply_health_alert_drawer_mismatch logs
-- exactly one row per shift.closed dispatch, with shop_id populated, even
-- though the underlying alert evaluation itself does not fire (count stays
-- below threshold).
-- ============================================================================
INSERT INTO public.shops (id, name, timezone) VALUES
  ('11111111-2222-3333-4444-000000000001', 'Shop KPI-Event', 'Asia/Damascus');

INSERT INTO public.notification_settings (shop_id, type, enabled, threshold_json)
VALUES ('11111111-2222-3333-4444-000000000001', 'health_alert_drawer_mismatches', true, jsonb_build_object('threshold', 99));

INSERT INTO public.events (id, shop_id, type, entity_id, payload, staff_id, occurred_at)
VALUES (
  '11111111-2222-3333-4444-000000000010',
  '11111111-2222-3333-4444-000000000001', 'shift.closed',
  '11111111-2222-3333-4444-000000000001',
  jsonb_build_object('variance', 5.00, 'shiftId', '11111111-2222-3333-4444-000000000020')::text,
  '00000000-0000-0000-0000-000000000000', now()
);

SELECT is(
  (SELECT count(*)::int FROM public.health_alert_evaluation_log
     WHERE shop_id = '11111111-2222-3333-4444-000000000001' AND evaluation_source = 'event'),
  1,
  'event source: one shift.closed dispatch produces exactly one log row'
);
SELECT is(
  (SELECT count(DISTINCT shop_id)::int FROM public.health_alert_evaluation_log
     WHERE evaluation_source = 'event' AND shop_id = '11111111-2222-3333-4444-000000000001'),
  1,
  'event source: shop_id is populated (non-null) for the event-derived evaluator'
);

-- ============================================================================
-- Section 2: 'scheduled' source -- one cron tick over MANY candidates
-- produces exactly ONE log row, not one per shift/device/shop examined.
-- shop_id is NULL (no single shop per invocation).
-- ============================================================================
INSERT INTO public.shops (id, name, timezone) VALUES
  ('11111111-2222-3333-4444-000000000002', 'Shop KPI-Sched-A', 'Asia/Damascus'),
  ('11111111-2222-3333-4444-000000000003', 'Shop KPI-Sched-B', 'Asia/Damascus');

INSERT INTO public.devices (id, shop_id, code) VALUES
  ('11111111-2222-3333-4444-000000000032', '11111111-2222-3333-4444-000000000002', 'DEV-KPI-A1'),
  ('11111111-2222-3333-4444-000000000042', '11111111-2222-3333-4444-000000000003', 'DEV-KPI-B1');

INSERT INTO public.notification_settings (shop_id, type, enabled, threshold_json) VALUES
  ('11111111-2222-3333-4444-000000000002', 'health_alert_overdue_shift', true, jsonb_build_object('threshold', 1)),
  ('11111111-2222-3333-4444-000000000003', 'health_alert_overdue_shift', true, jsonb_build_object('threshold', 1));

-- Two open, overdue shifts across TWO different shops -- one cron tick,
-- two candidates.
INSERT INTO public.cashier_shifts (id, shop_id, device_id, opened_at, opening_cash_usd, status) VALUES
  ('11111111-2222-3333-4444-000000000033', '11111111-2222-3333-4444-000000000002', '11111111-2222-3333-4444-000000000032', now() - interval '10 hours', 0, 'open'),
  ('11111111-2222-3333-4444-000000000043', '11111111-2222-3333-4444-000000000003', '11111111-2222-3333-4444-000000000042', now() - interval '10 hours', 0, 'open');

SELECT public._scheduled_check_overdue_shifts();

SELECT is(
  (SELECT count(*)::int FROM public.health_alert_evaluation_log WHERE evaluation_source = 'scheduled'),
  1,
  'scheduled source: one cron tick over 2 candidate shops/shifts produces exactly one log row, not one per candidate'
);
SELECT is(
  (SELECT shop_id FROM public.health_alert_evaluation_log WHERE evaluation_source = 'scheduled'),
  NULL,
  'scheduled source: shop_id is NULL -- no single shop per invocation'
);

-- A second cron tick produces a second (distinct) log row -- proves this
-- isn't a dedup/upsert, just plain per-invocation logging.
SELECT public._scheduled_check_overdue_shifts();

SELECT is(
  (SELECT count(*)::int FROM public.health_alert_evaluation_log WHERE evaluation_source = 'scheduled'),
  2,
  'scheduled source: a second cron tick produces a second, distinct log row'
);

-- ============================================================================
-- Section 3: 'foreground' source -- one RPC call produces exactly one log
-- row (covering all 4 metrics evaluated inside it), shop_id populated.
-- ============================================================================
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner-wafi148a-kpi@test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');

INSERT INTO public.shops (id, name, owner_user_id, timezone) VALUES
  ('11111111-2222-3333-4444-000000000005', 'Shop KPI-Foreground', 'aaaaaaaa-0000-0000-0000-000000000001', 'Asia/Damascus');

SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","active_role":"owner"}', true);
SET LOCAL ROLE authenticated;
SELECT public.evaluate_health_alerts_foreground();
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.health_alert_evaluation_log
     WHERE shop_id = '11111111-2222-3333-4444-000000000005' AND evaluation_source = 'foreground'),
  1,
  'foreground source: one RPC call (covering all 4 metrics) produces exactly one log row'
);

-- ============================================================================
-- Section 4: completed_at >= started_at holds for every row logged in this
-- test file (event, scheduled x2, foreground).
-- ============================================================================
SELECT is(
  (SELECT count(*)::int FROM public.health_alert_evaluation_log WHERE completed_at < started_at),
  0,
  'invariant: completed_at is never before started_at, across every logged row'
);

-- CHECK constraint on evaluation_source is enforced (closed set).
SELECT throws_ok(
  $$ INSERT INTO public.health_alert_evaluation_log (shop_id, evaluation_source, started_at, completed_at)
     VALUES (NULL, 'not_a_real_source', now(), now()) $$,
  '23514',
  NULL,
  'evaluation_source is a closed set enforced by a CHECK constraint'
);

-- No client role can read the table -- RLS is enabled with zero policies.
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","active_role":"owner"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.health_alert_evaluation_log),
  0,
  'RLS lockdown: an authenticated client role sees zero rows in health_alert_evaluation_log (no policies granted yet)'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
