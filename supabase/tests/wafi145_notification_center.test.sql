-- supabase/tests/wafi145_notification_center.test.sql
-- WAFI-145: business hours constraint, nullable source_event_id, notification_settings RLS.
-- Run via: npx supabase test db

BEGIN;
SELECT plan(7);

-- Fixture: a dedicated owner + shop for this test (following wafi143's convention of
-- not relying on whatever happens to already be in public.shops).
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'f0000000-0000-0000-0000-000000000001', 'owner-wafi145@test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');
DELETE FROM public.shops WHERE owner_user_id = 'f0000000-0000-0000-0000-000000000001';
INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('f1000000-0000-0000-0000-000000000001', 'WAFI-145 Shop 1', 'f0000000-0000-0000-0000-000000000001');

INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'f0000000-0000-0000-0000-000000000002', 'owner2-wafi145@test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');
DELETE FROM public.shops WHERE owner_user_id = 'f0000000-0000-0000-0000-000000000002';
INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('f1000000-0000-0000-0000-000000000002', 'WAFI-145 Shop 2', 'f0000000-0000-0000-0000-000000000002');

-- Overnight hours accepted (open_time > close_time is a VALID window, not rejected).
SELECT lives_ok(
  $$ UPDATE public.shops SET open_time = '08:00', close_time = '02:00' WHERE id = 'f1000000-0000-0000-0000-000000000001' $$,
  'open_time > close_time (overnight) is accepted'
);

-- Equal hours rejected.
SELECT throws_ok(
  $$ UPDATE public.shops SET open_time = '09:00', close_time = '09:00' WHERE id = 'f1000000-0000-0000-0000-000000000001' $$,
  '23514',
  NULL,
  'open_time = close_time is rejected'
);

-- source_event_id nullable: state-derived notifications (Low Stock, Sync Failure)
-- have no originating domain event.
SELECT lives_ok(
  $$ INSERT INTO public.notifications (shop_id, recipient_role, type, title, message, severity, source_event_id)
     VALUES ('f1000000-0000-0000-0000-000000000001', 'owner', 'inventory.low_stock', 't', 'm', 'WARNING', NULL) $$,
  'source_event_id NULL is accepted for state-derived rows'
);

-- Two NULL source_event_id rows don't collide (partial index, not a full unique index).
SELECT lives_ok(
  $$ INSERT INTO public.notifications (shop_id, recipient_role, type, title, message, severity, source_event_id)
     VALUES ('f1000000-0000-0000-0000-000000000001', 'owner', 'inventory.low_stock', 't2', 'm2', 'WARNING', NULL) $$,
  'a second NULL source_event_id row is accepted (partial unique index)'
);

SELECT has_column('public', 'notifications', 'acknowledged_at', 'notifications has acknowledged_at');

-- notification_settings RLS: shop-scoped.
INSERT INTO public.notification_settings (shop_id, type, enabled, threshold_json)
VALUES
  ('f1000000-0000-0000-0000-000000000001', 'inventory.low_stock', true, NULL),
  ('f1000000-0000-0000-0000-000000000002', 'inventory.low_stock', true, NULL);

SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', json_build_object('sub', 'f0000000-0000-0000-0000-000000000001', 'active_role', 'owner', 'staff_id', null)::text, true);

SELECT results_eq(
  $$ SELECT count(*)::int FROM public.notification_settings WHERE shop_id != 'f1000000-0000-0000-0000-000000000001'::uuid $$,
  $$ VALUES (0) $$,
  'notification_settings only exposes the caller''s own shop'
);

SELECT results_eq(
  $$ SELECT count(*)::int FROM public.notification_settings WHERE shop_id = 'f1000000-0000-0000-0000-000000000001'::uuid $$,
  $$ VALUES (1) $$,
  'notification_settings DOES expose the caller''s own shop row'
);

SELECT * FROM finish();
ROLLBACK;
