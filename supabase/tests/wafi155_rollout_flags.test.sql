-- supabase/tests/wafi155_rollout_flags.test.sql
-- WAFI-155: platform_admins + set_rollout_flag + list_shops_for_rollout_admin.
-- Run via: npx supabase test db

BEGIN;
SELECT plan(19);

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

-- ========================================================================
-- 1. Authorization boundary (set_rollout_flag half)
-- ========================================================================

SELECT set_config('request.jwt.claims', '{"sub":"d2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.set_rollout_flag(
       (SELECT id FROM public.shops WHERE owner_user_id = 'd2222222-2222-2222-2222-222222222222'),
       'dashboard_v2', true) $$,
  'P0001', NULL, '1a: non-admin authenticated caller gets P0001 from set_rollout_flag'
);
RESET ROLE;

SELECT is(has_function_privilege('anon', 'public.set_rollout_flag(uuid, text, boolean)', 'EXECUTE'), false,
  '1c: anon has no EXECUTE on set_rollout_flag');

-- ========================================================================
-- 2. NULL-features grandfathering (the blocking design-review finding)
-- ========================================================================

SELECT set_config('request.jwt.claims', '{"sub":"d1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$ SELECT public.set_rollout_flag(
       (SELECT id FROM public.shops WHERE owner_user_id = 'd2222222-2222-2222-2222-222222222222'),
       'dashboard_v2', true) $$,
  '2a: platform admin can set a rollout flag on a NULL-features shop'
);
RESET ROLE;

-- 2b: re-read in a FRESH query -- the actual regression test for the
-- trigger-bypass fix; a silently-reverted write would still pass 2a.
SELECT is(
  (SELECT features FROM public.shops WHERE owner_user_id = 'd2222222-2222-2222-2222-222222222222'),
  '{"rollout": {"dashboard_v2": true}, "staff_pack": true, "customer_pack": true, "reporting_pack": true, "electronics_pro": true}'::jsonb,
  '2b: features persisted the rollout key AND materialized all four packs true, matching pre-write resolveFlag(null,...) behavior'
);

-- ========================================================================
-- 3. Sequential path-preservation (not a concurrency test)
-- ========================================================================

SELECT set_config('request.jwt.claims', '{"sub":"d1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT public.set_rollout_flag(
  (SELECT id FROM public.shops WHERE owner_user_id = 'd2222222-2222-2222-2222-222222222222'),
  'pos_brain', true);
RESET ROLE;
SELECT is(
  (SELECT features FROM public.shops WHERE owner_user_id = 'd2222222-2222-2222-2222-222222222222'),
  '{"rollout": {"dashboard_v2": true, "pos_brain": true}, "staff_pack": true, "customer_pack": true, "reporting_pack": true, "electronics_pro": true}'::jsonb,
  '3a: setting pos_brain preserves dashboard_v2 and all pack keys'
);

-- ========================================================================
-- 4. NULL materialization for p_enabled = false (pristine second shop)
-- ========================================================================

SELECT set_config('request.jwt.claims', '{"sub":"d1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT public.set_rollout_flag(
  (SELECT id FROM public.shops WHERE owner_user_id = 'd3333333-3333-3333-3333-333333333333'),
  'dashboard_v2', false);
RESET ROLE;
SELECT is(
  (SELECT features FROM public.shops WHERE owner_user_id = 'd3333333-3333-3333-3333-333333333333'),
  '{"rollout": {"dashboard_v2": false}, "staff_pack": true, "customer_pack": true, "reporting_pack": true, "electronics_pro": true}'::jsonb,
  '4: a disabling write to a NULL-features shop still materializes pack defaults true'
);

-- ========================================================================
-- 5. Parameter validation
-- ========================================================================

SELECT set_config('request.jwt.claims', '{"sub":"d1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.set_rollout_flag(NULL, 'dashboard_v2', true) $$,
  'P0002', NULL, '5a: NULL shop id raises P0002'
);
SELECT throws_ok(
  $$ SELECT public.set_rollout_flag(
       (SELECT id FROM public.shops WHERE owner_user_id = 'd2222222-2222-2222-2222-222222222222'),
       NULL, true) $$,
  'P0003', NULL, '5b: NULL flag key raises P0003'
);
SELECT throws_ok(
  $$ SELECT public.set_rollout_flag(
       (SELECT id FROM public.shops WHERE owner_user_id = 'd2222222-2222-2222-2222-222222222222'),
       'dashboard_v2', NULL) $$,
  'P0003', NULL, '5c: NULL enabled value raises P0003'
);
SELECT throws_ok(
  $$ SELECT public.set_rollout_flag(
       (SELECT id FROM public.shops WHERE owner_user_id = 'd2222222-2222-2222-2222-222222222222'),
       'not_a_real_flag', true) $$,
  'P0003', NULL, '5d: unknown flag key raises P0003'
);
SELECT throws_ok(
  $$ SELECT public.set_rollout_flag('00000000-0000-0000-0000-000000000099', 'dashboard_v2', true) $$,
  'P0002', NULL, '5e: nonexistent shop id raises P0002'
);
RESET ROLE;

-- ========================================================================
-- 8. Direct-client-write regression guard (both directions of the trigger)
-- ========================================================================

-- 8a: a non-admin owner's direct UPDATE to their own shop's features is
-- reverted by protect_shop_server_only_columns.
SELECT set_config('request.jwt.claims', '{"sub":"d3333333-3333-3333-3333-333333333333","role":"authenticated","active_role":"owner"}', true);
SET LOCAL ROLE authenticated;
UPDATE public.shops
   SET features = '{"staff_pack": false}'::jsonb
 WHERE owner_user_id = 'd3333333-3333-3333-3333-333333333333';
RESET ROLE;
SELECT isnt(
  (SELECT features FROM public.shops WHERE owner_user_id = 'd3333333-3333-3333-3333-333333333333'),
  '{"staff_pack": false}'::jsonb,
  '8a: a direct client UPDATE to features is reverted by protect_shop_server_only_columns'
);

-- 8b: the trusted RPC's own write (2a/2b/3a above) is NOT reverted -- named
-- separately since it is the opposite direction of 8a.
SELECT is(
  (SELECT features -> 'rollout' ->> 'dashboard_v2' FROM public.shops WHERE owner_user_id = 'd2222222-2222-2222-2222-222222222222'),
  'true',
  '8b: set_rollout_flag''s own write from 2a/3a is still persisted, proving the trigger does not revert the trusted RPC path'
);

SELECT * FROM finish();
ROLLBACK;
