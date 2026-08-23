-- supabase/tests/wafi148_never_closed_shift_projection.test.sql
BEGIN;
SELECT plan(3);

-- events.type (not event_type) and events.payload is TEXT requiring an
-- explicit ::jsonb cast to read fields from it (migration 074_events_bus_core.sql;
-- same correction already applied in Task 4's migration 109/test, matched here
-- exactly: sentinel staff_id, entity_id = the shop id as text).
SET LOCAL role postgres;
INSERT INTO public.shops (id, name, timezone, timezone_confirmed_at) VALUES
  ('88888888-8888-8888-8888-888888888888', 'Shop F', 'Asia/Damascus', now());

-- A force-closed (zombie) shift.closed event.
INSERT INTO public.events (id, shop_id, type, entity_id, payload, staff_id, occurred_at)
VALUES (
  gen_random_uuid(), '88888888-8888-8888-8888-888888888888', 'shift.closed',
  '88888888-8888-8888-8888-888888888888', jsonb_build_object('forceClosedBy', gen_random_uuid())::text,
  '00000000-0000-0000-0000-000000000000', now()
);
SELECT public._apply_health_never_closed_shift(
  (SELECT id FROM public.events WHERE shop_id = '88888888-8888-8888-8888-888888888888'
     AND type = 'shift.closed' ORDER BY occurred_at DESC LIMIT 1)
);
SELECT is(
  (SELECT value FROM public.health_metrics
     WHERE shop_id = '88888888-8888-8888-8888-888888888888'
       AND metric_key = 'never_closed_shift_count'
       AND period_start = (now() AT TIME ZONE 'Asia/Damascus')::date),
  1::bigint, 'a force-closed shift.closed event increments never_closed_shift_count'
);

-- A normal (non-force-closed) shift.closed event must NOT increment it --
-- a merely-late close is not the same signal as a zombie force-close.
INSERT INTO public.events (id, shop_id, type, entity_id, payload, staff_id, occurred_at)
VALUES (
  gen_random_uuid(), '88888888-8888-8888-8888-888888888888', 'shift.closed',
  '88888888-8888-8888-8888-888888888888', jsonb_build_object('forceClosedBy', NULL)::text,
  '00000000-0000-0000-0000-000000000000', now()
);
SELECT public._apply_health_never_closed_shift(
  (SELECT id FROM public.events WHERE shop_id = '88888888-8888-8888-8888-888888888888'
     AND type = 'shift.closed' ORDER BY occurred_at DESC LIMIT 1)
);
SELECT is(
  (SELECT value FROM public.health_metrics
     WHERE shop_id = '88888888-8888-8888-8888-888888888888'
       AND metric_key = 'never_closed_shift_count'
       AND period_start = (now() AT TIME ZONE 'Asia/Damascus')::date),
  1::bigint, 'a normal (non-force-closed) shift close does not increment the count'
);

DELETE FROM public.health_metrics
  WHERE shop_id = '88888888-8888-8888-8888-888888888888' AND metric_key = 'never_closed_shift_count';
SELECT public._rebuild_health_never_closed_shift();
SELECT is(
  (SELECT value FROM public.health_metrics
     WHERE shop_id = '88888888-8888-8888-8888-888888888888'
       AND metric_key = 'never_closed_shift_count'
       AND period_start = (now() AT TIME ZONE 'Asia/Damascus')::date),
  1::bigint, 'a full rebuild reproduces the same value from source events'
);

SELECT * FROM finish();
ROLLBACK;
