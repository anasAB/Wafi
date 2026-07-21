-- Manual verification for auth_role()/auth_staff_id()/auth_permissions()/can().
-- Run each SELECT by hand in the Supabase SQL editor (no automated harness
-- in this repo -- see verify_custom_access_token_hook.sql for precedent).
-- These calls run as the SQL editor's own role (not `authenticated` via
-- PostgREST), so auth.jwt() returns NULL in this context by default --
-- these assertions instead verify the DENY-BY-DEFAULT behavior when no JWT
-- context is present, which is exactly the fail-closed path these
-- functions must guarantee.

-- Case 1: no JWT context at all -- auth_role() must default to 'cashier',
-- never NULL and never a permissive role.
SELECT public.auth_role() = 'cashier' AS case_1_pass;

-- Case 2: no JWT context -- auth_staff_id() must be NULL, not error.
SELECT public.auth_staff_id() IS NULL AS case_2_pass;

-- Case 3: no JWT context -- auth_permissions() must return '{}', not error,
-- not NULL.
SELECT public.auth_permissions() = '{}'::jsonb AS case_3_pass;

-- Case 4: no JWT context (fails closed to 'cashier', no staff_id) -- can()
-- must return false for any flag, never error.
SELECT public.can('can_view_reports') = false AS case_4_pass;

-- Case 5: can('can_view_reports') on a made-up flag name that doesn't exist
-- in StaffPermissions -- must return false, not error (defends the "future
-- flags" extensibility goal -- an unrecognized flag denies, it never grants).
SELECT public.can('some_flag_that_does_not_exist') = false AS case_5_pass;
