-- supabase/tests/wafi202_sales_immutability.test.sql
-- WAFI-202: proves sales/sale_line_items/sale_payments/returns/
-- return_line_items are append-only with strict staff attribution.
-- Run via: npx supabase test db

BEGIN;
SELECT plan(16);

-- ============================================================
-- Fixtures (seeded as postgres, bypassing RLS)
-- ============================================================

-- Shop A: owner, manager, two cashiers, one device, one product
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000002', 'owner-a@wafi202.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');

-- provision_shop_for_new_user() (021_provision_shop_on_signup.sql) already
-- auto-created a shop for this owner via an AFTER INSERT trigger on
-- auth.users -- replace it with the fixed-id row the rest of this fixture
-- (staff/products/sales below) hardcodes references to.
DELETE FROM public.shops WHERE owner_user_id = 'a0000000-0000-0000-0000-000000000002';
INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('a0000000-0000-0000-0000-000000000001', 'WAFI-202 Test Shop A', 'a0000000-0000-0000-0000-000000000002');

INSERT INTO public.staff (id, shop_id, name, pin_hash, role, is_active) VALUES
  ('a0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'Owner A',    'x', 'owner',   true),
  ('a0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'Manager A',  'x', 'manager', true),
  ('a0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'Cashier A1', 'x', 'cashier', true),
  ('a0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'Cashier A2', 'x', 'cashier', true);

INSERT INTO public.devices (id, shop_id, code)
VALUES ('a0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000001', 'A');

INSERT INTO public.products (id, shop_id, name_ar, price_usd)
VALUES ('a0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000001', 'منتج اختبار', 10.00);

INSERT INTO public.cashier_shifts (id, shop_id, device_id, staff_id, opened_at, opening_cash_usd, status)
VALUES ('a0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000005', now(), 0, 'open');

INSERT INTO public.sales (id, shop_id, device_id, device_sequence, display_sale_number, created_at, total_usd, total_syp, exchange_rate_at_sale, payment_method, staff_id, shift_id)
VALUES ('a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000007', 1, 'A-0001', now(), 10.00, 150000, 15000, 'cash_usd', 'a0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000009');

INSERT INTO public.sale_line_items (id, sale_id, shop_id, product_id, quantity, unit_price_usd, line_total_usd)
VALUES ('a0000000-0000-0000-0000-00000000001b', 'a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000008', 1, 10.00, 10.00);

INSERT INTO public.returns (id, shop_id, original_sale_id, refund_method, refund_amount_usd, refund_amount_syp, shift_id)
VALUES ('a0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'cash_usd', 5.00, 75000, 'a0000000-0000-0000-0000-000000000009');

-- Shop B: separate tenant, one cashier, one device (cross-tenant regression)
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000002', 'owner-b@wafi202.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');

DELETE FROM public.shops WHERE owner_user_id = 'b0000000-0000-0000-0000-000000000002';
INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('b0000000-0000-0000-0000-000000000001', 'WAFI-202 Test Shop B', 'b0000000-0000-0000-0000-000000000002');

INSERT INTO public.staff (id, shop_id, name, pin_hash, role, is_active)
VALUES ('b0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'Cashier B1', 'x', 'cashier', true);

INSERT INTO public.devices (id, shop_id, code)
VALUES ('b0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000001', 'A');

-- Helper: executes dynamic SQL under whatever role/claims are currently
-- set, returns the affected row count. SECURITY INVOKER (the default) so
-- RLS applies as the calling session, not this function's owner.
CREATE OR REPLACE FUNCTION wafi202_row_count(p_sql text) RETURNS int
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
-- Test 1: Cashier inserts own sale -- Allowed
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"cashier","staff_id":"a0000000-0000-0000-0000-000000000005"}',
  true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$INSERT INTO public.sales (id, shop_id, device_id, device_sequence, display_sale_number, created_at, total_usd, total_syp, exchange_rate_at_sale, payment_method, staff_id, shift_id)
    VALUES ('a0000000-0000-0000-0000-00000000001a', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000007', 2, 'A-0002', now(), 10.00, 150000, 15000, 'cash_usd', 'a0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000009')$$,
  'Test 1: cashier inserts own sale -- allowed'
);

RESET ROLE;

-- ============================================================
-- Test 2: Cashier inserts sale with another staff_id -- Denied
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"cashier","staff_id":"a0000000-0000-0000-0000-000000000005"}',
  true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO public.sales (id, shop_id, device_id, device_sequence, display_sale_number, created_at, total_usd, total_syp, exchange_rate_at_sale, payment_method, staff_id, shift_id)
    VALUES ('a0000000-0000-0000-0000-00000000002a', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000007', 3, 'A-0003', now(), 10.00, 150000, 15000, 'cash_usd', 'a0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000009')$$,
  '42501', NULL,
  'Test 2: cashier inserts sale attributed to another cashier -- denied'
);

RESET ROLE;

-- ============================================================
-- Test 3: Manager inserts sale attributed to a cashier without
-- switching operators first -- Denied (no INSERT-level exception exists)
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"manager","staff_id":"a0000000-0000-0000-0000-000000000004"}',
  true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO public.sales (id, shop_id, device_id, device_sequence, display_sale_number, created_at, total_usd, total_syp, exchange_rate_at_sale, payment_method, staff_id, shift_id)
    VALUES ('a0000000-0000-0000-0000-00000000003a', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000007', 4, 'A-0004', now(), 10.00, 150000, 15000, 'cash_usd', 'a0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000009')$$,
  '42501', NULL,
  'Test 3: manager inserts sale attributed to a cashier without switching operators -- denied'
);

RESET ROLE;

-- ============================================================
-- Test 4: A session that has already switched operator to Cashier A1
-- (JWT staff_id/active_role reflect the switched-to operator, exactly as
-- production would look after a real switch_active_operator() call)
-- inserts a sale as that operator -- Allowed
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"cashier","staff_id":"a0000000-0000-0000-0000-000000000005"}',
  true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$INSERT INTO public.sales (id, shop_id, device_id, device_sequence, display_sale_number, created_at, total_usd, total_syp, exchange_rate_at_sale, payment_method, staff_id, shift_id)
    VALUES ('a0000000-0000-0000-0000-00000000004a', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000007', 5, 'A-0005', now(), 10.00, 150000, 15000, 'cash_usd', 'a0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000009')$$,
  'Test 4: post-operator-switch session inserts sale as the switched-to operator -- allowed'
);

RESET ROLE;

-- ============================================================
-- Test 5: Cashier updates own completed sale -- Denied
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"cashier","staff_id":"a0000000-0000-0000-0000-000000000005"}',
  true);
SET LOCAL ROLE authenticated;

SELECT is(
  wafi202_row_count($$UPDATE public.sales SET total_usd = 1 WHERE id = 'a0000000-0000-0000-0000-00000000000a'$$),
  0,
  'Test 5: cashier updates own completed sale -- denied'
);

RESET ROLE;

-- ============================================================
-- Test 6: Owner updates any sale -- Denied
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"owner","staff_id":"a0000000-0000-0000-0000-000000000003"}',
  true);
SET LOCAL ROLE authenticated;

SELECT is(
  wafi202_row_count($$UPDATE public.sales SET total_usd = 1 WHERE id = 'a0000000-0000-0000-0000-00000000000a'$$),
  0,
  'Test 6: owner updates any sale -- denied'
);

RESET ROLE;

-- ============================================================
-- Test 7: Manager forges staff_id via UPDATE -- Denied
-- (regression test for the exact exploit confirmed live against production)
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"manager","staff_id":"a0000000-0000-0000-0000-000000000004"}',
  true);
SET LOCAL ROLE authenticated;

SELECT is(
  wafi202_row_count($$UPDATE public.sales SET staff_id = 'a0000000-0000-0000-0000-000000000003' WHERE id = 'a0000000-0000-0000-0000-00000000000a'$$),
  0,
  'Test 7: manager forges staff_id via UPDATE -- denied'
);

RESET ROLE;

-- ============================================================
-- Test 8: Cashier deletes sale -- Denied
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"cashier","staff_id":"a0000000-0000-0000-0000-000000000005"}',
  true);
SET LOCAL ROLE authenticated;

SELECT is(
  wafi202_row_count($$DELETE FROM public.sales WHERE id = 'a0000000-0000-0000-0000-00000000000a'$$),
  0,
  'Test 8: cashier deletes sale -- denied'
);

RESET ROLE;

-- ============================================================
-- Test 9: Owner deletes sale -- Denied
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"owner","staff_id":"a0000000-0000-0000-0000-000000000003"}',
  true);
SET LOCAL ROLE authenticated;

SELECT is(
  wafi202_row_count($$DELETE FROM public.sales WHERE id = 'a0000000-0000-0000-0000-00000000000a'$$),
  0,
  'Test 9: owner deletes sale -- denied'
);

RESET ROLE;

-- ============================================================
-- Test 10: Return creation (attributed via shift) -- Allowed
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"cashier","staff_id":"a0000000-0000-0000-0000-000000000005"}',
  true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$INSERT INTO public.returns (id, shop_id, original_sale_id, refund_method, refund_amount_usd, refund_amount_syp, shift_id)
    VALUES ('a0000000-0000-0000-0000-00000000010a', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'cash_usd', 5.00, 75000, 'a0000000-0000-0000-0000-000000000009')$$,
  'Test 10: return creation attributed via shift -- allowed'
);

RESET ROLE;

-- ============================================================
-- Test 11: Return update -- Denied
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"cashier","staff_id":"a0000000-0000-0000-0000-000000000005"}',
  true);
SET LOCAL ROLE authenticated;

SELECT is(
  wafi202_row_count($$UPDATE public.returns SET refund_amount_usd = 1 WHERE id = 'a0000000-0000-0000-0000-00000000000b'$$),
  0,
  'Test 11: return update -- denied'
);

RESET ROLE;

-- ============================================================
-- Test 12: Return delete -- Denied
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"owner","staff_id":"a0000000-0000-0000-0000-000000000003"}',
  true);
SET LOCAL ROLE authenticated;

SELECT is(
  wafi202_row_count($$DELETE FROM public.returns WHERE id = 'a0000000-0000-0000-0000-00000000000b'$$),
  0,
  'Test 12: return delete -- denied'
);

RESET ROLE;

-- ============================================================
-- Test 13: Staff from shop B cannot insert a sale into shop A
-- (cross-tenant regression, since these policies are touched anyway)
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"cashier","staff_id":"b0000000-0000-0000-0000-000000000003"}',
  true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO public.sales (id, shop_id, device_id, device_sequence, display_sale_number, created_at, total_usd, total_syp, exchange_rate_at_sale, payment_method, staff_id, shift_id)
    VALUES ('a0000000-0000-0000-0000-00000000013a', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000007', 6, 'A-0006', now(), 10.00, 150000, 15000, 'cash_usd', 'b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000009')$$,
  '42501', NULL,
  'Test 13: staff from shop B cannot insert a sale into shop A -- denied'
);

RESET ROLE;

-- ============================================================
-- Test 14: Cashier inserts a sale_line_item for a sale they don't own
-- -- Denied (child-table attribution is transitive through parent)
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"cashier","staff_id":"a0000000-0000-0000-0000-000000000006"}',
  true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO public.sale_line_items (id, sale_id, shop_id, product_id, quantity, unit_price_usd, line_total_usd)
    VALUES ('a0000000-0000-0000-0000-00000000014a', 'a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000008', 1, 10.00, 10.00)$$,
  '42501', NULL,
  'Test 14: cashier inserts sale_line_item for a sale attributed to a different cashier -- denied'
);

RESET ROLE;

-- ============================================================
-- Test 15: Cashier updates a sale_line_item -- Denied
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"cashier","staff_id":"a0000000-0000-0000-0000-000000000005"}',
  true);
SET LOCAL ROLE authenticated;

SELECT is(
  wafi202_row_count($$UPDATE public.sale_line_items SET unit_price_usd = 1 WHERE id = 'a0000000-0000-0000-0000-00000000001b'$$),
  0,
  'Test 15: cashier updates a sale_line_item -- denied'
);

RESET ROLE;

-- ============================================================
-- Test 16: Owner deletes a sale_line_item -- Denied
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"owner","staff_id":"a0000000-0000-0000-0000-000000000003"}',
  true);
SET LOCAL ROLE authenticated;

SELECT is(
  wafi202_row_count($$DELETE FROM public.sale_line_items WHERE id = 'a0000000-0000-0000-0000-00000000001b'$$),
  0,
  'Test 16: owner deletes a sale_line_item -- denied'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
