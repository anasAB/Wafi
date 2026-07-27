-- supabase/tests/wafi001_cash_shift_hardening.test.sql
-- WAFI-001 closeout: proves the two vulns from the 2026-07-22 security review
-- (docs/security-review-2026-07-22.md) are fixed by migration
-- 068_wafi001_cash_shift_hardening.sql.
-- Vuln 1: cashier_shifts UPDATE/DELETE was open to any shop staff via a
--   stale permissive policy from migration 015 that migration 058 never
--   dropped.
-- Vuln 2: cashier_shifts/cash_movements INSERT lacked staff-attribution
--   enforcement (a cashier could misattribute a shift/movement to a
--   coworker).
-- Run via: npx supabase test db

BEGIN;
SELECT plan(10);

-- ============================================================
-- Fixtures (seeded as postgres, bypassing RLS)
-- ============================================================

-- Shop A: owner, manager, two cashiers, one device, one shift owned by
-- Cashier A1.
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000002', 'owner-a@wafi001.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');

DELETE FROM public.shops WHERE owner_user_id = 'a0000000-0000-0000-0000-000000000002';
INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('a0000000-0000-0000-0000-000000000001', 'WAFI-001 Test Shop A', 'a0000000-0000-0000-0000-000000000002');

INSERT INTO public.staff (id, shop_id, name, pin_hash, role, is_active) VALUES
  ('a0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'Owner A',    'x', 'owner',   true),
  ('a0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'Manager A',  'x', 'manager', true),
  ('a0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'Cashier A1', 'x', 'cashier', true),
  ('a0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'Cashier A2', 'x', 'cashier', true);

INSERT INTO public.devices (id, shop_id, code)
VALUES ('a0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000001', 'A');

-- Second device, so Test 7's own-shift-open doesn't collide with the
-- re-seeded open shift on device A (uq_cashier_shifts_one_open_per_device).
INSERT INTO public.devices (id, shop_id, code)
VALUES ('a0000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000001', 'B');

INSERT INTO public.cashier_shifts (id, shop_id, device_id, staff_id, opened_at, opening_cash_usd, status)
VALUES ('a0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000005', now(), 0, 'open');

-- Helper: executes dynamic SQL under whatever role/claims are currently set,
-- returns the affected row count. SECURITY INVOKER (the default) so RLS
-- applies as the calling session, not this function's owner.
CREATE OR REPLACE FUNCTION wafi001_row_count(p_sql text) RETURNS int
LANGUAGE plpgsql AS $test$
DECLARE
  cnt int;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RETURN cnt;
END;
$test$;

-- ============================================================
-- Test 1 (Vuln 1 regression): Cashier A2 updates Cashier A1's shift -- Denied
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"cashier","staff_id":"a0000000-0000-0000-0000-000000000006"}',
  true);
SET LOCAL ROLE authenticated;

SELECT is(
  wafi001_row_count($$UPDATE public.cashier_shifts SET status = 'closed' WHERE id = 'a0000000-0000-0000-0000-000000000009'$$),
  0,
  'Test 1: cashier updates another cashier''s shift -- denied'
);

RESET ROLE;

-- ============================================================
-- Test 2 (Vuln 1 regression): Cashier A2 deletes Cashier A1's shift -- Denied
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"cashier","staff_id":"a0000000-0000-0000-0000-000000000006"}',
  true);
SET LOCAL ROLE authenticated;

SELECT is(
  wafi001_row_count($$DELETE FROM public.cashier_shifts WHERE id = 'a0000000-0000-0000-0000-000000000009'$$),
  0,
  'Test 2: cashier deletes another cashier''s shift -- denied'
);

RESET ROLE;

-- ============================================================
-- Test 3: Cashier A1 updates their own shift -- Allowed
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"cashier","staff_id":"a0000000-0000-0000-0000-000000000005"}',
  true);
SET LOCAL ROLE authenticated;

SELECT is(
  wafi001_row_count($$UPDATE public.cashier_shifts SET closing_cash_usd = 10 WHERE id = 'a0000000-0000-0000-0000-000000000009'$$),
  1,
  'Test 3: cashier updates their own shift -- allowed'
);

RESET ROLE;

-- ============================================================
-- Test 4: Manager updates any shift in the shop -- Allowed
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"manager","staff_id":"a0000000-0000-0000-0000-000000000004"}',
  true);
SET LOCAL ROLE authenticated;

SELECT is(
  wafi001_row_count($$UPDATE public.cashier_shifts SET closing_cash_usd = 20 WHERE id = 'a0000000-0000-0000-0000-000000000009'$$),
  1,
  'Test 4: manager updates any shift in the shop -- allowed'
);

RESET ROLE;

-- ============================================================
-- Test 5: Owner deletes a shift -- Allowed (owner is exempt, same as the
-- pre-existing SELECT ownership check)
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"owner","staff_id":"a0000000-0000-0000-0000-000000000003"}',
  true);
SET LOCAL ROLE authenticated;

SELECT is(
  wafi001_row_count($$DELETE FROM public.cashier_shifts WHERE id = 'a0000000-0000-0000-0000-000000000009'$$),
  1,
  'Test 5: owner deletes any shift in the shop -- allowed'
);

RESET ROLE;

-- Re-seed the shift consumed by Test 5's delete, for the remaining insert tests.
INSERT INTO public.cashier_shifts (id, shop_id, device_id, staff_id, opened_at, opening_cash_usd, status)
VALUES ('a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000005', now(), 0, 'open');

-- ============================================================
-- Test 6 (Vuln 2 regression): Cashier opens a shift attributed to another
-- staff member -- Denied
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"cashier","staff_id":"a0000000-0000-0000-0000-000000000005"}',
  true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO public.cashier_shifts (id, shop_id, device_id, staff_id, opened_at, opening_cash_usd, status)
    VALUES ('a0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000006', now(), 0, 'open')$$,
  '42501', NULL,
  'Test 6: cashier opens a shift attributed to another staff member -- denied'
);

RESET ROLE;

-- ============================================================
-- Test 7: Cashier opens their own shift -- Allowed
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"cashier","staff_id":"a0000000-0000-0000-0000-000000000006"}',
  true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$INSERT INTO public.cashier_shifts (id, shop_id, device_id, staff_id, opened_at, opening_cash_usd, status)
    VALUES ('a0000000-0000-0000-0000-00000000000c', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000006', now(), 0, 'open')$$,
  'Test 7: cashier opens their own shift -- allowed'
);

RESET ROLE;

-- ============================================================
-- Test 8 (Vuln 2 regression): Cashier records a cash movement attributed to
-- another staff member -- Denied
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"cashier","staff_id":"a0000000-0000-0000-0000-000000000005"}',
  true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO public.cash_movements (id, shop_id, device_id, shift_id, staff_id, direction, category, currency, amount)
    VALUES ('a0000000-0000-0000-0000-00000000000d', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000006', 'out', 'pay_out', 'USD', 5)$$,
  '42501', NULL,
  'Test 8: cashier records a cash movement attributed to another staff member -- denied'
);

RESET ROLE;

-- ============================================================
-- Test 9: Cashier records their own cash movement -- Allowed
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"cashier","staff_id":"a0000000-0000-0000-0000-000000000005"}',
  true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$INSERT INTO public.cash_movements (id, shop_id, device_id, shift_id, staff_id, direction, category, currency, amount)
    VALUES ('a0000000-0000-0000-0000-00000000000e', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000005', 'out', 'pay_out', 'USD', 5)$$,
  'Test 9: cashier records their own cash movement -- allowed'
);

RESET ROLE;

-- ============================================================
-- Test 10: Manager records a cash movement attributed to a cashier without
-- switching operators first -- Denied (no INSERT-level role exception exists,
-- consistent with the sales-domain WAFI-202 pattern)
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"manager","staff_id":"a0000000-0000-0000-0000-000000000004"}',
  true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO public.cash_movements (id, shop_id, device_id, shift_id, staff_id, direction, category, currency, amount)
    VALUES ('a0000000-0000-0000-0000-00000000000f', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000005', 'out', 'pay_out', 'USD', 5)$$,
  '42501', NULL,
  'Test 10: manager records a cash movement attributed to a cashier without switching operators -- denied'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
