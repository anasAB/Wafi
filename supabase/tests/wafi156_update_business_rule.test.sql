-- supabase/tests/wafi156_update_business_rule.test.sql
-- WAFI-156: update_business_rule() RPC -- owner-only, name/threshold/enabled
-- only (spec §2.1). Run via: npx supabase test db

BEGIN;
SELECT plan(6);

-- ========================================================================
-- Fixtures: two shops (A, B). Shop A gets an owner and a cashier plus a
-- large_return rule; Shop B gets an owner and its own large_return rule
-- (used only for the cross-shop rejection test).
-- ========================================================================

INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'f0000000-0000-0000-0000-000000000051', 'owner-wafi156-eur-a@test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-000000000000', 'f0000000-0000-0000-0000-000000000053', 'owner-wafi156-eur-b@test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');

DELETE FROM public.shops WHERE owner_user_id IN ('f0000000-0000-0000-0000-000000000051', 'f0000000-0000-0000-0000-000000000053');
INSERT INTO public.shops (id, name, owner_user_id)
VALUES
  ('f0000000-0000-0000-0000-000000000050', 'WAFI-156 EUR Shop A', 'f0000000-0000-0000-0000-000000000051'),
  ('f0000000-0000-0000-0000-000000000052', 'WAFI-156 EUR Shop B', 'f0000000-0000-0000-0000-000000000053');

DELETE FROM public.staff WHERE shop_id IN ('f0000000-0000-0000-0000-000000000050', 'f0000000-0000-0000-0000-000000000052');
INSERT INTO public.staff (id, shop_id, name, pin_hash, role, is_active)
VALUES
  ('f0000000-0000-0000-0000-000000000060', 'f0000000-0000-0000-0000-000000000050', 'Owner A', crypt('1234', gen_salt('bf')), 'owner', true),
  ('f0000000-0000-0000-0000-000000000061', 'f0000000-0000-0000-0000-000000000050', 'Cashier A', crypt('1234', gen_salt('bf')), 'cashier', true);

DELETE FROM public.business_rules WHERE shop_id IN ('f0000000-0000-0000-0000-000000000050', 'f0000000-0000-0000-0000-000000000052');
INSERT INTO public.business_rules (id, shop_id, rule_key, name, event_type, field, transform, operator, threshold, action, enabled)
VALUES
  ('f0000000-0000-0000-0000-000000000070', 'f0000000-0000-0000-0000-000000000050', 'large_return', 'إرجاع كبير', 'sale.returned', 'refundAmountUsd', 'none', 'gt', 100, 'notify_owner', true),
  ('f0000000-0000-0000-0000-000000000071', 'f0000000-0000-0000-0000-000000000052', 'large_return', 'إرجاع كبير', 'sale.returned', 'refundAmountUsd', 'none', 'gt', 100, 'notify_owner', true);

-- Authenticate as shop A's owner.
SELECT set_config('request.jwt.claims', '{"sub":"f0000000-0000-0000-0000-000000000051","active_role":"owner","staff_id":"f0000000-0000-0000-0000-000000000060"}', true);
SET LOCAL ROLE authenticated;

-- 1. Owner can update name/threshold/enabled.
SELECT is(
  public.update_business_rule('f0000000-0000-0000-0000-000000000070', 'إرجاع كبير جدًا', 200, false),
  'updated',
  'owner caller can update name/threshold/enabled'
);
SELECT is(
  (SELECT threshold FROM public.business_rules WHERE id = 'f0000000-0000-0000-0000-000000000070'),
  200::numeric,
  'threshold actually changed'
);
SELECT is(
  (SELECT event_type FROM public.business_rules WHERE id = 'f0000000-0000-0000-0000-000000000070'),
  'sale.returned',
  'event_type is untouched -- not a parameter this RPC accepts'
);

-- 2. Empty/blank name rejected without mutating the row.
SELECT is(
  public.update_business_rule('f0000000-0000-0000-0000-000000000070', '   ', 300, true),
  'invalid_name',
  'blank name is rejected'
);

-- 3. Non-owner (cashier) call is rejected.
SELECT set_config('request.jwt.claims', '{"sub":"f0000000-0000-0000-0000-000000000051","active_role":"cashier","staff_id":"f0000000-0000-0000-0000-000000000061"}', true);
SELECT is(
  public.update_business_rule('f0000000-0000-0000-0000-000000000070', 'x', 1, true),
  'forbidden',
  'non-owner staff member cannot update a rule'
);
SELECT set_config('request.jwt.claims', '{"sub":"f0000000-0000-0000-0000-000000000051","active_role":"owner","staff_id":"f0000000-0000-0000-0000-000000000060"}', true);

-- 4. Cross-shop rule_id rejected even for an owner of a different shop.
SELECT is(
  public.update_business_rule('f0000000-0000-0000-0000-000000000071', 'x', 1, true),
  'forbidden',
  'owner of shop A cannot update a rule belonging to shop B'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
