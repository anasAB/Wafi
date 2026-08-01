-- supabase/tests/wafi140_events_rls.test.sql
-- WAFI-140: events/daily_event_counts RLS cross-shop isolation.
-- Run via: npx supabase test db

BEGIN;
SELECT plan(6);

INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-000000000002', 'owner-e1@wafi140.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');
DELETE FROM public.shops WHERE owner_user_id = 'e0000000-0000-0000-0000-000000000002';
INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('e0000000-0000-0000-0000-000000000001', 'WAFI-140 Shop 1', 'e0000000-0000-0000-0000-000000000002');

INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-000000000004', 'owner-e2@wafi140.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');
DELETE FROM public.shops WHERE owner_user_id = 'e0000000-0000-0000-0000-000000000004';
INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('e0000000-0000-0000-0000-000000000003', 'WAFI-140 Shop 2', 'e0000000-0000-0000-0000-000000000004');

INSERT INTO public.staff (id, shop_id, name, pin_hash, role, is_active)
VALUES ('e0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000001', 'Owner1', 'x', 'owner', true);

-- Seed as postgres (bypasses RLS): one event + one daily_event_counts row for Shop 1.
INSERT INTO public.events (type, entity_id, payload, staff_id, shop_id, occurred_at)
VALUES ('sale.completed', 'sale-1', '{"saleId":"sale-1"}'::jsonb, 'e0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000001', now());
INSERT INTO public.daily_event_counts (shop_id, event_type, day, count)
VALUES ('e0000000-0000-0000-0000-000000000001', 'sale.completed', current_date, 1);

-- As Shop 1's owner: sees own event/count row.
SELECT set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.events)::int, 1, 'Shop 1 owner sees own event');
SELECT is((SELECT count(*) FROM public.daily_event_counts)::int, 1, 'Shop 1 owner sees own count row');
RESET ROLE;

-- As Shop 2's owner: sees nothing (cross-tenant isolation).
SELECT set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.events)::int, 0, 'Shop 2 owner sees no cross-tenant event');
SELECT is((SELECT count(*) FROM public.daily_event_counts)::int, 0, 'Shop 2 owner sees no cross-tenant count row');

-- Shop 2 owner cannot insert an event tagged as Shop 1.
SELECT throws_ok(
  $$INSERT INTO public.events (type, entity_id, payload, staff_id, shop_id, occurred_at)
    VALUES ('sale.completed', 'x', '{}'::jsonb, 'e0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000001', now())$$,
  '42501',
  'Shop 2 owner cannot insert event as Shop 1'
);
RESET ROLE;

-- events is append-only: no UPDATE policy exists, so even the owning shop's
-- authenticated role cannot update a row it can see.
SELECT set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$UPDATE public.events SET entity_id = 'changed' WHERE type = 'sale.completed'$$,
  '42501',
  'events is append-only -- owning shop cannot UPDATE'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
