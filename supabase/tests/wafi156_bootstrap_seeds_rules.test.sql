-- supabase/tests/wafi156_bootstrap_seeds_rules.test.sql
-- WAFI-156: bootstrap_owner_identity() (migration 096) now provisions
-- business_rules for a freshly-bootstrapped shop. Fixture pattern mirrors
-- supabase/tests/wafi_owner_bootstrap.test.sql. Run via: npx supabase test db

BEGIN;
SELECT plan(2);

-- ============================================================
-- Fixture: a fresh shop with NO staff/devices/device_sessions/business_rules
-- rows yet -- exactly the state a real new signup is in before
-- OwnerSetupScreen runs.
-- ============================================================
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-000000000002', 'owner-wafi156-bootstrap@test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');

DELETE FROM public.shops WHERE owner_user_id = 'c0000000-0000-0000-0000-000000000002';
INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('c0000000-0000-0000-0000-000000000001', 'WAFI-156 Bootstrap Test Shop', 'c0000000-0000-0000-0000-000000000002');

SELECT set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true);
SET LOCAL ROLE authenticated;

SELECT is(
  public.bootstrap_owner_identity(
    'c0000000-0000-0000-0000-000000000007'::uuid,
    'c0000000-0000-0000-0000-000000000003'::uuid,
    'Owner C',
    '1234'
  ),
  'success',
  'bootstrap succeeds for a fresh shop'
);

RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.business_rules WHERE shop_id = 'c0000000-0000-0000-0000-000000000001'),
  2,
  'bootstrap_owner_identity provisions both proof business_rules for a new shop'
);

SELECT * FROM finish();
ROLLBACK;
