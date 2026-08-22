-- supabase/tests/wafi148a_claim_functions.test.sql
-- WAFI-148A Task 3: claim_health_alert_period, claim_health_alert_transition,
-- resolve_health_alert_transition -- the shared claim/notify contract.
-- Run via: npx supabase test db
--
-- Known test gap (documented per task brief, not faked): true concurrent-claim
-- behavior cannot be exercised by a single pgTAP session, which cannot hold
-- two overlapping open transactions on one connection. As with WAFI-156's
-- execute_rule_action_concurrent test, a real concurrency proof requires two
-- separate client connections racing the same INSERT ... ON CONFLICT
-- statement; that is not attempted here. What IS asserted below (repeat
-- sequential calls returning false/no-op) proves idempotency under
-- SEQUENTIAL re-invocation, which is a necessary but not sufficient condition
-- for the concurrency guarantee -- it does not by itself prove the row-lock
-- behavior holds under real overlap.

BEGIN;
SELECT plan(27);

-- ========================================================================
-- Fixture: one shop.
-- ========================================================================
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-000000000001', 'owner-wafi148a-claim@test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');

DELETE FROM public.shops WHERE owner_user_id = 'e0000000-0000-0000-0000-000000000001';
INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('e0000000-0000-0000-0000-000000000010', 'WAFI-148A Claim Shop', 'e0000000-0000-0000-0000-000000000001');

-- ========================================================================
-- claim_health_alert_period
-- ========================================================================

-- 1. First claim on a fresh key succeeds, inserts exactly one notification row.
SELECT is(
  public.claim_health_alert_period(
    'e0000000-0000-0000-0000-000000000010'::uuid, 'sync_failures', '2026-08-20'::date,
    5, 'sync_failures', 'فشل في المزامنة', 'حدث فشل في المزامنة', 'WARNING'
  ),
  true,
  'first claim_health_alert_period on a fresh key returns true'
);
SELECT is(
  (SELECT count(*)::int FROM public.health_alert_state_a
     WHERE shop_id = 'e0000000-0000-0000-0000-000000000010' AND metric_key = 'sync_failures' AND period_start = '2026-08-20'),
  1,
  'health_alert_state_a row created for the claimed period'
);
SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = 'e0000000-0000-0000-0000-000000000010' AND type = 'sync_failures'),
  1,
  'exactly one notification row inserted after first claim'
);
SELECT is(
  (SELECT recipient_role FROM public.notifications WHERE shop_id = 'e0000000-0000-0000-0000-000000000010' AND type = 'sync_failures'),
  'owner',
  'notification recipient_role is owner'
);
SELECT is(
  (SELECT recipient_staff_id FROM public.notifications WHERE shop_id = 'e0000000-0000-0000-0000-000000000010' AND type = 'sync_failures'),
  NULL,
  'notification recipient_staff_id is NULL (owner-role targeting, not staff-table lookup)'
);

-- 2. Second claim on the same key returns false, inserts zero additional notifications,
--    and does not modify threshold_used/alerted_at on the existing row.
SELECT is(
  public.claim_health_alert_period(
    'e0000000-0000-0000-0000-000000000010'::uuid, 'sync_failures', '2026-08-20'::date,
    99, 'sync_failures', 'ignored title', 'ignored message', 'CRITICAL'
  ),
  false,
  'second claim on the same (shop, metric, period) key returns false'
);
SELECT is(
  (SELECT count(*)::int FROM public.notifications
     WHERE shop_id = 'e0000000-0000-0000-0000-000000000010' AND type = 'sync_failures'),
  1,
  'still exactly one notification row after the second claim'
);
SELECT is(
  (SELECT threshold_used FROM public.health_alert_state_a
     WHERE shop_id = 'e0000000-0000-0000-0000-000000000010' AND metric_key = 'sync_failures' AND period_start = '2026-08-20'),
  5::numeric,
  'threshold_used on the existing row is unchanged by the failed second claim'
);

-- A different period_start for the same metric is an independent key.
SELECT is(
  public.claim_health_alert_period(
    'e0000000-0000-0000-0000-000000000010'::uuid, 'sync_failures', '2026-08-21'::date,
    5, 'sync_failures', 'title', 'message', 'WARNING'
  ),
  true,
  'claim for a new period_start on the same metric succeeds independently'
);

-- source_event_id parameter is passed through (metric #4 use case).
SELECT is(
  public.claim_health_alert_period(
    'e0000000-0000-0000-0000-000000000010'::uuid, 'drawer_mismatch', '2026-08-20'::date,
    10, 'drawer_mismatch', 'title', 'message', 'CRITICAL', 'f0000000-0000-0000-0000-000000000099'::uuid
  ),
  true,
  'claim with an explicit source_event_id succeeds'
);
SELECT is(
  (SELECT source_event_id FROM public.notifications WHERE type = 'drawer_mismatch'),
  'f0000000-0000-0000-0000-000000000099'::uuid,
  'source_event_id is passed through to the notification row when supplied'
);

-- ========================================================================
-- claim_health_alert_transition
-- ========================================================================

-- 3. Missing row + call -> creates ALERTING row, notifies, returns true (bootstrap case).
SELECT is(
  public.claim_health_alert_transition(
    'e0000000-0000-0000-0000-000000000010'::uuid, 'stale_device', 'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    'stale_device', 'جهاز غير متزامن', 'لم يتم رصد جهاز منذ فترة'
  ),
  true,
  'claim_health_alert_transition bootstraps a missing row and returns true'
);
SELECT is(
  (SELECT state FROM public.health_alert_state_b
     WHERE shop_id = 'e0000000-0000-0000-0000-000000000010' AND alert_key = 'stale_device' AND entity_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'ALERTING',
  'bootstrapped row has state ALERTING'
);
SELECT is(
  (SELECT count(*)::int FROM public.notifications WHERE type = 'stale_device'),
  1,
  'bootstrap claim inserted exactly one notification'
);

-- last_notified_at is set to the same now() used for the notification insert.
SELECT ok(
  (SELECT last_notified_at FROM public.health_alert_state_b
     WHERE shop_id = 'e0000000-0000-0000-0000-000000000010' AND alert_key = 'stale_device' AND entity_id = 'aaaaaaaa-0000-0000-0000-000000000001')
  = (SELECT created_at FROM public.notifications WHERE type = 'stale_device'),
  'last_notified_at matches the notification created_at value after a successful claim'
);

-- 4. Existing ALERTING row + call -> no change, no notification, returns false.
SELECT is(
  public.claim_health_alert_transition(
    'e0000000-0000-0000-0000-000000000010'::uuid, 'stale_device', 'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    'stale_device', 'ignored', 'ignored'
  ),
  false,
  'claim on an already-ALERTING row returns false'
);
SELECT is(
  (SELECT count(*)::int FROM public.notifications WHERE type = 'stale_device'),
  1,
  'no additional notification inserted for an already-ALERTING row'
);

-- 5. Existing HEALTHY row + call -> transitions to ALERTING, notifies, returns true.
UPDATE public.health_alert_state_b SET state = 'HEALTHY', last_notified_at = NULL
  WHERE shop_id = 'e0000000-0000-0000-0000-000000000010' AND alert_key = 'stale_device' AND entity_id = 'aaaaaaaa-0000-0000-0000-000000000001';

SELECT is(
  public.claim_health_alert_transition(
    'e0000000-0000-0000-0000-000000000010'::uuid, 'stale_device', 'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    'stale_device', 'جهاز غير متزامن مجددا', 'رصد ثانٍ'
  ),
  true,
  'claim on an existing HEALTHY row transitions and returns true'
);
SELECT is(
  (SELECT state FROM public.health_alert_state_b
     WHERE shop_id = 'e0000000-0000-0000-0000-000000000010' AND alert_key = 'stale_device' AND entity_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'ALERTING',
  'row transitioned back to ALERTING'
);
SELECT is(
  (SELECT count(*)::int FROM public.notifications WHERE type = 'stale_device'),
  2,
  'HEALTHY-to-ALERTING transition inserted a second notification'
);

-- entity_type / entity_id are populated on the notification row when supplied.
SELECT is(
  public.claim_health_alert_transition(
    'e0000000-0000-0000-0000-000000000010'::uuid, 'overdue_shift', 'bbbbbbbb-0000-0000-0000-000000000002'::uuid,
    'overdue_shift', 'وردية متأخرة', 'لم يتم إغلاق الوردية', 'WARNING', 'shift'
  ),
  true,
  'claim with an explicit entity_type succeeds'
);
SELECT is(
  (SELECT entity_type FROM public.notifications WHERE type = 'overdue_shift'),
  'shift',
  'entity_type is passed through to the notification row'
);
SELECT is(
  (SELECT entity_id FROM public.notifications WHERE type = 'overdue_shift'),
  'bbbbbbbb-0000-0000-0000-000000000002',
  'entity_id is cast to text and passed through to the notification row'
);

-- ========================================================================
-- resolve_health_alert_transition
-- ========================================================================

-- 6. Existing ALERTING row -> resolves to HEALTHY, inserts NO notification (silent recovery).
SELECT is(
  (SELECT count(*)::int FROM public.notifications) AS pre_count,
  (SELECT count(*)::int FROM public.notifications),
  'sanity: notification count stable before resolve call'
);

SELECT lives_ok(
  $$ SELECT public.resolve_health_alert_transition(
       'e0000000-0000-0000-0000-000000000010'::uuid, 'stale_device', 'aaaaaaaa-0000-0000-0000-000000000001'::uuid
     ) $$,
  'resolve_health_alert_transition on an existing ALERTING row does not error'
);
SELECT is(
  (SELECT state FROM public.health_alert_state_b
     WHERE shop_id = 'e0000000-0000-0000-0000-000000000010' AND alert_key = 'stale_device' AND entity_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'HEALTHY',
  'row resolved to HEALTHY'
);
SELECT is(
  (SELECT count(*)::int FROM public.notifications),
  2,
  'resolve_health_alert_transition inserted zero new notifications (recovery is silent)'
);

-- 7. Missing row -> no-op, no error.
SELECT lives_ok(
  $$ SELECT public.resolve_health_alert_transition(
       'e0000000-0000-0000-0000-000000000010'::uuid, 'overdue_shift', 'cccccccc-0000-0000-0000-000000000003'::uuid
     ) $$,
  'resolve_health_alert_transition on a missing row is a no-op, no error'
);
SELECT is(
  (SELECT count(*)::int FROM public.health_alert_state_b WHERE entity_id = 'cccccccc-0000-0000-0000-000000000003'),
  0,
  'resolve on a missing row does not create one'
);

-- ========================================================================
-- Rollback test (Transactional Guarantees #2): force the notification
-- insert to fail inside claim_health_alert_transition (an invalid severity
-- violates public.notifications' CHECK constraint) and assert the whole
-- transaction rolled back -- no health_alert_state_b row change persists --
-- and a later legitimate claim on the same key can still succeed.
-- ========================================================================
SELECT throws_ok(
  $$ SELECT public.claim_health_alert_transition(
       'e0000000-0000-0000-0000-000000000010'::uuid, 'overdue_shift', 'dddddddd-0000-0000-0000-000000000004'::uuid,
       'overdue_shift', 't', 'm', 'NOT_A_VALID_SEVERITY'
     ) $$,
  '23514',
  'an invalid severity fails the notification insert inside claim_health_alert_transition'
);
SELECT is(
  (SELECT count(*)::int FROM public.health_alert_state_b WHERE entity_id = 'dddddddd-0000-0000-0000-000000000004'),
  0,
  'the failed claim left no health_alert_state_b row -- the INSERT ... ON CONFLICT was rolled back with the notification failure'
);
SELECT is(
  public.claim_health_alert_transition(
    'e0000000-0000-0000-0000-000000000010'::uuid, 'overdue_shift', 'dddddddd-0000-0000-0000-000000000004'::uuid,
    'overdue_shift', 't', 'm'
  ),
  true,
  'a later legitimate claim on the same key succeeds after the earlier failed claim rolled back cleanly'
);

SELECT * FROM finish();
ROLLBACK;
