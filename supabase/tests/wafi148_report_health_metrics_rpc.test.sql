BEGIN;
SELECT plan(9 + 1);

-- auth_shop_id() (migration 015) resolves via shops.owner_user_id = auth.uid(),
-- reading the JWT's `sub` claim -- not a shop_id claim (established pattern per
-- supabase/tests/wafi156_execute_rule_action.test.sql).
SET LOCAL role postgres;
INSERT INTO public.shops (id, name, timezone, owner_user_id) VALUES
  ('33333333-3333-3333-3333-333333333333', 'Shop C', 'Asia/Damascus', 'e0000000-0000-0000-0000-000000000003');
INSERT INTO public.devices (id, shop_id, code, is_active) VALUES
  ('44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333', 'DEV1', true);

SELECT set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-000000000003","active_role":"owner"}', true);
SET LOCAL role authenticated;

-- 1. Client-allowed counter is accepted and GREATEST()-merged.
SELECT public.report_health_metrics(
  '44444444-4444-4444-4444-444444444444'::uuid,
  jsonb_build_array(jsonb_build_object(
    'metric_key', 'app_error_count', 'period_start', '2026-08-21', 'value', 5
  )),
  '[]'::jsonb
);
SELECT is(
  (SELECT value FROM public.health_metrics
     WHERE shop_id = '33333333-3333-3333-3333-333333333333'
       AND device_id = '44444444-4444-4444-4444-444444444444'
       AND metric_key = 'app_error_count' AND period_start = '2026-08-21'),
  5::bigint, 'first report of 5 is stored'
);

-- 2. A lower retry does not regress the value (GREATEST()).
SELECT public.report_health_metrics(
  '44444444-4444-4444-4444-444444444444'::uuid,
  jsonb_build_array(jsonb_build_object(
    'metric_key', 'app_error_count', 'period_start', '2026-08-21', 'value', 3
  )),
  '[]'::jsonb
);
SELECT is(
  (SELECT value FROM public.health_metrics
     WHERE shop_id = '33333333-3333-3333-3333-333333333333'
       AND device_id = '44444444-4444-4444-4444-444444444444'
       AND metric_key = 'app_error_count' AND period_start = '2026-08-21'),
  5::bigint, 'GREATEST() keeps the higher prior value on a stale retry'
);

-- 3. A higher value is applied.
SELECT public.report_health_metrics(
  '44444444-4444-4444-4444-444444444444'::uuid,
  jsonb_build_array(jsonb_build_object(
    'metric_key', 'app_error_count', 'period_start', '2026-08-21', 'value', 8
  )),
  '[]'::jsonb
);
SELECT is(
  (SELECT value FROM public.health_metrics
     WHERE shop_id = '33333333-3333-3333-3333-333333333333'
       AND device_id = '44444444-4444-4444-4444-444444444444'
       AND metric_key = 'app_error_count' AND period_start = '2026-08-21'),
  8::bigint, 'a genuinely newer, higher value is applied'
);

-- 4. Server-authoritative metric_key is rejected -- allowlist proof.
SELECT throws_ok(
  $$ SELECT public.report_health_metrics(
       '44444444-4444-4444-4444-444444444444'::uuid,
       jsonb_build_array(jsonb_build_object(
         'metric_key', 'drawer_mismatch_count', 'period_start', '2026-08-21', 'value', 99
       )),
       '[]'::jsonb
     ) $$,
  'P0001',
  'unknown or unwritable metric_key: drawer_mismatch_count',
  'client cannot write a class-S metric_key under any payload shape'
);

-- 5. Unknown metric_key is rejected the same way.
SELECT throws_ok(
  $$ SELECT public.report_health_metrics(
       '44444444-4444-4444-4444-444444444444'::uuid,
       jsonb_build_array(jsonb_build_object(
         'metric_key', 'made_up_metric', 'period_start', '2026-08-21', 'value', 1
       )),
       '[]'::jsonb
     ) $$,
  'P0001',
  'unknown or unwritable metric_key: made_up_metric',
  'an arbitrary unknown metric_key is rejected'
);

-- 6. period_start outside the 7-day reporting window is rejected.
SELECT throws_ok(
  $$ SELECT public.report_health_metrics(
       '44444444-4444-4444-4444-444444444444'::uuid,
       jsonb_build_array(jsonb_build_object(
         'metric_key', 'app_error_count', 'period_start', '2020-01-01', 'value', 1
       )),
       '[]'::jsonb
     ) $$,
  'P0001',
  'period_start outside the allowed reporting window',
  'an old period_start far outside the 7-day window is rejected'
);

-- 7. A device belonging to a different shop cannot be reported against.
SET LOCAL role postgres;
INSERT INTO public.shops (id, name, timezone, owner_user_id) VALUES
  ('55555555-5555-5555-5555-555555555555', 'Shop D', 'Asia/Damascus', 'e0000000-0000-0000-0000-000000000004');
INSERT INTO public.devices (id, shop_id, code, is_active) VALUES
  ('66666666-6666-6666-6666-666666666666', '55555555-5555-5555-5555-555555555555', 'DEV2', true);
SELECT set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-000000000003","active_role":"owner"}', true);
SET LOCAL role authenticated;
SELECT throws_ok(
  $$ SELECT public.report_health_metrics(
       '66666666-6666-6666-6666-666666666666'::uuid,
       jsonb_build_array(jsonb_build_object(
         'metric_key', 'app_error_count', 'period_start', '2026-08-21', 'value', 1
       )),
       '[]'::jsonb
     ) $$,
  'P0001',
  'device does not belong to the authenticated shop',
  'a device belonging to a different shop cannot be reported against'
);

-- 8. Gauge overwrite semantics: a lower value DOES apply (not GREATEST()).
SELECT public.report_health_metrics(
  '44444444-4444-4444-4444-444444444444'::uuid, '[]'::jsonb,
  jsonb_build_array(jsonb_build_object(
    'gauge_key', 'dead_letter_count', 'value', 7, 'observed_at', '2026-08-21T08:00:00Z'
  ))
);
SELECT public.report_health_metrics(
  '44444444-4444-4444-4444-444444444444'::uuid, '[]'::jsonb,
  jsonb_build_array(jsonb_build_object(
    'gauge_key', 'dead_letter_count', 'value', 2, 'observed_at', '2026-08-21T09:00:00Z'
  ))
);
SELECT is(
  (SELECT value FROM public.health_gauges
     WHERE shop_id = '33333333-3333-3333-3333-333333333333'
       AND device_id = '44444444-4444-4444-4444-444444444444'
       AND gauge_key = 'dead_letter_count'),
  2::bigint, 'a lower gauge value overwrites, unlike a counter'
);

-- 9. last_seen_at is bumped only on a successful, authorized call.
SELECT ok(
  (SELECT last_seen_at FROM public.devices WHERE id = '44444444-4444-4444-4444-444444444444') IS NOT NULL,
  'last_seen_at is updated as a side effect of a successful call'
);

-- 10. Two devices, deliberately different volumes, proving a shop-level rate
-- must be computed as SUM(numerators)/SUM(denominators), never
-- AVG(device_rate) -- device A: 1/10 = 10%, device B: 1/1000 = 0.1%,
-- shop-level correct answer is 2/1010 ~= 0.198%, NOT (10%+0.1%)/2 = 5.05%.
SET LOCAL role postgres;
INSERT INTO public.devices (id, shop_id, code, is_active) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'DEV3', true),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333', 'DEV4', true);

INSERT INTO public.health_metrics (shop_id, device_id, metric_key, period_start, value) VALUES
  ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sync_failure_terminal', '2026-08-20', 1),
  ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sync_terminal_total',    '2026-08-20', 10),
  ('33333333-3333-3333-3333-333333333333', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'sync_failure_terminal', '2026-08-20', 1),
  ('33333333-3333-3333-3333-333333333333', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'sync_terminal_total',    '2026-08-20', 1000);

SELECT is(
  round(
    (SELECT sum(value) FROM public.health_metrics
       WHERE shop_id = '33333333-3333-3333-3333-333333333333'
         AND metric_key = 'sync_failure_terminal' AND period_start = '2026-08-20')::numeric
    /
    (SELECT sum(value) FROM public.health_metrics
       WHERE shop_id = '33333333-3333-3333-3333-333333333333'
         AND metric_key = 'sync_terminal_total' AND period_start = '2026-08-20')::numeric
    * 100, 3
  ),
  round(2.0 / 1010.0 * 100, 3),
  'shop-level rate is sum(numerators)/sum(denominators), not an average of device rates (would wrongly be ~5.05%)'
);

SELECT * FROM finish();
ROLLBACK;
