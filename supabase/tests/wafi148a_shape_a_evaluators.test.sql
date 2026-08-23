-- supabase/tests/wafi148a_shape_a_evaluators.test.sql
-- WAFI-148A Task 10: proves the client-callable foreground evaluator RPC
-- (evaluate_health_alerts_foreground, migration 122) for metrics #1/#2/#5/#6
-- (sync failures, offline duration, deferred-job failures, app errors).
--
-- Each metric's threshold check is a simple SUM(value) >= threshold on the
-- raw metric alone -- deliberately NOT the rate-based logic
-- useOwnerHealth.ts computes for its informational dashboard signal (see the
-- migration's own header comment). Sections below cover: authorization
-- (server-derives shop, never trusts a param), multi-device SUM aggregation,
-- threshold attainment (below vs at/above), same-period dedup, disabled-type
-- skip for one metric while its siblings still evaluate normally in the same
-- call, missing-timezone shop (no evaluation attempted, no error), and
-- per-metric exception isolation (one metric's claim failing does not block
-- the other 3 in the same call).
--
-- Run via: npx supabase test db

BEGIN;
SELECT plan(15);

-- WAFI-148A Task 11: migration 123 gates the entire body of
-- evaluate_health_alerts_foreground behind the WAFI-155 'health_alerting'
-- rollout flag, fail-closed (default disabled). This file's fixtures predate
-- that gate and rely on claims firing by default, so default every new
-- shops row in this transaction to flag-enabled -- rolled back with the rest
-- of the transaction, so this has no effect outside this test file.
ALTER TABLE public.shops ALTER COLUMN features
  SET DEFAULT jsonb_build_object('rollout', jsonb_build_object('health_alerting', true));

-- ============================================================================
-- Section 1: authorization -- the RPC takes no shop_id parameter at all; it
-- derives the caller's shop via auth_shop_id(). Shop A's owner calling it
-- only ever evaluates/claims for Shop A, never for an arbitrary other shop.
-- ============================================================================
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-000000000001', 'owner-wafi148a-fg-a@test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');

-- migration 021 auto-provisions a shop for this new auth.users row; delete
-- it before inserting our own explicit shop with the same owner_user_id
-- (uq_shops_owner_user only allows one shop per owner).
DELETE FROM public.shops WHERE owner_user_id = 'e0000000-0000-0000-0000-000000000001';

INSERT INTO public.shops (id, name, owner_user_id, timezone, timezone_confirmed_at) VALUES
  ('e1111111-0000-0000-0000-000000000001', 'Shop FG-A (authz)', 'e0000000-0000-0000-0000-000000000001', 'Asia/Damascus', now());

INSERT INTO public.devices (id, shop_id, code) VALUES
  ('e1111111-0000-0000-0000-000000000002', 'e1111111-0000-0000-0000-000000000001', 'DEV-FGA-1');

INSERT INTO public.notification_settings (shop_id, type, enabled, threshold_json)
VALUES ('e1111111-0000-0000-0000-000000000001', 'health_alert_sync_failures', true, jsonb_build_object('threshold', 3));

INSERT INTO public.health_metrics (shop_id, device_id, metric_key, period_start, value, updated_at)
VALUES ('e1111111-0000-0000-0000-000000000001', 'e1111111-0000-0000-0000-000000000002', 'sync_failure_terminal',
        (now() AT TIME ZONE 'Asia/Damascus')::date, 5, now());

-- A second shop, Shop B, with no relationship to the authenticated user below.
INSERT INTO public.shops (id, name, timezone) VALUES
  ('e2222222-0000-0000-0000-000000000001', 'Shop FG-B (must not be touched)', 'Asia/Damascus');
INSERT INTO public.devices (id, shop_id, code) VALUES
  ('e2222222-0000-0000-0000-000000000002', 'e2222222-0000-0000-0000-000000000001', 'DEV-FGB-1');
INSERT INTO public.notification_settings (shop_id, type, enabled, threshold_json)
VALUES ('e2222222-0000-0000-0000-000000000001', 'health_alert_sync_failures', true, jsonb_build_object('threshold', 1));
INSERT INTO public.health_metrics (shop_id, device_id, metric_key, period_start, value, updated_at)
VALUES ('e2222222-0000-0000-0000-000000000001', 'e2222222-0000-0000-0000-000000000002', 'sync_failure_terminal',
        (now() AT TIME ZONE 'Asia/Damascus')::date, 99, now());

SELECT set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-000000000001","active_role":"owner"}', true);
SET LOCAL ROLE authenticated;

SELECT public.evaluate_health_alerts_foreground();

RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = 'e1111111-0000-0000-0000-000000000001' AND type = 'health_alert_sync_failures'),
  1,
  'authz: the authenticated owner''s own shop (Shop FG-A) is evaluated and alerted'
);
SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = 'e2222222-0000-0000-0000-000000000001' AND type = 'health_alert_sync_failures'),
  0,
  'authz: an unrelated shop (Shop FG-B) is never touched -- the RPC cannot be pointed at another shop'
);

-- ============================================================================
-- Section 2: multi-device SUM aggregation (metric #2, offline duration) --
-- 3 devices each reporting a value for the same period; SUM must match plain
-- addition, not average or max.
-- ============================================================================
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-000000000010', 'owner-wafi148a-fg-c@test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');

DELETE FROM public.shops WHERE owner_user_id = 'e0000000-0000-0000-0000-000000000010';

INSERT INTO public.shops (id, name, owner_user_id, timezone, timezone_confirmed_at) VALUES
  ('e3333333-0000-0000-0000-000000000001', 'Shop FG-C (multi-device SUM)', 'e0000000-0000-0000-0000-000000000010', 'Asia/Damascus', now());

INSERT INTO public.devices (id, shop_id, code) VALUES
  ('e3333333-0000-0000-0000-000000000002', 'e3333333-0000-0000-0000-000000000001', 'DEV-FGC-1'),
  ('e3333333-0000-0000-0000-000000000003', 'e3333333-0000-0000-0000-000000000001', 'DEV-FGC-2'),
  ('e3333333-0000-0000-0000-000000000004', 'e3333333-0000-0000-0000-000000000001', 'DEV-FGC-3');

INSERT INTO public.notification_settings (shop_id, type, enabled, threshold_json)
VALUES ('e3333333-0000-0000-0000-000000000001', 'health_alert_offline_duration', true, jsonb_build_object('threshold', 500));

-- 100 + 150 + 200 = 450 -- under the 500 threshold. Proves SUM, not average
-- (avg=150, well under) and not a single-device read.
INSERT INTO public.health_metrics (shop_id, device_id, metric_key, period_start, value, updated_at) VALUES
  ('e3333333-0000-0000-0000-000000000001', 'e3333333-0000-0000-0000-000000000002', 'offline_duration_seconds', (now() AT TIME ZONE 'Asia/Damascus')::date, 100, now()),
  ('e3333333-0000-0000-0000-000000000001', 'e3333333-0000-0000-0000-000000000003', 'offline_duration_seconds', (now() AT TIME ZONE 'Asia/Damascus')::date, 150, now()),
  ('e3333333-0000-0000-0000-000000000001', 'e3333333-0000-0000-0000-000000000004', 'offline_duration_seconds', (now() AT TIME ZONE 'Asia/Damascus')::date, 200, now());

SELECT set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-000000000010","active_role":"owner"}', true);
SET LOCAL ROLE authenticated;
SELECT public.evaluate_health_alerts_foreground();
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = 'e3333333-0000-0000-0000-000000000001' AND type = 'health_alert_offline_duration'),
  0,
  'multi-device SUM: 100+150+200=450 stays under a threshold of 500 -- proves SUM (not e.g. MAX=200) is used'
);

-- Now push the sum to exactly the threshold by raising one device's value:
-- 100 + 150 + 300 = 550 >= 500.
UPDATE public.health_metrics SET value = 300
 WHERE shop_id = 'e3333333-0000-0000-0000-000000000001' AND device_id = 'e3333333-0000-0000-0000-000000000004';

SELECT set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-000000000010","active_role":"owner"}', true);
SET LOCAL ROLE authenticated;
SELECT public.evaluate_health_alerts_foreground();
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = 'e3333333-0000-0000-0000-000000000001' AND type = 'health_alert_offline_duration'),
  1,
  'multi-device SUM: 100+150+300=550 correctly crosses a threshold of 500, matching manual addition across all 3 devices'
);

-- ============================================================================
-- Section 3: threshold attainment (metric #5, deferred-job failures) --
-- below threshold produces no alert; a subsequent rise to at/above threshold
-- produces exactly one.
-- ============================================================================
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-000000000020', 'owner-wafi148a-fg-d@test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');

DELETE FROM public.shops WHERE owner_user_id = 'e0000000-0000-0000-0000-000000000020';

INSERT INTO public.shops (id, name, owner_user_id, timezone, timezone_confirmed_at) VALUES
  ('e4444444-0000-0000-0000-000000000001', 'Shop FG-D (threshold attainment)', 'e0000000-0000-0000-0000-000000000020', 'Asia/Damascus', now());

INSERT INTO public.devices (id, shop_id, code) VALUES
  ('e4444444-0000-0000-0000-000000000002', 'e4444444-0000-0000-0000-000000000001', 'DEV-FGD-1');

INSERT INTO public.notification_settings (shop_id, type, enabled, threshold_json)
VALUES ('e4444444-0000-0000-0000-000000000001', 'health_alert_deferred_job_failures', true, jsonb_build_object('threshold', 5));

INSERT INTO public.health_metrics (shop_id, device_id, metric_key, period_start, value, updated_at)
VALUES ('e4444444-0000-0000-0000-000000000001', 'e4444444-0000-0000-0000-000000000002', 'deferred_job_failure_terminal',
        (now() AT TIME ZONE 'Asia/Damascus')::date, 3, now());

SELECT set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-000000000020","active_role":"owner"}', true);
SET LOCAL ROLE authenticated;
SELECT public.evaluate_health_alerts_foreground();
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = 'e4444444-0000-0000-0000-000000000001' AND type = 'health_alert_deferred_job_failures'),
  0,
  'threshold attainment: value (3) below threshold (5) produces no alert'
);

UPDATE public.health_metrics SET value = 5
 WHERE shop_id = 'e4444444-0000-0000-0000-000000000001' AND device_id = 'e4444444-0000-0000-0000-000000000002';

SELECT set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-000000000020","active_role":"owner"}', true);
SET LOCAL ROLE authenticated;
SELECT public.evaluate_health_alerts_foreground();
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = 'e4444444-0000-0000-0000-000000000001' AND type = 'health_alert_deferred_job_failures'),
  1,
  'threshold attainment: value rising to exactly the threshold (5>=5) produces exactly one alert'
);

-- ============================================================================
-- Section 4: same-period dedup -- a second call the same day produces no
-- additional notification, via claim_health_alert_period's own dedup.
-- ============================================================================
SELECT set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-000000000020","active_role":"owner"}', true);
SET LOCAL ROLE authenticated;
SELECT public.evaluate_health_alerts_foreground();
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = 'e4444444-0000-0000-0000-000000000001' AND type = 'health_alert_deferred_job_failures'),
  1,
  'same-period dedup: a second call the same day produces zero additional notifications'
);

-- ============================================================================
-- Section 5: disabled-type skip for one metric while its siblings still
-- evaluate normally in the same call (metric #6 app_errors disabled; #1/#2/#5
-- all enabled and over threshold on the same shop/call).
-- ============================================================================
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-000000000030', 'owner-wafi148a-fg-e@test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');

DELETE FROM public.shops WHERE owner_user_id = 'e0000000-0000-0000-0000-000000000030';

INSERT INTO public.shops (id, name, owner_user_id, timezone, timezone_confirmed_at) VALUES
  ('e5555555-0000-0000-0000-000000000001', 'Shop FG-E (disabled-type isolation)', 'e0000000-0000-0000-0000-000000000030', 'Asia/Damascus', now());

INSERT INTO public.devices (id, shop_id, code) VALUES
  ('e5555555-0000-0000-0000-000000000002', 'e5555555-0000-0000-0000-000000000001', 'DEV-FGE-1');

INSERT INTO public.notification_settings (shop_id, type, enabled, threshold_json) VALUES
  ('e5555555-0000-0000-0000-000000000001', 'health_alert_sync_failures', true, jsonb_build_object('threshold', 1)),
  ('e5555555-0000-0000-0000-000000000001', 'health_alert_offline_duration', true, jsonb_build_object('threshold', 1)),
  ('e5555555-0000-0000-0000-000000000001', 'health_alert_deferred_job_failures', true, jsonb_build_object('threshold', 1)),
  ('e5555555-0000-0000-0000-000000000001', 'health_alert_app_errors', false, jsonb_build_object('threshold', 1));

INSERT INTO public.health_metrics (shop_id, device_id, metric_key, period_start, value, updated_at) VALUES
  ('e5555555-0000-0000-0000-000000000001', 'e5555555-0000-0000-0000-000000000002', 'sync_failure_terminal', (now() AT TIME ZONE 'Asia/Damascus')::date, 10, now()),
  ('e5555555-0000-0000-0000-000000000001', 'e5555555-0000-0000-0000-000000000002', 'offline_duration_seconds', (now() AT TIME ZONE 'Asia/Damascus')::date, 10, now()),
  ('e5555555-0000-0000-0000-000000000001', 'e5555555-0000-0000-0000-000000000002', 'deferred_job_failure_terminal', (now() AT TIME ZONE 'Asia/Damascus')::date, 10, now()),
  ('e5555555-0000-0000-0000-000000000001', 'e5555555-0000-0000-0000-000000000002', 'app_error_count', (now() AT TIME ZONE 'Asia/Damascus')::date, 10, now());

SELECT set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-000000000030","active_role":"owner"}', true);
SET LOCAL ROLE authenticated;
SELECT public.evaluate_health_alerts_foreground();
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = 'e5555555-0000-0000-0000-000000000001' AND type = 'health_alert_app_errors'),
  0,
  'disabled-type isolation: the disabled metric (#6 app_errors) never claims'
);
SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = 'e5555555-0000-0000-0000-000000000001'
       AND type IN ('health_alert_sync_failures', 'health_alert_offline_duration', 'health_alert_deferred_job_failures')),
  3,
  'disabled-type isolation: all 3 other enabled, over-threshold metrics still claim in the same call'
);

-- ============================================================================
-- Section 6: unconfirmed-timezone shop -- no evaluation attempted for any
-- metric, no error raised.
--
-- WAFI-148 fix: shops.timezone is NOT NULL DEFAULT 'UTC' (migration 084) --
-- it can never actually be NULL, so the original "missing timezone" premise
-- here was false (an explicit NULL insert below would now violate the NOT
-- NULL constraint). The real "not ready to evaluate" state is
-- timezone_confirmed_at IS NULL (migration 115), which this fixture
-- reproduces by simply never setting timezone_confirmed_at.
-- ============================================================================
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-000000000040', 'owner-wafi148a-fg-f@test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');

DELETE FROM public.shops WHERE owner_user_id = 'e0000000-0000-0000-0000-000000000040';

INSERT INTO public.shops (id, name, owner_user_id, timezone) VALUES
  ('e6666666-0000-0000-0000-000000000001', 'Shop FG-F (unconfirmed timezone)', 'e0000000-0000-0000-0000-000000000040', 'Asia/Damascus');

INSERT INTO public.devices (id, shop_id, code) VALUES
  ('e6666666-0000-0000-0000-000000000002', 'e6666666-0000-0000-0000-000000000001', 'DEV-FGF-1');

INSERT INTO public.notification_settings (shop_id, type, enabled, threshold_json)
VALUES ('e6666666-0000-0000-0000-000000000001', 'health_alert_sync_failures', true, jsonb_build_object('threshold', 1));

-- No period_start can be computed without a timezone, so this metric is
-- inserted under today's UTC date as a best-effort "would have qualified"
-- fixture -- the point is that the function must never even reach the SUM
-- query for a shop with no configured timezone.
INSERT INTO public.health_metrics (shop_id, device_id, metric_key, period_start, value, updated_at)
VALUES ('e6666666-0000-0000-0000-000000000001', 'e6666666-0000-0000-0000-000000000002', 'sync_failure_terminal', now()::date, 99, now());

SELECT set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-000000000040","active_role":"owner"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$ SELECT public.evaluate_health_alerts_foreground() $$,
  'missing-timezone shop: the RPC returns without error'
);
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = 'e6666666-0000-0000-0000-000000000001'),
  0,
  'missing-timezone shop: no evaluation is attempted and no notification is ever claimed'
);

-- ============================================================================
-- Section 7: per-metric exception isolation -- a temporary trigger forces
-- the sync_failures claim to raise (simulating an unexpected failure, same
-- technique used by Task 5/8's interval-overflow forced error). The other 3
-- metrics, all enabled and over threshold in the same call, must still be
-- evaluated and alerted.
-- ============================================================================
CREATE OR REPLACE FUNCTION pg_temp.wafi148a_force_sync_failure_error()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.metric_key = 'sync_failure_terminal' THEN
    RAISE EXCEPTION 'wafi148a test: forced failure for per-metric isolation test';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER wafi148a_force_error
  BEFORE INSERT ON public.health_alert_state_a
  FOR EACH ROW EXECUTE FUNCTION pg_temp.wafi148a_force_sync_failure_error();

INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-000000000050', 'owner-wafi148a-fg-g@test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');

DELETE FROM public.shops WHERE owner_user_id = 'e0000000-0000-0000-0000-000000000050';

INSERT INTO public.shops (id, name, owner_user_id, timezone, timezone_confirmed_at) VALUES
  ('e7777777-0000-0000-0000-000000000001', 'Shop FG-G (per-metric isolation)', 'e0000000-0000-0000-0000-000000000050', 'Asia/Damascus', now());

INSERT INTO public.devices (id, shop_id, code) VALUES
  ('e7777777-0000-0000-0000-000000000002', 'e7777777-0000-0000-0000-000000000001', 'DEV-FGG-1');

INSERT INTO public.notification_settings (shop_id, type, enabled, threshold_json) VALUES
  ('e7777777-0000-0000-0000-000000000001', 'health_alert_sync_failures', true, jsonb_build_object('threshold', 1)),
  ('e7777777-0000-0000-0000-000000000001', 'health_alert_offline_duration', true, jsonb_build_object('threshold', 1)),
  ('e7777777-0000-0000-0000-000000000001', 'health_alert_deferred_job_failures', true, jsonb_build_object('threshold', 1)),
  ('e7777777-0000-0000-0000-000000000001', 'health_alert_app_errors', true, jsonb_build_object('threshold', 1));

INSERT INTO public.health_metrics (shop_id, device_id, metric_key, period_start, value, updated_at) VALUES
  ('e7777777-0000-0000-0000-000000000001', 'e7777777-0000-0000-0000-000000000002', 'sync_failure_terminal', (now() AT TIME ZONE 'Asia/Damascus')::date, 10, now()),
  ('e7777777-0000-0000-0000-000000000001', 'e7777777-0000-0000-0000-000000000002', 'offline_duration_seconds', (now() AT TIME ZONE 'Asia/Damascus')::date, 10, now()),
  ('e7777777-0000-0000-0000-000000000001', 'e7777777-0000-0000-0000-000000000002', 'deferred_job_failure_terminal', (now() AT TIME ZONE 'Asia/Damascus')::date, 10, now()),
  ('e7777777-0000-0000-0000-000000000001', 'e7777777-0000-0000-0000-000000000002', 'app_error_count', (now() AT TIME ZONE 'Asia/Damascus')::date, 10, now());

SELECT set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-000000000050","active_role":"owner"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$ SELECT public.evaluate_health_alerts_foreground() $$,
  'per-metric isolation: the RPC call itself does not throw even though one metric''s claim raises internally'
);
RESET ROLE;

DROP TRIGGER wafi148a_force_error ON public.health_alert_state_a;

SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = 'e7777777-0000-0000-0000-000000000001' AND type = 'health_alert_sync_failures'),
  0,
  'per-metric isolation: the forced-failure metric (sync_failures) itself got no notification'
);
SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = 'e7777777-0000-0000-0000-000000000001'
       AND type IN ('health_alert_offline_duration', 'health_alert_deferred_job_failures', 'health_alert_app_errors')),
  3,
  'per-metric isolation: the other 3 metrics, all over threshold in the same call, are still evaluated and alerted despite sync_failures raising'
);

-- ============================================================================
-- WAFI-148A Task 14: secondary correctness assertion -- the claim-then-
-- notify transaction invariant. notifications.created_at and
-- health_alert_state_a.alerted_at are written inside the SAME
-- claim_health_alert_period call (migration 118), so for the Section 1
-- sync_failures alert on Shop FG-A, the two timestamps must be effectively
-- equal (same transaction -- exactly equal or off by microseconds at most).
-- This is a correctness/atomicity check, not a product KPI.
-- ============================================================================
SELECT ok(
  (SELECT abs(extract(epoch FROM
     (SELECT created_at FROM public.notifications
        WHERE shop_id = 'e1111111-0000-0000-0000-000000000001' AND type = 'health_alert_sync_failures')
     -
     (SELECT alerted_at FROM public.health_alert_state_a
        WHERE shop_id = 'e1111111-0000-0000-0000-000000000001' AND metric_key = 'sync_failure_terminal')
  ))) < 0.01,
  'claim-then-notify atomicity: notifications.created_at and health_alert_state_a.alerted_at for the Shop FG-A sync_failures alert differ by less than 10ms (same transaction)'
);

SELECT * FROM finish();
ROLLBACK;
