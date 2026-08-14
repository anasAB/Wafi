-- supabase/tests/wafi156_business_rules.test.sql
-- WAFI-156: business_rules table -- schema, RLS, closed-vocabulary CHECK
-- constraints, and seed_business_rules_for_shop().
-- Run via: npx supabase test db

BEGIN;
SELECT plan(6);

-- ========================================================================
-- Fixtures: one owner + one shop (business_rules migration's backfill DO
-- block already seeded this shop's 2 proof rules when the migration ran
-- against pre-existing public.shops rows created by earlier test fixtures,
-- but this shop is newly inserted here so it only gets seeded explicitly
-- below).
-- ========================================================================

INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'f0000000-0000-0000-0000-000000000002', 'owner-wafi156@test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');

DELETE FROM public.shops WHERE owner_user_id = 'f0000000-0000-0000-0000-000000000002';
INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('f0000000-0000-0000-0000-000000000001', 'WAFI-156 Shop', 'f0000000-0000-0000-0000-000000000002');

-- Ensure a clean slate for this shop's rules, then run the seed function
-- under test (mirrors the migration's own backfill call shape).
DELETE FROM public.business_rules WHERE shop_id = 'f0000000-0000-0000-0000-000000000001';
SELECT public.seed_business_rules_for_shop('f0000000-0000-0000-0000-000000000001');

-- 1. Seed produced exactly 2 rows for a fresh shop.
SELECT is(
  (SELECT count(*)::int FROM public.business_rules WHERE shop_id = 'f0000000-0000-0000-0000-000000000001'),
  2,
  'seed_business_rules_for_shop creates exactly the 2 proof rules'
);

-- 2. rule_key uniqueness enforced per shop.
SELECT throws_ok(
  $$ INSERT INTO public.business_rules (shop_id, rule_key, name, event_type, field, transform, operator, threshold, action)
     VALUES ('f0000000-0000-0000-0000-000000000001', 'large_return', 'dup', 'sale.returned', 'refundAmountUsd', 'none', 'gt', 1, 'notify_owner') $$,
  '23505',
  'duplicate rule_key per shop is rejected by UNIQUE (shop_id, rule_key)'
);

-- 3-5. Closed-vocabulary CHECK constraints reject out-of-enum values.
SELECT throws_ok(
  $$ INSERT INTO public.business_rules (shop_id, rule_key, name, event_type, field, transform, operator, threshold, action)
     VALUES ('f0000000-0000-0000-0000-000000000001', 'bad_transform', 'x', 'sale.returned', 'refundAmountUsd', 'sqrt', 'gt', 1, 'notify_owner') $$,
  '23514', 'transform outside (none, abs) rejected by CHECK'
);
SELECT throws_ok(
  $$ INSERT INTO public.business_rules (shop_id, rule_key, name, event_type, field, transform, operator, threshold, action)
     VALUES ('f0000000-0000-0000-0000-000000000001', 'bad_operator', 'x', 'sale.returned', 'refundAmountUsd', 'none', 'contains', 1, 'notify_owner') $$,
  '23514', 'operator outside the closed enum rejected by CHECK'
);
SELECT throws_ok(
  $$ INSERT INTO public.business_rules (shop_id, rule_key, name, event_type, field, transform, operator, threshold, action)
     VALUES ('f0000000-0000-0000-0000-000000000001', 'bad_action', 'x', 'sale.returned', 'refundAmountUsd', 'none', 'gt', 1, 'create_task') $$,
  '23514', 'action other than notify_owner rejected by CHECK'
);

-- 6. authenticated role has no direct write grant at all.
SELECT set_config('request.jwt.claims', '{"sub":"f0000000-0000-0000-0000-000000000002","active_role":"owner"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ UPDATE public.business_rules SET threshold = 999 WHERE rule_key = 'large_return' $$,
  '42501',
  'authenticated role cannot UPDATE business_rules directly (permission denied, not RLS-filtered)'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
