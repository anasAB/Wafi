-- supabase/tests/wafi151_events_sequence_and_projection_day.test.sql
-- WAFI-151 Plan 2, Task 1: events.sequence / events.event_projection_day
-- (084_events_sequence_and_projection_day.sql), plus re-verification that
-- apply_daily_event_count / _apply_daily_event_count (083) still behave
-- correctly after this migration's CREATE OR REPLACE of both function bodies.
-- Run via: npx supabase test db

BEGIN;
SELECT plan(8);

-- Mirrors the harness pattern from wafi151_daily_event_counts_apply.test.sql:
-- an auth.users row per owner, then a shops row whose owner_user_id maps that
-- user to auth_shop_id() (migration 015 -- no JWT claim needed for shop
-- resolution, just auth.uid() = sub).
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-000000000002', 'owner-c@wafi151.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');
DELETE FROM public.shops WHERE owner_user_id = 'c0000000-0000-0000-0000-000000000002';
INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('c0000000-0000-0000-0000-000000000001', 'WAFI-151 Shop C', 'c0000000-0000-0000-0000-000000000002');

INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'd0000000-0000-0000-0000-000000000002', 'owner-d@wafi151.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');
DELETE FROM public.shops WHERE owner_user_id = 'd0000000-0000-0000-0000-000000000002';
INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('d0000000-0000-0000-0000-000000000001', 'WAFI-151 Shop D', 'd0000000-0000-0000-0000-000000000002');

-- Seed the authoritative events as postgres (bypasses RLS), same as
-- wafi151_daily_event_counts_apply's "Seed as postgres" step.
INSERT INTO public.events (id, type, entity_id, payload, staff_id, shop_id, occurred_at) VALUES
  ('c1000000-0000-0000-0000-000000000001', 'sale.completed', 'sale-c1', '{"saleId":"sale-c1"}', 'c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', now()),
  ('d1000000-0000-0000-0000-000000000001', 'sale.completed', 'sale-d1', '{"saleId":"sale-d1"}', 'd0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', now());

-- 1. Newly inserted events get a non-null sequence automatically.
SELECT isnt(
  (SELECT sequence FROM events WHERE id = 'c1000000-0000-0000-0000-000000000001'),
  NULL,
  'newly inserted event receives a non-null sequence automatically'
);

-- 2. sequence values are unique across the table.
SELECT ok(
  (SELECT count(*) FROM events) = (SELECT count(DISTINCT sequence) FROM events),
  'no two events share a sequence value'
);

-- 3. event_projection_day is set automatically at insert.
SELECT isnt(
  (SELECT event_projection_day FROM events WHERE id = 'c1000000-0000-0000-0000-000000000001'),
  NULL,
  'newly inserted event receives a non-null event_projection_day automatically'
);

-- 4. event_projection_day derives from occurred_at under the shop's timezone
-- (UTC default, since shops.timezone defaults to 'UTC' and this migration
-- backfills it).
INSERT INTO public.events (id, type, entity_id, payload, staff_id, shop_id, occurred_at) VALUES
  ('c1000000-0000-0000-0000-000000000002', 'sale.completed', 'sale-c2', '{"saleId":"sale-c2"}', 'c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', '2026-08-11T23:30:00+00:00');
SELECT is(
  (SELECT event_projection_day FROM events WHERE id = 'c1000000-0000-0000-0000-000000000002')::text,
  '2026-08-11',
  'event_projection_day derives from occurred_at under the shop''s timezone (UTC default)'
);

-- 5. sequence is never NULL on any row after this migration's backfill.
SELECT ok(
  (SELECT count(*) FROM events WHERE sequence IS NULL) = 0,
  'no event in the table has a null sequence after backfill'
);

-- Re-verification (per task brief): this migration replaced both
-- apply_daily_event_count and _apply_daily_event_count via CREATE OR REPLACE,
-- so Plan 1's behavior must be re-checked, not assumed to survive the swap.

-- 6. Authenticate as Shop C's owner: a legitimate same-shop call still succeeds
-- and increments daily_event_counts using the new event_projection_day column.
SELECT set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-0000-0000-000000000002","active_role":"owner"}', true);
SET LOCAL ROLE authenticated;

SELECT apply_daily_event_count('c1000000-0000-0000-0000-000000000001');
SELECT is(
  (SELECT count FROM public.daily_event_counts WHERE source_event_id = 'c1000000-0000-0000-0000-000000000001'),
  1,
  'apply_daily_event_count still succeeds for a legitimate same-shop call after the function replacement'
);
SELECT is(
  (SELECT day FROM public.daily_event_counts WHERE source_event_id = 'c1000000-0000-0000-0000-000000000001'),
  (SELECT event_projection_day FROM public.events WHERE id = 'c1000000-0000-0000-0000-000000000001'),
  'the resulting daily_event_counts row is bucketed by the event''s event_projection_day, not occurred_at::date'
);

-- 7. A cross-shop call still raises P0001, not silently applies.
SELECT throws_ok(
  $$SELECT apply_daily_event_count('d1000000-0000-0000-0000-000000000001')$$,
  'P0001',
  NULL,
  'apply_daily_event_count still raises P0001 for a cross-shop event after the function replacement'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
