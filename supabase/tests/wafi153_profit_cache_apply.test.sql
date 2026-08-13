-- supabase/tests/wafi153_profit_cache_apply.test.sql
-- WAFI-153. Directly mirrors wafi151_daily_event_counts_apply.test.sql's harness
-- pattern for public.apply_profit_cache / public._apply_profit_cache
-- (086_profit_cache_apply.sql).
-- Run via: npx supabase test db

BEGIN;
SELECT plan(16);

-- Fixture setup: one shop, owned by one auth user. Full auth.users column set
-- matches the convention used by every other pgTAP test in this repo (e.g.
-- wafi151_daily_event_counts_apply.test.sql, wafi140_events_rls.test.sql) --
-- the minimal (id, email)-only form is not sufficient for a local Supabase
-- auth.users row.
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'owner@wafi153.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');
DELETE FROM public.shops WHERE owner_user_id = '11111111-1111-1111-1111-111111111111';
INSERT INTO public.shops (id, owner_user_id, name, timezone)
  VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Test Shop', 'UTC');

-- Seed events as postgres (bypasses RLS), same as wafi151's precedent --
-- _apply_profit_cache derives everything from these rows, never from client
-- input. public.events.entity_id and staff_id are NOT NULL (074_events_bus_core.sql),
-- so every fixture row below supplies both. payload is a TEXT column (074's
-- deliberate JSON-as-text-string choice, matching audit_log.meta's precedent),
-- not JSONB -- inserted as a plain string literal, no ::jsonb cast needed.

-- Event 1: version=2 sale.completed, $19.99 revenue, $10.00 cogs, $0 discount, costless=false.
INSERT INTO public.events (id, shop_id, type, entity_id, payload, payload_version, occurred_at, staff_id)
VALUES ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'sale.completed', 's1',
  '{"saleId":"s1","totalUsd":19.99,"totalSyp":0,"cogsUsd":10.00,"discountUsd":0,"hasCostlessLine":false}',
  2, now(), '11111111-1111-1111-1111-111111111111');

-- _apply_profit_cache has EXECUTE revoked from PUBLIC (086) and is only
-- ever reachable via the public apply_profit_cache wrapper or the
-- SECURITY DEFINER rebuild function, both of which run as their own
-- owner regardless of caller grants -- there is no production path where
-- service_role calls it directly, so (mirroring wafi151's convention)
-- this internal-only setup call runs as the unrestricted test role, not
-- service_role, which has no grant on it either.
SELECT public._apply_profit_cache('33333333-3333-3333-3333-333333333333');

-- Test 1: cents conversion is exact, not truncated (19.99 -> 1999, never 1900).
SELECT is(
  (SELECT revenue_usd FROM public.profit_cache WHERE shop_id = '22222222-2222-2222-2222-222222222222'),
  1999::bigint, 'revenue_usd is 1999 cents for a $19.99 sale, not truncated to 1900'
);

-- Test 2: ledger row created.
SELECT is(
  (SELECT count(*)::int FROM public.projection_processed_events
   WHERE projection_name = 'profit_cache' AND event_id = '33333333-3333-3333-3333-333333333333'),
  1, 'ledger records the applied event exactly once'
);

-- Test 3: redelivery is a no-op (same event applied twice -> one increment, one ledger row).
SELECT public._apply_profit_cache('33333333-3333-3333-3333-333333333333');
SELECT is(
  (SELECT revenue_usd FROM public.profit_cache WHERE shop_id = '22222222-2222-2222-2222-222222222222'),
  1999::bigint, 'redelivering the same event_id does not double-increment'
);

-- Test 4: payload_version = 1 is a permanent, ledger-recorded no-op, not an error.
INSERT INTO public.events (id, shop_id, type, entity_id, payload, payload_version, occurred_at, staff_id)
VALUES ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222', 'sale.completed', 's2',
  '{"saleId":"s2","totalUsd":5.00,"totalSyp":0}', 1, now(), '11111111-1111-1111-1111-111111111111');
SELECT lives_ok(
  $$ SELECT public._apply_profit_cache('44444444-4444-4444-4444-444444444444') $$,
  'a payload_version=1 event does not raise'
);
SELECT is(
  (SELECT revenue_usd FROM public.profit_cache WHERE shop_id = '22222222-2222-2222-2222-222222222222'),
  1999::bigint, 'a payload_version=1 event produces no profit_cache mutation'
);
SELECT is(
  (SELECT count(*)::int FROM public.projection_processed_events
   WHERE projection_name = 'profit_cache' AND event_id = '44444444-4444-4444-4444-444444444444'),
  1, 'a payload_version=1 event is still ledger-recorded so it is never retried'
);

-- Test 5: payload_version = 3 raises loudly (P0004).
INSERT INTO public.events (id, shop_id, type, entity_id, payload, payload_version, occurred_at, staff_id)
VALUES ('55555555-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222', 'sale.completed', 's3',
  '{"saleId":"s3","totalUsd":5.00,"totalSyp":0,"cogsUsd":0,"discountUsd":0,"hasCostlessLine":false}',
  3, now(), '11111111-1111-1111-1111-111111111111');
SELECT throws_ok(
  $$ SELECT public._apply_profit_cache('55555555-5555-5555-5555-555555555555') $$,
  'P0004', NULL, 'a payload_version > 2 event raises loudly'
);

-- Test 6: a version=2 sale.completed missing a required field (cogsUsd) raises P0005, no partial mutation.
INSERT INTO public.events (id, shop_id, type, entity_id, payload, payload_version, occurred_at, staff_id)
VALUES ('66666666-6666-6666-6666-666666666666', '22222222-2222-2222-2222-222222222222', 'sale.completed', 's4',
  '{"saleId":"s4","totalUsd":5.00,"totalSyp":0,"discountUsd":0,"hasCostlessLine":false}',
  2, now(), '11111111-1111-1111-1111-111111111111');
SELECT throws_ok(
  $$ SELECT public._apply_profit_cache('66666666-6666-6666-6666-666666666666') $$,
  'P0005', NULL, 'a version=2 event missing a required field raises loudly'
);
SELECT is(
  (SELECT revenue_usd FROM public.profit_cache WHERE shop_id = '22222222-2222-2222-2222-222222222222'),
  1999::bigint, 'the missing-field event caused no partial mutation to the existing row'
);

-- Test 7: sale.returned full-return-of-costless-sale decrements the ORIGINAL SALE's day, not the return's.
INSERT INTO public.events (id, shop_id, type, entity_id, payload, payload_version, occurred_at, staff_id)
VALUES ('77777777-7777-7777-7777-777777777777', '22222222-2222-2222-2222-222222222222', 'sale.completed', 's5',
  '{"saleId":"s5","totalUsd":8.00,"totalSyp":0,"cogsUsd":0,"discountUsd":0,"hasCostlessLine":true}',
  2, '2026-08-10T10:00:00Z', '11111111-1111-1111-1111-111111111111');
UPDATE public.events SET event_projection_day = '2026-08-10' WHERE id = '77777777-7777-7777-7777-777777777777';
SELECT public._apply_profit_cache('77777777-7777-7777-7777-777777777777');
SELECT is(
  (SELECT costless_sale_count FROM public.profit_cache WHERE shop_id = '22222222-2222-2222-2222-222222222222' AND day = '2026-08-10'),
  1, 'sale.completed increments costless_sale_count on its own day'
);

INSERT INTO public.events (id, shop_id, type, entity_id, payload, payload_version, occurred_at, staff_id)
VALUES ('88888888-8888-8888-8888-888888888888', '22222222-2222-2222-2222-222222222222', 'sale.returned', 'r1',
  '{"returnId":"r1","saleId":"s5","refundAmountUsd":8.00,"cogsReversalUsd":0,"isFullReturn":true,"saleWasCostless":true,"originalSaleProjectionDay":"2026-08-10"}',
  2, '2026-08-20T10:00:00Z', '11111111-1111-1111-1111-111111111111');
UPDATE public.events SET event_projection_day = '2026-08-20' WHERE id = '88888888-8888-8888-8888-888888888888';
SELECT public._apply_profit_cache('88888888-8888-8888-8888-888888888888');
SELECT is(
  (SELECT costless_sale_count FROM public.profit_cache WHERE shop_id = '22222222-2222-2222-2222-222222222222' AND day = '2026-08-10'),
  0, 'a full return of a costless sale decrements the SALE''S day (Aug 10), not the return''s day (Aug 20)'
);
SELECT is(
  (SELECT count(*)::int FROM public.profit_cache WHERE shop_id = '22222222-2222-2222-2222-222222222222' AND day = '2026-08-20' AND return_count = 1),
  1, 'the return''s own day gets its refund/return_count metrics'
);

-- Test 8: return-before-sale ordering nets to 0 regardless of order.
INSERT INTO public.events (id, shop_id, type, entity_id, payload, payload_version, occurred_at, staff_id)
VALUES ('99999999-9999-9999-9999-999999999999', '22222222-2222-2222-2222-222222222222', 'sale.returned', 'r2',
  '{"returnId":"r2","saleId":"s6","refundAmountUsd":5.00,"cogsReversalUsd":0,"isFullReturn":true,"saleWasCostless":true,"originalSaleProjectionDay":"2026-09-01"}',
  2, '2026-09-05T10:00:00Z', '11111111-1111-1111-1111-111111111111');
UPDATE public.events SET event_projection_day = '2026-09-05' WHERE id = '99999999-9999-9999-9999-999999999999';
SELECT public._apply_profit_cache('99999999-9999-9999-9999-999999999999');
SELECT is(
  (SELECT costless_sale_count FROM public.profit_cache WHERE shop_id = '22222222-2222-2222-2222-222222222222' AND day = '2026-09-01'),
  -1, 'return-before-sale seeds -1 via upsert, never silently loses the decrement'
);

INSERT INTO public.events (id, shop_id, type, entity_id, payload, payload_version, occurred_at, staff_id)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'sale.completed', 's6',
  '{"saleId":"s6","totalUsd":5.00,"totalSyp":0,"cogsUsd":0,"discountUsd":0,"hasCostlessLine":true}',
  2, '2026-09-01T10:00:00Z', '11111111-1111-1111-1111-111111111111');
UPDATE public.events SET event_projection_day = '2026-09-01' WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
SELECT public._apply_profit_cache('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SELECT is(
  (SELECT costless_sale_count FROM public.profit_cache WHERE shop_id = '22222222-2222-2222-2222-222222222222' AND day = '2026-09-01'),
  0, 'sale.completed arriving after its own return nets to 0 (return-first ordering)'
);

-- Test 9: direct client INSERT against profit_cache is rejected (grant-level).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111')::text, true);
SELECT throws_ok(
  $$ INSERT INTO public.profit_cache (shop_id, day) VALUES ('22222222-2222-2222-2222-222222222222', '2026-01-01') $$,
  '42501', NULL, 'a direct client INSERT against profit_cache is rejected at the grant level'
);
RESET ROLE;

-- Test 10: _apply_profit_cache is not callable directly by authenticated (only via the wrapper).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111')::text, true);
SELECT throws_ok(
  $$ SELECT public._apply_profit_cache('33333333-3333-3333-3333-333333333333') $$,
  '42501', NULL, '_apply_profit_cache is not directly callable by authenticated'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
