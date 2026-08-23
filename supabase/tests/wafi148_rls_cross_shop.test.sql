BEGIN;
SELECT plan(4);

SET LOCAL role postgres;
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-000000000006', 'owner-wafi148-h@test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-000000000007', 'owner-wafi148-i@test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;
DELETE FROM public.shops WHERE owner_user_id IN ('e0000000-0000-0000-0000-000000000006', 'e0000000-0000-0000-0000-000000000007');
INSERT INTO public.shops (id, name, timezone, owner_user_id) VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Shop H', 'Asia/Damascus', 'e0000000-0000-0000-0000-000000000006'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Shop I', 'Asia/Damascus', 'e0000000-0000-0000-0000-000000000007');
INSERT INTO public.health_metrics (shop_id, device_id, metric_key, period_start, value)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', gen_random_uuid(), 'app_error_count', current_date, 1);
INSERT INTO public.health_gauges (shop_id, device_id, gauge_key, value, observed_at)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', gen_random_uuid(), 'dead_letter_count', 1, now());

SELECT set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-000000000007","active_role":"owner"}', true);
SET LOCAL role authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.health_metrics WHERE shop_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  0, 'shop I cannot read shop H health_metrics'
);
SELECT is(
  (SELECT count(*)::int FROM public.health_gauges WHERE shop_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  0, 'shop I cannot read shop H health_gauges'
);
SELECT throws_ok(
  $$ INSERT INTO public.health_metrics (shop_id, device_id, metric_key, period_start, value)
     VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', gen_random_uuid(), 'app_error_count', current_date, 99) $$,
  NULL, NULL,
  'no direct client INSERT policy exists on health_metrics -- all writes go through the RPC/apply functions'
);
SELECT throws_ok(
  $$ UPDATE public.health_metrics SET value = 0 WHERE shop_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  NULL, NULL,
  'no direct client UPDATE policy exists on health_metrics'
);

SELECT * FROM finish();
ROLLBACK;
