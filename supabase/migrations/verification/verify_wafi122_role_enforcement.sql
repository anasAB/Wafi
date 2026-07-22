-- WAFI-202 note: sales/sale_line_items/sale_payments/returns/
-- return_line_items append-only + attribution enforcement now has an
-- automated pgTAP regression suite --
-- supabase/tests/wafi202_sales_immutability.test.sql, run via
-- `supabase test db`. That suite is the primary verification method for
-- those five tables' write policies going forward. This manual script
-- remains useful as an additional pre-deploy sanity check against a real
-- Supabase project (local pgTAP tests can't catch environment-specific
-- drift, e.g. a hand-applied policy change that never made it into a
-- migration file), but is no longer the *only* verification method.
--
-- Manual verification for WAFI-122's full role-enforcement scope, covering
-- all 10 domain RLS migrations (053-062) built across Tasks 1-10. Run each
-- block by hand in the Supabase SQL editor, against a project seeded with
-- at least one shop, one owner, one manager, and one cashier staff row (use
-- your dev/staging seed data; substitute real UUIDs for the placeholders
-- marked <...>).
--
-- NOT part of the automated migration set -- this repo has no SQL-testing
-- framework (pgTAP/pg_prove) wired up, so this follows the same hand-run
-- convention established by verify_custom_access_token_hook.sql.
--
-- set_config('request.jwt.claims', '<json>', true) fakes the per-request
-- JWT claims GUC that PostgREST normally sets from the caller's real JWT --
-- auth.jwt() (used by auth_role()/auth_staff_id() in Task 2) reads exactly
-- this GUC. The `true` argument scopes the setting to the current
-- transaction only, so each block should be run as its own statement/
-- transaction to avoid leaking claims between cases.
--
-- Placeholder legend (all marked with <...>, none are real values):
--   <owner_auth_uid>                       -- auth.users.id of the shop's owner
--   <owner_staff_id>                       -- staff.id row for that owner
--   <cashier_staff_id>                     -- staff.id row for a cashier in the shop
--   <manager_staff_id>                     -- staff.id row for a manager in the shop
--   <manager_with_malformed_permissions_staff_id> -- staff.id with permissions
--                                              set to invalid/non-JSON text
--   <deactivated_manager_staff_id>         -- staff.id with is_active = false
--   <manager_all_flags_false_staff_id>     -- staff.id, role manager, every
--                                              permission flag explicitly false
--   <other_shop_staff_id>                  -- staff.id belonging to a DIFFERENT
--                                              shop than <owner_auth_uid>'s
--   <staff_id_from_a_different_shop>       -- same idea, used for C2
--   <anon_key>, <project>, <cashier_jwt>   -- Section D curl placeholders

-- ============================================================
-- SECTION A: Role-based access (happy path)
-- ============================================================

-- A1: Cashier cannot SELECT from staff.
SELECT set_config('request.jwt.claims',
  '{"sub":"<owner_auth_uid>","active_role":"cashier","staff_id":"<cashier_staff_id>"}', true);
SELECT count(*) = 0 AS a1_pass FROM public.staff;

-- A2: Owner CAN SELECT from staff.
SELECT set_config('request.jwt.claims',
  '{"sub":"<owner_auth_uid>","active_role":"owner","staff_id":"<owner_staff_id>"}', true);
SELECT count(*) > 0 AS a2_pass FROM public.staff;

-- A3: Cashier cannot SELECT audit_log.
SELECT set_config('request.jwt.claims',
  '{"sub":"<owner_auth_uid>","active_role":"cashier","staff_id":"<cashier_staff_id>"}', true);
SELECT count(*) = 0 AS a3_pass FROM public.audit_log;

-- A4: Cashier sees only their OWN sales, not another cashier's or manager's.
-- Requires at least two sales rows with different staff_id values pre-seeded.
SELECT set_config('request.jwt.claims',
  '{"sub":"<owner_auth_uid>","active_role":"cashier","staff_id":"<cashier_staff_id>"}', true);
SELECT bool_and(staff_id = '<cashier_staff_id>'::uuid) AS a4_pass FROM public.sales;

-- A5: Manager CAN SELECT all sales, including another staff member's.
SELECT set_config('request.jwt.claims',
  '{"sub":"<owner_auth_uid>","active_role":"manager","staff_id":"<manager_staff_id>"}', true);
SELECT count(*) >= (
  SELECT count(*) FROM public.sales WHERE staff_id = '<cashier_staff_id>'::uuid
) AS a5_pass FROM public.sales;

-- ============================================================
-- SECTION B: Negative / edge cases (design spec §11)
-- ============================================================

-- B1: Missing active_role claim entirely -- auth_role() must default to
-- 'cashier' (fail closed), so staff SELECT must still be blocked.
SELECT set_config('request.jwt.claims', '{"sub":"<owner_auth_uid>"}', true);
SELECT count(*) = 0 AS b1_pass FROM public.staff;

-- B2: Missing staff_id claim (role present, staff_id absent) -- auth_staff_id()
-- must be NULL; a cashier-role query with no staff_id sees zero of their
-- "own" sales (since staff_id = NULL never matches via `=`).
SELECT set_config('request.jwt.claims', '{"sub":"<owner_auth_uid>","active_role":"cashier"}', true);
SELECT count(*) = 0 AS b2_pass FROM public.sales;

-- B3: Null/malformed permissions JSON on the claimed staff row -- can()
-- must return false, not error. Requires a staff row with
-- permissions = 'not valid json' or similar pre-seeded for this case, OR
-- run directly against can()'s own logic:
SELECT set_config('request.jwt.claims',
  '{"sub":"<owner_auth_uid>","active_role":"manager","staff_id":"<manager_with_malformed_permissions_staff_id>"}', true);
SELECT public.can('can_view_reports') = false AS b3_pass;

-- B4: Archived/deactivated staff (is_active = false) attempting a write --
-- auth_permissions() excludes inactive staff by its own WHERE clause, so
-- can() must deny even if the flag was true before deactivation.
SELECT set_config('request.jwt.claims',
  '{"sub":"<owner_auth_uid>","active_role":"manager","staff_id":"<deactivated_manager_staff_id>"}', true);
SELECT public.can('can_manage_products') = false AS b4_pass;

-- B5: Manager with ALL permission flags explicitly false -- every
-- permission-gated write must be denied, role floor alone is not enough.
SELECT set_config('request.jwt.claims',
  '{"sub":"<owner_auth_uid>","active_role":"manager","staff_id":"<manager_all_flags_false_staff_id>"}', true);
SELECT public.can('can_manage_products') = false AS b5_pass;

-- B6: Wrong shop_id -- cross-tenant regression guard. Use a staff_id that
-- belongs to a DIFFERENT shop than the one auth_shop_id() resolves to via
-- the owner_user_id mapping for <owner_auth_uid>.
SELECT set_config('request.jwt.claims',
  '{"sub":"<owner_auth_uid>","active_role":"owner","staff_id":"<other_shop_staff_id>"}', true);
SELECT count(*) = 0 AS b6_pass FROM public.staff WHERE id = '<other_shop_staff_id>'::uuid;

-- ============================================================
-- SECTION C: Lifecycle (design spec §11)
-- ============================================================

-- C1: Manager loses can_view_reports mid-session -- flip the flag directly
-- in staff.permissions, then re-run the SAME claims (simulating the same
-- still-valid JWT) -- auth_permissions() re-reads the LIVE staff row on
-- every call (it is not itself cached in the JWT), so access must be lost
-- immediately, without waiting for a JWT refresh.
-- Run once with the flag true, note the result, then:
--   UPDATE public.staff SET permissions = jsonb_set(permissions::jsonb, '{can_view_reports}', 'false')::text
--   WHERE id = '<manager_staff_id>';
-- then re-run:
SELECT set_config('request.jwt.claims',
  '{"sub":"<owner_auth_uid>","active_role":"manager","staff_id":"<manager_staff_id>"}', true);
SELECT public.can('can_view_reports') = false AS c1_pass;

-- C2: Device reassigned to a different shop -- staff_id from the OLD shop
-- must not resolve any rows once auth_shop_id() (tied to <owner_auth_uid>)
-- points at the NEW shop. This is exercised the same way as B6 -- a
-- staff_id from shop A queried while auth_shop_id() resolves to shop B
-- must return zero rows, confirming the tenant boundary is independent of
-- which role/staff_id claims are attached.
SELECT set_config('request.jwt.claims',
  '{"sub":"<owner_auth_uid>","active_role":"owner","staff_id":"<staff_id_from_a_different_shop>"}', true);
SELECT count(*) = 0 AS c2_pass FROM public.staff WHERE id = '<staff_id_from_a_different_shop>'::uuid;

-- ============================================================
-- SECTION D: Manual penetration test (design spec §11, DoD line item)
-- ============================================================
-- Not a SQL block -- run this against your Supabase project's REST endpoint
-- directly (curl/Postman), using a cashier's real JWT (extract it from the
-- browser devtools of a cashier-unlocked session):
--
--   curl -H "apikey: <anon_key>" -H "Authorization: Bearer <cashier_jwt>" \
--     "https://<project>.supabase.co/rest/v1/staff?select=*"
--
-- Expected: empty array `[]`, HTTP 200 (RLS denies rows, does not error).
--
--   curl -H "apikey: <anon_key>" -H "Authorization: Bearer <cashier_jwt>" \
--     "https://<project>.supabase.co/rest/v1/audit_log?select=*"
--
-- Expected: empty array `[]`.

-- ============================================================
-- After running: confirm every *_pass column above returned `true`, and
-- both Section D curl commands returned `[]`. Any `false`, non-empty
-- array, or error means role enforcement is broken and must be fixed
-- before this branch merges.
-- ============================================================
