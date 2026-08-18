-- supabase/tests/wafi156_execute_rule_action.test.sql
-- WAFI-156: execute_rule_action() RPC -- authoritative re-evaluation, atomic
-- claim, and the ordered authorization/invariant checks (spec §2.3).
-- Run via: npx supabase test db

BEGIN;
SELECT plan(11);

-- ========================================================================
-- Fixtures: two shops (A, B), each with an owner, so cross-shop rejection
-- can be tested. Shop A gets: a large_return rule, a drawer_variance rule,
-- a disabled clone of large_return, and three sale.returned/shift.closed
-- events. Shop B gets: one owner, one large_return rule, one matching
-- sale.returned event (used only to prove cross-shop rejection).
-- ========================================================================

INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'f0000000-0000-0000-0000-000000000011', 'owner-wafi156-era-a@test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-000000000000', 'f0000000-0000-0000-0000-000000000013', 'owner-wafi156-era-b@test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');

DELETE FROM public.shops WHERE owner_user_id IN ('f0000000-0000-0000-0000-000000000011', 'f0000000-0000-0000-0000-000000000013');
INSERT INTO public.shops (id, name, owner_user_id)
VALUES
  ('f0000000-0000-0000-0000-000000000010', 'WAFI-156 ERA Shop A', 'f0000000-0000-0000-0000-000000000011'),
  ('f0000000-0000-0000-0000-000000000012', 'WAFI-156 ERA Shop B', 'f0000000-0000-0000-0000-000000000013');

DELETE FROM public.business_rules WHERE shop_id IN ('f0000000-0000-0000-0000-000000000010', 'f0000000-0000-0000-0000-000000000012');
INSERT INTO public.business_rules (id, shop_id, rule_key, name, event_type, field, transform, operator, threshold, action, enabled)
VALUES
  ('f0000000-0000-0000-0000-000000000020', 'f0000000-0000-0000-0000-000000000010', 'large_return',          'إرجاع كبير',     'sale.returned', 'refundAmountUsd', 'none', 'gt', 100, 'notify_owner', true),
  ('f0000000-0000-0000-0000-000000000021', 'f0000000-0000-0000-0000-000000000010', 'drawer_variance',       'فرق في الصندوق', 'shift.closed',  'variance',        'abs',  'gt', 15,  'notify_owner', true),
  ('f0000000-0000-0000-0000-000000000022', 'f0000000-0000-0000-0000-000000000010', 'large_return_disabled', 'إرجاع كبير (معطل)', 'sale.returned', 'refundAmountUsd', 'none', 'gt', 100, 'notify_owner', false),
  ('f0000000-0000-0000-0000-000000000023', 'f0000000-0000-0000-0000-000000000012', 'large_return',          'إرجاع كبير',     'sale.returned', 'refundAmountUsd', 'none', 'gt', 100, 'notify_owner', true);

-- events.payload is TEXT holding JSON (074_events_bus_core.sql). Field names
-- match ReturnedPayload/ShiftClosedPayload (src/services/events/domainEvent.types.ts).
DELETE FROM public.events WHERE shop_id IN ('f0000000-0000-0000-0000-000000000010', 'f0000000-0000-0000-0000-000000000012');
INSERT INTO public.events (id, type, entity_id, payload, staff_id, shop_id, occurred_at)
VALUES
  -- Shop A: above-threshold return, used for the happy path + idempotency + cross-shop + event_type-mismatch + disabled-rule tests.
  ('f0000000-0000-0000-0000-000000000030', 'sale.returned', 'return-a1',
   '{"returnId":"return-a1","saleId":"sale-a1","refundAmountUsd":250,"restockedItemCount":2,"cogsReversalUsd":120,"isFullReturn":true,"saleWasCostless":false,"originalSaleProjectionDay":"2026-08-01"}',
   'f0000000-0000-0000-0000-000000000011', 'f0000000-0000-0000-0000-000000000010', now()),
  -- Shop A: below-threshold return, used for the authoritative-re-evaluation ("not_matched") test.
  ('f0000000-0000-0000-0000-000000000031', 'sale.returned', 'return-a2',
   '{"returnId":"return-a2","saleId":"sale-a2","refundAmountUsd":50,"restockedItemCount":1,"cogsReversalUsd":20,"isFullReturn":false,"saleWasCostless":false,"originalSaleProjectionDay":"2026-08-02"}',
   'f0000000-0000-0000-0000-000000000011', 'f0000000-0000-0000-0000-000000000010', now()),
  -- Shop B: above-threshold return, used only for the cross-shop rejection test.
  ('f0000000-0000-0000-0000-000000000032', 'sale.returned', 'return-b1',
   '{"returnId":"return-b1","saleId":"sale-b1","refundAmountUsd":250,"restockedItemCount":1,"cogsReversalUsd":90,"isFullReturn":true,"saleWasCostless":false,"originalSaleProjectionDay":"2026-08-03"}',
   'f0000000-0000-0000-0000-000000000013', 'f0000000-0000-0000-0000-000000000012', now());

-- 1. anon cannot call it at all -- no EXECUTE grant, rejected before the body even runs.
SET ROLE anon;
SELECT throws_ok(
  $$ SELECT public.execute_rule_action('f0000000-0000-0000-0000-000000000030', 'f0000000-0000-0000-0000-000000000020') $$,
  '42501',
  'anon role cannot call execute_rule_action (no EXECUTE grant)'
);
RESET ROLE;

-- Authenticate as shop A's owner for the tests that follow.
SELECT set_config('request.jwt.claims', '{"sub":"f0000000-0000-0000-0000-000000000011","active_role":"owner"}', true);
SET LOCAL ROLE authenticated;

-- 2. Happy path: matching event/rule as the correct authenticated shop -> 'executed'.
SELECT is(
  public.execute_rule_action('f0000000-0000-0000-0000-000000000030', 'f0000000-0000-0000-0000-000000000020'),
  'executed',
  'matching event/rule pair executes and returns executed'
);
SELECT is(
  (SELECT count(*)::int FROM public.notifications WHERE source_event_id = 'f0000000-0000-0000-0000-000000000030'),
  1,
  'exactly one notification row created'
);

-- 3. Idempotency: calling again for the same pair returns already_executed, no 2nd notification.
SELECT is(
  public.execute_rule_action('f0000000-0000-0000-0000-000000000030', 'f0000000-0000-0000-0000-000000000020'),
  'already_executed',
  'repeat call after success is idempotent'
);
SELECT is(
  (SELECT count(*)::int FROM public.notifications WHERE source_event_id = 'f0000000-0000-0000-0000-000000000030'),
  1,
  'still exactly one notification row after the repeat call'
);

-- 4. Cross-shop event/rule pair rejected (caller still belongs to the event's shop --
-- this isolates the event.shop_id != rule.shop_id check specifically).
SELECT throws_ok(
  $$ SELECT public.execute_rule_action('f0000000-0000-0000-0000-000000000030', 'f0000000-0000-0000-0000-000000000023') $$,
  NULL, NULL,
  'cross-shop event/rule pair is rejected'
);

-- 5. Caller from a different shop than the event rejected (auth_shop_id() mismatch).
SELECT set_config('request.jwt.claims', '{"sub":"f0000000-0000-0000-0000-000000000013","active_role":"owner"}', true);
SELECT throws_ok(
  $$ SELECT public.execute_rule_action('f0000000-0000-0000-0000-000000000030', 'f0000000-0000-0000-0000-000000000020') $$,
  NULL, NULL,
  'caller not belonging to the event''s shop is rejected'
);
SELECT set_config('request.jwt.claims', '{"sub":"f0000000-0000-0000-0000-000000000011","active_role":"owner"}', true);

-- 6. Same-shop but mismatched event_type (sale.returned event vs drawer_variance rule).
SELECT throws_ok(
  $$ SELECT public.execute_rule_action('f0000000-0000-0000-0000-000000000030', 'f0000000-0000-0000-0000-000000000021') $$,
  NULL, NULL,
  'event_type mismatch between event and rule is rejected'
);

-- 7. Disabled rule never fires even via direct call (same shop, same event_type,
-- threshold would match, but enabled = false).
SELECT throws_ok(
  $$ SELECT public.execute_rule_action('f0000000-0000-0000-0000-000000000030', 'f0000000-0000-0000-0000-000000000022') $$,
  NULL, NULL,
  'disabled rule is rejected even when directly targeted'
);

-- 8. Malicious-caller / authoritative-re-evaluation: below-threshold event, valid caller,
-- bypassing evaluateLocally() entirely -> not_matched, nothing written.
SELECT is(
  public.execute_rule_action('f0000000-0000-0000-0000-000000000031', 'f0000000-0000-0000-0000-000000000020'),
  'not_matched',
  'RPC independently re-evaluates and refuses a below-threshold event regardless of caller intent'
);
SELECT is(
  (SELECT count(*)::int FROM public.rule_action_log WHERE event_id = 'f0000000-0000-0000-0000-000000000031'),
  0,
  'no rule_action_log row written for a not_matched evaluation'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
