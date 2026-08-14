-- supabase/tests/wafi156_rule_action_log.test.sql
-- WAFI-156: rule_action_log table -- zero client access (no RLS, no grants)
-- and ON DELETE RESTRICT protection on both FKs.
-- Run via: npx supabase test db

BEGIN;
SELECT plan(3);

-- ========================================================================
-- Fixtures: one owner + one shop + one business_rules row + one events row
-- + one rule_action_log row referencing both.
-- ========================================================================

INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'f0000000-0000-0000-0000-000000000004', 'owner-wafi156-ral@test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');

DELETE FROM public.shops WHERE owner_user_id = 'f0000000-0000-0000-0000-000000000004';
INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('f0000000-0000-0000-0000-000000000003', 'WAFI-156 RAL Shop', 'f0000000-0000-0000-0000-000000000004');

DELETE FROM public.business_rules WHERE shop_id = 'f0000000-0000-0000-0000-000000000003';
INSERT INTO public.business_rules (id, shop_id, rule_key, name, event_type, field, transform, operator, threshold, action)
VALUES ('f0000000-0000-0000-0000-000000000005', 'f0000000-0000-0000-0000-000000000003', 'large_return', 'إرجاع كبير', 'sale.returned', 'refundAmountUsd', 'none', 'gt', 100, 'notify_owner');

INSERT INTO public.events (id, type, entity_id, payload, staff_id, shop_id, occurred_at)
VALUES ('f0000000-0000-0000-0000-000000000006', 'sale.returned', 'entity-1', '{}', 'f0000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-000000000003', now());

INSERT INTO public.rule_action_log (event_id, rule_id, action, attempts, executed_at)
VALUES ('f0000000-0000-0000-0000-000000000006', 'f0000000-0000-0000-0000-000000000005', 'notify_owner', 1, now());

-- 1. authenticated role cannot SELECT rule_action_log at all.
SELECT set_config('request.jwt.claims', '{"sub":"f0000000-0000-0000-0000-000000000004","active_role":"owner"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT * FROM public.rule_action_log LIMIT 1 $$,
  '42501',
  'authenticated role has no SELECT grant on rule_action_log'
);
RESET ROLE;

-- 2. Deleting a business_rules row with a rule_action_log reference is blocked.
SELECT throws_ok(
  $$ DELETE FROM public.business_rules WHERE id = 'f0000000-0000-0000-0000-000000000005' $$,
  '23503',
  'ON DELETE RESTRICT blocks deleting a business_rules row with rule_action_log history'
);

-- 3. Deleting the referenced events row is likewise blocked.
SELECT throws_ok(
  $$ DELETE FROM public.events WHERE id = 'f0000000-0000-0000-0000-000000000006' $$,
  '23503',
  'ON DELETE RESTRICT blocks deleting an events row with rule_action_log history'
);

SELECT * FROM finish();
ROLLBACK;
