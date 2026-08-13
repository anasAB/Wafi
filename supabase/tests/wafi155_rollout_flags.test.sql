-- supabase/tests/wafi155_rollout_flags.test.sql
-- WAFI-155: platform_admins + set_rollout_flag + list_shops_for_rollout_admin.
-- Run via: npx supabase test db

BEGIN;
SELECT plan(6);

-- ========================================================================
-- Fixtures
-- ========================================================================

-- Platform admin (not a shop owner).
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'd1111111-1111-1111-1111-111111111111', 'admin@wafi155.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');
INSERT INTO public.platform_admins (user_id) VALUES ('d1111111-1111-1111-1111-111111111111');

-- Owner A: provision_shop_for_new_user() (021) auto-creates a shop with
-- features left NULL -- exactly the real-world state Task 2's tests need.
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'd2222222-2222-2222-2222-222222222222', 'owner@wafi155.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');

-- Owner B: a second, pristine NULL-features shop, kept untouched until
-- Task 2's p_enabled=false materialization test.
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'd3333333-3333-3333-3333-333333333333', 'owner2@wafi155.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');

-- ========================================================================
-- platform_admins RLS/grants
-- ========================================================================

-- 7a: platform admin can SELECT their own row.
SELECT set_config('request.jwt.claims', '{"sub":"d1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.platform_admins WHERE user_id = 'd1111111-1111-1111-1111-111111111111'),
  1, '7a: platform admin can SELECT their own platform_admins row'
);
RESET ROLE;

-- 7b: a non-admin cannot see the admin's row (RLS scopes to auth.uid()).
SELECT set_config('request.jwt.claims', '{"sub":"d2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.platform_admins WHERE user_id = 'd1111111-1111-1111-1111-111111111111'),
  0, '7b: a non-admin cannot SELECT another user''s platform_admins row'
);

-- 7c/7d/7e: authenticated cannot INSERT/UPDATE/DELETE platform_admins.
SELECT throws_ok(
  $$ INSERT INTO public.platform_admins (user_id) VALUES ('d2222222-2222-2222-2222-222222222222') $$,
  '42501', NULL, '7c: authenticated cannot INSERT into platform_admins'
);
SELECT throws_ok(
  $$ UPDATE public.platform_admins SET user_id = user_id $$,
  '42501', NULL, '7d: authenticated cannot UPDATE platform_admins'
);
SELECT throws_ok(
  $$ DELETE FROM public.platform_admins $$,
  '42501', NULL, '7e: authenticated cannot DELETE from platform_admins'
);
RESET ROLE;

-- 7f: anon has no privilege at all.
SELECT is(has_table_privilege('anon', 'public.platform_admins', 'SELECT'), false,
  '7f: anon has no SELECT privilege on platform_admins');

SELECT * FROM finish();
ROLLBACK;
