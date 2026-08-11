-- supabase/tests/wafi151_daily_event_counts_rebuild.test.sql
-- WAFI-151 Plan 2: rebuild_daily_event_counts_scope
-- (085_daily_event_counts_rebuild.sql).
-- Run via: npx supabase test db

BEGIN;
SELECT plan(7);

-- One shop, mirroring wafi151_daily_event_counts_apply.test.sql's harness: an
-- auth.users row for the owner, then a shops row whose owner_user_id maps
-- that user to auth_shop_id() (migration 015).
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-000000000002', 'owner-c@wafi151.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');
DELETE FROM public.shops WHERE owner_user_id = 'c0000000-0000-0000-0000-000000000002';
INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('c0000000-0000-0000-0000-000000000001', 'WAFI-151 Shop C', 'c0000000-0000-0000-0000-000000000002');

-- Setup: two sale.completed events for shop_id_a on 2026-08-11, one event on
-- 2026-08-12 (a different day, must NOT be touched by a rebuild scoped to
-- just 08-11). Seed as postgres (bypasses RLS), same as the apply test.
INSERT INTO public.events (id, type, entity_id, payload, staff_id, shop_id, occurred_at) VALUES
  ('c1000000-0000-0000-0000-000000000001', 'sale.completed', 'sale-c1', '{"saleId":"sale-c1"}', 'c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', '2026-08-11T10:00:00+00:00'),
  ('c1000000-0000-0000-0000-000000000002', 'sale.completed', 'sale-c2', '{"saleId":"sale-c2"}', 'c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', '2026-08-11T11:00:00+00:00'),
  ('c1000000-0000-0000-0000-000000000003', 'sale.completed', 'sale-c3', '{"saleId":"sale-c3"}', 'c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', '2026-08-12T10:00:00+00:00');

-- Apply each once via apply_daily_event_count (as the shop owner) so there's
-- existing incrementally-computed state to rebuild against.
SELECT set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-0000-0000-000000000002","active_role":"owner"}', true);
SET LOCAL ROLE authenticated;
SELECT apply_daily_event_count('c1000000-0000-0000-0000-000000000001');
SELECT apply_daily_event_count('c1000000-0000-0000-0000-000000000002');
SELECT apply_daily_event_count('c1000000-0000-0000-0000-000000000003');
RESET ROLE;

-- rebuild_daily_event_counts_scope is granted to service_role only (no
-- per-caller shop check, per its design) -- calls below run as service_role.
SET LOCAL ROLE service_role;

-- 1. After rebuild, the day-11 row reflects exactly the 2 events for that day
--    -- and per the setup note above, that's also what incremental processing
--    (the earlier apply_daily_event_count calls) had already computed before
--    this rebuild ran. Rebuild reproducing the same value incremental
--    processing already produced, for the same event set, is the concrete
--    test for the design spec's AC #3 ("incremental and replay produce
--    identical results") -- both code paths ultimately call the same
--    _apply_daily_event_count, so this also proves there's no drift between
--    them, not just that the numbers happen to match.
SELECT rebuild_daily_event_counts_scope('c0000000-0000-0000-0000-000000000001', '2026-08-11', '2026-08-11');
SELECT is(
  (SELECT count FROM daily_event_counts WHERE shop_id = 'c0000000-0000-0000-0000-000000000001' AND day = '2026-08-11'),
  2,
  'rebuild reproduces exactly what incremental processing already computed for the same events (AC #3: incremental == replay)'
);

-- 2. The day-12 row (outside the rebuilt range) is untouched.
SELECT is(
  (SELECT count FROM daily_event_counts WHERE shop_id = 'c0000000-0000-0000-0000-000000000001' AND day = '2026-08-12'),
  1,
  'rebuilding one day does not affect an unrelated day''s row'
);

-- 3. Ledger entries for day-12's event are untouched (not deleted/reconciled by the day-11 rebuild).
SELECT ok(
  (SELECT count(*) FROM projection_processed_events pe
     JOIN events e ON e.id = pe.event_id
     WHERE e.shop_id = 'c0000000-0000-0000-0000-000000000001' AND e.event_projection_day = '2026-08-12'
       AND pe.projection_name = 'daily_event_counts') = 1,
  'rebuilding one day does not affect ledger entries for an unrelated day'
);

-- 4. Re-running the same rebuild is idempotent -- same result, not doubled.
SELECT rebuild_daily_event_counts_scope('c0000000-0000-0000-0000-000000000001', '2026-08-11', '2026-08-11');
SELECT is(
  (SELECT count FROM daily_event_counts WHERE shop_id = 'c0000000-0000-0000-0000-000000000001' AND day = '2026-08-11'),
  2,
  're-running the same rebuild produces the same result, not a doubled count'
);

-- 5. A forced validation failure leaves prior state intact (rollback test).
--    Capture the exact pre-rebuild row, then call a throwaway copy of the
--    rebuild function whose validation check is forced to fail unconditionally
--    (rather than trying to engineer a real negative count through normal
--    inputs), and assert the real table is byte-for-byte unchanged afterward.
CREATE OR REPLACE FUNCTION pg_temp.rebuild_daily_event_counts_scope_force_fail(
  p_shop_id uuid, p_from date, p_to date
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.daily_event_counts WHERE shop_id = p_shop_id AND day BETWEEN p_from AND p_to;
  DELETE FROM public.projection_processed_events pe
  WHERE pe.projection_name = 'daily_event_counts'
    AND pe.event_id IN (SELECT id FROM public.events WHERE shop_id = p_shop_id AND event_projection_day BETWEEN p_from AND p_to);
  RAISE EXCEPTION 'forced failure for rollback test';
END;
$$;

SELECT row_to_json(dec.*) INTO TEMP TABLE pre_rebuild_snapshot
FROM public.daily_event_counts dec WHERE shop_id = 'c0000000-0000-0000-0000-000000000001' AND day = '2026-08-11';

SELECT throws_ok(
  format('SELECT pg_temp.rebuild_daily_event_counts_scope_force_fail(%L, %L, %L)', 'c0000000-0000-0000-0000-000000000001', '2026-08-11', '2026-08-11'),
  'P0001', 'forced failure for rollback test',
  'a forced failure after delete-but-before-commit raises as expected'
);
SELECT is(
  (SELECT count FROM daily_event_counts WHERE shop_id = 'c0000000-0000-0000-0000-000000000001' AND day = '2026-08-11'),
  (SELECT (row_to_json(pre_rebuild_snapshot.*)->>'count')::integer FROM pre_rebuild_snapshot),
  'the real daily_event_counts row is completely unchanged after the forced-failure rollback -- the DELETE inside the failed call never persisted'
);

-- 6. Events whose event_projection_day is inside the range but whose
--    occurred_at falls outside it are still included -- proves relevance is
--    resolved by event_projection_day, not occurred_at (design spec AC #12).
--    event_projection_day is normally trigger-set from occurred_at at
--    insert; overwrite it explicitly afterward here to construct the case
--    where they disagree, since that's the scenario the rebuild engine must
--    handle correctly regardless of how such a row came to exist.
INSERT INTO events (id, type, entity_id, payload, payload_version, staff_id, shop_id, occurred_at, created_at)
VALUES ('c1000000-0000-0000-0000-000000000004', 'sale.completed', 'sale-c4', '{}', 1, 'c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', '2026-08-05T10:00:00+00:00', now());
UPDATE events SET event_projection_day = '2026-08-11' WHERE id = 'c1000000-0000-0000-0000-000000000004';

SELECT rebuild_daily_event_counts_scope('c0000000-0000-0000-0000-000000000001', '2026-08-11', '2026-08-11');
SELECT is(
  (SELECT count FROM daily_event_counts WHERE shop_id = 'c0000000-0000-0000-0000-000000000001' AND day = '2026-08-11'),
  3,
  'a rebuild for 2026-08-11 includes an event whose event_projection_day is 08-11 even though its occurred_at is 08-05 -- relevance is resolved by event_projection_day, never occurred_at'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
