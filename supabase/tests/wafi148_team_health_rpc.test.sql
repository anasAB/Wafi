-- supabase/tests/wafi148_team_health_rpc.test.sql
-- WAFI-148: list_health_for_admin + list_health_gauges_and_devices_for_admin,
-- both platform_admins-gated identically to list_shops_for_rollout_admin (090).
-- Run via: npx supabase test db
BEGIN;
SELECT plan(4);

-- list_health_for_admin checks platform_admins via auth.uid() directly (no
-- auth_shop_id()/shop_id claim involved) -- the "ordinary session" here just
-- needs a sub claim for a real, non-admin user.
SET LOCAL role postgres;
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-000000000005', 'owner-wafi148-g@test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;
DELETE FROM public.shops WHERE owner_user_id = 'e0000000-0000-0000-0000-000000000005';
INSERT INTO public.shops (id, name, timezone, owner_user_id) VALUES
  ('99999999-9999-9999-9999-999999999999', 'Shop G', 'Asia/Damascus', 'e0000000-0000-0000-0000-000000000005');
INSERT INTO public.health_metrics (shop_id, device_id, metric_key, period_start, value)
VALUES ('99999999-9999-9999-9999-999999999999', '00000000-0000-0000-0000-000000000000',
        'drawer_mismatch_count', current_date, 2);
INSERT INTO public.devices (id, shop_id, code, is_active, last_seen_at)
VALUES ('88888888-8888-8888-8888-888888888888', '99999999-9999-9999-9999-999999999999',
        'A', true, now());

-- Ordinary authenticated shop owner (not a platform admin) must be rejected.
SELECT set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-000000000005","active_role":"owner"}', true);
SET LOCAL role authenticated;
SELECT throws_ok(
  $$ SELECT * FROM public.list_health_for_admin(NULL) $$,
  'P0001', 'not authorized',
  'an ordinary shop-scoped session cannot call the team health RPC, regardless of shop permissions'
);
SELECT throws_ok(
  $$ SELECT * FROM public.list_health_gauges_and_devices_for_admin(NULL) $$,
  'P0001', 'not authorized',
  'an ordinary shop-scoped session cannot call the team health gauges/devices RPC, regardless of shop permissions'
);

-- A real platform admin can see cross-shop data.
SET LOCAL role postgres;
INSERT INTO public.platform_admins (user_id) VALUES (auth.uid()) ON CONFLICT DO NOTHING;
SELECT is(
  (SELECT count(*)::int FROM public.list_health_for_admin(NULL)
     WHERE shop_id = '99999999-9999-9999-9999-999999999999'),
  1, 'a platform admin sees the shop''s health row via the privileged read path'
);
SELECT is(
  (SELECT count(*)::int FROM public.list_health_gauges_and_devices_for_admin(NULL)
     WHERE shop_id = '99999999-9999-9999-9999-999999999999' AND device_id = '88888888-8888-8888-8888-888888888888'),
  1, 'a platform admin sees the shop''s device row via the privileged gauges/devices read path'
);

SELECT * FROM finish();
ROLLBACK;
