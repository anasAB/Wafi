-- supabase/tests/wafi148a_authorization.test.sql
-- WAFI-148A Task 3: authorization contract for the claim/resolve functions.
-- None of claim_health_alert_period / claim_health_alert_transition /
-- resolve_health_alert_transition are directly EXECUTE-able by `authenticated`
-- or `anon` -- they are internal building blocks called only by other
-- SECURITY DEFINER code (a trigger, cron functions, or the foreground RPC;
-- none built yet). Mirrors how execute_rule_action() is locked down in
-- migration 094, except execute_rule_action() IS the public entry point and
-- so IS granted to authenticated -- these three are not entry points and get
-- no such grant at all.
-- Run via: npx supabase test db

BEGIN;
SELECT plan(6);

INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'd0000000-0000-0000-0000-000000000001', 'owner-wafi148a-authz@test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');

DELETE FROM public.shops WHERE owner_user_id = 'd0000000-0000-0000-0000-000000000001';
INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('d0000000-0000-0000-0000-000000000010', 'WAFI-148A Authz Shop', 'd0000000-0000-0000-0000-000000000001');

SELECT set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-000000000001","active_role":"owner"}', true);

-- authenticated cannot call any of the three functions.
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$ SELECT public.claim_health_alert_period(
       'd0000000-0000-0000-0000-000000000010'::uuid, 'sync_failures', '2026-08-20'::date,
       5, 'sync_failures', 't', 'm'
     ) $$,
  '42501',
  NULL,
  'authenticated cannot call claim_health_alert_period (no EXECUTE grant)'
);

SELECT throws_ok(
  $$ SELECT public.claim_health_alert_transition(
       'd0000000-0000-0000-0000-000000000010'::uuid, 'stale_device', 'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
       'stale_device', 't', 'm'
     ) $$,
  '42501',
  NULL,
  'authenticated cannot call claim_health_alert_transition (no EXECUTE grant)'
);

SELECT throws_ok(
  $$ SELECT public.resolve_health_alert_transition(
       'd0000000-0000-0000-0000-000000000010'::uuid, 'stale_device', 'aaaaaaaa-0000-0000-0000-000000000001'::uuid
     ) $$,
  '42501',
  NULL,
  'authenticated cannot call resolve_health_alert_transition (no EXECUTE grant)'
);

RESET ROLE;

-- anon cannot call any of the three functions either.
SET ROLE anon;

SELECT throws_ok(
  $$ SELECT public.claim_health_alert_period(
       'd0000000-0000-0000-0000-000000000010'::uuid, 'sync_failures', '2026-08-20'::date,
       5, 'sync_failures', 't', 'm'
     ) $$,
  '42501',
  NULL,
  'anon cannot call claim_health_alert_period (no EXECUTE grant)'
);

SELECT throws_ok(
  $$ SELECT public.claim_health_alert_transition(
       'd0000000-0000-0000-0000-000000000010'::uuid, 'stale_device', 'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
       'stale_device', 't', 'm'
     ) $$,
  '42501',
  NULL,
  'anon cannot call claim_health_alert_transition (no EXECUTE grant)'
);

SELECT throws_ok(
  $$ SELECT public.resolve_health_alert_transition(
       'd0000000-0000-0000-0000-000000000010'::uuid, 'stale_device', 'aaaaaaaa-0000-0000-0000-000000000001'::uuid
     ) $$,
  '42501',
  NULL,
  'anon cannot call resolve_health_alert_transition (no EXECUTE grant)'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
