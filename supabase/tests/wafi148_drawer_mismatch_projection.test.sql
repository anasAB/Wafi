BEGIN;
SELECT plan(3);

SET LOCAL role postgres;
INSERT INTO public.shops (id, name, timezone) VALUES
  ('77777777-7777-7777-7777-777777777777', 'Shop E', 'Asia/Damascus');

-- Simulate a shift.closed event with a mismatch over the existing $15 threshold.
-- public.events' event-kind column is `type` (migration 074), not `event_type`,
-- and `payload` is stored as TEXT (JSON.stringify'd by the client), not JSONB --
-- see 074_events_bus_core.sql and 086_profit_cache_apply.sql for the precedent
-- of casting with `payload::jsonb` before `->>`.
INSERT INTO public.events (id, shop_id, type, entity_id, payload, staff_id, occurred_at)
VALUES (
  gen_random_uuid(), '77777777-7777-7777-7777-777777777777', 'shift.closed',
  '77777777-7777-7777-7777-777777777777', jsonb_build_object('variance', 20.00)::text,
  '00000000-0000-0000-0000-000000000000', now()
);

SELECT public._apply_health_drawer_mismatch(
  (SELECT id FROM public.events WHERE shop_id = '77777777-7777-7777-7777-777777777777'
     AND type = 'shift.closed' ORDER BY occurred_at DESC LIMIT 1)
);

SELECT is(
  (SELECT value FROM public.health_metrics
     WHERE shop_id = '77777777-7777-7777-7777-777777777777'
       AND metric_key = 'drawer_mismatch_count'
       AND period_start = (now() AT TIME ZONE 'Asia/Damascus')::date),
  1::bigint, 'a shift.closed event with variance > 15 increments drawer_mismatch_count'
);

-- A within-threshold variance must NOT increment the count.
INSERT INTO public.events (id, shop_id, type, entity_id, payload, staff_id, occurred_at)
VALUES (
  gen_random_uuid(), '77777777-7777-7777-7777-777777777777', 'shift.closed',
  '77777777-7777-7777-7777-777777777777', jsonb_build_object('variance', 5.00)::text,
  '00000000-0000-0000-0000-000000000000', now()
);
SELECT public._apply_health_drawer_mismatch(
  (SELECT id FROM public.events WHERE shop_id = '77777777-7777-7777-7777-777777777777'
     AND type = 'shift.closed' ORDER BY occurred_at DESC LIMIT 1)
);
SELECT is(
  (SELECT value FROM public.health_metrics
     WHERE shop_id = '77777777-7777-7777-7777-777777777777'
       AND metric_key = 'drawer_mismatch_count'
       AND period_start = (now() AT TIME ZONE 'Asia/Damascus')::date),
  1::bigint, 'a variance within the existing $15 threshold does not increment the count'
);

-- Rebuild from scratch reproduces the same value (rebuildability).
DELETE FROM public.health_metrics
  WHERE shop_id = '77777777-7777-7777-7777-777777777777' AND metric_key = 'drawer_mismatch_count';
SELECT public._rebuild_health_drawer_mismatch();
SELECT is(
  (SELECT value FROM public.health_metrics
     WHERE shop_id = '77777777-7777-7777-7777-777777777777'
       AND metric_key = 'drawer_mismatch_count'
       AND period_start = (now() AT TIME ZONE 'Asia/Damascus')::date),
  1::bigint, 'a full rebuild reproduces the same value from source events'
);

SELECT * FROM finish();
ROLLBACK;
