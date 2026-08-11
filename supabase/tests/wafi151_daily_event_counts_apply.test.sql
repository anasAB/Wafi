-- supabase/tests/wafi151_daily_event_counts_apply.test.sql
-- WAFI-151 Plan 1: apply_daily_event_count / _apply_daily_event_count
-- (083_daily_event_counts_atomic_increment.sql).
-- Run via: npx supabase test db

BEGIN;
SELECT plan(6);

-- Two shops, mirroring wafi140_events_rls.test.sql's harness: an auth.users row
-- per owner, then a shops row whose owner_user_id maps that user to
-- auth_shop_id() (migration 015 -- no JWT claim needed for shop resolution,
-- just auth.uid() = sub).
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000002', 'owner-a@wafi151.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');
DELETE FROM public.shops WHERE owner_user_id = 'a0000000-0000-0000-0000-000000000002';
INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('a0000000-0000-0000-0000-000000000001', 'WAFI-151 Shop A', 'a0000000-0000-0000-0000-000000000002');

INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000002', 'owner-b@wafi151.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');
DELETE FROM public.shops WHERE owner_user_id = 'b0000000-0000-0000-0000-000000000002';
INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('b0000000-0000-0000-0000-000000000001', 'WAFI-151 Shop B', 'b0000000-0000-0000-0000-000000000002');

-- Seed the authoritative events as postgres (bypasses RLS), same as wafi140's
-- "Seed as postgres" step -- apply_daily_event_count derives everything from
-- these rows, never from client input, so seeding them directly (rather than
-- via an authenticated INSERT) is the correct way to set up the fixture.
INSERT INTO public.events (id, type, entity_id, payload, staff_id, shop_id, occurred_at) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'sale.completed', 'sale-a1', '{"saleId":"sale-a1"}', 'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', now()),
  ('a1000000-0000-0000-0000-000000000002', 'sale.completed', 'sale-a2', '{"saleId":"sale-a2"}', 'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', now()),
  ('b1000000-0000-0000-0000-000000000001', 'sale.completed', 'sale-b1', '{"saleId":"sale-b1"}', 'b0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', now());

-- Authenticate as Shop A's owner: auth_shop_id() resolves to Shop A.
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","active_role":"owner"}', true);
SET LOCAL ROLE authenticated;

-- 1. First call creates the row and a ledger entry.
SELECT apply_daily_event_count('a1000000-0000-0000-0000-000000000001');
SELECT is(
  (SELECT count FROM public.daily_event_counts WHERE source_event_id = 'a1000000-0000-0000-0000-000000000001'),
  1,
  'first apply creates a row with count = 1'
);
SELECT is(
  (SELECT count(*)::integer FROM public.projection_processed_events WHERE projection_name = 'daily_event_counts' AND event_id = 'a1000000-0000-0000-0000-000000000001'),
  1,
  'ledger records exactly one entry for this event'
);

-- 2. Repeated calls for the SAME event ID are a no-op (fixes bug 2: cross-device
-- double-counting of the same event, simulated here as a repeated call).
SELECT apply_daily_event_count('a1000000-0000-0000-0000-000000000001');
SELECT apply_daily_event_count('a1000000-0000-0000-0000-000000000001');
SELECT is(
  (SELECT count FROM public.daily_event_counts WHERE source_event_id = 'a1000000-0000-0000-0000-000000000001'),
  1,
  'repeated calls for the same event ID do not increment further -- exactly-once per event'
);

-- 3. A DIFFERENT event for the same (shop, type, day) DOES increment -- the fix
-- must not accidentally make the projection stop counting distinct events.
SELECT apply_daily_event_count('a1000000-0000-0000-0000-000000000002');
SELECT is(
  (SELECT count FROM public.daily_event_counts WHERE shop_id = 'a0000000-0000-0000-0000-000000000001' AND event_type = 'sale.completed'),
  2,
  'a distinct event ID for the same logical key still increments -- fix does not suppress legitimate increments'
);

-- 4. A caller cannot apply an event belonging to another shop.
SELECT throws_ok(
  $$SELECT apply_daily_event_count('b1000000-0000-0000-0000-000000000001')$$,
  'P0001',
  NULL,
  'applying an event from another shop is rejected, not silently applied'
);

-- 5. Direct client writes are rejected at the grant level, not just avoided by convention.
SELECT throws_ok(
  $$INSERT INTO public.daily_event_counts (shop_id, event_type, day, count) VALUES ('a0000000-0000-0000-0000-000000000001', 'sale.completed', current_date, 1)$$,
  '42501',
  NULL,
  'direct INSERT into daily_event_counts is rejected -- apply_daily_event_count is the only mutation path'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
