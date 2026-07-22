# WAFI-122 Role Enforcement pgTAP Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the 13 automatable assertions in `verify_wafi122_role_enforcement.sql` (Sections A–C) into an automated pgTAP regression suite, closing one of WAFI-001's four listed open DoD items.

**Architecture:** A single new pgTAP file, `supabase/tests/wafi122_role_enforcement.test.sql`, following the exact fixture/assertion conventions already established by `supabase/tests/wafi202_sales_immutability.test.sql` — two-tenant SQL fixtures seeded as `postgres` (bypassing RLS), then per-case `set_config('request.jwt.claims', ...)` + `SET LOCAL ROLE authenticated` to simulate each JWT/role combination, asserted with pgTAP's `ok()`/`is()`/`lives_ok()`.

**Tech Stack:** PostgreSQL + pgTAP (via `npx supabase test db`), Supabase local dev stack (Docker).

## Global Constraints

- Section D (the live REST `curl` pentest) is explicitly out of scope — it has no local-Postgres equivalent and stays manual.
- No changes to RLS policies, helper functions, or migrations — this is a test-only addition. If a case reveals a real bug, stop and report it rather than silently patching the policy inside this "just add tests" ticket.
- `auth_shop_id()` resolves from `shops.owner_user_id = auth.uid()` — i.e. from the JWT's `sub` claim, NOT from `staff_id`. Every fixture's `set_config` claims must set `sub` to the correct shop owner's `auth.users.id` for that case, exactly like `wafi202_sales_immutability.test.sql` does, regardless of which role/staff_id is being tested.
- `staff.permissions` is a `TEXT` column (migration `032_staff_permissions_text.sql`) storing JSON text — insert the malformed-permissions fixture row as a plain non-JSON string, no cast needed at insert time (the cast happens inside `auth_permissions()`, guarded by `can()`'s exception handler).
- `staff.role` CHECK constraint allows `'owner'`, `'cashier'`, `'manager'` (migration `020_staff_role_manager.sql`).
- If no local Docker/Postgres environment is available when this plan is executed (`docker info` fails), each test case's expected outcome must instead be manually traced against the actual policy/function definitions in `supabase/migrations/`, and this must be recorded in the commit/report exactly as WAFI-202's suite already documents for the same gap — do not claim real execution proof that didn't happen.

---

## Task 1: pgTAP suite — fixtures + Section A (role-based access)

**Files:**
- Create: `supabase/tests/wafi122_role_enforcement.test.sql`

**Interfaces:**
- Produces: the file itself, opened with `BEGIN; SELECT plan(13);` (final count across all tasks) and fixtures reused by Tasks 2 and 3 (Shop A: owner `a0000000-0000-0000-0000-000000000002`/shop `a0000000-0000-0000-0000-000000000001`/manager `...0004`/cashier-1 `...0005`/cashier-2 `...0006`/device `...0007`/product `...0008`/shift `...0009`; Shop B: owner `b0000000-0000-0000-0000-000000000002`/shop `b0000000-0000-0000-0000-000000000001`/cashier `b0000000-0000-0000-0000-000000000003`).

This task is not TDD in the usual sense (the deliverable IS a test suite, there is no separate production code to drive) — instead each step is "write N assertions, then verify their expected result is correct" per the Global Constraints' Docker fallback rule.

- [ ] **Step 1: Create the file with its header, fixtures, and Section A's 5 assertions**

Write `supabase/tests/wafi122_role_enforcement.test.sql`:

```sql
-- supabase/tests/wafi122_role_enforcement.test.sql
-- WAFI-122: automated pgTAP coverage for Sections A-C of
-- supabase/migrations/verification/verify_wafi122_role_enforcement.sql
-- (role-based access, negative/edge cases, lifecycle). Section D of that
-- manual script (a live REST curl pentest) has no local-Postgres
-- equivalent and stays manual -- not covered here.
-- Run via: npx supabase test db

BEGIN;
SELECT plan(13);

-- ============================================================
-- Fixtures (seeded as postgres, bypassing RLS)
-- ============================================================

-- Shop A: owner, manager, two cashiers, one device, one product, one shift,
-- two sales (one per cashier -- needed for A4/A5 to prove "sees only their
-- own" vs "sees everyone's" against genuinely different owners).
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000002', 'owner-a@wafi122.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');

INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('a0000000-0000-0000-0000-000000000001', 'WAFI-122 Test Shop A', 'a0000000-0000-0000-0000-000000000002');

INSERT INTO public.staff (id, shop_id, name, pin_hash, role, permissions, is_active) VALUES
  ('a0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'Owner A',    'x', 'owner',   '{}', true),
  ('a0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'Manager A',  'x', 'manager', '{"can_view_reports":true,"can_manage_products":true}', true),
  ('a0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'Cashier A1', 'x', 'cashier', '{}', true),
  ('a0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'Cashier A2', 'x', 'cashier', '{}', true);

INSERT INTO public.devices (id, shop_id, device_code)
VALUES ('a0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000001', 'A');

INSERT INTO public.products (id, shop_id, name_ar, price_usd)
VALUES ('a0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000001', 'منتج اختبار', 10.00);

INSERT INTO public.cashier_shifts (id, shop_id, device_id, staff_id, opened_at, opening_cash_usd, status)
VALUES ('a0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000005', now(), 0, 'open');

-- Sale by cashier-1
INSERT INTO public.sales (id, shop_id, device_id, device_sequence, display_sale_number, created_at, total_usd, total_syp, exchange_rate_at_sale, payment_method, staff_id, shift_id)
VALUES ('a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000007', 1, 'A-0001', now(), 10.00, 150000, 15000, 'cash_usd', 'a0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000009');

-- Sale by cashier-2 (different owner, same shop -- proves A4/A5 need real ownership diversity)
INSERT INTO public.sales (id, shop_id, device_id, device_sequence, display_sale_number, created_at, total_usd, total_syp, exchange_rate_at_sale, payment_method, staff_id, shift_id)
VALUES ('a0000000-0000-0000-0000-00000000000c', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000007', 2, 'A-0002', now(), 20.00, 300000, 15000, 'cash_usd', 'a0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000009');

-- Shop A edge-case staff rows (used by Section B, seeded here alongside the
-- rest of Shop A's fixtures so Task 1's fixture block is the single source):
-- malformed (non-JSON) permissions; deactivated manager; manager with every
-- flag explicitly false.
INSERT INTO public.staff (id, shop_id, name, pin_hash, role, permissions, is_active) VALUES
  ('a0000000-0000-0000-0000-00000000000d', 'a0000000-0000-0000-0000-000000000001', 'Manager Malformed', 'x', 'manager', 'not valid json', true),
  ('a0000000-0000-0000-0000-00000000000e', 'a0000000-0000-0000-0000-000000000001', 'Manager Deactivated', 'x', 'manager', '{"can_manage_products":true}', false),
  ('a0000000-0000-0000-0000-00000000000f', 'a0000000-0000-0000-0000-000000000001', 'Manager AllFalse', 'x', 'manager', '{"can_manage_products":false,"can_view_reports":false}', true);

-- Shop B: separate tenant, one cashier, for cross-tenant checks (Section B6/C2).
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000002', 'owner-b@wafi122.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');

INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('b0000000-0000-0000-0000-000000000001', 'WAFI-122 Test Shop B', 'b0000000-0000-0000-0000-000000000002');

INSERT INTO public.staff (id, shop_id, name, pin_hash, role, is_active)
VALUES ('b0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'Cashier B1', 'x', 'cashier', true);

-- ============================================================
-- Section A: role-based access (happy path)
-- ============================================================

-- A1: Cashier cannot SELECT staff.
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"cashier","staff_id":"a0000000-0000-0000-0000-000000000005"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*) FROM public.staff)::int, 0,
  'A1: cashier cannot SELECT staff'
);
RESET ROLE;

-- A2: Owner CAN SELECT staff.
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"owner","staff_id":"a0000000-0000-0000-0000-000000000003"}', true);
SET LOCAL ROLE authenticated;
SELECT cmp_ok(
  (SELECT count(*) FROM public.staff)::int, '>', 0,
  'A2: owner CAN SELECT staff'
);
RESET ROLE;

-- A3: Cashier cannot SELECT audit_log.
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"cashier","staff_id":"a0000000-0000-0000-0000-000000000005"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*) FROM public.audit_log)::int, 0,
  'A3: cashier cannot SELECT audit_log'
);
RESET ROLE;

-- A4: Cashier-1 sees only their OWN sales, not cashier-2's.
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"cashier","staff_id":"a0000000-0000-0000-0000-000000000005"}', true);
SET LOCAL ROLE authenticated;
SELECT ok(
  (SELECT bool_and(staff_id = 'a0000000-0000-0000-0000-000000000005'::uuid) FROM public.sales),
  'A4: cashier-1 sees only their own sales'
);
RESET ROLE;

-- A5: Manager sees ALL sales, including cashier-2's (a different staff member's).
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"manager","staff_id":"a0000000-0000-0000-0000-000000000004"}', true);
SET LOCAL ROLE authenticated;
SELECT ok(
  (SELECT count(*) FROM public.sales WHERE staff_id = 'a0000000-0000-0000-0000-000000000006'::uuid) > 0,
  'A5: manager sees cashier-2''s sale (not just their own role''s)'
);
RESET ROLE;

-- (Sections B and C continue below, added by later tasks. Do not COMMIT/
-- ROLLBACK or call finish() until the final task adds them.)
```

- [ ] **Step 2: Verify the 5 assertions' expected outcomes against the actual policies**

Check whether a local Supabase/Docker stack is available:

Run: `docker info`

- If it succeeds (Docker daemon running): run `npx supabase start` (first time only — this pulls images and can take several minutes), then `npx supabase test db`. Expected: pgTAP reports `1..13` planned but only 5 `ok` lines exist so far (the rest of the file isn't written yet) — this step's job is just to confirm A1–A5 each say `ok`, not to get a clean full-suite run yet (that happens after Task 3). Record the exact command and output in your task report.
- If `docker info` fails (no Docker daemon): manually trace each of A1–A5 against the real policy definitions instead of running the suite. Read `supabase/migrations/055_identity_domain_rls.sql` for the `staff`/`audit_log` SELECT policies referenced by A1/A2/A3, and `supabase/migrations/056_sales_domain_rls.sql` for the `sales` SELECT policy referenced by A4/A5. For each assertion, write in your report which policy clause makes it pass (e.g. "A1 passes because `staff_select_owner_or_manager`'s `USING` clause requires `auth_role() IN ('owner','manager')`, and this JWT's `active_role` is `cashier`"). Explicitly state in your report that this is a manual trace, not an executed run, matching the same caveat already recorded for `wafi202_sales_immutability.test.sql`.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/wafi122_role_enforcement.test.sql
git commit -m "test(wafi-122): add pgTAP suite fixtures + Section A (role access)"
```

---

## Task 2: pgTAP suite — Section B (negative/edge cases)

**Files:**
- Modify: `supabase/tests/wafi122_role_enforcement.test.sql`

**Interfaces:**
- Consumes: the fixtures created in Task 1 (Shop A's edge-case staff rows `...000d`/`...000e`/`...000f`, Shop B's cashier `b0000000-0000-0000-0000-000000000003`).

- [ ] **Step 1: Insert Section B's 6 assertions**

In `supabase/tests/wafi122_role_enforcement.test.sql`, replace the placeholder comment line `-- (Sections B and C continue below, added by later tasks. Do not COMMIT/` and the line after it with:

```sql
-- ============================================================
-- Section B: negative / edge cases (design spec Sections A-C mapping)
-- ============================================================

-- B1: Missing active_role claim entirely -- auth_role() must default to
-- 'cashier' (fail closed), so staff SELECT must still be blocked.
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*) FROM public.staff)::int, 0,
  'B1: missing active_role claim fails closed to cashier-level denial on staff'
);
RESET ROLE;

-- B2: Missing staff_id claim (role present, staff_id absent) -- auth_staff_id()
-- must be NULL; a cashier-role query with no staff_id sees zero of their
-- "own" sales (staff_id = NULL never matches via `=`).
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"cashier"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*) FROM public.sales)::int, 0,
  'B2: missing staff_id claim sees zero "own" sales'
);
RESET ROLE;

-- B3: Malformed (non-JSON) permissions on the claimed staff row -- can()
-- must return false, not error.
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"manager","staff_id":"a0000000-0000-0000-0000-00000000000d"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  public.can('can_view_reports'), false,
  'B3: malformed permissions JSON -> can() is false, not an error'
);
RESET ROLE;

-- B4: Deactivated staff (is_active = false) -- auth_permissions() excludes
-- inactive staff by its own WHERE clause, so can() must deny even though the
-- flag itself is true on the row.
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"manager","staff_id":"a0000000-0000-0000-0000-00000000000e"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  public.can('can_manage_products'), false,
  'B4: deactivated staff -> can() denies despite a true flag on the row'
);
RESET ROLE;

-- B5: Manager with ALL permission flags explicitly false -- role floor alone
-- (manager) is not enough; every permission-gated check must deny.
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"manager","staff_id":"a0000000-0000-0000-0000-00000000000f"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  public.can('can_manage_products'), false,
  'B5: manager with all flags false -> can() denies'
);
RESET ROLE;

-- B6: Cross-tenant regression guard. Shop B's staff_id queried while the
-- JWT's sub resolves auth_shop_id() to Shop A (via the owner mapping) --
-- must return zero rows regardless of role/staff_id claims.
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"owner","staff_id":"a0000000-0000-0000-0000-000000000003"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*) FROM public.staff WHERE id = 'b0000000-0000-0000-0000-000000000003'::uuid)::int, 0,
  'B6: Shop B staff_id invisible under Shop A''s resolved tenant'
);
RESET ROLE;

-- (Section C continues below, added by the final task. Do not COMMIT/
-- ROLLBACK or call finish() until then.)
```

- [ ] **Step 2: Verify the 6 assertions' expected outcomes**

Same Docker-availability check as Task 1 Step 2:

- If Docker is available: run `npx supabase test db` again. Expected: A1–A5 and B1–B6 all report `ok` (11 of the eventual 13 — C1/C2 aren't written yet).
- If not: manually trace each against `supabase/migrations/054_auth_role_helpers.sql` (`auth_role()`, `auth_staff_id()`, `auth_permissions()`, `can()` — covers B1–B5) and `supabase/migrations/015_rls_tenant_scoping.sql` (`auth_shop_id()` — covers B6). Record the trace in your report, same caveat as Task 1.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/wafi122_role_enforcement.test.sql
git commit -m "test(wafi-122): add pgTAP suite Section B (negative/edge cases)"
```

---

## Task 3: pgTAP suite — Section C (lifecycle) + housekeeping doc updates

**Files:**
- Modify: `supabase/tests/wafi122_role_enforcement.test.sql`
- Modify: `supabase/migrations/verification/verify_wafi122_role_enforcement.sql`
- Modify: `WAFI_Production_Readiness_Plan_v3.md`

**Interfaces:**
- Consumes: the fixtures and structure from Tasks 1–2; this task closes the file (`SELECT finish(); ROLLBACK;`) and brings the suite to its final `plan(13)` count.

- [ ] **Step 1: Insert Section C's 2 assertions and close the file**

In `supabase/tests/wafi122_role_enforcement.test.sql`, replace the placeholder comment line `-- (Section C continues below, added by the final task. Do not COMMIT/` and the line after it with:

```sql
-- ============================================================
-- Section C: lifecycle
-- ============================================================

-- C1: Manager loses can_view_reports mid-session -- flip the flag directly
-- (simulating a still-valid JWT with a live permissions change), re-run the
-- SAME claims -- auth_permissions() re-reads the LIVE staff row on every
-- call (not cached in the JWT), so access must be lost immediately.
UPDATE public.staff SET permissions = '{"can_view_reports":false,"can_manage_products":true}'
WHERE id = 'a0000000-0000-0000-0000-000000000004';

SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"manager","staff_id":"a0000000-0000-0000-0000-000000000004"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  public.can('can_view_reports'), false,
  'C1: permission loss takes effect immediately, no JWT refresh needed'
);
RESET ROLE;

-- C2: Device reassigned to a different shop -- staff_id from the OLD shop
-- must not resolve once auth_shop_id() points at the NEW shop. Same
-- underlying mechanism as B6 (tenant boundary is claims-independent),
-- framed per the manual script's own C2 case for 1:1 traceability.
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"owner","staff_id":"a0000000-0000-0000-0000-000000000003"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*) FROM public.staff WHERE id = 'b0000000-0000-0000-0000-000000000003'::uuid)::int, 0,
  'C2: staff_id from a shop no longer resolved by auth_shop_id() is invisible'
);
RESET ROLE;

SELECT finish();
ROLLBACK;
```

- [ ] **Step 2: Verify all 13 assertions, then run the full file once end-to-end**

Same Docker-availability check:

- If Docker is available: run `npx supabase test db`. Expected: `1..13`, all 13 lines `ok`, `# Looks like you passed all 13 tests`. This is the first genuine full-suite execution — paste the actual output into your report.
- If not: manually trace C1/C2 the same way as prior steps (C1 against `auth_permissions()`'s live re-read behavior in `054_auth_role_helpers.sql`; C2 is the same trace as B6). Record all 13 cases' trace results together in your report as the final summary, explicitly stating no real execution occurred and a human with Docker should run `npx supabase test db` before relying on this as executed proof — matching the exact caveat already recorded for `wafi202_sales_immutability.test.sql`.

- [ ] **Step 3: Update `verify_wafi122_role_enforcement.sql`'s header**

Read the current header (lines 1–21) — it already has a paragraph describing WAFI-202's pgTAP suite as the primary verification method for the five sales tables. Add a parallel paragraph immediately after that existing paragraph (before the "Manual verification for WAFI-122's full role-enforcement scope..." paragraph):

```sql
--
-- WAFI-122 note: Sections A, B, and C below (role-based access, negative/
-- edge cases, lifecycle -- 13 assertions) now also have an automated pgTAP
-- regression suite -- supabase/tests/wafi122_role_enforcement.test.sql, run
-- via `npx supabase test db`. That suite is the primary verification method
-- for those 13 cases going forward. Section D (the live REST curl pentest
-- below) has no local-Postgres equivalent and remains the only way to
-- verify that specific check -- it stays manual. This whole script remains
-- useful as an additional pre-deploy sanity check against a real Supabase
-- project (local pgTAP tests can't catch environment-specific drift, e.g.
-- a hand-applied policy change that never made it into a migration file).
```

- [ ] **Step 4: Update `WAFI_Production_Readiness_Plan_v3.md`'s WAFI-001 row**

Find the sentence in the WAFI-001 row (Macro-Phase 1 table) that reads:

```
Also open: (2) no automated DB-level role×table test suite, only a manual SQL script (`supabase/migrations/verification/verify_wafi122_role_enforcement.sql`); (3) live exploit test above stands in for a full pentest but a formal one is still not performed; (4) no final security sign-off document.
```

Replace it with:

```
Also open: (2) **RESOLVED** — automated pgTAP suite added for Sections A-C (role access, edge cases, lifecycle) at `supabase/tests/wafi122_role_enforcement.test.sql`; the manual script's Section D (live REST pentest) remains manual by nature and is covered by item (3). Still open: (3) live exploit test above stands in for a full pentest but a formal one is still not performed; (4) no final security sign-off document.
```

- [ ] **Step 5: Commit**

```bash
git add supabase/tests/wafi122_role_enforcement.test.sql supabase/migrations/verification/verify_wafi122_role_enforcement.sql WAFI_Production_Readiness_Plan_v3.md
git commit -m "test(wafi-122): complete pgTAP suite Section C, update DoD status docs"
```
