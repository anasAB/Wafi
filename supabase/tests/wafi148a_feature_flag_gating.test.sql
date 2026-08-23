-- supabase/tests/wafi148a_feature_flag_gating.test.sql
-- WAFI-148A Task 11: proves the WAFI-155 'health_alerting' rollout flag
-- (migration 123) gates claim/notify paths across all 5 evaluator functions
-- while never gating resolve/recovery paths.
--
-- Section 1 covers the shared helper (_health_alerting_enabled) directly:
-- true/false/null/malformed features, matching list_shops_for_rollout_admin's
-- fail-closed contract exactly.
--
-- Sections 2-6 cover, per evaluator: (a) flag off -> no claims, existing
-- state untouched; (b) flag off while a Shape B condition recovers, then
-- flag on -> the resolve already happened correctly even while the flag was
-- off (the gated-claim/ungated-resolve asymmetry); (c) flag off then on,
-- Shape A -> evaluates fresh against the current value/threshold on the next
-- call, no reconstruction of missed history.
--
-- Run via: npx supabase test db

BEGIN;
SELECT plan(31);

SET LOCAL role postgres;

-- ============================================================================
-- Section 1: _health_alerting_enabled direct behavior.
-- ============================================================================
INSERT INTO public.shops (id, name, timezone, features) VALUES
  ('f0000000-0000-0000-0000-000000000001', 'Shop FF1 (flag true)', 'Asia/Damascus',
   jsonb_build_object('rollout', jsonb_build_object('health_alerting', true))),
  ('f0000000-0000-0000-0000-000000000002', 'Shop FF2 (flag false)', 'Asia/Damascus',
   jsonb_build_object('rollout', jsonb_build_object('health_alerting', false))),
  ('f0000000-0000-0000-0000-000000000003', 'Shop FF3 (no features at all)', 'Asia/Damascus', NULL),
  ('f0000000-0000-0000-0000-000000000004', 'Shop FF4 (features, no rollout key)', 'Asia/Damascus',
   jsonb_build_object('staff_pack', true)),
  ('f0000000-0000-0000-0000-000000000005', 'Shop FF5 (rollout present, other flags, no health_alerting)', 'Asia/Damascus',
   jsonb_build_object('rollout', jsonb_build_object('dashboard_v2', true))),
  ('f0000000-0000-0000-0000-000000000006', 'Shop FF6 (malformed: health_alerting is a string not a bool)', 'Asia/Damascus',
   jsonb_build_object('rollout', jsonb_build_object('health_alerting', 'yes'))),
  ('f0000000-0000-0000-0000-000000000007', 'Shop FF7 (malformed: rollout is a scalar, not an object)', 'Asia/Damascus',
   jsonb_build_object('rollout', 'not-an-object'));

SELECT is(public._health_alerting_enabled('f0000000-0000-0000-0000-000000000001'), true,
  'helper: explicit true reads as enabled');
SELECT is(public._health_alerting_enabled('f0000000-0000-0000-0000-000000000002'), false,
  'helper: explicit false reads as disabled');
SELECT is(public._health_alerting_enabled('f0000000-0000-0000-0000-000000000003'), false,
  'helper: NULL features reads as disabled (fail-closed)');
SELECT is(public._health_alerting_enabled('f0000000-0000-0000-0000-000000000004'), false,
  'helper: features present but no rollout key at all reads as disabled');
SELECT is(public._health_alerting_enabled('f0000000-0000-0000-0000-000000000005'), false,
  'helper: rollout object present with other flags but no health_alerting key reads as disabled');
SELECT is(public._health_alerting_enabled('f0000000-0000-0000-0000-000000000006'), false,
  'helper: malformed non-boolean health_alerting value reads as disabled (fail-closed), matching list_shops_for_rollout_admin''s contract');
SELECT is(public._health_alerting_enabled('f0000000-0000-0000-0000-000000000007'), false,
  'helper: malformed non-object rollout value reads as disabled (fail-closed)');
SELECT is(public._health_alerting_enabled('00000000-0000-0000-0000-000000000099'), false,
  'helper: a non-existent shop id reads as disabled, not an error');

-- ============================================================================
-- Section 2: _apply_health_alert_drawer_mismatch (metric #4, Shape A claim,
-- shift.closed trigger path) -- flag off produces no claim/notification.
-- ============================================================================
INSERT INTO public.shops (id, name, timezone, timezone_confirmed_at, features) VALUES
  ('f1111111-0000-0000-0000-000000000001', 'Shop FG1 (drawer mismatch, flag off)', 'Asia/Damascus', now(),
   jsonb_build_object('rollout', jsonb_build_object('health_alerting', false)));

INSERT INTO public.notification_settings (shop_id, type, enabled, threshold_json)
VALUES ('f1111111-0000-0000-0000-000000000001', 'health_alert_drawer_mismatches', true, jsonb_build_object('threshold', 1));

INSERT INTO public.events (id, shop_id, type, entity_id, payload, staff_id, occurred_at)
VALUES (
  'f1111111-0000-0000-0000-100000000001',
  'f1111111-0000-0000-0000-000000000001', 'shift.closed',
  'f1111111-0000-0000-0000-000000000001',
  jsonb_build_object('variance', 20.00, 'shiftId', 'f1111111-0000-0000-0000-200000000001')::text,
  '00000000-0000-0000-0000-000000000000', now()
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = 'f1111111-0000-0000-0000-000000000001' AND type = 'health_alert_drawer_mismatches'),
  0,
  'flag off: drawer-mismatch claim path never fires, even though the projection value meets threshold'
);
SELECT is(
  (SELECT count(*)::int FROM public.health_alert_state_a
     WHERE shop_id = 'f1111111-0000-0000-0000-000000000001' AND metric_key = 'drawer_mismatch_count'),
  0,
  'flag off: no health_alert_state_a row is created either (claim never attempted)'
);
-- The underlying WAFI-148 projection (drawer_mismatch_count itself) is NOT
-- part of this feature's flag and must be unaffected.
SELECT is(
  (SELECT value FROM public.health_metrics
     WHERE shop_id = 'f1111111-0000-0000-0000-000000000001'
       AND metric_key = 'drawer_mismatch_count'
       AND period_start = (now() AT TIME ZONE 'Asia/Damascus')::date),
  1::bigint,
  'flag off: the unrelated WAFI-148 drawer_mismatch_count projection itself still increments normally'
);

-- (c) Shape A, flag off then on: evaluates fresh against current value on the
-- next call, no retroactive reconstruction.
UPDATE public.shops SET features = jsonb_build_object('rollout', jsonb_build_object('health_alerting', true))
 WHERE id = 'f1111111-0000-0000-0000-000000000001';

SELECT public._apply_health_alert_drawer_mismatch('f1111111-0000-0000-0000-100000000001');

SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = 'f1111111-0000-0000-0000-000000000001' AND type = 'health_alert_drawer_mismatches'),
  1,
  'Shape A flag off->on: re-evaluating the SAME event after flip-on claims fresh against the current (still-qualifying) value -- no special-casing of missed history'
);

-- ============================================================================
-- Section 3: evaluate_health_alerts_foreground (metrics #1/#2/#5/#6, Shape A,
-- whole-function gate) -- flag off skips ALL 4 metrics for the shop; flag on
-- then evaluates fresh, no retroactive firing of missed periods.
-- ============================================================================
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'f2000000-0000-0000-0000-000000000001', 'owner-wafi148a-flag-fg@test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');

-- migration 021 auto-provisions a shop for this new auth.users row; delete
-- it before inserting our own explicit shop with the same owner_user_id
-- (uq_shops_owner_user only allows one shop per owner).
DELETE FROM public.shops WHERE owner_user_id = 'f2000000-0000-0000-0000-000000000001';

INSERT INTO public.shops (id, name, owner_user_id, timezone, timezone_confirmed_at, features) VALUES
  ('f2111111-0000-0000-0000-000000000001', 'Shop FG2 (foreground, flag off)', 'f2000000-0000-0000-0000-000000000001', 'Asia/Damascus', now(),
   jsonb_build_object('rollout', jsonb_build_object('health_alerting', false)));

INSERT INTO public.devices (id, shop_id, code) VALUES
  ('f2111111-0000-0000-0000-000000000002', 'f2111111-0000-0000-0000-000000000001', 'DEV-FG2-1');

INSERT INTO public.notification_settings (shop_id, type, enabled, threshold_json) VALUES
  ('f2111111-0000-0000-0000-000000000001', 'health_alert_sync_failures', true, jsonb_build_object('threshold', 1)),
  ('f2111111-0000-0000-0000-000000000001', 'health_alert_offline_duration', true, jsonb_build_object('threshold', 1)),
  ('f2111111-0000-0000-0000-000000000001', 'health_alert_deferred_job_failures', true, jsonb_build_object('threshold', 1)),
  ('f2111111-0000-0000-0000-000000000001', 'health_alert_app_errors', true, jsonb_build_object('threshold', 1));

INSERT INTO public.health_metrics (shop_id, device_id, metric_key, period_start, value, updated_at) VALUES
  ('f2111111-0000-0000-0000-000000000001', 'f2111111-0000-0000-0000-000000000002', 'sync_failure_terminal', (now() AT TIME ZONE 'Asia/Damascus')::date, 10, now()),
  ('f2111111-0000-0000-0000-000000000001', 'f2111111-0000-0000-0000-000000000002', 'offline_duration_seconds', (now() AT TIME ZONE 'Asia/Damascus')::date, 10, now()),
  ('f2111111-0000-0000-0000-000000000001', 'f2111111-0000-0000-0000-000000000002', 'deferred_job_failure_terminal', (now() AT TIME ZONE 'Asia/Damascus')::date, 10, now()),
  ('f2111111-0000-0000-0000-000000000001', 'f2111111-0000-0000-0000-000000000002', 'app_error_count', (now() AT TIME ZONE 'Asia/Damascus')::date, 10, now());

SELECT set_config('request.jwt.claims', '{"sub":"f2000000-0000-0000-0000-000000000001","active_role":"owner"}', true);
SET LOCAL ROLE authenticated;
SELECT public.evaluate_health_alerts_foreground();
RESET ROLE;
-- set_config(..., true) is transaction-local, not role-local: it survives
-- RESET ROLE. Clear it so the admin-level UPDATE below isn't mistaken by
-- protect_shop_features() (migration 041) for a client request carrying a
-- JWT, which would silently revert the features change.
SELECT set_config('request.jwt.claims', '', true);

SELECT is(
  (SELECT count(*)::int FROM public.notifications WHERE shop_id = 'f2111111-0000-0000-0000-000000000001'),
  0,
  'flag off: evaluate_health_alerts_foreground claims nothing for any of the 4 metrics, all of which are over threshold'
);
SELECT is(
  (SELECT count(*)::int FROM public.health_alert_state_a WHERE shop_id = 'f2111111-0000-0000-0000-000000000001'),
  0,
  'flag off: no health_alert_state_a rows exist at all -- claims were never attempted, not attempted-and-rejected'
);

-- Flip the flag on; re-evaluate. Same underlying values (nothing changed
-- while the flag was off) -- fresh evaluation claims all 4, exactly once.
UPDATE public.shops SET features = jsonb_build_object('rollout', jsonb_build_object('health_alerting', true))
 WHERE id = 'f2111111-0000-0000-0000-000000000001';

SELECT set_config('request.jwt.claims', '{"sub":"f2000000-0000-0000-0000-000000000001","active_role":"owner"}', true);
SET LOCAL ROLE authenticated;
SELECT public.evaluate_health_alerts_foreground();
RESET ROLE;
-- See the comment above the previous RESET ROLE: clear the transaction-local
-- JWT claim so later admin-level shops.features UPDATEs are not silently
-- reverted by protect_shop_features() (migration 041).
SELECT set_config('request.jwt.claims', '', true);

SELECT is(
  (SELECT count(*)::int FROM public.notifications WHERE shop_id = 'f2111111-0000-0000-0000-000000000001'),
  4,
  'Shape A flag off->on: the first post-re-enable call evaluates fresh against the current (still over-threshold) values and claims all 4 metrics exactly once -- no attempt to reconstruct missed history'
);

-- ============================================================================
-- Section 4: _scheduled_check_overdue_shifts (metric #8 claim path) -- flag
-- off produces no claim; recovery (owned by the shift.closed trigger
-- extension, migration 119, NOT this function) is unaffected by the flag and
-- already proven correct in wafi148a_shift_closed_extension.test.sql. Here we
-- assert the flag-off claim-suppression side directly, plus flag off->on
-- fresh evaluation.
-- ============================================================================
INSERT INTO public.shops (id, name, timezone, features) VALUES
  ('f3111111-0000-0000-0000-000000000001', 'Shop FG3 (overdue shift, flag off)', 'Asia/Damascus',
   jsonb_build_object('rollout', jsonb_build_object('health_alerting', false)));

INSERT INTO public.devices (id, shop_id, code) VALUES
  ('f3111111-0000-0000-0000-000000000002', 'f3111111-0000-0000-0000-000000000001', 'DEV-FG3-1');

INSERT INTO public.notification_settings (shop_id, type, enabled, threshold_json)
VALUES ('f3111111-0000-0000-0000-000000000001', 'health_alert_overdue_shift', true, jsonb_build_object('threshold', 4));

INSERT INTO public.cashier_shifts (id, shop_id, device_id, opened_at, opening_cash_usd, status)
VALUES ('f3111111-0000-0000-0000-000000000003', 'f3111111-0000-0000-0000-000000000001', 'f3111111-0000-0000-0000-000000000002',
        now() - interval '10 hours', 0, 'open');

SELECT public._scheduled_check_overdue_shifts();

SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = 'f3111111-0000-0000-0000-000000000001' AND type = 'health_alert_overdue_shift'),
  0,
  'flag off: overdue-shift scheduled check claims nothing, even for a shift well past threshold'
);
SELECT is(
  (SELECT count(*)::int FROM public.health_alert_state_b
     WHERE shop_id = 'f3111111-0000-0000-0000-000000000001' AND alert_key = 'overdue_shift'),
  0,
  'flag off: no health_alert_state_b row is created either'
);

UPDATE public.shops SET features = jsonb_build_object('rollout', jsonb_build_object('health_alerting', true))
 WHERE id = 'f3111111-0000-0000-0000-000000000001';

SELECT public._scheduled_check_overdue_shifts();

SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = 'f3111111-0000-0000-0000-000000000001' AND type = 'health_alert_overdue_shift'),
  1,
  'flag off->on: a later run after enabling claims exactly once against the still-open, still-overdue shift'
);

-- ============================================================================
-- Section 5: _scheduled_check_dead_letter_count (metric #3) -- BOTH branches
-- in one loop iteration: (a) flag off suppresses the claim branch only; (b)
-- an already-ALERTING row still resolves correctly while the flag is off
-- (the resolve branch is never gated), proving the asymmetry within this
-- function specifically.
-- ============================================================================
INSERT INTO public.shops (id, name, timezone, features) VALUES
  ('f4111111-0000-0000-0000-000000000001', 'Shop FG4 (dead-letter, flag asymmetry)', 'Asia/Damascus',
   jsonb_build_object('rollout', jsonb_build_object('health_alerting', true)));

INSERT INTO public.devices (id, shop_id, code) VALUES
  ('f4111111-0000-0000-0000-000000000002', 'f4111111-0000-0000-0000-000000000001', 'DEV-FG4-1');

INSERT INTO public.notification_settings (shop_id, type, enabled, threshold_json)
VALUES ('f4111111-0000-0000-0000-000000000001', 'health_alert_dead_letter_count', true, jsonb_build_object('threshold', 5));

-- Tick 1 (flag ON): gauge over threshold -> claims/ALERTING.
INSERT INTO public.health_gauges (shop_id, device_id, gauge_key, value, observed_at)
VALUES ('f4111111-0000-0000-0000-000000000001', 'f4111111-0000-0000-0000-000000000002', 'dead_letter_count', 10, now());

SELECT public._scheduled_check_dead_letter_count();

SELECT is(
  (SELECT state FROM public.health_alert_state_b
     WHERE shop_id = 'f4111111-0000-0000-0000-000000000001' AND alert_key = 'dead_letter_count'
       AND entity_id = '00000000-0000-0000-0000-000000000000'),
  'ALERTING',
  'dead-letter asymmetry setup: flag on, gauge over threshold claims ALERTING'
);

-- Now turn the flag OFF, and let the gauge recover (fall under threshold).
UPDATE public.shops SET features = jsonb_build_object('rollout', jsonb_build_object('health_alerting', false))
 WHERE id = 'f4111111-0000-0000-0000-000000000001';

UPDATE public.health_gauges SET value = 1, observed_at = now()
 WHERE shop_id = 'f4111111-0000-0000-0000-000000000001' AND device_id = 'f4111111-0000-0000-0000-000000000002';

SELECT public._scheduled_check_dead_letter_count();

SELECT is(
  (SELECT state FROM public.health_alert_state_b
     WHERE shop_id = 'f4111111-0000-0000-0000-000000000001' AND alert_key = 'dead_letter_count'
       AND entity_id = '00000000-0000-0000-0000-000000000000'),
  'HEALTHY',
  'dead-letter asymmetry: the resolve branch runs and resolves the alert to HEALTHY even while the flag is OFF'
);

-- With the flag still off, push the gauge back over threshold -- the claim
-- branch must NOT fire.
UPDATE public.health_gauges SET value = 10, observed_at = now()
 WHERE shop_id = 'f4111111-0000-0000-0000-000000000001' AND device_id = 'f4111111-0000-0000-0000-000000000002';

SELECT public._scheduled_check_dead_letter_count();

SELECT is(
  (SELECT state FROM public.health_alert_state_b
     WHERE shop_id = 'f4111111-0000-0000-0000-000000000001' AND alert_key = 'dead_letter_count'
       AND entity_id = '00000000-0000-0000-0000-000000000000'),
  'HEALTHY',
  'dead-letter asymmetry: with the flag off, the gauge rising back over threshold does NOT re-claim -- stays HEALTHY (claim branch is gated)'
);
SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = 'f4111111-0000-0000-0000-000000000001' AND type = 'health_alert_dead_letter_count'),
  1,
  'dead-letter asymmetry: only the original flag-on claim produced a notification -- the flag-off re-claim attempt produced none'
);

-- (Task 12, round-3 completion) Flip the flag back ON. The gauge is still
-- over threshold (10, unchanged since the last tick) -- this is the
-- "disabled while bad -> recovered while still disabled -> bad again ->
-- re-enable" scenario's final step: exactly ONE additional notification for
-- this post-re-enable episode (two total), not zero and not a duplicate of
-- the pre-disable episode.
UPDATE public.shops SET features = jsonb_build_object('rollout', jsonb_build_object('health_alerting', true))
 WHERE id = 'f4111111-0000-0000-0000-000000000001';

SELECT public._scheduled_check_dead_letter_count();

SELECT is(
  (SELECT state FROM public.health_alert_state_b
     WHERE shop_id = 'f4111111-0000-0000-0000-000000000001' AND alert_key = 'dead_letter_count'
       AND entity_id = '00000000-0000-0000-0000-000000000000'),
  'ALERTING',
  'round-3 (#3) completion: re-enabling with the gauge still over threshold claims ALERTING again for the post-re-enable episode'
);
SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = 'f4111111-0000-0000-0000-000000000001' AND type = 'health_alert_dead_letter_count'),
  2,
  'round-3 (#3) completion: exactly one additional notification after re-enabling (two total) -- not zero, not a stale duplicate of the earlier episode'
);

-- ============================================================================
-- Section 6: _scheduled_check_stale_devices (metric #7) -- Query A (claim)
-- gated; Query B (resolve, including the disappearance branch) unaffected by
-- the flag. Proves recovery-via-freshness happens correctly while the flag
-- is off, then flag on evaluates a fresh stale condition normally.
-- ============================================================================
INSERT INTO public.shops (id, name, timezone, features) VALUES
  ('f5111111-0000-0000-0000-000000000001', 'Shop FG5 (stale device, flag asymmetry)', 'Asia/Damascus',
   jsonb_build_object('rollout', jsonb_build_object('health_alerting', true)));

INSERT INTO public.devices (id, shop_id, code, is_active, last_seen_at) VALUES
  ('f5111111-0000-0000-0000-000000000002', 'f5111111-0000-0000-0000-000000000001', 'DEV-FG5-1', true, now() - interval '30 hours');

INSERT INTO public.notification_settings (shop_id, type, enabled, threshold_json)
VALUES ('f5111111-0000-0000-0000-000000000001', 'health_alert_stale_device', true, jsonb_build_object('threshold', 24));

-- Tick 1 (flag ON): stale -> ALERTING.
SELECT public._scheduled_check_stale_devices();

SELECT is(
  (SELECT state FROM public.health_alert_state_b
     WHERE shop_id = 'f5111111-0000-0000-0000-000000000001' AND alert_key = 'stale_device'
       AND entity_id = 'f5111111-0000-0000-0000-000000000002'),
  'ALERTING',
  'stale-device asymmetry setup: flag on, stale device claims ALERTING'
);

-- Flag OFF, device becomes fresh again.
UPDATE public.shops SET features = jsonb_build_object('rollout', jsonb_build_object('health_alerting', false))
 WHERE id = 'f5111111-0000-0000-0000-000000000001';

UPDATE public.devices SET last_seen_at = now()
 WHERE id = 'f5111111-0000-0000-0000-000000000002';

SELECT public._scheduled_check_stale_devices();

SELECT is(
  (SELECT state FROM public.health_alert_state_b
     WHERE shop_id = 'f5111111-0000-0000-0000-000000000001' AND alert_key = 'stale_device'
       AND entity_id = 'f5111111-0000-0000-0000-000000000002'),
  'HEALTHY',
  'stale-device asymmetry: Query B resolves the device to HEALTHY via freshness even while the flag is OFF'
);

-- With the flag still off, the device goes stale again -- Query A must not
-- re-claim.
UPDATE public.devices SET last_seen_at = now() - interval '30 hours'
 WHERE id = 'f5111111-0000-0000-0000-000000000002';

SELECT public._scheduled_check_stale_devices();

SELECT is(
  (SELECT state FROM public.health_alert_state_b
     WHERE shop_id = 'f5111111-0000-0000-0000-000000000001' AND alert_key = 'stale_device'
       AND entity_id = 'f5111111-0000-0000-0000-000000000002'),
  'HEALTHY',
  'stale-device asymmetry: with the flag off, the device going stale again does NOT re-claim -- stays HEALTHY (Query A is gated)'
);

-- Now flip flag ON and run again: fresh evaluation claims normally.
UPDATE public.shops SET features = jsonb_build_object('rollout', jsonb_build_object('health_alerting', true))
 WHERE id = 'f5111111-0000-0000-0000-000000000001';

SELECT public._scheduled_check_stale_devices();

SELECT is(
  (SELECT state FROM public.health_alert_state_b
     WHERE shop_id = 'f5111111-0000-0000-0000-000000000001' AND alert_key = 'stale_device'
       AND entity_id = 'f5111111-0000-0000-0000-000000000002'),
  'ALERTING',
  'flag off->on: a later run after re-enabling claims fresh against the still-stale device'
);
SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = 'f5111111-0000-0000-0000-000000000001' AND type = 'health_alert_stale_device'),
  2,
  'flag off->on: exactly 2 notifications total for this device -- the original flag-on claim and the re-enabled claim, with zero produced during the flag-off window'
);

-- ============================================================================
-- Section 7: set_rollout_flag now accepts 'health_alerting' (previously
-- unknown to the allowlist), and list_shops_for_rollout_admin surfaces it.
-- ============================================================================
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'f6000000-0000-0000-0000-000000000001', 'admin-wafi148a-flag@test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');

INSERT INTO public.platform_admins (user_id) VALUES ('f6000000-0000-0000-0000-000000000001');

INSERT INTO public.shops (id, name, timezone) VALUES
  ('f6111111-0000-0000-0000-000000000001', 'Shop FG6 (admin flag toggling)', 'Asia/Damascus');

SELECT set_config('request.jwt.claims', '{"sub":"f6000000-0000-0000-0000-000000000001","active_role":"owner"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$ SELECT public.set_rollout_flag('f6111111-0000-0000-0000-000000000001', 'health_alerting', true) $$,
  'set_rollout_flag now accepts health_alerting as a known flag key (previously would have raised "unknown rollout flag")'
);
RESET ROLE;

-- set_rollout_flag (migration 090/123) deliberately clears
-- request.jwt.claims internally (a narrowly-scoped, transaction-local
-- override so its own UPDATE isn't reverted by protect_shop_features,
-- migration 041/075) -- see its header comment. Re-establish the admin's
-- JWT claim before the next authenticated call, exactly as a fresh request
-- would carry it.
SELECT set_config('request.jwt.claims', '{"sub":"f6000000-0000-0000-0000-000000000001","active_role":"owner"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT health_alerting FROM public.list_shops_for_rollout_admin('Shop FG6 (admin flag toggling)') LIMIT 1),
  true,
  'list_shops_for_rollout_admin surfaces the health_alerting column reflecting the flag just set'
);

SELECT * FROM finish();
ROLLBACK;
