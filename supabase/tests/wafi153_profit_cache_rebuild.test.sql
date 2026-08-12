-- supabase/tests/wafi153_profit_cache_rebuild.test.sql
-- WAFI-153: rebuild_profit_cache_scope / _backfill_profit_cache_shop
-- (087_profit_cache_rebuild.sql). Mirrors
-- supabase/tests/wafi151_daily_event_counts_rebuild.test.sql's harness shape.
-- Run via: npx supabase test db

BEGIN;
SELECT plan(6);

-- One shop. Inserting into auth.users fires provision_shop_for_new_user
-- (migration 021), which auto-creates a shops row for this owner -- delete
-- it and insert our own fixed-id shop row instead, same as the WAFI-151
-- rebuild test's owner/shop setup.
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'owner@wafi153.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');
DELETE FROM public.shops WHERE owner_user_id = '11111111-1111-1111-1111-111111111111';
INSERT INTO public.shops (id, owner_user_id, name, timezone)
  VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Test Shop', 'UTC');

INSERT INTO public.devices (id, shop_id, device_code)
  VALUES ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'DEV-1');
INSERT INTO public.products (id, shop_id, name_ar, price_usd)
  VALUES ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222', 'منتج تجريبي', 0);

-- Test 1: mixed-version-day backfill -- one version-1 sale (backfill-only)
-- and one version-2 sale (event-derived) on the same day; the full rebuild
-- must sum both exactly once each.
INSERT INTO public.sales (id, shop_id, device_id, device_sequence, display_sale_number, created_at, total_usd, total_syp, exchange_rate_at_sale, payment_method)
  VALUES ('b1111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', 1, 'INV-1', '2026-08-10T09:00:00Z', 10.00, 0, 1, 'cash_usd');
INSERT INTO public.events (id, type, entity_id, shop_id, payload, payload_version, occurred_at, staff_id)
VALUES ('c1111111-1111-1111-1111-111111111111', 'sale.completed', 'b1111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
  '{"saleId":"b1111111-1111-1111-1111-111111111111","totalUsd":10.00,"totalSyp":0}',
  1, '2026-08-10T09:00:00Z', '11111111-1111-1111-1111-111111111111');

INSERT INTO public.sales (id, shop_id, device_id, device_sequence, display_sale_number, created_at, total_usd, total_syp, exchange_rate_at_sale, payment_method)
  VALUES ('b2222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', 2, 'INV-2', '2026-08-10T11:00:00Z', 20.00, 0, 1, 'cash_usd');
INSERT INTO public.events (id, type, entity_id, shop_id, payload, payload_version, occurred_at, staff_id)
VALUES ('c2222222-2222-2222-2222-222222222222', 'sale.completed', 'b2222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222',
  '{"saleId":"b2222222-2222-2222-2222-222222222222","totalUsd":20.00,"totalSyp":0,"cogsUsd":0,"discountUsd":0,"hasCostlessLine":false}',
  2, '2026-08-10T11:00:00Z', '11111111-1111-1111-1111-111111111111');

SET LOCAL ROLE service_role;
SELECT public.rebuild_profit_cache_scope('22222222-2222-2222-2222-222222222222');
RESET ROLE;

SELECT is(
  (SELECT revenue_usd FROM public.profit_cache WHERE shop_id = '22222222-2222-2222-2222-222222222222' AND day = '2026-08-10'),
  3000::bigint, 'mixed-version day: rebuild sums the backfilled v1 sale ($10) and the replayed v2 sale ($20) exactly once each = $30'
);

-- Test 2: repeated-rebuild idempotency.
SET LOCAL ROLE service_role;
SELECT public.rebuild_profit_cache_scope('22222222-2222-2222-2222-222222222222');
RESET ROLE;
SELECT is(
  (SELECT revenue_usd FROM public.profit_cache WHERE shop_id = '22222222-2222-2222-2222-222222222222' AND day = '2026-08-10'),
  3000::bigint, 'a second immediate rebuild produces byte-identical rows'
);

-- Test 3: cross-day rebuild safety -- sale day 1, full return day 10, both
-- within the covered range; full-scope rebuild must reproduce incremental's
-- result (0). Both events are payload_version 2, so the sale is excluded
-- from backfill entirely -- this scenario is fully event-derived.
INSERT INTO public.sales (id, shop_id, device_id, device_sequence, display_sale_number, created_at, total_usd, total_syp, exchange_rate_at_sale, payment_method)
  VALUES ('b3333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', 3, 'INV-3', '2026-09-01T09:00:00Z', 15.00, 0, 1, 'cash_usd');
INSERT INTO public.events (id, type, entity_id, shop_id, payload, payload_version, occurred_at, staff_id)
VALUES ('c3333333-3333-3333-3333-333333333333', 'sale.completed', 'b3333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222',
  '{"saleId":"b3333333-3333-3333-3333-333333333333","totalUsd":15.00,"totalSyp":0,"cogsUsd":0,"discountUsd":0,"hasCostlessLine":true}',
  2, '2026-09-01T09:00:00Z', '11111111-1111-1111-1111-111111111111');

INSERT INTO public.events (id, type, entity_id, shop_id, payload, payload_version, occurred_at, staff_id)
VALUES ('c4444444-4444-4444-4444-444444444444', 'sale.returned', 'r3', '22222222-2222-2222-2222-222222222222',
  '{"returnId":"r3","saleId":"b3333333-3333-3333-3333-333333333333","refundAmountUsd":15.00,"cogsReversalUsd":0,"isFullReturn":true,"saleWasCostless":true,"originalSaleProjectionDay":"2026-09-01"}',
  2, '2026-09-10T09:00:00Z', '11111111-1111-1111-1111-111111111111');

SET LOCAL ROLE service_role;
SELECT public.rebuild_profit_cache_scope('22222222-2222-2222-2222-222222222222');
RESET ROLE;
SELECT is(
  (SELECT costless_sale_count FROM public.profit_cache WHERE shop_id = '22222222-2222-2222-2222-222222222222' AND day = '2026-09-01'),
  0, 'full-scope rebuild reproduces the incremental cross-day result: sale day''s costless_sale_count ends at 0'
);

-- Test 4: backfilled-row-mutated-by-a-later-event rebuild safety -- a
-- pre-coverage costless sale (backfill-only, no sale.completed event at all)
-- with a later v2 full-return event referencing it must end at 0 after
-- rebuild, not -1. The sale_line_item's unit_cost_usd defaults to 0, which
-- is exactly what makes the backfill compute has_costless_line = true for
-- this sale, giving the decrement something real to zero out.
INSERT INTO public.sales (id, shop_id, device_id, device_sequence, display_sale_number, created_at, total_usd, total_syp, exchange_rate_at_sale, payment_method)
  VALUES ('b5555555-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', 4, 'INV-4', '2026-10-01T09:00:00Z', 12.00, 0, 1, 'cash_usd');
INSERT INTO public.sale_line_items (sale_id, shop_id, product_id, quantity, unit_price_usd, line_total_usd)
  VALUES ('b5555555-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222', '44444444-4444-4444-4444-444444444444', 1, 12.00, 12.00);
-- No sale.completed event for this sale at all -- pure pre-coverage history, backfill-only.

INSERT INTO public.events (id, type, entity_id, shop_id, payload, payload_version, occurred_at, staff_id)
VALUES ('c5555555-5555-5555-5555-555555555555', 'sale.returned', 'r4', '22222222-2222-2222-2222-222222222222',
  '{"returnId":"r4","saleId":"b5555555-5555-5555-5555-555555555555","refundAmountUsd":12.00,"cogsReversalUsd":0,"isFullReturn":true,"saleWasCostless":true,"originalSaleProjectionDay":"2026-10-01"}',
  2, '2026-10-05T09:00:00Z', '11111111-1111-1111-1111-111111111111');

SET LOCAL ROLE service_role;
SELECT public.rebuild_profit_cache_scope('22222222-2222-2222-2222-222222222222');
RESET ROLE;
SELECT is(
  (SELECT costless_sale_count FROM public.profit_cache WHERE shop_id = '22222222-2222-2222-2222-222222222222' AND day = '2026-10-01'),
  0, 'a full rematerialization never re-applies the same decrement twice against a never-reset backfilled row (must be 0, not -1)'
);

-- Test 5: rebuild_profit_cache_scope is not callable by authenticated (service_role only).
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.rebuild_profit_cache_scope('22222222-2222-2222-2222-222222222222') $$,
  '42501', NULL, 'rebuild_profit_cache_scope is service_role-only, not callable by authenticated'
);
RESET ROLE;

-- Test 6: an expense with an eligible v2 event is excluded from backfill (not double-counted).
INSERT INTO public.expenses (id, shop_id, amount, currency, amount_usd, category, expense_date)
  VALUES ('e1111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 7.00, 'USD', 7.00, 'other', '2026-11-01');
INSERT INTO public.events (id, type, entity_id, shop_id, payload, payload_version, occurred_at, staff_id)
VALUES ('c6666666-6666-6666-6666-666666666666', 'expense.recorded', 'e1111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
  '{"expenseId":"e1111111-1111-1111-1111-111111111111","amountUsd":7.00}',
  2, '2026-11-01T09:00:00Z', '11111111-1111-1111-1111-111111111111');

SET LOCAL ROLE service_role;
SELECT public.rebuild_profit_cache_scope('22222222-2222-2222-2222-222222222222');
RESET ROLE;
SELECT is(
  (SELECT expenses_usd FROM public.profit_cache WHERE shop_id = '22222222-2222-2222-2222-222222222222' AND day = '2026-11-01'),
  700::bigint, 'an expense with an eligible v2 event is applied exactly once (event-derived, not also backfilled)'
);

SELECT * FROM finish();
ROLLBACK;
