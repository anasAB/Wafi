-- supabase/tests/wafi_owner_bootstrap.test.sql
-- Regression coverage for bootstrap_owner_identity() (migration 069) --
-- fixes the circular owner-signup bootstrap lockout. Run via a disposable
-- Postgres connection (see Task 3) since supabase test db/pg_prove require
-- Docker, unavailable in this environment.

BEGIN;
SELECT plan(10);

-- ============================================================
-- Fixtures: a fresh shop with NO staff/devices/device_sessions rows yet --
-- exactly the state a real new signup is in before OwnerSetupScreen runs.
-- ============================================================
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000002', 'owner-a@bootstrap.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');

-- provision_shop_for_new_user() (migration 021) already auto-created a shop
-- via its AFTER INSERT trigger -- replace it with the fixed-id row this
-- fixture hardcodes references to, same pattern as the other test files.
DELETE FROM public.shops WHERE owner_user_id = 'a0000000-0000-0000-0000-000000000002';
INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('a0000000-0000-0000-0000-000000000001', 'Bootstrap Test Shop A', 'a0000000-0000-0000-0000-000000000002');

-- A second, unrelated shop/owner -- proves bootstrap_completed_at is
-- scoped per-shop, not global.
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000002', 'owner-b@bootstrap.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');
DELETE FROM public.shops WHERE owner_user_id = 'b0000000-0000-0000-0000-000000000002';
INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('b0000000-0000-0000-0000-000000000001', 'Bootstrap Test Shop B', 'b0000000-0000-0000-0000-000000000002');

-- ============================================================
-- Test 1: fresh shop bootstraps successfully -- returns 'success'
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true);
SET LOCAL ROLE authenticated;

SELECT is(
  public.bootstrap_owner_identity(
    'a0000000-0000-0000-0000-000000000007'::uuid,
    'a0000000-0000-0000-0000-000000000003'::uuid,
    'Owner A',
    '1234'
  ),
  'success',
  'Test 1: fresh shop bootstraps successfully'
);

RESET ROLE;

-- ============================================================
-- Test 2: devices row was created for the new device
-- ============================================================
SELECT is(
  (SELECT count(*)::int FROM public.devices WHERE id = 'a0000000-0000-0000-0000-000000000007'),
  1,
  'Test 2: devices row created'
);

-- ============================================================
-- Test 3: staff row was created with role owner and is_active true
-- ============================================================
SELECT is(
  (SELECT role FROM public.staff WHERE id = 'a0000000-0000-0000-0000-000000000003'),
  'owner',
  'Test 3: staff row has role owner'
);

-- ============================================================
-- Test 4: staff permissions match OWNER_PERMISSIONS (all nine flags true)
-- ============================================================
SELECT is(
  (SELECT permissions::jsonb FROM public.staff WHERE id = 'a0000000-0000-0000-0000-000000000003'),
  '{"can_view_reports":true,"can_manage_products":true,"can_manage_customers":true,'
  '"can_view_expenses":true,"can_manage_settings":true,"can_manage_inventory":true,'
  '"can_manage_suppliers":true,"can_manage_stock_take":true,"can_view_staff_ledger":true}'::jsonb,
  'Test 4: staff permissions match OWNER_PERMISSIONS exactly'
);

-- ============================================================
-- Test 5: device_sessions row was created with active_role owner
-- ============================================================
SELECT is(
  (SELECT active_role FROM public.device_sessions WHERE device_id = 'a0000000-0000-0000-0000-000000000007'),
  'owner',
  'Test 5: device_sessions.active_role is owner'
);

-- ============================================================
-- Test 6: shops.bootstrap_completed_at is now set for this shop
-- ============================================================
SELECT ok(
  (SELECT bootstrap_completed_at FROM public.shops WHERE id = 'a0000000-0000-0000-0000-000000000001') IS NOT NULL,
  'Test 6: bootstrap_completed_at is set'
);

-- ============================================================
-- Test 7: the pin_hash matches switch_active_operator's own verification
-- formula (sha256(salt+pin) hex) -- a subsequent real operator switch with
-- the same PIN must succeed.
-- ============================================================
SELECT is(
  (SELECT pin_hash FROM public.staff WHERE id = 'a0000000-0000-0000-0000-000000000003'),
  (SELECT encode(digest(pin_salt || '1234', 'sha256'), 'hex') FROM public.staff WHERE id = 'a0000000-0000-0000-0000-000000000003'),
  'Test 7: pin_hash matches switch_active_operator''s verification formula'
);

-- ============================================================
-- Test 8: calling again with DIFFERENT ids after already-complete returns
-- 'already_bootstrapped' and does NOT create a second owner (idempotency +
-- retry-after-lost-local-ids safety -- see design doc's retry section).
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true);
SET LOCAL ROLE authenticated;

SELECT is(
  public.bootstrap_owner_identity(
    'a0000000-0000-0000-0000-00000000000a'::uuid,
    'a0000000-0000-0000-0000-00000000000b'::uuid,
    'Someone Else',
    '9999'
  ),
  'already_bootstrapped',
  'Test 8: retry with different ids after already-complete -- idempotent no-op'
);

RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.staff WHERE shop_id = 'a0000000-0000-0000-0000-000000000001' AND role = 'owner'),
  1,
  'Test 8b: still exactly one owner for shop A -- no duplicate created'
);

-- ============================================================
-- Test 9: a shop's own bootstrap is independent of another shop's --
-- shop B (never bootstrapped) still returns 'success' for its own owner.
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true);
SET LOCAL ROLE authenticated;

SELECT is(
  public.bootstrap_owner_identity(
    'b0000000-0000-0000-0000-000000000007'::uuid,
    'b0000000-0000-0000-0000-000000000003'::uuid,
    'Owner B',
    '4321'
  ),
  'success',
  'Test 9: an unrelated, not-yet-bootstrapped shop still succeeds'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
