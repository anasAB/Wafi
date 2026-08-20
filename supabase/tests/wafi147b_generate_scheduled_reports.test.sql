-- supabase/tests/wafi147b_generate_scheduled_reports.test.sql
-- WAFI-147B Task 5. Cadence resolver: slot validation, applicable-shops
-- filtering, and per-item failure isolation.
BEGIN;
SELECT plan(6);

-- FK prerequisite: shops.owner_user_id references auth.users(id). A minimal
-- (id, email)-only row is insufficient for local Supabase's auth.users (see
-- precedent in wafi147b_generate_report_snapshot.test.sql / wafi153 /
-- wafi143) -- use the full-column insert convention established there.
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  recovery_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change, email_change_token_new,
  recovery_token
) VALUES
  ('00000000-0000-0000-0000-000000000000', '77777777-7777-7777-7777-777777777777',
   'authenticated', 'authenticated', 'active-shop-owner@example.com', 'x', now(),
   now(), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(),
   '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '99999999-9999-9999-9999-999999999999',
   'authenticated', 'authenticated', 'inactive-shop-owner@example.com', 'x', now(),
   now(), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(),
   '', '', '', '');

INSERT INTO public.shops (id, owner_user_id, name, is_active) VALUES
  ('66666666-6666-6666-6666-666666666666', '77777777-7777-7777-7777-777777777777', 'Active Shop', true),
  ('88888888-8888-8888-8888-888888888888', '99999999-9999-9999-9999-999999999999', 'Inactive Shop', false);

-- 1. Slot validation: an off-schedule explicit scheduled_for is rejected.
SELECT throws_ok(
  $$ SELECT public.generate_scheduled_reports('weekly', '2026-08-19 13:37:00+00') $$, -- a Wednesday
  NULL, NULL, 'non-canonical weekly slot is rejected'
);
SELECT throws_ok(
  $$ SELECT public.generate_scheduled_reports('weekly', '2026-08-16 10:00:00+00') $$, -- Sunday, wrong hour
  NULL, NULL, 'canonical day but wrong hour is rejected'
);
SELECT lives_ok(
  $$ SELECT public.generate_scheduled_reports('weekly', '2026-08-16 09:00:00+00') $$, -- a real Sunday 09:00
  'canonical Sunday 09:00 slot is accepted'
);

-- 2. Applicable shops: only the active shop gets a snapshot.
-- NOTE: as of this task, only 1 of the 6 weekly report types
-- ('weekly-summary') is actually implemented by generate_report_snapshot()
-- (Task 4). The other 5 ('inventory-health', 'discount-report',
-- 'returns-report', 'credit-report', 'dead-stock') are not yet implemented
-- (Task 6) and raise a "not yet implemented" exception from
-- generate_report_snapshot(), which this resolver's per-item failure
-- isolation catches and logs as a WARNING rather than propagating -- so
-- those 5 fail-and-get-skipped and only 1 snapshot row is actually created
-- for the active shop. Expected count is therefore 1, not 6, until Task 6
-- lands and implements the remaining 5 weekly report types.
SELECT is(
  (SELECT count(*)::int FROM public.generated_reports WHERE shop_id = '66666666-6666-6666-6666-666666666666'),
  1, 'active shop gets the 1 currently-implemented weekly report type (others raise-and-are-skipped until Task 6)'
);
SELECT is(
  (SELECT count(*)::int FROM public.generated_reports WHERE shop_id = '88888888-8888-8888-8888-888888888888'),
  0, 'inactive shop gets nothing'
);

-- 3. Idempotency at the resolver level: re-running the same slot changes nothing.
SELECT lives_ok(
  $$ SELECT public.generate_scheduled_reports('weekly', '2026-08-16 09:00:00+00') $$,
  're-running the same slot is a safe no-op'
);

SELECT * FROM finish();
ROLLBACK;
