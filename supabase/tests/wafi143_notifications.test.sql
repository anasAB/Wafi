-- supabase/tests/wafi143_notifications.test.sql
-- WAFI-143: notifications.source_event_id uniqueness + per-recipient RLS.
-- Run via: npx supabase test db

BEGIN;
SELECT plan(4);

-- The unique index exists (Task 3's migration).
SELECT has_index('public', 'notifications', 'notifications_source_event_id_unique',
  'notifications_source_event_id_unique index exists');

-- A second insert sharing source_event_id is silently absorbed via
-- ON CONFLICT (source_event_id) DO NOTHING, the SQL-level equivalent of
-- supabase-js's ignoreDuplicates:true (mirrors WAFI-150's wafi150_audit_dedup pattern).
INSERT INTO public.notifications (shop_id, recipient_role, type, title, message, entity_type, entity_id, source_event_id)
VALUES ('e0000000-0000-0000-0000-000000000001', 'owner', 'discount.large_applied', 't', 'm', 'sale', 's1', 'ee000000-0000-0000-0000-000000000001');

SELECT lives_ok(
  $$INSERT INTO public.notifications (shop_id, recipient_role, type, title, message, entity_type, entity_id, source_event_id)
    VALUES ('e0000000-0000-0000-0000-000000000001', 'owner', 'discount.large_applied', 't', 'm', 'sale', 's1', 'ee000000-0000-0000-0000-000000000001')
    ON CONFLICT (source_event_id) DO NOTHING$$,
  'a second insert sharing source_event_id is silently absorbed, not a unique-violation error'
);

-- RLS cross-check: set up an owner (shop 1) and a cashier (shop 1) auth context and
-- confirm a role-targeted notification is visible to the owner but not fabricated as
-- visible to a different shop's owner.
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-000000000002', 'owner-wafi143@test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');
DELETE FROM public.shops WHERE owner_user_id = 'e0000000-0000-0000-0000-000000000002';
INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('e0000000-0000-0000-0000-000000000001', 'WAFI-143 Shop 1', 'e0000000-0000-0000-0000-000000000002');

INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-000000000004', 'owner2-wafi143@test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');
DELETE FROM public.shops WHERE owner_user_id = 'e0000000-0000-0000-0000-000000000004';
INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('e0000000-0000-0000-0000-000000000003', 'WAFI-143 Shop 2', 'e0000000-0000-0000-0000-000000000004');

INSERT INTO public.notifications (shop_id, recipient_role, type, title, message, entity_type, entity_id, source_event_id)
VALUES ('e0000000-0000-0000-0000-000000000003', 'owner', 'discount.large_applied', 't', 'm', 'sale', 's2', 'ee000000-0000-0000-0000-000000000002');

SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', json_build_object('sub', 'e0000000-0000-0000-0000-000000000002', 'active_role', 'owner', 'staff_id', null)::text, true);

SELECT results_eq(
  $$SELECT count(*)::int FROM public.notifications WHERE entity_id = 's2'$$,
  $$SELECT 0$$,
  'a shop-1 owner cannot see a notification belonging to shop 2'
);

SELECT results_eq(
  $$SELECT count(*)::int FROM public.notifications WHERE entity_id = 's1'$$,
  $$SELECT 1$$,
  'a shop-1 owner CAN see a role=owner notification targeted at their own shop'
);

SELECT * FROM finish();
ROLLBACK;
