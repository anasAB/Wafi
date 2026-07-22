-- supabase/tests/wafi122_role_enforcement.test.sql
-- WAFI-122: automated pgTAP coverage for Sections A-C of
-- supabase/migrations/verification/verify_wafi122_role_enforcement.sql
-- (role-based access, negative/edge cases, lifecycle). Section D of that
-- manual script (a live REST curl pentest) has no local-Postgres
-- equivalent and stays manual -- not covered here.
-- Run via: npx supabase test db

BEGIN;
SELECT plan(13);

-- ============================================================
-- Fixtures (seeded as postgres, bypassing RLS)
-- ============================================================

-- Shop A: owner, manager, two cashiers, one device, one product, one shift,
-- two sales (one per cashier -- needed for A4/A5 to prove "sees only their
-- own" vs "sees everyone's" against genuinely different owners).
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000002', 'owner-a@wafi122.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');

INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('a0000000-0000-0000-0000-000000000001', 'WAFI-122 Test Shop A', 'a0000000-0000-0000-0000-000000000002');

INSERT INTO public.staff (id, shop_id, name, pin_hash, role, permissions, is_active) VALUES
  ('a0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'Owner A',    'x', 'owner',   '{}', true),
  ('a0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'Manager A',  'x', 'manager', '{"can_view_reports":true,"can_manage_products":true}', true),
  ('a0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'Cashier A1', 'x', 'cashier', '{}', true),
  ('a0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'Cashier A2', 'x', 'cashier', '{}', true);

INSERT INTO public.devices (id, shop_id, device_code)
VALUES ('a0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000001', 'A');

INSERT INTO public.products (id, shop_id, name_ar, price_usd)
VALUES ('a0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000001', 'منتج اختبار', 10.00);

INSERT INTO public.cashier_shifts (id, shop_id, device_id, staff_id, opened_at, opening_cash_usd, status)
VALUES ('a0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000005', now(), 0, 'open');

-- Sale by cashier-1
INSERT INTO public.sales (id, shop_id, device_id, device_sequence, display_sale_number, created_at, total_usd, total_syp, exchange_rate_at_sale, payment_method, staff_id, shift_id)
VALUES ('a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000007', 1, 'A-0001', now(), 10.00, 150000, 15000, 'cash_usd', 'a0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000009');

-- Sale by cashier-2 (different owner, same shop -- proves A4/A5 need real ownership diversity)
INSERT INTO public.sales (id, shop_id, device_id, device_sequence, display_sale_number, created_at, total_usd, total_syp, exchange_rate_at_sale, payment_method, staff_id, shift_id)
VALUES ('a0000000-0000-0000-0000-00000000000c', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000007', 2, 'A-0002', now(), 20.00, 300000, 15000, 'cash_usd', 'a0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000009');

-- Shop A edge-case staff rows (used by Section B, seeded here alongside the
-- rest of Shop A's fixtures so Task 1's fixture block is the single source):
-- malformed (non-JSON) permissions; deactivated manager; manager with every
-- flag explicitly false.
INSERT INTO public.staff (id, shop_id, name, pin_hash, role, permissions, is_active) VALUES
  ('a0000000-0000-0000-0000-00000000000d', 'a0000000-0000-0000-0000-000000000001', 'Manager Malformed', 'x', 'manager', 'not valid json', true),
  ('a0000000-0000-0000-0000-00000000000e', 'a0000000-0000-0000-0000-000000000001', 'Manager Deactivated', 'x', 'manager', '{"can_manage_products":true}', false),
  ('a0000000-0000-0000-0000-00000000000f', 'a0000000-0000-0000-0000-000000000001', 'Manager AllFalse', 'x', 'manager', '{"can_manage_products":false,"can_view_reports":false}', true);

-- Shop B: separate tenant, one cashier, for cross-tenant checks (Section B6/C2).
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000002', 'owner-b@wafi122.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');

INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('b0000000-0000-0000-0000-000000000001', 'WAFI-122 Test Shop B', 'b0000000-0000-0000-0000-000000000002');

INSERT INTO public.staff (id, shop_id, name, pin_hash, role, is_active)
VALUES ('b0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'Cashier B1', 'x', 'cashier', true);

-- ============================================================
-- Section A: role-based access (happy path)
-- ============================================================

-- A1: Cashier cannot SELECT staff.
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"cashier","staff_id":"a0000000-0000-0000-0000-000000000005"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*) FROM public.staff)::int, 0,
  'A1: cashier cannot SELECT staff'
);
RESET ROLE;

-- A2: Owner CAN SELECT staff.
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"owner","staff_id":"a0000000-0000-0000-0000-000000000003"}', true);
SET LOCAL ROLE authenticated;
SELECT cmp_ok(
  (SELECT count(*) FROM public.staff)::int, '>', 0,
  'A2: owner CAN SELECT staff'
);
RESET ROLE;

-- A3: Cashier cannot SELECT audit_log.
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"cashier","staff_id":"a0000000-0000-0000-0000-000000000005"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*) FROM public.audit_log)::int, 0,
  'A3: cashier cannot SELECT audit_log'
);
RESET ROLE;

-- A4: Cashier-1 sees only their OWN sales, not cashier-2's.
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"cashier","staff_id":"a0000000-0000-0000-0000-000000000005"}', true);
SET LOCAL ROLE authenticated;
SELECT ok(
  (SELECT bool_and(staff_id = 'a0000000-0000-0000-0000-000000000005'::uuid) FROM public.sales),
  'A4: cashier-1 sees only their own sales'
);
RESET ROLE;

-- A5: Manager sees ALL sales, including cashier-2's (a different staff member's).
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"manager","staff_id":"a0000000-0000-0000-0000-000000000004"}', true);
SET LOCAL ROLE authenticated;
SELECT ok(
  (SELECT count(*) FROM public.sales WHERE staff_id = 'a0000000-0000-0000-0000-000000000006'::uuid) > 0,
  'A5: manager sees cashier-2''s sale (not just their own role''s)'
);
RESET ROLE;

-- (Sections B and C continue below, added by later tasks. Do not COMMIT/
-- ROLLBACK or call finish() until the final task adds them.)
