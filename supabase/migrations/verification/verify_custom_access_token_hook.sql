-- Manual verification for WAFI-122's custom_access_token_hook fail-closed
-- behavior. Run this against a Supabase SQL editor (staging/local) after
-- migration 048_session_id_active_role.sql is applied.
--
-- NOT part of the automated migration set -- this repo has no SQL-testing
-- framework (pgTAP/pg_prove) wired up (confirmed absent during WAFI-138's
-- migration work), so this is a documented check, run and inspected by hand
-- rather than a new test harness introduced for a single function.
--
-- IMPORTANT: this verifies the CURRENT hook, which is keyed on Supabase's
-- native per-session `session_id` JWT claim (migration 048), NOT the
-- original `device_id`-keyed design (migrations 046/047) -- that design was
-- found broken during implementation review; see ADR-009's "Design
-- Correction" section and the header comment of migration 048 for why.
--
-- How to run: execute each SELECT below in order. Cases 1-4 need no setup
-- and must each return `true` on their `case_N_pass` column. Case 5 first
-- INSERTs a real device_sessions row (uncomment and fill in a real
-- shop_id/device_id from your environment), then verifies the stored role
-- round-trips through the hook, then cleans up the row it inserted.

-- ---------------------------------------------------------------------
-- Case 1: no session_id claim at all (claims present but empty object)
-- → must fail closed to 'cashier', not null/error.
-- Exercises: the `v_session IS NULL` branch (lines ~205-211 of migration
-- 048's custom_access_token_hook).
-- ---------------------------------------------------------------------
SELECT public.custom_access_token_hook(
  '{"user_id": "00000000-0000-0000-0000-000000000000", "claims": {}}'::jsonb
) = '{"claims": {"active_role": "cashier"}}'::jsonb AS case_1_pass;

-- ---------------------------------------------------------------------
-- Case 2: session_id claim present (well-formed UUID) but no matching
-- device_sessions row → must return 'cashier', not null/error.
-- Exercises: the guarded SELECT ... INTO v_role returning no row, so
-- v_role stays NULL and the `IF v_role IS NULL THEN v_role := 'cashier'`
-- fallback fires.
-- ---------------------------------------------------------------------
SELECT public.custom_access_token_hook(
  '{"user_id": "00000000-0000-0000-0000-000000000000",
    "claims": {"session_id": "22222222-2222-2222-2222-222222222222"}}'::jsonb
) = '{"claims": {"session_id": "22222222-2222-2222-2222-222222222222", "active_role": "cashier"}}'::jsonb
  AS case_2_pass;

-- ---------------------------------------------------------------------
-- Case 3: malformed (non-UUID) session_id claim → must still fail closed
-- to 'cashier', not raise an error up to the caller.
-- Exercises: the exception-guarded cast `session_id = v_session::uuid`
-- inside the BEGIN/EXCEPTION WHEN OTHERS block -- a review-round fix
-- added AFTER the original brief was written, since the brief's
-- device_id-keyed version had no such guard/test case.
-- ---------------------------------------------------------------------
SELECT public.custom_access_token_hook(
  '{"user_id": "00000000-0000-0000-0000-000000000000",
    "claims": {"session_id": "not-a-uuid"}}'::jsonb
) = '{"claims": {"session_id": "not-a-uuid", "active_role": "cashier"}}'::jsonb
  AS case_3_pass;

-- ---------------------------------------------------------------------
-- Case 4: "claims" key missing entirely, present as JSON null, or a
-- non-object scalar/array → must still fail closed to 'cashier', not
-- raise "cannot set path in scalar" from jsonb_set.
-- Exercises: the normalization `IF claims IS NULL OR jsonb_typeof(claims)
-- <> 'object' THEN claims := '{}'::jsonb` -- another review-round fix not
-- present (or tested) in the brief's original version.
-- ---------------------------------------------------------------------
SELECT public.custom_access_token_hook(
  '{"user_id": "00000000-0000-0000-0000-000000000000"}'::jsonb
) = '{"claims": {"active_role": "cashier"}}'::jsonb AS case_4a_pass_claims_missing;

SELECT public.custom_access_token_hook(
  '{"user_id": "00000000-0000-0000-0000-000000000000", "claims": null}'::jsonb
) = '{"claims": {"active_role": "cashier"}}'::jsonb AS case_4b_pass_claims_null;

SELECT public.custom_access_token_hook(
  '{"user_id": "00000000-0000-0000-0000-000000000000", "claims": "not-an-object"}'::jsonb
) = '{"claims": {"active_role": "cashier"}}'::jsonb AS case_4c_pass_claims_scalar;

-- ---------------------------------------------------------------------
-- Case 5: a real matching device_sessions row → the actual stored role
-- must round-trip correctly (NOT fall back to 'cashier').
-- Exercises: the success path of the guarded SELECT, matching on
-- session_id (not device_id, per the migration 048 re-key).
--
-- Fill in a real shop_id and device_id that exist in your environment
-- before running, then run the three statements below in order, then run
-- the cleanup DELETE at the very end regardless of pass/fail.
-- ---------------------------------------------------------------------
-- INSERT INTO public.device_sessions (device_id, session_id, shop_id, active_role)
--   VALUES (
--     '<a real device_id>',
--     '33333333-3333-3333-3333-333333333333',
--     '<a real shop_id>',
--     'owner'
--   )
--   ON CONFLICT (device_id) DO UPDATE
--     SET session_id = excluded.session_id, active_role = excluded.active_role;
--
-- SELECT public.custom_access_token_hook(
--   '{"user_id": "00000000-0000-0000-0000-000000000000",
--     "claims": {"session_id": "33333333-3333-3333-3333-333333333333"}}'::jsonb
-- ) -> 'claims' ->> 'active_role' = 'owner' AS case_5_pass;
--
-- -- Cleanup: delete (or restore) the test row so it doesn't linger.
-- DELETE FROM public.device_sessions WHERE session_id = '33333333-3333-3333-3333-333333333333';

-- ---------------------------------------------------------------------
-- After running: confirm every case_N_pass column above returned `true`.
-- Any `false` or error means the fail-closed guarantee is broken and must
-- be fixed before this hook is wired into production Auth Hooks config.
-- ---------------------------------------------------------------------
