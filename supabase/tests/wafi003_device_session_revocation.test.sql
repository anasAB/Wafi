-- supabase/tests/wafi003_device_session_revocation.test.sql
-- WAFI-003: pgTAP coverage for record_device_session_id / revoke_device_session.
-- Run via: npx supabase test db

BEGIN;
SELECT plan(6);

-- ============================================================
-- Fixtures
-- ============================================================

-- Shop A: owner account + one device.
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000002', 'owner-a@wafi003.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');

DELETE FROM public.shops WHERE owner_user_id = 'a0000000-0000-0000-0000-000000000002';
INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('a0000000-0000-0000-0000-000000000001', 'WAFI-003 Test Shop A', 'a0000000-0000-0000-0000-000000000002');

INSERT INTO public.devices (id, shop_id, code)
VALUES ('a0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000001', 'A');

-- Shop B: separate tenant, one device (cross-tenant regression).
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000002', 'owner-b@wafi003.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');

DELETE FROM public.shops WHERE owner_user_id = 'b0000000-0000-0000-0000-000000000002';
INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('b0000000-0000-0000-0000-000000000001', 'WAFI-003 Test Shop B', 'b0000000-0000-0000-0000-000000000002');

INSERT INTO public.devices (id, shop_id, code)
VALUES ('b0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000001', 'A');

-- A real auth.sessions row for Shop A's device, to prove revoke actually
-- deletes it (not just no-ops). auth.sessions requires user_id; minimal
-- columns filled in matching what GoTrue itself would write.
INSERT INTO auth.sessions (id, user_id, created_at, updated_at)
VALUES ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', now(), now());

-- ============================================================
-- Test 1: record_device_session_id writes session_id for the caller's own device
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.record_device_session_id('a0000000-0000-0000-0000-000000000007'::uuid, 'c0000000-0000-0000-0000-000000000001'::uuid)$$,
  'Test 1: record_device_session_id succeeds for the caller''s own device'
);
RESET ROLE;

SELECT is(
  (SELECT session_id::text FROM public.device_sessions WHERE device_id = 'a0000000-0000-0000-0000-000000000007'),
  'c0000000-0000-0000-0000-000000000001',
  'Test 2: device_sessions.session_id was written'
);

-- ============================================================
-- Test 3: record_device_session_id no-ops for a device in another shop
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.record_device_session_id('b0000000-0000-0000-0000-000000000007'::uuid, 'c0000000-0000-0000-0000-000000000001'::uuid)$$,
  'Test 3: record_device_session_id on another shop''s device does not error'
);
RESET ROLE;

SELECT is(
  (SELECT count(*) FROM public.device_sessions WHERE device_id = 'b0000000-0000-0000-0000-000000000007')::int,
  0,
  'Test 4: cross-tenant call wrote nothing for shop B''s device'
);

-- ============================================================
-- Test 5: revoke_device_session actually deletes the auth.sessions row
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.revoke_device_session('a0000000-0000-0000-0000-000000000007'::uuid)$$,
  'Test 5: revoke_device_session succeeds for the caller''s own device'
);
RESET ROLE;

SELECT is(
  (SELECT count(*) FROM auth.sessions WHERE id = 'c0000000-0000-0000-0000-000000000001')::int,
  0,
  'Test 6: the auth.sessions row was actually deleted'
);

SELECT * FROM finish();
ROLLBACK;
