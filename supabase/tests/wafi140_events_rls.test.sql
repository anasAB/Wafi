-- supabase/tests/wafi140_events_rls.test.sql
-- WAFI-140: events/daily_event_counts RLS cross-shop isolation.
-- Run via: npx supabase test db

BEGIN;
SELECT plan(13); -- was 6; +6 for rate limit (throws_ok+lives_ok=2) and per-type RLS/registry
                 -- cross-check (cashier-denied is + cashier-public is + owner-allowed-all is + set_eq=4);
                 -- +1 (final review) for the created_at server-stamp / no-backdating assertion.

INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-000000000002', 'owner-e1@wafi140.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');
DELETE FROM public.shops WHERE owner_user_id = 'e0000000-0000-0000-0000-000000000002';
INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('e0000000-0000-0000-0000-000000000001', 'WAFI-140 Shop 1', 'e0000000-0000-0000-0000-000000000002');

INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-000000000004', 'owner-e2@wafi140.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');
DELETE FROM public.shops WHERE owner_user_id = 'e0000000-0000-0000-0000-000000000004';
INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('e0000000-0000-0000-0000-000000000003', 'WAFI-140 Shop 2', 'e0000000-0000-0000-0000-000000000004');

INSERT INTO public.staff (id, shop_id, name, pin_hash, role, is_active)
VALUES ('e0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000001', 'Owner1', 'x', 'owner', true);

INSERT INTO public.staff (id, shop_id, name, pin_hash, role, permissions, is_active) VALUES
  ('e0000000-0000-0000-0000-000000000006', 'e0000000-0000-0000-0000-000000000001', 'Cashier1', 'x', 'cashier', '{}', true);

-- One row per gated event type, plus the existing sale.completed (public) row, all Shop 1.
-- payload literals are untyped ('{}', not '{}'::jsonb): events.payload is TEXT (074), and
-- jsonb -> text is an explicit-only I/O conversion cast, so a ::jsonb-typed value is not
-- assignable to it. An untyped literal coerces correctly either way.
INSERT INTO public.events (type, entity_id, payload, staff_id, shop_id, occurred_at) VALUES
  ('staff.ledger_entry_added', 'x1', '{}', 'e0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000001', now()),
  ('settlement.paid',          'x2', '{}', 'e0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000001', now()),
  ('expense.recorded',         'x3', '{}', 'e0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000001', now()),
  ('product.cost_updated',     'x4', '{}', 'e0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000001', now());

-- Seed as postgres (bypasses RLS): one event + one daily_event_counts row for Shop 1.
INSERT INTO public.events (type, entity_id, payload, staff_id, shop_id, occurred_at)
VALUES ('sale.completed', 'sale-1', '{"saleId":"sale-1"}', 'e0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000001', now());
INSERT INTO public.daily_event_counts (shop_id, event_type, day, count)
VALUES ('e0000000-0000-0000-0000-000000000001', 'sale.completed', current_date, 1);

-- As Shop 1's owner: sees own event/count rows. `active_role` MUST be present in the claims:
-- public.auth_role() (migration 054) fails closed to 'cashier' when it is absent, so a claim
-- set without it silently tests the CASHIER path -- which is exactly what this assertion used
-- to do (found in the WAFI-140 Sprint 3 final review). It still passed then only because a
-- cashier is denied the 4 gated fixture rows by events_select_scoped (077) and therefore saw
-- just the single public sale.completed row, matching the old expected value of 1.
-- Deliberately owner now, so the expected count is ALL 5 Shop 1 rows present at this point in
-- the file: the 4 gated-type fixture rows + the sale-1 seed row (the 'rl-' rate-limit rows and
-- the backdate probe below are all inserted later).
SELECT set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-0000-0000-000000000002","active_role":"owner","staff_id":"e0000000-0000-0000-0000-000000000005"}', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.events)::int, 5,
  'Shop 1 owner (active_role=owner) sees all 5 of its own events');
SELECT is((SELECT count(*) FROM public.daily_event_counts)::int, 1, 'Shop 1 owner sees own count row');

-- created_at is server-stamped, not client-trusted (076_events_rate_limit.sql, final review):
-- insert one row as Shop 1's owner with an explicitly BACKDATED created_at, then prove the
-- stored value is the real insert time instead. If the trigger's `NEW.created_at := now()`
-- were removed, this row would sit outside the trigger's trailing-60s window and the whole
-- 500/60s cap would be bypassable by a hostile or buggy client.
INSERT INTO public.events (type, entity_id, payload, staff_id, shop_id, occurred_at, created_at)
VALUES ('sale.completed', 'backdate-probe', '{}', 'e0000000-0000-0000-0000-000000000005',
        'e0000000-0000-0000-0000-000000000001', now(), now() - interval '10 minutes');
SELECT is(
  (SELECT created_at > now() - interval '5 seconds'
     FROM public.events WHERE entity_id = 'backdate-probe'),
  true,
  'a client-supplied backdated created_at is overwritten with the server insert time'
);
RESET ROLE;

-- As Shop 2's owner: sees nothing (cross-tenant isolation). active_role spelled out for the
-- same reason as above -- shop scoping makes these two assertions role-independent, but a
-- claim labeled "owner" should actually BE an owner.
SELECT set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-0000-0000-000000000004","active_role":"owner"}', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.events)::int, 0, 'Shop 2 owner sees no cross-tenant event');
SELECT is((SELECT count(*) FROM public.daily_event_counts)::int, 0, 'Shop 2 owner sees no cross-tenant count row');

-- Shop 2 owner cannot insert an event tagged as Shop 1.
SELECT throws_ok(
  $$INSERT INTO public.events (type, entity_id, payload, staff_id, shop_id, occurred_at)
    VALUES ('sale.completed', 'x', '{}', 'e0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000001', now())$$,
  '42501',
  'Shop 2 owner cannot insert event as Shop 1'
);
RESET ROLE;

-- events is append-only: no UPDATE policy exists, so even the owning shop's
-- authenticated role cannot update a row it can see. Tested as owner explicitly (the most
-- privileged role) so the denial cannot be mistaken for a permission gate.
SELECT set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-0000-0000-000000000002","active_role":"owner","staff_id":"e0000000-0000-0000-0000-000000000005"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$UPDATE public.events SET entity_id = 'changed' WHERE type = 'sale.completed'$$,
  '42501',
  'events is append-only -- owning shop cannot UPDATE'
);
RESET ROLE;

-- Rate limit: top Shop 1 up to exactly 500 events within the trigger's trailing-60s
-- window (bypassing RLS, as postgres), then assert the 501st insert -- still as postgres,
-- still Shop 1 -- raises the trigger's exception. The loop count is computed dynamically
-- (500 minus however many Shop 1 events already exist within the window) rather than
-- hardcoded to 500: by this point in the file Shop 1 already has 6 event rows (the
-- sale-1 seed row + the 4 gated-type fixture rows + the 'backdate-probe' row above), all
-- inserted moments ago in this same transaction, and the trigger counts ALL of Shop 1's events in the window
-- (not just sale.completed). A hardcoded `FOR i IN 1..500` would push the running total
-- to 506 partway through the loop, tripping the trigger's `>= 500` check inside this
-- unguarded DO block around iteration ~495 and aborting the whole test transaction
-- before the intended throws_ok/lives_ok assertions ever run. Computing v_needed makes
-- the loop top up to exactly 500, so the very next insert (the throws_ok below) is
-- genuinely the 501st -- a real test of the boundary, not an accidental early trip.
-- Uses a distinct entity_id prefix ('rl-') so this block's rows don't interfere with the
-- earlier count-based assertions above (which ran before this block, so no ordering
-- hazard either way, but kept distinct for clarity).
DO $$
DECLARE
  v_current_count integer;
  v_needed integer;
BEGIN
  SELECT count(*) INTO v_current_count FROM public.events
  WHERE shop_id = 'e0000000-0000-0000-0000-000000000001' AND created_at > now() - interval '1 minute';
  v_needed := 500 - v_current_count;
  FOR i IN 1..v_needed LOOP
    INSERT INTO public.events (type, entity_id, payload, staff_id, shop_id, occurred_at)
    VALUES ('sale.completed', 'rl-' || i, '{}', 'e0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000001', now());
  END LOOP;
END $$;
SELECT throws_ok(
  $$INSERT INTO public.events (type, entity_id, payload, staff_id, shop_id, occurred_at)
    VALUES ('sale.completed', 'rl-501', '{}', 'e0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000001', now())$$,
  'P0001',
  'the 501st insert within a minute for the same shop is rate-limited'
);

-- Shop 2's own insert in the same window is unaffected by Shop 1's volume.
SELECT lives_ok(
  $$INSERT INTO public.events (type, entity_id, payload, staff_id, shop_id, occurred_at)
    VALUES ('sale.completed', 'shop2-unaffected', '{}', 'e0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000003', now())$$,
  'shop 2 insert succeeds unaffected by shop 1 hitting its rate limit'
);

-- Per-type RLS: cashier sees the public sale.completed rows but none of the 4 gated types.
SELECT set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-0000-0000-000000000002","active_role":"cashier","staff_id":"e0000000-0000-0000-0000-000000000006"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*) FROM public.events WHERE type IN ('staff.ledger_entry_added','settlement.paid','expense.recorded','product.cost_updated'))::int,
  0,
  'cashier sees zero rows of any gated event type'
);
SELECT is(
  (SELECT count(*) FROM public.events WHERE type = 'sale.completed')::int > 0,
  true,
  'cashier still sees public event types'
);
RESET ROLE;

-- Owner sees all 4 gated types (can() short-circuits true for owner, migration 054).
SELECT set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-0000-0000-000000000002","active_role":"owner","staff_id":"e0000000-0000-0000-0000-000000000005"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*) FROM public.events WHERE type IN ('staff.ledger_entry_added','settlement.paid','expense.recorded','product.cost_updated'))::int,
  4,
  'owner sees all 4 gated event types'
);
RESET ROLE;

-- Registry/SQL cross-check (design spec §3, closes the "ELSE true" hazard): extract the
-- set of `type` string literals appearing in a WHEN branch of events_select_scoped's live
-- USING expression, and assert it is EXACTLY the 4-element set that
-- EVENT_SENSITIVITY (src/services/events/domainEvent.types.ts) marks non-'public'. If a
-- future contributor adds an event to one list without the other, this assertion fails.
SELECT set_eq(
  $$
  SELECT unnest(regexp_matches(
    pg_get_expr(pg_policy.polqual, pg_policy.polrelid), 'WHEN ''([a-z._]+)''', 'g'
  ))
  FROM pg_policy
  JOIN pg_class ON pg_class.oid = pg_policy.polrelid
  WHERE pg_class.relname = 'events' AND pg_policy.polname = 'events_select_scoped'
  $$,
  $$
  VALUES ('staff.ledger_entry_added'), ('settlement.paid'), ('expense.recorded'), ('product.cost_updated')
  $$,
  'events_select_scoped''s gated type set matches EVENT_SENSITIVITY''s non-public keys exactly'
);

SELECT * FROM finish();
ROLLBACK;
