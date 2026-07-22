# WAFI-202 Sales/Returns Immutability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close WAFI-202 by making `sales`, `sale_line_items`, `sale_payments`, `returns`, `return_line_items` append-only under RLS (no UPDATE/DELETE for `anon`/`authenticated`, strict staff-attribution on INSERT), backed by an automated pgTAP regression suite proving the invariant.

**Architecture:** A single new RLS migration replaces the migration-015-inherited shop-scoped-only INSERT/UPDATE/DELETE policies on the five affected tables with attribution-aware INSERT policies and no UPDATE/DELETE policies at all (Postgres RLS defaults to deny when no policy exists for a command). A new pgTAP test file exercises the full matrix against a local Supabase stack.

**Tech Stack:** PostgreSQL RLS policies, pgTAP (via Supabase CLI's `supabase test db`), Supabase CLI 2.x, Docker (for the local Supabase stack).

## Global Constraints

- Expand-contract migrations only — no destructive drops of columns/tables (per `CLAUDE.md`). This plan only replaces policy definitions, never touches data or schema shape.
- `staff_id = auth_staff_id()` is strict — **no owner/manager exception** on INSERT for `sales` or `returns` (design decision, see spec's "no owner/manager exception" rationale). The only path to record a write under a different staff member's identity is `switch_active_operator()`.
- **This migration must NOT be applied to the hosted production Supabase project (`eazyrdnvsiyaaccvjbhb`) as part of this plan.** Per the spec's "Blocking Prerequisite" section, WAFI-203 (operator-identity drift fix) must land first. This plan builds and merges the migration + tests to `main`; a separate, later action applies it to production once WAFI-203 ships.
- `postgres`/`service_role` continue to bypass RLS entirely, unaffected by this change — do not add any policy that scopes those roles.

---

## File Structure

- **Create:** `supabase/migrations/064_wafi202_sales_immutability.sql` — the RLS policy migration.
- **Create:** `supabase/tests/wafi202_sales_immutability.test.sql` — pgTAP regression suite (13 assertions from the spec's test matrix).
- **Modify:** `supabase/migrations/verification/verify_wafi122_role_enforcement.sql` — header comment update only, pointing at the new automated suite.
- **Modify:** `docs/superpowers/specs/2026-07-22-wafi-202-sales-immutability-design.md` — no content change needed; referenced for context only.
- **Modify:** `WAFI_Production_Readiness_Plan_v3.md` — mark WAFI-202's migration+tests as landed (still gated on WAFI-203 for production).

---

### Task 1: Bring up a local Supabase dev stack and confirm existing migrations replay cleanly

**Files:**
- Create: `supabase/config.toml` (via `supabase init`)
- No test file for this task — it's an environment-verification task with a pass/fail check, not a code change.

**Interfaces:**
- Produces: a running local Supabase stack (Postgres + pgTAP extension available) that Task 2 and Task 4 depend on.

This project has never run `supabase init`/`supabase start` locally before (there's no `supabase/config.toml` in the repo today — everything so far has been applied by hand against the hosted project via the SQL editor). Confirming the full migration history replays cleanly on a fresh local instance is a prerequisite for writing pgTAP tests against it.

- [ ] **Step 1: Initialize the Supabase CLI project config**

Run: `cd "C:/Users/AnasBaajBlue10/testing/Wafi" && npx supabase init`

If prompted interactively (e.g., "Generate VS Code settings?"), answer `N` to all prompts — this repo doesn't need CLI-generated editor config.

Expected: creates `supabase/config.toml` (and possibly `supabase/.gitignore`, `supabase/functions/`). Does **not** touch `supabase/migrations/` or `supabase/seed.sql` — verify with `git status` that only new files appear, nothing existing is modified.

- [ ] **Step 2: Start the local stack**

Run: `npx supabase start`

Expected: Docker containers pull/start (first run takes a few minutes), ending with a printed block showing `API URL`, `DB URL`, `Studio URL`, `anon key`, `service_role key`. Keep this output — you'll need the `DB URL` for later steps if you want to inspect the local DB directly with `psql`.

If this fails with a Docker error, confirm Docker Desktop is running (`docker ps` should succeed, not error) before retrying.

- [ ] **Step 3: Confirm all existing migrations replayed without error**

Run: `npx supabase db reset`

This drops and recreates the local database, replaying every file in `supabase/migrations/` in order, then running `supabase/seed.sql`.

Expected: output ends with `Finished supabase db reset on branch main.` (or equivalent success message) and no `ERROR:` lines. If a migration fails, the command exits non-zero and prints which file/statement failed — stop and report the exact error rather than guessing a fix, since a failure here means the local stack can't be used for pgTAP testing until resolved (this would be a pre-existing repo issue unrelated to WAFI-202, not something to silently patch as part of this task).

- [ ] **Step 4: Confirm pgTAP is available**

Run: `npx supabase db psql -c "CREATE EXTENSION IF NOT EXISTS pgtap;"` (if `supabase db psql` isn't available in your CLI version, use `psql "$(npx supabase status -o json | node -e "process.stdin.once('data',d=>console.log(JSON.parse(d).DB_URL))")" -c "CREATE EXTENSION IF NOT EXISTS pgtap;"` instead, substituting the actual `DB URL` printed in Step 2 if the one-liner doesn't resolve cleanly on your shell)

Expected: `CREATE EXTENSION` (or no output if it already existed) — no error. Supabase's local Postgres image ships pgTAP by default, so this should just confirm it, not install anything new.

- [ ] **Step 5: Confirm the `devices` table's actual live column shape**

Run: `npx supabase db psql -c "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='devices' ORDER BY ordinal_position;"`

Expected: a column list including `device_code` (this is what `supabase/seed.sql:9` already inserts into — `INSERT INTO devices (id, shop_id, device_code) VALUES ...` — confirming this is the live shape a fresh migration replay produces; migration `037_devices.sql`'s `code`/`is_temporary` columns are a pre-existing, unrelated schema-drift issue in this repo and are out of scope here). Task 2's fixtures use `device_code`, matching this.

- [ ] **Step 6: Commit the new config**

```bash
git add supabase/config.toml supabase/.gitignore
git commit -m "chore: initialize local Supabase CLI stack for pgTAP testing

Enables running the automated RLS regression suite (WAFI-202) via
'supabase test db' against a local instance, rather than only the
manual SQL-editor verification script this repo has relied on so far.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

(If `supabase init` created additional files like `supabase/functions/.gitkeep`, include those too — check `git status` first.)

---

### Task 2: Write the failing pgTAP regression suite (red)

**Files:**
- Create: `supabase/tests/wafi202_sales_immutability.test.sql`

**Interfaces:**
- Consumes: the local Supabase stack from Task 1; `public.auth_shop_id()`, `public.auth_role()`, `public.auth_staff_id()` (defined in `054_auth_role_helpers.sql`, already applied by Task 1's migration replay).
- Produces: a pgTAP test file with 13 assertions, run via `supabase test db`. This task deliberately runs it *before* Task 3's migration exists, to prove the "Denied" assertions currently fail (the vulnerability is real) before the fix makes them pass.

This test file is self-contained: it seeds its own fixture data (two shops, staff across owner/manager/cashier roles, a sale, a return) directly as `postgres` (bypassing RLS), then simulates each persona via `set_config('request.jwt.claims', ..., true)` + `SET LOCAL ROLE authenticated` — the exact pattern validated by hand against the hosted project during this investigation. The whole file runs in one transaction that never commits (`BEGIN`/`ROLLBACK`), so nothing it does persists.

- [ ] **Step 1: Write the test file**

```sql
-- supabase/tests/wafi202_sales_immutability.test.sql
-- WAFI-202: proves sales/sale_line_items/sale_payments/returns/
-- return_line_items are append-only with strict staff attribution.
-- Run via: npx supabase test db

BEGIN;
SELECT plan(13);

-- ============================================================
-- Fixtures (seeded as postgres, bypassing RLS)
-- ============================================================

-- Shop A: owner, manager, two cashiers, one device, one product
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000002', 'owner-a@wafi202.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');

INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('a0000000-0000-0000-0000-000000000001', 'WAFI-202 Test Shop A', 'a0000000-0000-0000-0000-000000000002');

INSERT INTO public.staff (id, shop_id, name, pin_hash, role, is_active) VALUES
  ('a0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'Owner A',    'x', 'owner',   true),
  ('a0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'Manager A',  'x', 'manager', true),
  ('a0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'Cashier A1', 'x', 'cashier', true),
  ('a0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'Cashier A2', 'x', 'cashier', true);

INSERT INTO public.devices (id, shop_id, device_code)
VALUES ('a0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000001', 'A');

INSERT INTO public.products (id, shop_id, name_ar, price_usd)
VALUES ('a0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000001', 'منتج اختبار', 10.00);

INSERT INTO public.cashier_shifts (id, shop_id, device_id, staff_id, opened_at, opening_cash_usd, status)
VALUES ('a0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000005', now(), 0, 'open');

INSERT INTO public.sales (id, shop_id, device_id, device_sequence, display_sale_number, created_at, total_usd, total_syp, exchange_rate_at_sale, payment_method, staff_id, shift_id)
VALUES ('a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000007', 1, 'A-0001', now(), 10.00, 150000, 15000, 'cash_usd', 'a0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000009');

INSERT INTO public.returns (id, shop_id, original_sale_id, refund_method, refund_amount_usd, refund_amount_syp, shift_id)
VALUES ('a0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'cash_usd', 5.00, 75000, 'a0000000-0000-0000-0000-000000000009');

-- Shop B: separate tenant, one cashier, one device (cross-tenant regression)
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000002', 'owner-b@wafi202.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');

INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('b0000000-0000-0000-0000-000000000001', 'WAFI-202 Test Shop B', 'b0000000-0000-0000-0000-000000000002');

INSERT INTO public.staff (id, shop_id, name, pin_hash, role, is_active)
VALUES ('b0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'Cashier B1', 'x', 'cashier', true);

INSERT INTO public.devices (id, shop_id, device_code)
VALUES ('b0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000001', 'A');

-- Helper: executes dynamic SQL under whatever role/claims are currently
-- set, returns the affected row count. SECURITY INVOKER (the default) so
-- RLS applies as the calling session, not this function's owner.
CREATE OR REPLACE FUNCTION wafi202_row_count(p_sql text) RETURNS int
LANGUAGE plpgsql AS $test$
DECLARE
  cnt int;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RETURN cnt;
END;
$test$;

-- ============================================================
-- Test 1: Cashier inserts own sale -- Allowed
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"cashier","staff_id":"a0000000-0000-0000-0000-000000000005"}',
  true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$INSERT INTO public.sales (id, shop_id, device_id, device_sequence, display_sale_number, created_at, total_usd, total_syp, exchange_rate_at_sale, payment_method, staff_id, shift_id)
    VALUES ('a0000000-0000-0000-0000-00000000001a', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000007', 2, 'A-0002', now(), 10.00, 150000, 15000, 'cash_usd', 'a0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000009')$$,
  'Test 1: cashier inserts own sale -- allowed'
);

RESET ROLE;

-- ============================================================
-- Test 2: Cashier inserts sale with another staff_id -- Denied
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"cashier","staff_id":"a0000000-0000-0000-0000-000000000005"}',
  true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO public.sales (id, shop_id, device_id, device_sequence, display_sale_number, created_at, total_usd, total_syp, exchange_rate_at_sale, payment_method, staff_id, shift_id)
    VALUES ('a0000000-0000-0000-0000-00000000002a', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000007', 3, 'A-0003', now(), 10.00, 150000, 15000, 'cash_usd', 'a0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000009')$$,
  '42501',
  'Test 2: cashier inserts sale attributed to another cashier -- denied'
);

RESET ROLE;

-- ============================================================
-- Test 3: Manager inserts sale attributed to a cashier without
-- switching operators first -- Denied (no INSERT-level exception exists)
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"manager","staff_id":"a0000000-0000-0000-0000-000000000004"}',
  true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO public.sales (id, shop_id, device_id, device_sequence, display_sale_number, created_at, total_usd, total_syp, exchange_rate_at_sale, payment_method, staff_id, shift_id)
    VALUES ('a0000000-0000-0000-0000-00000000003a', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000007', 4, 'A-0004', now(), 10.00, 150000, 15000, 'cash_usd', 'a0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000009')$$,
  '42501',
  'Test 3: manager inserts sale attributed to a cashier without switching operators -- denied'
);

RESET ROLE;

-- ============================================================
-- Test 4: A session that has already switched operator to Cashier A1
-- (JWT staff_id/active_role reflect the switched-to operator, exactly as
-- production would look after a real switch_active_operator() call)
-- inserts a sale as that operator -- Allowed
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"cashier","staff_id":"a0000000-0000-0000-0000-000000000005"}',
  true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$INSERT INTO public.sales (id, shop_id, device_id, device_sequence, display_sale_number, created_at, total_usd, total_syp, exchange_rate_at_sale, payment_method, staff_id, shift_id)
    VALUES ('a0000000-0000-0000-0000-00000000004a', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000007', 5, 'A-0005', now(), 10.00, 150000, 15000, 'cash_usd', 'a0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000009')$$,
  'Test 4: post-operator-switch session inserts sale as the switched-to operator -- allowed'
);

RESET ROLE;

-- ============================================================
-- Test 5: Cashier updates own completed sale -- Denied
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"cashier","staff_id":"a0000000-0000-0000-0000-000000000005"}',
  true);
SET LOCAL ROLE authenticated;

SELECT is(
  wafi202_row_count($$UPDATE public.sales SET total_usd = 1 WHERE id = 'a0000000-0000-0000-0000-00000000000a'$$),
  0,
  'Test 5: cashier updates own completed sale -- denied'
);

RESET ROLE;

-- ============================================================
-- Test 6: Owner updates any sale -- Denied
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"owner","staff_id":"a0000000-0000-0000-0000-000000000003"}',
  true);
SET LOCAL ROLE authenticated;

SELECT is(
  wafi202_row_count($$UPDATE public.sales SET total_usd = 1 WHERE id = 'a0000000-0000-0000-0000-00000000000a'$$),
  0,
  'Test 6: owner updates any sale -- denied'
);

RESET ROLE;

-- ============================================================
-- Test 7: Manager forges staff_id via UPDATE -- Denied
-- (regression test for the exact exploit confirmed live against production)
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"manager","staff_id":"a0000000-0000-0000-0000-000000000004"}',
  true);
SET LOCAL ROLE authenticated;

SELECT is(
  wafi202_row_count($$UPDATE public.sales SET staff_id = 'a0000000-0000-0000-0000-000000000003' WHERE id = 'a0000000-0000-0000-0000-00000000000a'$$),
  0,
  'Test 7: manager forges staff_id via UPDATE -- denied'
);

RESET ROLE;

-- ============================================================
-- Test 8: Cashier deletes sale -- Denied
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"cashier","staff_id":"a0000000-0000-0000-0000-000000000005"}',
  true);
SET LOCAL ROLE authenticated;

SELECT is(
  wafi202_row_count($$DELETE FROM public.sales WHERE id = 'a0000000-0000-0000-0000-00000000000a'$$),
  0,
  'Test 8: cashier deletes sale -- denied'
);

RESET ROLE;

-- ============================================================
-- Test 9: Owner deletes sale -- Denied
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"owner","staff_id":"a0000000-0000-0000-0000-000000000003"}',
  true);
SET LOCAL ROLE authenticated;

SELECT is(
  wafi202_row_count($$DELETE FROM public.sales WHERE id = 'a0000000-0000-0000-0000-00000000000a'$$),
  0,
  'Test 9: owner deletes sale -- denied'
);

RESET ROLE;

-- ============================================================
-- Test 10: Return creation (attributed via shift) -- Allowed
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"cashier","staff_id":"a0000000-0000-0000-0000-000000000005"}',
  true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$INSERT INTO public.returns (id, shop_id, original_sale_id, refund_method, refund_amount_usd, refund_amount_syp, shift_id)
    VALUES ('a0000000-0000-0000-0000-00000000010a', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'cash_usd', 5.00, 75000, 'a0000000-0000-0000-0000-000000000009')$$,
  'Test 10: return creation attributed via shift -- allowed'
);

RESET ROLE;

-- ============================================================
-- Test 11: Return update -- Denied
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"cashier","staff_id":"a0000000-0000-0000-0000-000000000005"}',
  true);
SET LOCAL ROLE authenticated;

SELECT is(
  wafi202_row_count($$UPDATE public.returns SET refund_amount_usd = 1 WHERE id = 'a0000000-0000-0000-0000-00000000000b'$$),
  0,
  'Test 11: return update -- denied'
);

RESET ROLE;

-- ============================================================
-- Test 12: Return delete -- Denied
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"owner","staff_id":"a0000000-0000-0000-0000-000000000003"}',
  true);
SET LOCAL ROLE authenticated;

SELECT is(
  wafi202_row_count($$DELETE FROM public.returns WHERE id = 'a0000000-0000-0000-0000-00000000000b'$$),
  0,
  'Test 12: return delete -- denied'
);

RESET ROLE;

-- ============================================================
-- Test 13: Staff from shop B cannot insert a sale into shop A
-- (cross-tenant regression, since these policies are touched anyway)
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated","active_role":"cashier","staff_id":"b0000000-0000-0000-0000-000000000003"}',
  true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO public.sales (id, shop_id, device_id, device_sequence, display_sale_number, created_at, total_usd, total_syp, exchange_rate_at_sale, payment_method, staff_id, shift_id)
    VALUES ('a0000000-0000-0000-0000-00000000013a', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000007', 6, 'A-0006', now(), 10.00, 150000, 15000, 'cash_usd', 'b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000009')$$,
  '42501',
  'Test 13: staff from shop B cannot insert a sale into shop A -- denied'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the suite and confirm the expected tests currently FAIL**

Run: `npx supabase test db`

Expected: pg_prove output showing `13 tests` planned. Tests 5, 6, 7, 8, 9, 11, 12 (the "Denied" UPDATE/DELETE cases) are expected to **FAIL** right now — because migration 064 doesn't exist yet, these tables still have the migration-015 shop-scoped-only UPDATE/DELETE policies, so the attempted writes actually succeed (row count 1, not 0). Tests 2, 3, 13 (the "Denied" INSERT-attribution cases) should also currently **FAIL**, since the existing `sales_insert_all`/`returns_insert_all` policies (migration 015 shape) check only `shop_id`, not attribution — so no exception is thrown where one is expected. Tests 1, 4, 10 (the "Allowed" cases) should already **PASS**, since basic shop-scoped INSERT already works today.

Confirm the failure count and specific failing test numbers match this expectation before proceeding — if a *different* set of tests fails (e.g., an "Allowed" test fails, or a fixture INSERT itself errors), stop and diagnose that first; it likely means a fixture assumption (schema shape, column name) doesn't match what Task 1 found, not a policy issue.

- [ ] **Step 3: Commit the failing test file**

```bash
cd "C:/Users/AnasBaajBlue10/testing/Wafi"
git add supabase/tests/wafi202_sales_immutability.test.sql
git commit -m "test(wafi-202): add failing pgTAP suite for sales/returns immutability

Proves the WAFI-202 gap with automated, re-runnable tests instead of
manual SQL-editor inspection: 10 of 13 assertions currently fail
against the migration-015-inherited shop-scoped-only INSERT/UPDATE/
DELETE policies. Migration 064 (next commit) makes them pass.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Write the RLS migration (green)

**Files:**
- Create: `supabase/migrations/064_wafi202_sales_immutability.sql`

**Interfaces:**
- Consumes: `public.auth_shop_id()`, `public.auth_role()`, `public.auth_staff_id()` (`054_auth_role_helpers.sql`).
- Produces: the policy set Task 2's tests assert against.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/064_wafi202_sales_immutability.sql
-- WAFI-202: sales, sale_line_items, sale_payments, returns, return_line_items
-- become append-only from the client's perspective (no UPDATE/DELETE for
-- anon/authenticated), and INSERT requires strict staff attribution --
-- staff_id = auth_staff_id(), no owner/manager exception.
--
-- Confirmed via live exploit test against production (2026-07-21): a
-- manager-role session could change total_usd on a completed sale and
-- forge staff_id attribution, since these five tables kept migration-015's
-- shop-scoped-only INSERT/UPDATE/DELETE policies (056_sales_domain_rls.sql
-- tightened SELECT only, deferring the rest -- tracked as WAFI-202).
--
-- Financial corrections are represented as new immutable events (returns)
-- rather than modifications of historical records -- confirmed no
-- legitimate client code path ever issues UPDATE on any of these five
-- tables (searched all of src/). sync_status is written once, as part of
-- the initial INSERT.
--
-- No owner/manager INSERT exception: switch_active_operator()
-- (045/048_session_id_active_role.sql) already provides a secure,
-- PIN-verified, audited path to act as another staff member. A second,
-- unauthenticated attribution path here would reopen the exact bypass
-- this migration exists to close.
--
-- These restrictions apply only to anon/authenticated application
-- sessions -- PostgreSQL superusers and service_role continue to bypass
-- RLS entirely, as designed.
--
-- Rollback: restore the original migration-015 INSERT/UPDATE/DELETE
-- policies for these five tables (shop-scoped only, no attribution/
-- immutability check). Policy-only rollback -- no data migration and no
-- schema rollback required.

-- ============================================================
-- sales
-- ============================================================
DROP POLICY IF EXISTS sales_insert_all ON public.sales;
DROP POLICY IF EXISTS sales_update_all ON public.sales;
DROP POLICY IF EXISTS sales_delete_all ON public.sales;

CREATE POLICY sales_insert_own ON public.sales
  FOR INSERT TO authenticated, anon
  WITH CHECK (
    shop_id = (SELECT public.auth_shop_id())
    AND staff_id = public.auth_staff_id()
  );
-- No UPDATE/DELETE policy: sales is append-only.

-- ============================================================
-- sale_line_items (attribution via parent sale)
-- ============================================================
DROP POLICY IF EXISTS sale_line_items_insert_all ON public.sale_line_items;
DROP POLICY IF EXISTS sale_line_items_update_all ON public.sale_line_items;
DROP POLICY IF EXISTS sale_line_items_delete_all ON public.sale_line_items;

CREATE POLICY sale_line_items_insert_own ON public.sale_line_items
  FOR INSERT TO authenticated, anon
  WITH CHECK (
    shop_id = (SELECT public.auth_shop_id())
    AND EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.id = sale_line_items.sale_id AND s.staff_id = public.auth_staff_id()
    )
  );
-- No UPDATE/DELETE policy: append-only.

-- ============================================================
-- sale_payments (attribution via parent sale)
-- ============================================================
DROP POLICY IF EXISTS sale_payments_insert_all ON public.sale_payments;
DROP POLICY IF EXISTS sale_payments_update_all ON public.sale_payments;
DROP POLICY IF EXISTS sale_payments_delete_all ON public.sale_payments;

CREATE POLICY sale_payments_insert_own ON public.sale_payments
  FOR INSERT TO authenticated, anon
  WITH CHECK (
    shop_id = (SELECT public.auth_shop_id())
    AND EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.id = sale_payments.sale_id AND s.staff_id = public.auth_staff_id()
    )
  );
-- No UPDATE/DELETE policy: append-only.

-- ============================================================
-- returns (attribution via shift_id -> cashier_shifts.staff_id, since
-- returns has no direct staff_id column -- same join pattern
-- 056_sales_domain_rls.sql already uses for its SELECT policy)
-- ============================================================
DROP POLICY IF EXISTS returns_insert_all ON public.returns;
DROP POLICY IF EXISTS returns_update_all ON public.returns;
DROP POLICY IF EXISTS returns_delete_all ON public.returns;

CREATE POLICY returns_insert_own ON public.returns
  FOR INSERT TO authenticated, anon
  WITH CHECK (
    shop_id = (SELECT public.auth_shop_id())
    AND EXISTS (
      SELECT 1 FROM public.cashier_shifts cs
      WHERE cs.id = returns.shift_id AND cs.staff_id = public.auth_staff_id()
    )
  );
-- No UPDATE/DELETE policy: append-only.

-- ============================================================
-- return_line_items (attribution via parent return)
-- ============================================================
DROP POLICY IF EXISTS return_line_items_insert_all ON public.return_line_items;
DROP POLICY IF EXISTS return_line_items_update_all ON public.return_line_items;
DROP POLICY IF EXISTS return_line_items_delete_all ON public.return_line_items;

CREATE POLICY return_line_items_insert_own ON public.return_line_items
  FOR INSERT TO authenticated, anon
  WITH CHECK (
    shop_id = (SELECT public.auth_shop_id())
    AND EXISTS (
      SELECT 1 FROM public.returns r
      JOIN public.cashier_shifts cs ON cs.id = r.shift_id
      WHERE r.id = return_line_items.return_id AND cs.staff_id = public.auth_staff_id()
    )
  );
-- No UPDATE/DELETE policy: append-only.
```

- [ ] **Step 2: Apply the migration locally and confirm it runs cleanly**

Run: `npx supabase db reset`

Expected: replays all migrations including the new 064, ending in the same success message as Task 1 Step 3, no errors. (`db reset` re-runs everything from scratch each time, which is why Task 2's test file is idempotent/self-contained — it doesn't depend on any prior test run's leftover state.)

- [ ] **Step 3: Run the pgTAP suite and confirm all 13 tests now pass**

Run: `npx supabase test db`

Expected: `13 tests` planned, `13 passed`, `0 failed`. If any test still fails, read pg_prove's diagnostic output for that specific test number — it prints the actual vs. expected value — and check the corresponding policy in `064_wafi202_sales_immutability.sql` against the failing assertion before changing anything else.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/064_wafi202_sales_immutability.sql
git commit -m "fix(wafi-202): make sales/returns append-only with strict attribution

sales, sale_line_items, sale_payments, returns, return_line_items lose
their inherited migration-015 UPDATE/DELETE policies entirely (no
replacement -- RLS defaults to deny) and gain attribution-aware INSERT
WITH CHECK clauses requiring staff_id = auth_staff_id(), no owner/
manager exception. Closes the gap confirmed via live exploit test
against production, where a manager could tamper with completed sales
and forge staff attribution.

All 13 pgTAP assertions in wafi202_sales_immutability.test.sql now pass.

NOT applied to production yet -- gated on WAFI-203 (operator identity
drift fix) per the design spec's blocking prerequisite.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Update the manual verification script and housekeeping docs

**Files:**
- Modify: `supabase/migrations/verification/verify_wafi122_role_enforcement.sql:1-10` (header only)
- Modify: `WAFI_Production_Readiness_Plan_v3.md` (WAFI-202/WAFI-001 rows)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed by later tasks — this is documentation only.

- [ ] **Step 1: Update the manual script's header to point at the automated suite**

Read the current header first:

Run: `head -n 20 "supabase/migrations/verification/verify_wafi122_role_enforcement.sql"`

Then edit lines 1-10 (the existing header comment block) to prepend this note directly above the existing `-- Manual verification for WAFI-122's...` line:

```sql
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
```

- [ ] **Step 2: Update the roadmap doc's WAFI-202 status**

In `WAFI_Production_Readiness_Plan_v3.md`, find the WAFI-001 row (it contains the WAFI-202 discussion) and the new WAFI-203 row added during the design phase. Add this sentence to the end of the WAFI-001 row's existing text, right before the final "**Do not treat as done...**" sentence:

`WAFI-202's migration (064_wafi202_sales_immutability.sql) and 13-case pgTAP suite are merged to main and passing locally as of the date this task runs — not yet applied to production, pending WAFI-203.`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/verification/verify_wafi122_role_enforcement.sql WAFI_Production_Readiness_Plan_v3.md
git commit -m "docs(wafi-202): point manual verification script at automated suite

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Explicit Non-Goal of This Plan

**This plan does not apply `064_wafi202_sales_immutability.sql` to the hosted production Supabase project.** Per the design spec's Blocking Prerequisite section, that must wait until WAFI-203 (operator identity drift fix — needs its own brainstorm/design session, tracked separately) ships and is verified. When that time comes, applying it is a single manual step (paste the migration into the hosted project's SQL editor, or `supabase db push` if the project gets linked via `supabase link`) — not part of this plan's task list.
