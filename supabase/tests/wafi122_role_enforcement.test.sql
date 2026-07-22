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

-- provision_shop_for_new_user() (021_provision_shop_on_signup.sql) already
-- auto-created a shop for this owner via an AFTER INSERT trigger on
-- auth.users -- replace it with the fixed-id row the rest of this fixture
-- (staff/products/sales below) hardcodes references to.
DELETE FROM public.shops WHERE owner_user_id = 'a0000000-0000-0000-0000-000000000002';
INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('a0000000-0000-0000-0000-000000000001', 'WAFI-122 Test Shop A', 'a0000000-0000-0000-0000-000000000002');

INSERT INTO public.staff (id, shop_id, name, pin_hash, role, permissions, is_active) VALUES
  ('a0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'Owner A',    'x', 'owner',   '{}', true),
  ('a0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'Manager A',  'x', 'manager', '{"can_view_reports":true,"can_manage_products":true}', true),
  ('a0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'Cashier A1', 'x', 'cashier', '{}', true),
  ('a0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'Cashier A2', 'x', 'cashier', '{}', true);

INSERT INTO public.devices (id, shop_id, code)
VALUES ('a0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000001', 'A');

INSERT INTO public.products (id, shop_id, name_ar, price_usd)
VALUES ('a0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000001', 'منتج اختبار', 10.00);

INSERT INTO public.cashier_shifts (id, shop_id, device_id, staff_id, opened_at, opening_cash_usd, status)
VALUES ('a0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000005', now(), 0, 'open');

-- One audit_log row for Shop A -- without this, A3 ("cashier cannot SELECT
-- audit_log") would pass trivially against an empty table regardless of
-- whether audit_log_select_owner_or_permission (061_audit_domain_rls.sql)
-- actually filters anything. shop_id/staff_id are TEXT columns here (see
-- 002_audit_log.sql), not UUID, so no cast is needed.
INSERT INTO public.audit_log (shop_id, staff_id, staff_name, event, entity_type, entity_id)
VALUES ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003', 'Owner A', 'shift.opened', 'cashier_shifts', 'a0000000-0000-0000-0000-000000000009');

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

DELETE FROM public.shops WHERE owner_user_id = 'b0000000-0000-0000-0000-000000000002';
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

-- ============================================================
-- Section B: negative / edge cases (design spec Sections A-C mapping)
-- ============================================================

-- B1: Missing active_role claim entirely -- auth_role() must default to
-- 'cashier' (fail closed), so staff SELECT must still be blocked.
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*) FROM public.staff)::int, 0,
  'B1: missing active_role claim fails closed to cashier-level denial on staff'
);
RESET ROLE;

-- B2: Missing staff_id claim (role present, staff_id absent) -- auth_staff_id()
-- must be NULL; a cashier-role query with no staff_id sees zero of their
-- "own" sales (staff_id = NULL never matches via `=`).
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"cashier"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*) FROM public.sales)::int, 0,
  'B2: missing staff_id claim sees zero "own" sales'
);
RESET ROLE;

-- B3: Malformed (non-JSON) permissions on the claimed staff row -- can()
-- must return false, not error.
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"manager","staff_id":"a0000000-0000-0000-0000-00000000000d"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  public.can('can_view_reports'), false,
  'B3: malformed permissions JSON -> can() is false, not an error'
);
RESET ROLE;

-- B4: Deactivated staff (is_active = false) -- auth_permissions() excludes
-- inactive staff by its own WHERE clause, so can() must deny even though the
-- flag itself is true on the row.
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"manager","staff_id":"a0000000-0000-0000-0000-00000000000e"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  public.can('can_manage_products'), false,
  'B4: deactivated staff -> can() denies despite a true flag on the row'
);
RESET ROLE;

-- B5: Manager with ALL permission flags explicitly false -- role floor alone
-- (manager) is not enough; every permission-gated check must deny.
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"manager","staff_id":"a0000000-0000-0000-0000-00000000000f"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  public.can('can_manage_products'), false,
  'B5: manager with all flags false -> can() denies'
);
RESET ROLE;

-- B6: Cross-tenant regression guard. Shop B's staff_id queried while the
-- JWT's sub resolves auth_shop_id() to Shop A (via the owner mapping) --
-- must return zero rows regardless of role/staff_id claims.
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"owner","staff_id":"a0000000-0000-0000-0000-000000000003"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*) FROM public.staff WHERE id = 'b0000000-0000-0000-0000-000000000003'::uuid)::int, 0,
  'B6: Shop B staff_id invisible under Shop A''s resolved tenant'
);
RESET ROLE;

-- ============================================================
-- Section C: lifecycle
-- ============================================================

-- C1: Manager loses can_view_reports mid-session -- flip the flag directly
-- (simulating a still-valid JWT with a live permissions change), re-run the
-- SAME claims -- auth_permissions() re-reads the LIVE staff row on every
-- call (not cached in the JWT), so access must be lost immediately.
UPDATE public.staff SET permissions = '{"can_view_reports":false,"can_manage_products":true}'
WHERE id = 'a0000000-0000-0000-0000-000000000004';

SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"manager","staff_id":"a0000000-0000-0000-0000-000000000004"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  public.can('can_view_reports'), false,
  'C1: permission loss takes effect immediately, no JWT refresh needed'
);
RESET ROLE;

-- C2: Device reassigned to a different shop -- staff_id from the OLD shop
-- must not resolve once auth_shop_id() points at the NEW shop. Same
-- underlying mechanism as B6 (tenant boundary is claims-independent),
-- framed per the manual script's own C2 case for 1:1 traceability.
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"owner","staff_id":"a0000000-0000-0000-0000-000000000003"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*) FROM public.staff WHERE id = 'b0000000-0000-0000-0000-000000000003'::uuid)::int, 0,
  'C2: staff_id from a shop no longer resolved by auth_shop_id() is invisible'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
