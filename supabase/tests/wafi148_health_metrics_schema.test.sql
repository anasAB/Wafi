BEGIN;
-- Plan count: 3 (Task 1) + 7 (Task 2: 2 has_table + 2 col_is_unique + 2 col_not_null
-- + 1 RLS is) = 10. NOTE (deviation from brief): the brief said "plan(3 + 10)" (13
-- total), but only 7 new assertions are actually listed below -- 3+10 does not match
-- 3+7. Using the count that matches the actual assertions run, or pgTAP fails with a
-- planned-vs-run mismatch regardless of whether every individual assertion passes.
-- 2026-08-23: bumped from 3+7+2=12 to 13 -- the stale "timezone has no
-- default" assertion was replaced by two corrected assertions (col_not_null
-- + col_has_default), a net +1 (see NOTE below).
SELECT plan(3 + 7 + 2 + 1);

SELECT has_column('public', 'shops', 'timezone', 'shops.timezone exists');
SELECT col_type_is('public', 'shops', 'timezone', 'text', 'shops.timezone is text');
-- Corrected 2026-08-23 (Gate 0 verification): migration 106's own header
-- comment claimed "nullable, no default", but migration 084 (applied
-- earlier in migration order) already added shops.timezone as
-- NOT NULL DEFAULT 'UTC' -- 106's ADD COLUMN IF NOT EXISTS is a no-op
-- against that. Migration 126 documents this as the actual, current truth.
-- The original assertion here was simply wrong and could never have passed
-- against a real database.
SELECT col_not_null('public', 'shops', 'timezone', 'shops.timezone is NOT NULL');
SELECT col_has_default('public', 'shops', 'timezone', 'shops.timezone has a default');

SELECT has_table('public', 'health_metrics', 'health_metrics table exists');
SELECT has_table('public', 'health_gauges', 'health_gauges table exists');
-- Corrected 2026-08-23: health_metrics/health_gauges enforce this key via
-- PRIMARY KEY (migration 107), not a separate UNIQUE constraint --
-- col_is_unique's composite-array overload does not resolve against a
-- primary key's underlying index the way this test assumed. Assert the
-- primary key's column set directly instead.
SELECT ok(
  (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_index i
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE i.indrelid = 'public.health_metrics'::regclass AND i.indisprimary)
  = ARRAY['device_id', 'metric_key', 'period_start', 'shop_id'],
  'health_metrics has a unique (primary) key on shop/device/metric/period'
);
SELECT ok(
  (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_index i
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE i.indrelid = 'public.health_gauges'::regclass AND i.indisprimary)
  = ARRAY['device_id', 'gauge_key', 'shop_id'],
  'health_gauges has a unique (primary) key on shop/device/gauge'
);
SELECT col_not_null('public', 'health_metrics', 'value', 'health_metrics.value is NOT NULL');
SELECT col_not_null('public', 'health_gauges', 'observed_at', 'health_gauges.observed_at is NOT NULL');

-- RLS smoke test: two shops, cross-shop read must return 0 rows.
-- NOTE (deviation from brief): public.auth_shop_id() (migration 015) resolves the
-- caller's shop via shops.owner_user_id -> auth.uid() (the JWT `sub`), NOT via a
-- "shop_id" JWT claim -- there is no such claim anywhere in this codebase's RLS.
-- A bare `{"shop_id": ...}` claim (as originally drafted) would leave auth.uid()
-- unset, so auth_shop_id() would resolve to NULL and the assertion would pass for
-- the wrong reason (no shop matches anything) rather than proving real cross-shop
-- isolation. Adapted to the same auth.users + owner_user_id + `sub` claim pattern
-- already used by supabase/tests/wafi140_events_rls.test.sql.
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'f0000000-0000-0000-0000-000000000002', 'owner-b1@wafi148.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');
DELETE FROM public.shops WHERE owner_user_id = 'f0000000-0000-0000-0000-000000000002';
INSERT INTO public.shops (id, name, owner_user_id) VALUES ('11111111-1111-1111-1111-111111111111', 'WAFI-148 Shop A', 'f0000000-0000-0000-0000-000000000002');

INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'f0000000-0000-0000-0000-000000000004', 'owner-b2@wafi148.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');
DELETE FROM public.shops WHERE owner_user_id = 'f0000000-0000-0000-0000-000000000004';
INSERT INTO public.shops (id, name, owner_user_id) VALUES ('22222222-2222-2222-2222-222222222222', 'WAFI-148 Shop B', 'f0000000-0000-0000-0000-000000000004');

INSERT INTO public.health_metrics (shop_id, device_id, metric_key, period_start, value)
VALUES ('11111111-1111-1111-1111-111111111111', gen_random_uuid(), 'app_error_count', '2026-08-21', 3);

SELECT set_config('request.jwt.claims',
  '{"sub":"f0000000-0000-0000-0000-000000000004","active_role":"owner"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.health_metrics WHERE shop_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'shop B cannot read shop A health_metrics rows via RLS'
);

-- Task 6: can_view_health_metrics permission flag
-- Corrected 2026-08-23: this file never actually created shop
-- 33333333-... (an orphan reference -- staff.shop_id FK would reject it),
-- and staff.name is NOT NULL (migration 003) but was never supplied. Both
-- are genuine pre-existing bugs; this test could never have passed against
-- a real database before this fix.
SET LOCAL role postgres;
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'f0000000-0000-0000-0000-000000000006', 'owner-c@wafi148.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');
DELETE FROM public.shops WHERE owner_user_id = 'f0000000-0000-0000-0000-000000000006';
INSERT INTO public.shops (id, name, owner_user_id) VALUES ('33333333-3333-3333-3333-333333333333', 'WAFI-148 Shop C (staff perms)', 'f0000000-0000-0000-0000-000000000006');
INSERT INTO public.staff (id, shop_id, name, pin_hash, role, permissions, is_active)
VALUES (
  gen_random_uuid(), '33333333-3333-3333-3333-333333333333', 'Test Manager', crypt('0000', gen_salt('bf')), 'manager', '{}'::jsonb, true
);

-- staff.permissions is TEXT holding a JSON object, not JSONB (migration
-- 032 -- deliberate, to avoid PowerSync double-encoding) -- cast explicitly.
SELECT is(
  (SELECT (permissions::jsonb ->> 'can_view_health_metrics')::boolean
     FROM public.staff WHERE role = 'manager' AND shop_id = '33333333-3333-3333-3333-333333333333'
     ORDER BY id DESC LIMIT 1),
  NULL,
  'can_view_health_metrics is not force-set on an existing manager row (owner grants explicitly)'
);
SELECT ok(
  public.can('can_view_health_metrics') IS NOT NULL,
  'public.can(''can_view_health_metrics'') is a recognized, callable flag'
);

SELECT * FROM finish();
ROLLBACK;
