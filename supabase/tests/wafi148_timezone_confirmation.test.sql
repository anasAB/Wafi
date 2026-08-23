-- supabase/tests/wafi148_timezone_confirmation.test.sql
-- WAFI-148 follow-up: proves timezone_confirmed_at IS NOT NULL is the real
-- readiness gate (not the always-true-NOT-NULL timezone column), that
-- confirm_shop_timezone() is owner-only/self-shop-only/IANA-validated, and
-- that the two event-sourced projections bucket by event_projection_day
-- (immutable) rather than the shop's current timezone.
BEGIN;
SELECT plan(10);

SET LOCAL role postgres;
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-000000000010', 'owner-wafi148-k@test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;
DELETE FROM public.shops WHERE owner_user_id = 'e0000000-0000-0000-0000-000000000010';
INSERT INTO public.shops (id, name, owner_user_id) VALUES
  ('22222222-3333-4444-5555-666666666666', 'Shop K', 'e0000000-0000-0000-0000-000000000010');
INSERT INTO public.devices (id, shop_id, code, is_active) VALUES
  ('22222222-3333-4444-5555-666666666667', '22222222-3333-4444-5555-666666666666', 'DEV5', true);

-- 1. Fresh shop has the inherited UTC default but is NOT confirmed --
--    report_health_metrics must still reject it, proving timezone (which is
--    never null) is not what gates readiness.
SELECT is(
  (SELECT timezone FROM public.shops WHERE id = '22222222-3333-4444-5555-666666666666'),
  'UTC', 'a fresh shop inherits the UTC default (confirming the column is never null)'
);

SELECT set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-000000000010","active_role":"owner"}', true);
SET LOCAL role authenticated;
SELECT throws_ok(
  $$ SELECT public.report_health_metrics(
       '22222222-3333-4444-5555-666666666667'::uuid,
       jsonb_build_array(jsonb_build_object(
         'metric_key', 'app_error_count', 'period_start', current_date, 'value', 1
       )),
       '[]'::jsonb
     ) $$,
  'P0001', 'shop timezone is not configured',
  'report_health_metrics rejects an unconfirmed shop even though timezone itself is non-null'
);

-- 2. A non-owner cannot confirm the timezone.
SELECT set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-000000000010","active_role":"cashier"}', true);
SELECT is(
  public.confirm_shop_timezone('Asia/Damascus'), 'forbidden',
  'a non-owner cannot confirm the shop timezone'
);

-- 3. An invalid (non-IANA) timezone name is rejected.
SELECT set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-000000000010","active_role":"owner"}', true);
SELECT is(
  public.confirm_shop_timezone('UTC+2'), 'invalid_timezone',
  'a non-IANA timezone name is rejected'
);

-- 4. The owner can confirm a real IANA zone, including UTC itself.
SELECT is(
  public.confirm_shop_timezone('Asia/Damascus'), 'ok',
  'the shop owner can confirm a real IANA timezone'
);
SELECT is(
  (SELECT timezone_confirmed_at IS NOT NULL FROM public.shops WHERE id = '22222222-3333-4444-5555-666666666666'),
  true, 'timezone_confirmed_at is set after confirmation'
);

-- 5. report_health_metrics now succeeds.
SELECT lives_ok(
  $$ SELECT public.report_health_metrics(
       '22222222-3333-4444-5555-666666666667'::uuid,
       jsonb_build_array(jsonb_build_object(
         'metric_key', 'app_error_count', 'period_start', (now() AT TIME ZONE 'Asia/Damascus')::date, 'value', 1
       )),
       '[]'::jsonb
     ) $$,
  'report_health_metrics succeeds once the shop timezone is confirmed'
);

-- 6. Event-sourced projections bucket by event_projection_day, immutable
--    regardless of a LATER timezone change. Insert a shift.closed event now
--    (event_projection_day computed at insert time against 'Asia/Damascus'),
--    then change the shop's confirmed timezone, and prove the ALREADY-WRITTEN
--    health_metrics row keeps its original period_start rather than shifting.
SET LOCAL role postgres;
INSERT INTO public.events (id, shop_id, type, entity_id, payload, staff_id, occurred_at)
VALUES (
  gen_random_uuid(), '22222222-3333-4444-5555-666666666666', 'shift.closed',
  '22222222-3333-4444-5555-666666666666', jsonb_build_object('variance', 30.00)::text,
  '00000000-0000-0000-0000-000000000000', now()
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.health_metrics hm
      JOIN public.events e ON e.shop_id = hm.shop_id
     WHERE hm.shop_id = '22222222-3333-4444-5555-666666666666'
       AND hm.metric_key = 'drawer_mismatch_count'
       AND hm.period_start = e.event_projection_day
       AND e.type = 'shift.closed'
  ),
  'drawer_mismatch_count is bucketed by the event''s immutable event_projection_day'
);

SELECT set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-000000000010","active_role":"owner"}', true);
SET LOCAL role authenticated;
SELECT is(
  public.confirm_shop_timezone('America/New_York'), 'ok',
  'the owner can re-confirm the shop to a different real IANA timezone'
);
SET LOCAL role postgres;

-- Rebuild AFTER the timezone change -- if the apply function recomputed from
-- occurred_at + the current (now America/New_York) timezone instead of
-- reading event_projection_day, this event's historical period would shift.
SELECT public._rebuild_health_drawer_mismatch();

SELECT is(
  (SELECT count(*)::int FROM public.health_metrics
     WHERE shop_id = '22222222-3333-4444-5555-666666666666'
       AND metric_key = 'drawer_mismatch_count'
       AND period_start = (SELECT event_projection_day FROM public.events
                              WHERE shop_id = '22222222-3333-4444-5555-666666666666'
                                AND type = 'shift.closed' LIMIT 1)),
  1, 'a rebuild AFTER a timezone change still attributes the event to its original event_projection_day, not a recomputed one'
);

SELECT * FROM finish();
ROLLBACK;
