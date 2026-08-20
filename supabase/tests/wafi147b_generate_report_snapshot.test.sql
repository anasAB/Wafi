-- supabase/tests/wafi147b_generate_report_snapshot.test.sql
-- WAFI-147B. pgTAP tests for public.generate_report_snapshot(...) -- the
-- generation primitive, exercised via its 2 worked report types
-- (cash-flow: simple; weekly-summary: composite/gated-section).
-- Run via: npx supabase test db
BEGIN;
SELECT plan(28);

-- Fixture shop + owner + a manager with can_view_reports granted (for
-- notification fan-out) + a cashier without it.
--
-- shops.owner_user_id is a real FK to auth.users(id) (013_shops_owner_user_id.sql),
-- so (mirroring wafi153_profit_cache_apply.test.sql's established convention)
-- a full-column auth.users row must exist before the shops insert, or the FK
-- fails outright.
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'owner-wafi147b-gen@test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');

INSERT INTO public.shops (id, owner_user_id, name) VALUES
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'Test Shop');

-- public.staff.pin_hash is NOT NULL (003_staff.sql) -- the brief's fixture
-- omitted it; supplied here as a throwaway bcrypt-shaped value since no
-- test exercises PIN auth. role CHECK allows 'owner'|'cashier'|'manager'
-- (020_staff_role_manager.sql).
INSERT INTO public.staff (id, shop_id, name, pin_hash, role, permissions) VALUES
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'Owner', 'x', 'owner', '{}'),
  ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'Manager', 'x', 'manager', '{"can_view_reports": true}'),
  ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'Cashier', 'x', 'cashier', '{}');

-- 1. Coherence validation: a mismatched period for a valid scheduled_for is rejected.
SELECT throws_ok(
  $$ SELECT public.generate_report_snapshot(
       '11111111-1111-1111-1111-111111111111', 'weekly-summary',
       '2026-08-10 00:00:00+00', '2026-08-11 00:00:00+00', -- one day, not a week
       '2026-08-23 09:00:00+00') $$,
  NULL, NULL,
  'period not matching (report_type, scheduled_for) is rejected'
);

-- 2. Simple (non-composite) report type: creates exactly one snapshot row.
SELECT lives_ok(
  $$ SELECT public.generate_report_snapshot(
       '11111111-1111-1111-1111-111111111111', 'cash-flow',
       '2026-08-19 00:00:00+00', '2026-08-20 00:00:00+00', '2026-08-20 00:00:00+00') $$,
  'cash-flow generation succeeds'
);
SELECT is(
  (SELECT count(*)::int FROM public.generated_reports
   WHERE shop_id = '11111111-1111-1111-1111-111111111111' AND report_type = 'cash-flow'),
  1, 'exactly one cash-flow snapshot row created'
);
SELECT is(
  (SELECT count(*)::int FROM public.generated_report_staff_sections grs
   JOIN public.generated_reports gr ON gr.id = grs.generated_report_id
   WHERE gr.report_type = 'cash-flow'),
  0, 'cash-flow (no gated section) never gets a staff_sections row'
);

-- 3. Idempotency: calling again with the same natural key is a no-op.
SELECT lives_ok(
  $$ SELECT public.generate_report_snapshot(
       '11111111-1111-1111-1111-111111111111', 'cash-flow',
       '2026-08-19 00:00:00+00', '2026-08-20 00:00:00+00', '2026-08-20 00:00:00+00') $$,
  'second call for same natural key is a safe no-op'
);
SELECT is(
  (SELECT count(*)::int FROM public.generated_reports
   WHERE shop_id = '11111111-1111-1111-1111-111111111111' AND report_type = 'cash-flow'),
  1, 'still exactly one row after the no-op retry'
);

-- 4. Composite report type: creates a main snapshot AND a staff-sections row,
--    AND exactly 2 notifications (owner + manager; cashier lacks can_view_reports).
SELECT lives_ok(
  $$ SELECT public.generate_report_snapshot(
       '11111111-1111-1111-1111-111111111111', 'weekly-summary',
       '2026-08-10 00:00:00+00', '2026-08-17 00:00:00+00', '2026-08-23 09:00:00+00') $$,
  'weekly-summary generation succeeds'
);
SELECT is(
  (SELECT count(*)::int FROM public.notifications
   WHERE entity_type = 'generated_report' AND type = 'report_ready'
     AND recipient_staff_id IN ('33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444')),
  2, 'exactly 2 notifications: owner + the can_view_reports-granted manager'
);

-- 5. Task 6: the remaining 10 report types. One lives_ok per type, plus a
--    staff-section presence/absence check matching each type's composite
--    status per its src/features/reports/definitions/<name>.ts source.

-- daily-closing (daily cadence; composite -- gated Staff Performance section)
SELECT lives_ok(
  $$ SELECT public.generate_report_snapshot(
       '11111111-1111-1111-1111-111111111111', 'daily-closing',
       '2026-08-19 00:00:00+00', '2026-08-20 00:00:00+00', '2026-08-20 00:00:00+00') $$,
  'daily-closing generation succeeds'
);
SELECT is(
  (SELECT count(*)::int FROM public.generated_report_staff_sections grs
   JOIN public.generated_reports gr ON gr.id = grs.generated_report_id
   WHERE gr.report_type = 'daily-closing' AND gr.shop_id = '11111111-1111-1111-1111-111111111111'),
  1, 'daily-closing (has a gated section per dailyClosing.ts) gets a staff_sections row'
);

-- inventory-health (weekly cadence; no gated section)
SELECT lives_ok(
  $$ SELECT public.generate_report_snapshot(
       '11111111-1111-1111-1111-111111111111', 'inventory-health',
       '2026-08-10 00:00:00+00', '2026-08-17 00:00:00+00', '2026-08-23 09:00:00+00') $$,
  'inventory-health generation succeeds'
);
SELECT is(
  (SELECT count(*)::int FROM public.generated_report_staff_sections grs
   JOIN public.generated_reports gr ON gr.id = grs.generated_report_id
   WHERE gr.report_type = 'inventory-health' AND gr.shop_id = '11111111-1111-1111-1111-111111111111'),
  0, 'inventory-health (no gated section per inventoryHealth.ts) never gets a staff_sections row'
);

-- discount-report (weekly cadence; composite -- gated By Staff section)
SELECT lives_ok(
  $$ SELECT public.generate_report_snapshot(
       '11111111-1111-1111-1111-111111111111', 'discount-report',
       '2026-08-10 00:00:00+00', '2026-08-17 00:00:00+00', '2026-08-23 09:00:00+00') $$,
  'discount-report generation succeeds'
);
SELECT is(
  (SELECT count(*)::int FROM public.generated_report_staff_sections grs
   JOIN public.generated_reports gr ON gr.id = grs.generated_report_id
   WHERE gr.report_type = 'discount-report' AND gr.shop_id = '11111111-1111-1111-1111-111111111111'),
  1, 'discount-report (has a gated section per discountReport.ts) gets a staff_sections row'
);

-- returns-report (weekly cadence; composite -- gated By Staff section)
SELECT lives_ok(
  $$ SELECT public.generate_report_snapshot(
       '11111111-1111-1111-1111-111111111111', 'returns-report',
       '2026-08-10 00:00:00+00', '2026-08-17 00:00:00+00', '2026-08-23 09:00:00+00') $$,
  'returns-report generation succeeds'
);
SELECT is(
  (SELECT count(*)::int FROM public.generated_report_staff_sections grs
   JOIN public.generated_reports gr ON gr.id = grs.generated_report_id
   WHERE gr.report_type = 'returns-report' AND gr.shop_id = '11111111-1111-1111-1111-111111111111'),
  1, 'returns-report (has a gated section per returnsReport.ts) gets a staff_sections row'
);

-- credit-report (weekly cadence; no gated section)
SELECT lives_ok(
  $$ SELECT public.generate_report_snapshot(
       '11111111-1111-1111-1111-111111111111', 'credit-report',
       '2026-08-10 00:00:00+00', '2026-08-17 00:00:00+00', '2026-08-23 09:00:00+00') $$,
  'credit-report generation succeeds'
);
SELECT is(
  (SELECT count(*)::int FROM public.generated_report_staff_sections grs
   JOIN public.generated_reports gr ON gr.id = grs.generated_report_id
   WHERE gr.report_type = 'credit-report' AND gr.shop_id = '11111111-1111-1111-1111-111111111111'),
  0, 'credit-report (no gated section per creditReport.ts) never gets a staff_sections row'
);

-- dead-stock (weekly cadence; no gated section)
SELECT lives_ok(
  $$ SELECT public.generate_report_snapshot(
       '11111111-1111-1111-1111-111111111111', 'dead-stock',
       '2026-08-10 00:00:00+00', '2026-08-17 00:00:00+00', '2026-08-23 09:00:00+00') $$,
  'dead-stock generation succeeds'
);
SELECT is(
  (SELECT count(*)::int FROM public.generated_report_staff_sections grs
   JOIN public.generated_reports gr ON gr.id = grs.generated_report_id
   WHERE gr.report_type = 'dead-stock' AND gr.shop_id = '11111111-1111-1111-1111-111111111111'),
  0, 'dead-stock (no gated section per deadStock.ts) never gets a staff_sections row'
);

-- monthly-health (monthly cadence; composite -- gated Staff Performance Review section)
SELECT lives_ok(
  $$ SELECT public.generate_report_snapshot(
       '11111111-1111-1111-1111-111111111111', 'monthly-health',
       '2026-07-01 00:00:00+00', '2026-08-01 00:00:00+00', '2026-08-01 09:00:00+00') $$,
  'monthly-health generation succeeds'
);
SELECT is(
  (SELECT count(*)::int FROM public.generated_report_staff_sections grs
   JOIN public.generated_reports gr ON gr.id = grs.generated_report_id
   WHERE gr.report_type = 'monthly-health' AND gr.shop_id = '11111111-1111-1111-1111-111111111111'),
  1, 'monthly-health (has a gated section per monthlyHealth.ts) gets a staff_sections row'
);

-- profit-trend (monthly cadence; no gated section)
SELECT lives_ok(
  $$ SELECT public.generate_report_snapshot(
       '11111111-1111-1111-1111-111111111111', 'profit-trend',
       '2026-07-01 00:00:00+00', '2026-08-01 00:00:00+00', '2026-08-01 09:00:00+00') $$,
  'profit-trend generation succeeds'
);
SELECT is(
  (SELECT count(*)::int FROM public.generated_report_staff_sections grs
   JOIN public.generated_reports gr ON gr.id = grs.generated_report_id
   WHERE gr.report_type = 'profit-trend' AND gr.shop_id = '11111111-1111-1111-1111-111111111111'),
  0, 'profit-trend (no gated section per profitTrend.ts) never gets a staff_sections row'
);

-- top-customers (monthly cadence; no gated section)
SELECT lives_ok(
  $$ SELECT public.generate_report_snapshot(
       '11111111-1111-1111-1111-111111111111', 'top-customers',
       '2026-07-01 00:00:00+00', '2026-08-01 00:00:00+00', '2026-08-01 09:00:00+00') $$,
  'top-customers generation succeeds'
);
SELECT is(
  (SELECT count(*)::int FROM public.generated_report_staff_sections grs
   JOIN public.generated_reports gr ON gr.id = grs.generated_report_id
   WHERE gr.report_type = 'top-customers' AND gr.shop_id = '11111111-1111-1111-1111-111111111111'),
  0, 'top-customers (no gated section per topCustomers.ts) never gets a staff_sections row'
);

-- top-products (monthly cadence; no gated section)
SELECT lives_ok(
  $$ SELECT public.generate_report_snapshot(
       '11111111-1111-1111-1111-111111111111', 'top-products',
       '2026-07-01 00:00:00+00', '2026-08-01 00:00:00+00', '2026-08-01 09:00:00+00') $$,
  'top-products generation succeeds'
);
SELECT is(
  (SELECT count(*)::int FROM public.generated_report_staff_sections grs
   JOIN public.generated_reports gr ON gr.id = grs.generated_report_id
   WHERE gr.report_type = 'top-products' AND gr.shop_id = '11111111-1111-1111-1111-111111111111'),
  0, 'top-products (no gated section per topProducts.ts) never gets a staff_sections row'
);

SELECT * FROM finish();
ROLLBACK;
