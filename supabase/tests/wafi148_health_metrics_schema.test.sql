BEGIN;
-- Plan count: 3 (Task 1) + 7 (Task 2: 2 has_table + 2 col_is_unique + 2 col_not_null
-- + 1 RLS is) = 10. NOTE (deviation from brief): the brief said "plan(3 + 10)" (13
-- total), but only 7 new assertions are actually listed below -- 3+10 does not match
-- 3+7. Using the count that matches the actual assertions run, or pgTAP fails with a
-- planned-vs-run mismatch regardless of whether every individual assertion passes.
SELECT plan(3 + 7);

SELECT has_column('public', 'shops', 'timezone', 'shops.timezone exists');
SELECT col_type_is('public', 'shops', 'timezone', 'text', 'shops.timezone is text');
SELECT col_is_null('public', 'shops', 'timezone', 'shops.timezone has no default (nullable)');

SELECT has_table('public', 'health_metrics', 'health_metrics table exists');
SELECT has_table('public', 'health_gauges', 'health_gauges table exists');
SELECT col_is_unique(
  'public', 'health_metrics',
  ARRAY['shop_id', 'device_id', 'metric_key', 'period_start'],
  'health_metrics has a unique key on shop/device/metric/period'
);
SELECT col_is_unique(
  'public', 'health_gauges',
  ARRAY['shop_id', 'device_id', 'gauge_key'],
  'health_gauges has a unique key on shop/device/gauge'
);
SELECT col_not_null('public', 'health_metrics', 'value', 'health_metrics.value is NOT NULL');
SELECT col_not_null('public', 'health_gauges', 'observed_at', 'health_gauges.observed_at is NOT NULL');

-- RLS smoke test: two shops, cross-shop read must return 0 rows.
-- NOTE (deviation from brief): public.auth_shop_id() (migration 015) resolves the
-- caller's shop via shops.owner_user_id -> auth.uid() (the JWT `sub`), NOT via a
-- "shop_id" JWT claim -- there is no such claim anywhere in this codebase's RLS.
-- A bare `{"shop_id": ...}` claim (as originally drafted) would leave auth.uid()
-- unset, so auth_shop_id() would resolve to NULL and the assertion would pass for
-- the wrong reason (no shop matches anything) rather than proving real cross-shop
-- isolation. Adapted to the same auth.users + owner_user_id + `sub` claim pattern
-- already used by supabase/tests/wafi140_events_rls.test.sql.
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'f0000000-0000-0000-0000-000000000002', 'owner-b1@wafi148.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');
DELETE FROM public.shops WHERE owner_user_id = 'f0000000-0000-0000-0000-000000000002';
INSERT INTO public.shops (id, name, owner_user_id) VALUES ('11111111-1111-1111-1111-111111111111', 'WAFI-148 Shop A', 'f0000000-0000-0000-0000-000000000002');

INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'f0000000-0000-0000-0000-000000000004', 'owner-b2@wafi148.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');
DELETE FROM public.shops WHERE owner_user_id = 'f0000000-0000-0000-0000-000000000004';
INSERT INTO public.shops (id, name, owner_user_id) VALUES ('22222222-2222-2222-2222-222222222222', 'WAFI-148 Shop B', 'f0000000-0000-0000-0000-000000000004');

INSERT INTO public.health_metrics (shop_id, device_id, metric_key, period_start, value)
VALUES ('11111111-1111-1111-1111-111111111111', gen_random_uuid(), 'app_error_count', '2026-08-21', 3);

SELECT set_config('request.jwt.claims',
  '{"sub":"f0000000-0000-0000-0000-000000000004","active_role":"owner"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.health_metrics WHERE shop_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'shop B cannot read shop A health_metrics rows via RLS'
);

SELECT * FROM finish();
ROLLBACK;
