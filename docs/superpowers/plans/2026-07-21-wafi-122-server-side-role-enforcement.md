# WAFI-122: Server-Side Role Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the direct-access (curl/Postman JWT-extraction) authorization gap by adding role/permission-aware RLS policies across every domain, backed by a `staff_id` JWT claim and a small set of SQL helper functions.

**Architecture:** Extend the existing `custom_access_token_hook` (migrations 047/048, already tagged WAFI-122) to also stamp a `staff_id` claim from `device_sessions.active_staff_id`. Add `auth_staff_id()`, `auth_role()`, `auth_permissions()`, `can(flag)` SQL helpers. Rewrite per-table RLS policies domain-by-domain (Identity, Sales, Inventory, Cash & Shifts, Accounting, Staff Finance, Audit, Configuration), splitting SELECT/INSERT/UPDATE/DELETE per the CRUD matrix in the design spec, since several "owner/manager-only" domains still need cashier writes for core POS flow.

**Tech Stack:** PostgreSQL RLS (Supabase), plpgsql functions, Supabase Auth Hooks (JWT custom claims). No frontend changes — `src/router/permissions.ts`/`useCan.ts` are unaffected (server-only ticket).

## Global Constraints

- **No CLI migration workflow exists.** This repo has no `supabase db push`/`migration up` script (confirmed absent from `package.json`). Every migration in this plan is applied by pasting its SQL into the Supabase SQL editor (or your own local Supabase project's SQL editor), consistent with how migrations 001–052 were applied.
- **No automated RLS/pgTAP test harness exists.** The only precedent is `supabase/migrations/verification/verify_custom_access_token_hook.sql` — a hand-run SQL script with `SELECT ... AS case_N_pass` assertions, inspected manually. This plan follows that exact convention for RLS verification rather than introducing a new test framework (YAGNI — a €100-200/month, 2-person team building a POS is not the moment to stand up pgTAP/pg_prove).
- **`staff.permissions` is TEXT, not JSONB** (migration 032, intentional — avoids PowerSync double-encoding). Every SQL reference to it must cast `::jsonb` explicitly.
- **Migration numbering:** highest existing file is `052_sale_discounts.sql`. This plan's migrations are numbered `053`–`064`, contiguous.
- **Idempotency:** every migration uses `CREATE OR REPLACE FUNCTION`, `DROP POLICY IF EXISTS`, `DROP TABLE IF EXISTS`-style guards so it is safe to re-run, matching the existing codebase convention.
- **Owner always bypasses permission flags, never tenant scoping** (INV-005). Every policy in this plan checks `shop_id = (select auth_shop_id())` as an unconditional first clause, even for the owner.
- **Fail-closed on any claim/permission read failure** (INV-004) — verified explicitly in Task 12's negative test cases.
- **No frontend work in this plan.** `permissions.ts`/`useCan.ts` already read client-held `Staff` state correctly; this plan is exclusively `supabase/migrations/*.sql` plus two markdown docs (RPC audit, ADR).

---

### Task 1: Add `staff_id` JWT Claim to the Access Token Hook

**Files:**
- Create: `supabase/migrations/053_staff_id_claim.sql`
- Modify: `supabase/migrations/verification/verify_custom_access_token_hook.sql` (append new assertions)

**Interfaces:**
- Consumes: `public.device_sessions` (existing columns `session_id`, `active_role`, `active_staff_id` — confirmed present via migration 048)
- Produces: JWT claim `staff_id` (uuid or JSON null), alongside the existing `active_role` claim. Read by Task 2's `auth_staff_id()`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/053_staff_id_claim.sql
-- WAFI-122: extend custom_access_token_hook (047/048) to also stamp a
-- staff_id claim, read from the same device_sessions row already looked up
-- for active_role -- one lookup, two claims, so they can never drift apart.
-- Fail-closed: staff_id defaults to JSON null (no staff identity) on any
-- miss, matching active_role's existing fail-closed 'cashier' default.
--
-- IMPORTANT: jsonb_set(target, path, new_value) returns SQL NULL for the
-- WHOLE jsonb value if new_value itself is SQL NULL (not JSON null) -- the
-- same trap migration 047's header comment already documents for the
-- claims-normalization step. to_jsonb(NULL::uuid) returns SQL NULL, so it
-- must be wrapped in COALESCE(..., 'null'::jsonb) before every jsonb_set
-- call below, or a missing staff_id would silently blank out ALL claims.

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  claims     jsonb;
  v_session  text;
  v_role     text;
  v_staff_id uuid;
BEGIN
  claims := event -> 'claims';
  IF claims IS NULL OR jsonb_typeof(claims) <> 'object' THEN
    claims := '{}'::jsonb;
  END IF;
  v_session := claims ->> 'session_id';

  IF v_session IS NULL THEN
    claims := jsonb_set(claims, '{active_role}', '"cashier"');
    claims := jsonb_set(claims, '{staff_id}', 'null'::jsonb);
    RETURN jsonb_build_object('claims', claims);
  END IF;

  BEGIN
    SELECT active_role, active_staff_id INTO v_role, v_staff_id
    FROM public.device_sessions
    WHERE session_id = v_session::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_role := 'cashier';
    v_staff_id := NULL;
  END;

  IF v_role IS NULL THEN
    v_role := 'cashier';
  END IF;

  claims := jsonb_set(claims, '{active_role}', to_jsonb(v_role));
  claims := jsonb_set(claims, '{staff_id}', COALESCE(to_jsonb(v_staff_id), 'null'::jsonb));
  RETURN jsonb_build_object('claims', claims);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
```

- [ ] **Step 2: Apply the migration**

Paste the file's contents into your Supabase project's SQL editor and run it. Expected: `Success. No rows returned` (function replace + grants, no data change).

- [ ] **Step 3: Append manual verification cases**

Add to `supabase/migrations/verification/verify_custom_access_token_hook.sql` (append at the end, after the existing 5 cases):

```sql
-- Case 6: session_id present, matching device_sessions row has
-- active_staff_id set -- staff_id claim must equal it.
SELECT (public.custom_access_token_hook(
  jsonb_build_object('claims', jsonb_build_object('session_id', ds.session_id))
) -> 'claims' ->> 'staff_id')::uuid = ds.active_staff_id AS case_6_pass
FROM public.device_sessions ds
WHERE ds.session_id IS NOT NULL AND ds.active_staff_id IS NOT NULL
LIMIT 1;

-- Case 7: no session_id claim at all -- staff_id must be JSON null, not
-- SQL NULL (i.e. the key must exist and be explicitly null, not absent).
SELECT (public.custom_access_token_hook(jsonb_build_object('claims', '{}'::jsonb))
  -> 'claims') ? 'staff_id' AS case_7_key_present,
  (public.custom_access_token_hook(jsonb_build_object('claims', '{}'::jsonb))
  -> 'claims' -> 'staff_id') = 'null'::jsonb AS case_7_pass;
```

Run both against your Supabase SQL editor. Expected: `case_6_pass = true`, `case_7_key_present = true`, `case_7_pass = true`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/053_staff_id_claim.sql supabase/migrations/verification/verify_custom_access_token_hook.sql
git commit -m "feat(wafi-122): stamp staff_id JWT claim alongside active_role"
```

---

### Task 2: SQL Helper Functions (`auth_staff_id`, `auth_role`, `auth_permissions`, `can`)

**Files:**
- Create: `supabase/migrations/054_auth_role_helpers.sql`
- Create: `supabase/migrations/verification/verify_auth_role_helpers.sql`

**Interfaces:**
- Consumes: `staff_id`/`active_role` JWT claims (Task 1), `public.staff.permissions` (TEXT column holding JSON, migration 032)
- Produces: `public.auth_role() returns text`, `public.auth_staff_id() returns uuid`, `public.auth_permissions() returns jsonb`, `public.can(flag text) returns boolean` — consumed by every domain task (3–10)

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/054_auth_role_helpers.sql
-- WAFI-122: SQL helpers every domain RLS policy uses. auth.jwt() is
-- Supabase's built-in function returning the current request's JWT claims
-- as jsonb (reads the request.jwt.claims GUC PostgREST sets per request).

CREATE OR REPLACE FUNCTION public.auth_role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(auth.jwt() ->> 'active_role', 'cashier')
$$;

CREATE OR REPLACE FUNCTION public.auth_staff_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(auth.jwt() ->> 'staff_id', '')::uuid
$$;

-- Returns '{}'::jsonb (deny-by-default) when staff_id is null, the staff
-- row is missing, or the staff has been deactivated -- so a stale claim for
-- a deactivated staff member never inherits their last-known permissions.
-- SECURITY DEFINER: policies calling this must not require the caller to
-- have direct SELECT on staff (that would be circular with staff's own
-- RLS); search_path is pinned to keep it injection-safe.
CREATE OR REPLACE FUNCTION public.auth_permissions()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT permissions::jsonb FROM public.staff
     WHERE id = public.auth_staff_id() AND is_active = true),
    '{}'::jsonb
  )
$$;

-- Single call site for every permission-flag check in RLS policies. Owner
-- always passes (INV-005). The cast is wrapped in an exception handler --
-- not just COALESCE -- because a malformed non-boolean JSON value at the
-- flag's key (e.g. a stray string) would raise a cast error that COALESCE
-- alone does not catch; this must fail closed (deny), never error (INV-004).
CREATE OR REPLACE FUNCTION public.can(flag text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_raw text;
BEGIN
  IF public.auth_role() = 'owner' THEN
    RETURN true;
  END IF;

  BEGIN
    v_raw := public.auth_permissions() ->> flag;
    RETURN COALESCE(v_raw::boolean, false);
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;
END;
$$;
```

- [ ] **Step 2: Apply the migration**

Paste into the Supabase SQL editor and run. Expected: `Success. No rows returned`.

- [ ] **Step 3: Write the verification script**

```sql
-- supabase/migrations/verification/verify_auth_role_helpers.sql
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
```

- [ ] **Step 4: Run and confirm**

Run the script in the Supabase SQL editor. Expected: all five `case_N_pass` columns return `true`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/054_auth_role_helpers.sql supabase/migrations/verification/verify_auth_role_helpers.sql
git commit -m "feat(wafi-122): add auth_role/auth_staff_id/auth_permissions/can() RLS helpers"
```

---

### Task 3: Identity & Access Domain RLS (`staff`, `devices`)

**Files:**
- Create: `supabase/migrations/055_identity_domain_rls.sql`

**Interfaces:**
- Consumes: `public.auth_shop_id()` (existing, 015), `public.auth_role()` (Task 2)
- Produces: none consumed by later tasks (leaf domain)

- [ ] **Step 1: Discover current policy names on `devices`**

Run in the Supabase SQL editor first (policy names for `devices` were not confirmed during design research — this table was added in migration 037, after the `015` naming convention was established, and may not follow it):

```sql
SELECT policyname, cmd FROM pg_policies WHERE schemaname='public' AND tablename='devices';
```

Note the returned `policyname` values for INSERT and UPDATE — substitute them for `<devices_insert_policy_name>` / `<devices_update_policy_name>` in Step 2 below if they differ from `devices_insert_all`/`devices_update_all`.

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migrations/055_identity_domain_rls.sql
-- WAFI-122: Identity & Access domain -- staff, devices.
--
-- device_sessions is intentionally NOT touched here. It holds no PII beyond
-- active_staff_id/active_role, already has shop-scoped SELECT-only access
-- (migration 044), and all writes already go exclusively through the
-- switch_active_operator() SECURITY DEFINER RPC (which re-verifies the PIN
-- and the shop boundary itself). Narrowing its SELECT further by role would
-- need a device-identity JWT claim that does not currently exist (048
-- removed the device_id claim in favor of session_id) -- deferred rather
-- than guessed at here.
--
-- Simplification vs. the design spec: managers get FULL column access on
-- staff (not a pin_hash/pin_salt/recovery_codes-redacted view). RLS is
-- row-level, not column-level; column masking would require a
-- security-barrier view, which changes what PowerSync (querying the base
-- table directly) delivers on sync -- explicitly flagged as risky by the
-- WAFI-201 PowerSync investigation (out of scope for this ticket). The
-- ticket's literal AC only requires blocking CASHIER entirely from staff,
-- which this migration does. Manager column redaction is deferred as a
-- named follow-up, not silently dropped.

DROP POLICY IF EXISTS staff_select_all ON public.staff;
DROP POLICY IF EXISTS staff_insert_all ON public.staff;
DROP POLICY IF EXISTS staff_update_all ON public.staff;
DROP POLICY IF EXISTS staff_delete_all ON public.staff;

CREATE POLICY staff_select_owner_manager ON public.staff
  FOR SELECT TO authenticated, anon
  USING (
    shop_id = (SELECT public.auth_shop_id())
    AND public.auth_role() IN ('owner', 'manager')
  );

CREATE POLICY staff_insert_owner ON public.staff
  FOR INSERT TO authenticated, anon
  WITH CHECK (
    shop_id = (SELECT public.auth_shop_id())
    AND public.auth_role() = 'owner'
  );

CREATE POLICY staff_update_owner ON public.staff
  FOR UPDATE TO authenticated, anon
  USING (
    shop_id = (SELECT public.auth_shop_id())
    AND public.auth_role() = 'owner'
  )
  WITH CHECK (
    shop_id = (SELECT public.auth_shop_id())
    AND public.auth_role() = 'owner'
  );

-- No DELETE policy created: with RLS enabled and no policy for a command,
-- that command is denied outright. staff.id rows are deactivated
-- (is_active = false), never hard-deleted (INV per design spec §5.1).

-- devices: replace INSERT/UPDATE with owner-only. Use the exact policy
-- names discovered in Step 1 if they differ from the ones below.
DROP POLICY IF EXISTS devices_insert_all ON public.devices;
DROP POLICY IF EXISTS devices_update_all ON public.devices;

CREATE POLICY devices_insert_owner ON public.devices
  FOR INSERT TO authenticated, anon
  WITH CHECK (
    shop_id = (SELECT public.auth_shop_id())
    AND public.auth_role() = 'owner'
  );

CREATE POLICY devices_update_owner ON public.devices
  FOR UPDATE TO authenticated, anon
  USING (
    shop_id = (SELECT public.auth_shop_id())
    AND public.auth_role() = 'owner'
  )
  WITH CHECK (
    shop_id = (SELECT public.auth_shop_id())
    AND public.auth_role() = 'owner'
  );
-- devices SELECT policy is left as-is (existing shop-scoped, all-roles
-- access) -- device list visibility for troubleshooting is not sensitive.
```

- [ ] **Step 3: Apply and verify**

Run the migration in the Supabase SQL editor. Then verify with:

```sql
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname='public' AND tablename IN ('staff','devices')
ORDER BY tablename, cmd;
```

Expected: `staff` has exactly 3 policies (`staff_select_owner_manager`, `staff_insert_owner`, `staff_update_owner`), no DELETE row. `devices` shows the new owner-only INSERT/UPDATE policies plus its pre-existing SELECT policy.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/055_identity_domain_rls.sql
git commit -m "feat(wafi-122): role-scope staff and devices RLS policies"
```

---

### Task 4: Sales Domain RLS

**Files:**
- Create: `supabase/migrations/056_sales_domain_rls.sql`

**Interfaces:**
- Consumes: `public.auth_role()`, `public.auth_staff_id()` (Task 2), `sales.staff_id` (existing column, migration 017)
- Produces: none

- [ ] **Step 1: Discover attribution columns and current policy names**

Run first, to confirm the exact staff-attribution column name and current policy set on each table (these tables have evolved since migration 015's original loop, e.g. `052_sale_discounts.sql` added columns but not new policies):

```sql
SELECT policyname, cmd FROM pg_policies
WHERE schemaname='public'
  AND tablename IN ('sales','sale_line_items','sale_payments','returns','return_line_items','return_reasons')
ORDER BY tablename, cmd;

SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='sales' AND column_name ILIKE '%staff%';
```

Confirm `sales.staff_id` exists (added by migration `017_sales_staff_id.sql`) — this is the column the cashier-scoping predicate below relies on. If the discovery query shows a different name, substitute it throughout Step 2.

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migrations/056_sales_domain_rls.sql
-- WAFI-122: Sales domain -- sales, sale_line_items, sale_payments, returns,
-- return_line_items, return_reasons.
--
-- INSERT/UPDATE stay open to every shop role (cashier must be able to ring
-- a sale) -- the restriction is on SELECT: cashier sees only their own
-- sales, owner/manager see everything. sale_line_items/sale_payments have
-- no direct staff_id column -- they inherit sales' scoping via EXISTS,
-- since a line item / payment is only ever meaningful in the context of
-- its parent sale.

DROP POLICY IF EXISTS sales_select_all ON public.sales;
DROP POLICY IF EXISTS sale_line_items_select_all ON public.sale_line_items;
DROP POLICY IF EXISTS sale_payments_select_all ON public.sale_payments;
DROP POLICY IF EXISTS returns_select_all ON public.returns;
DROP POLICY IF EXISTS return_line_items_select_all ON public.return_line_items;

CREATE POLICY sales_select_own_or_manager ON public.sales
  FOR SELECT TO authenticated, anon
  USING (
    shop_id = (SELECT public.auth_shop_id())
    AND (
      public.auth_role() IN ('owner', 'manager')
      OR staff_id = public.auth_staff_id()
    )
  );

CREATE POLICY sale_line_items_select_own_or_manager ON public.sale_line_items
  FOR SELECT TO authenticated, anon
  USING (
    shop_id = (SELECT public.auth_shop_id())
    AND (
      public.auth_role() IN ('owner', 'manager')
      OR EXISTS (
        SELECT 1 FROM public.sales s
        WHERE s.id = sale_line_items.sale_id AND s.staff_id = public.auth_staff_id()
      )
    )
  );

CREATE POLICY sale_payments_select_own_or_manager ON public.sale_payments
  FOR SELECT TO authenticated, anon
  USING (
    shop_id = (SELECT public.auth_shop_id())
    AND (
      public.auth_role() IN ('owner', 'manager')
      OR EXISTS (
        SELECT 1 FROM public.sales s
        WHERE s.id = sale_payments.sale_id AND s.staff_id = public.auth_staff_id()
      )
    )
  );

CREATE POLICY returns_select_own_or_manager ON public.returns
  FOR SELECT TO authenticated, anon
  USING (
    shop_id = (SELECT public.auth_shop_id())
    AND (
      public.auth_role() IN ('owner', 'manager')
      OR staff_id = public.auth_staff_id()
    )
  );

CREATE POLICY return_line_items_select_own_or_manager ON public.return_line_items
  FOR SELECT TO authenticated, anon
  USING (
    shop_id = (SELECT public.auth_shop_id())
    AND (
      public.auth_role() IN ('owner', 'manager')
      OR EXISTS (
        SELECT 1 FROM public.returns r
        WHERE r.id = return_line_items.return_id AND r.staff_id = public.auth_staff_id()
      )
    )
  );

-- INSERT/UPDATE/DELETE policies for all six tables are left as-is from
-- migration 015 (open to every shop role, shop-scoped) -- INSERT must stay
-- open for the core POS flow; UPDATE/DELETE restrictions to "draft only" /
-- "nobody" require a sales.status column check this migration does not
-- have confirmed column values for, so is deferred to a follow-up (noted
-- in the plan's Task 12 verification script as a known gap to re-check
-- against the live schema before considering this domain fully closed).

-- return_reasons: config-like table, gate writes by can_manage_products
-- (shares the products config surface per design spec §5.2).
DROP POLICY IF EXISTS return_reasons_insert_all ON public.return_reasons;
DROP POLICY IF EXISTS return_reasons_update_all ON public.return_reasons;
DROP POLICY IF EXISTS return_reasons_delete_all ON public.return_reasons;

CREATE POLICY return_reasons_insert_permission ON public.return_reasons
  FOR INSERT TO authenticated, anon
  WITH CHECK (
    shop_id = (SELECT public.auth_shop_id())
    AND public.can('can_manage_products')
  );

CREATE POLICY return_reasons_update_permission ON public.return_reasons
  FOR UPDATE TO authenticated, anon
  USING (
    shop_id = (SELECT public.auth_shop_id())
    AND public.can('can_manage_products')
  )
  WITH CHECK (
    shop_id = (SELECT public.auth_shop_id())
    AND public.can('can_manage_products')
  );

CREATE POLICY return_reasons_delete_permission ON public.return_reasons
  FOR DELETE TO authenticated, anon
  USING (
    shop_id = (SELECT public.auth_shop_id())
    AND public.can('can_manage_products')
  );
```

- [ ] **Step 3: Apply and verify**

Run in the Supabase SQL editor, then:

```sql
SELECT policyname, cmd FROM pg_policies
WHERE schemaname='public'
  AND tablename IN ('sales','sale_line_items','sale_payments','returns','return_line_items','return_reasons')
ORDER BY tablename, cmd;
```

Expected: each SELECT policy above appears exactly once per table; INSERT/UPDATE/DELETE on `sales`/`sale_line_items`/`sale_payments`/`returns`/`return_line_items` are still the pre-existing 015 policies (unchanged); `return_reasons` INSERT/UPDATE/DELETE now reference `can_manage_products`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/056_sales_domain_rls.sql
git commit -m "feat(wafi-122): scope Sales domain SELECT to owner/manager or own records"
```

---

### Task 5: Inventory Domain RLS

**Files:**
- Create: `supabase/migrations/057_inventory_domain_rls.sql`

**Interfaces:**
- Consumes: `public.can(flag)` (Task 2)
- Produces: none

- [ ] **Step 1: Discover current policy names**

```sql
SELECT policyname, cmd FROM pg_policies
WHERE schemaname='public'
  AND tablename IN ('products','categories','subcategories','stock_adjustments','suppliers',
                     'stock_receivings','stock_receiving_line_items','stock_take_sessions','stock_take_lines')
ORDER BY tablename, cmd;
```

`categories`/`subcategories`/`stock_take_sessions`/`stock_take_lines` were added after migration 015 (`036_product_categories.sql`, `035_stock_take_sessions.sql`, `038_stock_take_scope_ids.sql`) — confirm their actual policy names before running Step 2's DROPs; adjust names if they differ.

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migrations/057_inventory_domain_rls.sql
-- WAFI-122: Inventory domain. SELECT stays open shop-wide on every table
-- (POS/product-list screens need it for every role). Writes are gated by
-- an EXPLICIT, single-purpose permission flag per sub-domain -- no generic
-- can_manage_* catch-all (design spec §4.2): can_manage_products,
-- can_manage_inventory, can_manage_suppliers, can_manage_stock_take.

DROP POLICY IF EXISTS products_insert_all ON public.products;
DROP POLICY IF EXISTS products_update_all ON public.products;
DROP POLICY IF EXISTS products_delete_all ON public.products;

CREATE POLICY products_insert_permission ON public.products
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_products'));
CREATE POLICY products_update_permission ON public.products
  FOR UPDATE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_products'))
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_products'));
CREATE POLICY products_delete_permission ON public.products
  FOR DELETE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_products'));

-- categories/subcategories share the products permission (same config
-- surface, per design spec §5.3). Replace <categories_insert_policy_name>
-- etc. with the names found in Step 1 if they differ.
DROP POLICY IF EXISTS categories_insert_all ON public.categories;
DROP POLICY IF EXISTS categories_update_all ON public.categories;
DROP POLICY IF EXISTS categories_delete_all ON public.categories;
CREATE POLICY categories_insert_permission ON public.categories
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_products'));
CREATE POLICY categories_update_permission ON public.categories
  FOR UPDATE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_products'))
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_products'));
CREATE POLICY categories_delete_permission ON public.categories
  FOR DELETE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_products'));

DROP POLICY IF EXISTS subcategories_insert_all ON public.subcategories;
DROP POLICY IF EXISTS subcategories_update_all ON public.subcategories;
DROP POLICY IF EXISTS subcategories_delete_all ON public.subcategories;
CREATE POLICY subcategories_insert_permission ON public.subcategories
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_products'));
CREATE POLICY subcategories_update_permission ON public.subcategories
  FOR UPDATE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_products'))
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_products'));
CREATE POLICY subcategories_delete_permission ON public.subcategories
  FOR DELETE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_products'));

-- stock_adjustments: append-only ledger -- INSERT only, gated by
-- can_manage_inventory (distinct flag from can_manage_products, per §4.2).
DROP POLICY IF EXISTS stock_adjustments_insert_all ON public.stock_adjustments;
DROP POLICY IF EXISTS stock_adjustments_update_all ON public.stock_adjustments;
DROP POLICY IF EXISTS stock_adjustments_delete_all ON public.stock_adjustments;
CREATE POLICY stock_adjustments_insert_permission ON public.stock_adjustments
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_inventory'));
-- No UPDATE/DELETE policy created: append-only, denied to everyone by
-- omission (matches audit_log's pattern, migration 018).

-- suppliers, stock_receivings, stock_receiving_line_items: can_manage_suppliers.
DROP POLICY IF EXISTS suppliers_insert_all ON public.suppliers;
DROP POLICY IF EXISTS suppliers_update_all ON public.suppliers;
DROP POLICY IF EXISTS suppliers_delete_all ON public.suppliers;
CREATE POLICY suppliers_insert_permission ON public.suppliers
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_suppliers'));
CREATE POLICY suppliers_update_permission ON public.suppliers
  FOR UPDATE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_suppliers'))
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_suppliers'));
CREATE POLICY suppliers_delete_permission ON public.suppliers
  FOR DELETE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_suppliers'));

DROP POLICY IF EXISTS stock_receivings_insert_all ON public.stock_receivings;
DROP POLICY IF EXISTS stock_receivings_update_all ON public.stock_receivings;
DROP POLICY IF EXISTS stock_receivings_delete_all ON public.stock_receivings;
CREATE POLICY stock_receivings_insert_permission ON public.stock_receivings
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_suppliers'));
CREATE POLICY stock_receivings_update_permission ON public.stock_receivings
  FOR UPDATE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_suppliers'))
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_suppliers'));
-- No DELETE policy: a finalized receiving is never deleted (design spec §5.3).

DROP POLICY IF EXISTS stock_receiving_line_items_insert_all ON public.stock_receiving_line_items;
DROP POLICY IF EXISTS stock_receiving_line_items_update_all ON public.stock_receiving_line_items;
CREATE POLICY stock_receiving_line_items_insert_permission ON public.stock_receiving_line_items
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_suppliers'));
CREATE POLICY stock_receiving_line_items_update_permission ON public.stock_receiving_line_items
  FOR UPDATE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_suppliers'))
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_suppliers'));

-- stock_take_sessions/stock_take_lines: can_manage_stock_take. Replace
-- policy names below with whatever Step 1's discovery query returned.
DROP POLICY IF EXISTS stock_take_sessions_insert_all ON public.stock_take_sessions;
DROP POLICY IF EXISTS stock_take_sessions_update_all ON public.stock_take_sessions;
CREATE POLICY stock_take_sessions_insert_permission ON public.stock_take_sessions
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_stock_take'));
CREATE POLICY stock_take_sessions_update_permission ON public.stock_take_sessions
  FOR UPDATE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_stock_take'))
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_stock_take'));

DROP POLICY IF EXISTS stock_take_lines_insert_all ON public.stock_take_lines;
DROP POLICY IF EXISTS stock_take_lines_update_all ON public.stock_take_lines;
CREATE POLICY stock_take_lines_insert_permission ON public.stock_take_lines
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_stock_take'));
CREATE POLICY stock_take_lines_update_permission ON public.stock_take_lines
  FOR UPDATE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_stock_take'))
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_stock_take'));
```

- [ ] **Step 3: Add the three new permission flags to `StaffPermissions`**

Modify `src/features/staff/staff.types.ts` — this is the one frontend touch this plan requires, because `can()` (Task 2) reads flags that must exist in the type/defaults so the owner UI can actually grant them:

```typescript
export interface StaffPermissions {
  can_view_reports:      boolean
  can_manage_products:   boolean
  can_manage_customers:  boolean
  can_view_expenses:     boolean
  can_manage_settings:   boolean
  can_manage_inventory:  boolean
  can_manage_suppliers:  boolean
  can_manage_stock_take: boolean
}

export const DEFAULT_CASHIER_PERMISSIONS: StaffPermissions = {
  can_view_reports:      false,
  can_manage_products:   false,
  can_manage_customers:  false,
  can_view_expenses:     false,
  can_manage_settings:   false,
  can_manage_inventory:  false,
  can_manage_suppliers:  false,
  can_manage_stock_take: false,
}

export const OWNER_PERMISSIONS: StaffPermissions = {
  can_view_reports:      true,
  can_manage_products:   true,
  can_manage_customers:  true,
  can_view_expenses:     true,
  can_manage_settings:   true,
  can_manage_inventory:  true,
  can_manage_suppliers:  true,
  can_manage_stock_take: true,
}

export const MANAGER_PERMISSIONS: StaffPermissions = {
  can_view_reports:      false,
  can_manage_products:   true,
  can_manage_customers:  true,
  can_view_expenses:     false,
  can_manage_settings:   false,
  can_manage_inventory:  true,
  can_manage_suppliers:  true,
  can_manage_stock_take: true,
}
```

Also update `permissionsForRole`'s manager branch in the same file to include the three new flags at their `MANAGER_PERMISSIONS` defaults:

```typescript
export function permissionsForRole(
  role: StaffRole,
  custom: Partial<StaffPermissions>,
): StaffPermissions {
  if (role === 'owner') return OWNER_PERMISSIONS
  if (role === 'manager') {
    return {
      can_manage_products:   true,
      can_manage_customers:  true,
      can_manage_settings:   false,
      can_manage_inventory:  true,
      can_manage_suppliers:  true,
      can_manage_stock_take: true,
      can_view_reports:      Boolean(custom?.can_view_reports),
      can_view_expenses:     Boolean(custom?.can_view_expenses),
    }
  }
  return { ...DEFAULT_CASHIER_PERMISSIONS, ...custom }
}
```

- [ ] **Step 4: Update the existing permissions test fixture**

Run `npm run test -- staffPermissions` first to see the current fixture, then modify `src/features/staff/__tests__/staffPermissions.test.ts` to assert the three new flags are present with the values above wherever it currently asserts on `MANAGER_PERMISSIONS`/`OWNER_PERMISSIONS`/`DEFAULT_CASHIER_PERMISSIONS` object shape.

- [ ] **Step 5: Run the frontend test suite and type-check**

```bash
npm run test -- staffPermissions
npm run type-check:test
```

Expected: all tests pass, zero TypeScript errors.

- [ ] **Step 6: Apply the SQL migration and verify**

Run `057_inventory_domain_rls.sql` in the Supabase SQL editor, then:

```sql
SELECT policyname, cmd FROM pg_policies
WHERE schemaname='public'
  AND tablename IN ('products','categories','subcategories','stock_adjustments','suppliers',
                     'stock_receivings','stock_receiving_line_items','stock_take_sessions','stock_take_lines')
ORDER BY tablename, cmd;
```

Expected: every table's INSERT/UPDATE (and DELETE where applicable) policy references its assigned `can('can_manage_...')` flag; `stock_adjustments` has no UPDATE/DELETE row at all.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/057_inventory_domain_rls.sql src/features/staff/staff.types.ts src/features/staff/__tests__/staffPermissions.test.ts
git commit -m "feat(wafi-122): explicit Inventory permission flags (can_manage_inventory/suppliers/stock_take) + RLS"
```

---

### Task 6: Cash & Shifts Domain RLS

**Files:**
- Create: `supabase/migrations/058_cash_shifts_domain_rls.sql`

**Interfaces:**
- Consumes: `public.auth_role()`, `public.auth_staff_id()` (Task 2)
- Produces: none

- [ ] **Step 1: Discover attribution columns and current policies**

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='cashier_shifts' AND column_name ILIKE '%staff%';

SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='cash_movements' AND column_name ILIKE '%staff%' OR column_name ILIKE '%shift%';

SELECT policyname, cmd FROM pg_policies
WHERE schemaname='public' AND tablename IN ('cashier_shifts','cash_movements','denomination_configs')
ORDER BY tablename, cmd;
```

Confirm `cashier_shifts` has a `staff_id` column (the drawer-attribution invariant in CLAUDE.md — "Anything that moves physical cash MUST carry shift_id and device_id" — implies `cash_movements.shift_id`; the query above confirms whether `cash_movements` itself has a direct `staff_id` or only `shift_id`). If `cash_movements` has no direct `staff_id`, use the `EXISTS`-via-`cashier_shifts` pattern from Task 4 instead of a direct column check in Step 2.

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migrations/058_cash_shifts_domain_rls.sql
-- WAFI-122: Cash & Shifts domain -- cashier_shifts, cash_movements,
-- denomination_configs. INSERT stays open (cashier must open own shift /
-- record own movements) -- SELECT is scoped: cashier sees only their own
-- shifts/movements, owner/manager see everything shop-wide.

DROP POLICY IF EXISTS cashier_shifts_select_all ON public.cashier_shifts;

CREATE POLICY cashier_shifts_select_own_or_manager ON public.cashier_shifts
  FOR SELECT TO authenticated, anon
  USING (
    shop_id = (SELECT public.auth_shop_id())
    AND (
      public.auth_role() IN ('owner', 'manager')
      OR staff_id = public.auth_staff_id()
    )
  );

DROP POLICY IF EXISTS cash_movements_select_all ON public.cash_movements;

CREATE POLICY cash_movements_select_own_or_manager ON public.cash_movements
  FOR SELECT TO authenticated, anon
  USING (
    shop_id = (SELECT public.auth_shop_id())
    AND (
      public.auth_role() IN ('owner', 'manager')
      OR EXISTS (
        SELECT 1 FROM public.cashier_shifts cs
        WHERE cs.id = cash_movements.shift_id AND cs.staff_id = public.auth_staff_id()
      )
    )
  );

-- denomination_configs: shop-wide config, owner-only write (design spec §5.4).
DROP POLICY IF EXISTS denomination_configs_insert_all ON public.denomination_configs;
DROP POLICY IF EXISTS denomination_configs_update_all ON public.denomination_configs;
DROP POLICY IF EXISTS denomination_configs_delete_all ON public.denomination_configs;

CREATE POLICY denomination_configs_insert_owner ON public.denomination_configs
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.auth_role() = 'owner');
CREATE POLICY denomination_configs_update_owner ON public.denomination_configs
  FOR UPDATE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.auth_role() = 'owner')
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.auth_role() = 'owner');
CREATE POLICY denomination_configs_delete_owner ON public.denomination_configs
  FOR DELETE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.auth_role() = 'owner');

-- cash_movements UPDATE/DELETE: no policy created for either -- append-only
-- after the fact; a correction is a new reversing row (design spec §5.4),
-- denied to everyone by omission just like stock_adjustments (Task 5) and
-- audit_log (018).
DROP POLICY IF EXISTS cash_movements_update_all ON public.cash_movements;
DROP POLICY IF EXISTS cash_movements_delete_all ON public.cash_movements;
```

- [ ] **Step 3: Apply and verify**

```sql
SELECT policyname, cmd FROM pg_policies
WHERE schemaname='public' AND tablename IN ('cashier_shifts','cash_movements','denomination_configs')
ORDER BY tablename, cmd;
```

Expected: `cash_movements` has no UPDATE/DELETE policy rows at all; `cashier_shifts`/`cash_movements` SELECT reference the own-or-manager predicate; `denomination_configs` writes are owner-only.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/058_cash_shifts_domain_rls.sql
git commit -m "feat(wafi-122): scope Cash & Shifts SELECT to owner/manager or own shift; make cash_movements append-only"
```

---

### Task 7: Accounting Domain RLS

**Files:**
- Create: `supabase/migrations/059_accounting_domain_rls.sql`

**Interfaces:**
- Consumes: `public.auth_role()`, `public.can(flag)` (Task 2)
- Produces: none

- [ ] **Step 1: Discover policies**

```sql
SELECT policyname, cmd FROM pg_policies
WHERE schemaname='public'
  AND tablename IN ('expenses','customers','customer_payments','installment_plans','installment_dues')
ORDER BY tablename, cmd;
```

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migrations/059_accounting_domain_rls.sql
-- WAFI-122: Accounting (Customer Credit) domain.
-- expenses: owner/manager only, full stop (design spec §5.5) -- cashiers do
-- not log expenses in this product's model.
-- customers/customer_payments/installment_*: gated by can_manage_customers.

DROP POLICY IF EXISTS expenses_select_all ON public.expenses;
DROP POLICY IF EXISTS expenses_insert_all ON public.expenses;
DROP POLICY IF EXISTS expenses_update_all ON public.expenses;
DROP POLICY IF EXISTS expenses_delete_all ON public.expenses;

CREATE POLICY expenses_select_owner_manager ON public.expenses
  FOR SELECT TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.auth_role() IN ('owner','manager'));
CREATE POLICY expenses_insert_owner_manager ON public.expenses
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.auth_role() IN ('owner','manager'));
CREATE POLICY expenses_update_owner_manager ON public.expenses
  FOR UPDATE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.auth_role() IN ('owner','manager'))
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.auth_role() IN ('owner','manager'));
-- No DELETE policy: expenses are never deleted (correct via a new entry).

DROP POLICY IF EXISTS customers_insert_all ON public.customers;
DROP POLICY IF EXISTS customers_update_all ON public.customers;
DROP POLICY IF EXISTS customers_delete_all ON public.customers;

CREATE POLICY customers_insert_permission ON public.customers
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_customers'));
CREATE POLICY customers_update_permission ON public.customers
  FOR UPDATE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_customers'))
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_customers'));
CREATE POLICY customers_delete_permission ON public.customers
  FOR DELETE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_customers'));

DROP POLICY IF EXISTS customer_payments_insert_all ON public.customer_payments;
DROP POLICY IF EXISTS customer_payments_update_all ON public.customer_payments;
DROP POLICY IF EXISTS customer_payments_delete_all ON public.customer_payments;

CREATE POLICY customer_payments_insert_permission ON public.customer_payments
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_customers'));
-- No UPDATE/DELETE policy: customer_payments is immutable (design spec §5.5).

-- installment_plans/installment_dues: not part of migration 015's original
-- loop; confirm their existing policy names via Step 1's query before
-- running the DROPs below.
DROP POLICY IF EXISTS installment_plans_insert_all ON public.installment_plans;
DROP POLICY IF EXISTS installment_plans_update_all ON public.installment_plans;

CREATE POLICY installment_plans_insert_permission ON public.installment_plans
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_customers'));
CREATE POLICY installment_plans_update_owner_manager ON public.installment_plans
  FOR UPDATE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.auth_role() IN ('owner','manager'))
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.auth_role() IN ('owner','manager'));

DROP POLICY IF EXISTS installment_dues_update_all ON public.installment_dues;

CREATE POLICY installment_dues_update_owner_manager ON public.installment_dues
  FOR UPDATE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.auth_role() IN ('owner','manager'))
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.auth_role() IN ('owner','manager'));
```

- [ ] **Step 3: Apply and verify**

```sql
SELECT policyname, cmd FROM pg_policies
WHERE schemaname='public'
  AND tablename IN ('expenses','customers','customer_payments','installment_plans','installment_dues')
ORDER BY tablename, cmd;
```

Expected: `expenses` has no DELETE row; `customer_payments` has no UPDATE/DELETE row; the rest reference `can_manage_customers` or owner/manager per the SQL above.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/059_accounting_domain_rls.sql
git commit -m "feat(wafi-122): gate Accounting domain writes by role/can_manage_customers"
```

---

### Task 8: Staff Finance Domain RLS

**Files:**
- Create: `supabase/migrations/060_staff_finance_domain_rls.sql`

**Interfaces:**
- Consumes: `public.auth_role()`, `public.can(flag)` (Task 2)
- Produces: none

- [ ] **Step 1: Discover policies**

```sql
SELECT policyname, cmd FROM pg_policies
WHERE schemaname='public' AND tablename IN ('staff_ledger','staff_settlements')
ORDER BY tablename, cmd;

SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='staff_settlements' AND column_name ILIKE '%status%';
```

Confirm the settlement status column's name and its allowed values (design spec assumes `draft`/`finalized`/`paid`) before Step 2.

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migrations/060_staff_finance_domain_rls.sql
-- WAFI-122: Staff Finance domain (renamed from "Payroll" per design spec
-- §5.6 -- this is advances/penalties/settlements, not payroll/compliance).
-- Renamed permission flag: can_view_staff_ledger (owner always passes via
-- can()'s built-in owner bypass).

DROP POLICY IF EXISTS staff_ledger_select_all ON public.staff_ledger;
DROP POLICY IF EXISTS staff_ledger_insert_all ON public.staff_ledger;
DROP POLICY IF EXISTS staff_ledger_update_all ON public.staff_ledger;
DROP POLICY IF EXISTS staff_ledger_delete_all ON public.staff_ledger;

CREATE POLICY staff_ledger_select_permission ON public.staff_ledger
  FOR SELECT TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_view_staff_ledger'));
CREATE POLICY staff_ledger_insert_permission ON public.staff_ledger
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_view_staff_ledger'));
-- No UPDATE/DELETE policy: staff_ledger is fully immutable (design spec §5.6).

DROP POLICY IF EXISTS staff_settlements_select_all ON public.staff_settlements;
DROP POLICY IF EXISTS staff_settlements_insert_all ON public.staff_settlements;
DROP POLICY IF EXISTS staff_settlements_update_all ON public.staff_settlements;
DROP POLICY IF EXISTS staff_settlements_delete_all ON public.staff_settlements;

CREATE POLICY staff_settlements_select_permission ON public.staff_settlements
  FOR SELECT TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_view_staff_ledger'));
CREATE POLICY staff_settlements_insert_permission ON public.staff_settlements
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_view_staff_ledger'));
CREATE POLICY staff_settlements_update_draft_only ON public.staff_settlements
  FOR UPDATE TO authenticated, anon
  USING (
    shop_id = (SELECT public.auth_shop_id())
    AND public.can('can_view_staff_ledger')
    AND status = 'draft'
  )
  WITH CHECK (
    shop_id = (SELECT public.auth_shop_id())
    AND public.can('can_view_staff_ledger')
  );
-- No DELETE policy on either table: neither is ever deleted.
```

- [ ] **Step 3: Add `can_view_staff_ledger` to `StaffPermissions`**

Modify `src/features/staff/staff.types.ts` (building on Task 5's edit) — add `can_view_staff_ledger: boolean` to the interface and set it `false` in `DEFAULT_CASHIER_PERMISSIONS`/`MANAGER_PERMISSIONS` defaults, `true` in `OWNER_PERMISSIONS`, and read from `custom?.can_view_staff_ledger` in the manager branch of `permissionsForRole` (same pattern as `can_view_reports`/`can_view_expenses`, since it is a financial flag an owner grants per-manager, not a structural one).

- [ ] **Step 4: Run frontend tests**

```bash
npm run test -- staffPermissions
npm run type-check:test
```

Expected: pass, zero TypeScript errors.

- [ ] **Step 5: Apply the SQL migration and verify**

```sql
SELECT policyname, cmd, qual FROM pg_policies
WHERE schemaname='public' AND tablename IN ('staff_ledger','staff_settlements')
ORDER BY tablename, cmd;
```

Expected: `staff_ledger` has no UPDATE/DELETE row; `staff_settlements` UPDATE policy's `qual` includes `status = 'draft'`; both tables' SELECT/INSERT reference `can_view_staff_ledger`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/060_staff_finance_domain_rls.sql src/features/staff/staff.types.ts
git commit -m "feat(wafi-122): Staff Finance domain RLS gated by can_view_staff_ledger"
```

---

### Task 9: Audit Domain RLS

**Files:**
- Create: `supabase/migrations/061_audit_domain_rls.sql`

**Interfaces:**
- Consumes: `public.auth_role()`, `public.can(flag)` (Task 2)
- Produces: none

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/061_audit_domain_rls.sql
-- WAFI-122: audit_log SELECT restricted to owner, or manager with
-- can_view_reports (reuses the existing reports flag rather than inventing
-- a new one -- audit log is a reporting-adjacent surface per design spec
-- §5.7). INSERT stays open to every shop role (every domain's mutations
-- write their own audit entries, system-generated). UPDATE/DELETE remain
-- absent -- already enforced append-only by migration 018, unchanged here.

DROP POLICY IF EXISTS audit_log_select_all ON public.audit_log;

CREATE POLICY audit_log_select_owner_or_permission ON public.audit_log
  FOR SELECT TO authenticated, anon
  USING (
    shop_id = ((SELECT public.auth_shop_id()))::text
    AND (public.auth_role() = 'owner' OR public.can('can_view_reports'))
  );
```

Note: `audit_log.shop_id` is `text` (migration 002), unlike every other table's `uuid` — matching the `::text` cast pattern already used in migration 015's dynamic loop for this exact table.

- [ ] **Step 2: Apply and verify**

```sql
SELECT policyname, cmd, qual FROM pg_policies
WHERE schemaname='public' AND tablename='audit_log'
ORDER BY cmd;
```

Expected: exactly one SELECT policy (`audit_log_select_owner_or_permission`), one INSERT policy (pre-existing, unchanged), no UPDATE/DELETE rows.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/061_audit_domain_rls.sql
git commit -m "feat(wafi-122): restrict audit_log SELECT to owner or can_view_reports"
```

---

### Task 10: Configuration Domain RLS

**Files:**
- Create: `supabase/migrations/062_configuration_domain_rls.sql`

**Interfaces:**
- Consumes: `public.auth_role()` (Task 2)
- Produces: none

- [ ] **Step 1: Discover policies**

```sql
SELECT policyname, cmd FROM pg_policies
WHERE schemaname='public' AND tablename IN ('receipt_settings','exchange_rates','shop_feature_flags','shops')
ORDER BY tablename, cmd;
```

Note `shop_feature_flags` (migration 041) is documented elsewhere in this codebase as server-only/not client-writable (per ADR-008/041 per the design spec's own note) — confirm via the query above whether it currently has any client-facing write policy at all before deciding whether Step 2's owner-only policy is a widening or a no-op.

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migrations/062_configuration_domain_rls.sql
-- WAFI-122: Configuration domain -- receipt_settings, exchange_rates,
-- shop_feature_flags, shops. All writes owner-only.

DROP POLICY IF EXISTS receipt_settings_insert_all ON public.receipt_settings;
DROP POLICY IF EXISTS receipt_settings_update_all ON public.receipt_settings;
DROP POLICY IF EXISTS receipt_settings_delete_all ON public.receipt_settings;

CREATE POLICY receipt_settings_insert_owner ON public.receipt_settings
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.auth_role() = 'owner');
CREATE POLICY receipt_settings_update_owner ON public.receipt_settings
  FOR UPDATE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.auth_role() = 'owner')
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.auth_role() = 'owner');

DROP POLICY IF EXISTS exchange_rates_insert_all ON public.exchange_rates;
DROP POLICY IF EXISTS exchange_rates_update_all ON public.exchange_rates;
DROP POLICY IF EXISTS exchange_rates_delete_all ON public.exchange_rates;

CREATE POLICY exchange_rates_insert_owner ON public.exchange_rates
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.auth_role() = 'owner');
-- No UPDATE/DELETE policy: exchange_rates history is append-only -- each
-- rate change is a new row, which is what makes the rate-lock invariant
-- auditable (design spec §5.8).

-- shops: owner-only write, if not already so. If Step 1 shows no existing
-- write policy at all (server/system-only today), skip this block --
-- do not widen it to client-writable as part of this ticket.
```

- [ ] **Step 3: Apply and verify**

```sql
SELECT policyname, cmd FROM pg_policies
WHERE schemaname='public' AND tablename IN ('receipt_settings','exchange_rates')
ORDER BY tablename, cmd;
```

Expected: `exchange_rates` has no UPDATE/DELETE row; `receipt_settings` writes are owner-only.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/062_configuration_domain_rls.sql
git commit -m "feat(wafi-122): owner-only writes for Configuration domain, append-only exchange_rates"
```

---

### Task 11: RPC Audit Documentation

**Files:**
- Create: `docs/architecture/WAFI-122-rpc-audit.md`

**Interfaces:**
- Consumes: none
- Produces: reference doc, no code interface

- [ ] **Step 1: Write the RPC audit doc**

```markdown
# WAFI-122 RPC Audit

Every `SECURITY DEFINER` function bypasses RLS by definition. Each one below
answers the four required questions (design spec §6) as of migrations
through 062.

## `switch_active_operator(device_id, session_id, staff_id, pin)`

- **Bypasses RLS?** Yes.
- **Why?** Must read `staff.pin_hash`/`pin_salt` to verify a PIN for a staff
  member who is not yet the authenticated JWT's identity — no RLS-visible
  caller identity exists yet at the moment this function runs.
- **What validates authorization inside it?** Re-verifies the PIN
  server-side (`sha256(salt+pin)` via pgcrypto) against the shop resolved
  from `devices.shop_id = auth_shop_id()` (tenant boundary enforced inside
  the function body, since SECURITY DEFINER means the caller's own RLS
  does not apply). Fails closed on lockout (`locked_until`), on missing/
  inactive staff, and on PIN mismatch — identically, so no response-shape
  signal distinguishes failure reasons.
- **Which tables does it touch?** Reads `devices`, `staff`; writes
  `device_sessions`.
- **Which audit entries does it write?** None currently. Flagged as a gap:
  an `operator.switched` audit event (already listed as a required event
  type in TICKET-007/WAFI-138's audit expansion) should be added when that
  ticket wires audit calls into this RPC.

## `allocate_device_code(...)`

- **Bypasses RLS?** Yes (SECURITY DEFINER, migration 037).
- **Why?** Runs during device self-registration, before the device has an
  established session/role.
- **What validates authorization inside it?** Tenant boundary via the
  caller's resolved `shop_id`; no role check needed since device
  registration is not role-gated by design (any device belonging to the
  shop can register itself).
- **Which tables does it touch?** `devices`.
- **Which audit entries does it write?** None currently — same gap as
  above, tracked for TICKET-007/WAFI-138.

## No other `SECURITY DEFINER` functions exist in this codebase as of
migration 062 (confirmed via `auth_shop_id()`, `auth_permissions()` in
Task 2, which are themselves SECURITY DEFINER but are read-only helpers,
not mutating RPCs, and are exempt from this audit's "which tables does it
touch to mutate" framing — they only SELECT).

Any future financial-write RPC must add its own section here, answering
all four questions, before merge (per design spec §6 and CLAUDE.md's ADR
requirement for significant decisions).
```

- [ ] **Step 2: Commit**

```bash
mkdir -p docs/architecture
git add docs/architecture/WAFI-122-rpc-audit.md
git commit -m "docs(wafi-122): RPC audit for switch_active_operator and allocate_device_code"
```

---

### Task 12: Comprehensive Role-Enforcement Verification Script

**Files:**
- Create: `supabase/migrations/verification/verify_wafi122_role_enforcement.sql`

**Interfaces:**
- Consumes: all of Tasks 1–10's policies/functions
- Produces: none (terminal verification artifact)

- [ ] **Step 1: Write the verification script**

This follows the same manual, hand-run convention as `verify_custom_access_token_hook.sql`. Because these assertions need to simulate different `active_role`/`staff_id`/`shop_id` JWT claims (not just "no JWT at all" like Task 2's helper tests), they use `set_config('request.jwt.claims', ..., true)` to fake a request-scoped JWT within a single SQL session — the same GUC PostgREST itself populates per request, which `auth.jwt()` reads.

```sql
-- supabase/migrations/verification/verify_wafi122_role_enforcement.sql
-- Manual verification for WAFI-122's full role-enforcement scope. Run each
-- block by hand in the Supabase SQL editor, against a project seeded with
-- at least one shop, one owner, one manager, and one cashier staff row (use
-- your dev/staging seed data; substitute real UUIDs for the placeholders
-- marked <...>).
--
-- set_config('request.jwt.claims', '<json>', true) fakes the per-request
-- JWT claims GUC that PostgREST normally sets from the caller's real JWT --
-- auth.jwt() (used by auth_role()/auth_staff_id() in Task 2) reads exactly
-- this GUC. The `true` argument scopes the setting to the current
-- transaction only, so each block should be run as its own statement/
-- transaction to avoid leaking claims between cases.

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
```

- [ ] **Step 2: Run every section against your dev/staging Supabase project**

Substitute real UUIDs from your seed data for every `<...>` placeholder. Run Section A, B, and C blocks in the SQL editor (one statement pair — `set_config` then the assertion — per case, in the same transaction so the fake claim doesn't leak to unrelated queries). Run Section D's curl commands from a terminal.

Expected: every `_pass` column returns `true`; both curl commands return `[]`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/verification/verify_wafi122_role_enforcement.sql
git commit -m "test(wafi-122): comprehensive manual verification script for role enforcement"
```

---

### Task 13: ADR for the PowerSync Sync-Branching Gap (WAFI-201)

**Files:**
- Create: `docs/adr/ADR-0XX-powersync-role-based-sync-gap.md` (use the next sequential ADR number in `docs/adr/` — check the highest existing `ADR-0NN-*.md` file first)
- Create: `docs/tickets/WAFI-201.md` (or append to wherever this project tracks follow-up tickets, matching how `epic.md`'s ticket entries are structured)

**Interfaces:**
- Consumes: none
- Produces: none (documentation artifacts)

- [ ] **Step 1: Check the next ADR number**

```bash
ls docs/adr/ | sort
```

Use the next unused number after the highest existing `ADR-0NN`.

- [ ] **Step 2: Write the ADR**

```markdown
# ADR-0XX: PowerSync Sync-Rule Role Branching Is Not Enforced (WAFI-122 Scope Boundary)

**Status:** Accepted
**Date:** 2026-07-21
**Related:** WAFI-122 (Server-Side Role Enforcement), ADR-009 (device-scoped
active_role claim for financial-column visibility)

## Context

WAFI-122 closes the direct-access authorization gap: RLS now blocks a
cashier from reading `staff`, `audit_log`, other shifts' `sales`, etc. via
any request that authenticates through PostgREST using the caller's own
JWT (curl, Postman, a modified client).

PowerSync's bulk-sync replication does not go through PostgREST and does
not authenticate as the end-user's JWT — it connects via its own
sync-service credentials and is governed entirely by the correlated-
subquery rules in `powersync.yaml`, independent of the RLS policies added
in WAFI-122. This project's PowerSync edition was already found (during
ADR-009's implementation) to not reliably support
`subscription.parameter()`-based per-role bucket branching — it returned
zero rows in live testing and the attempt was reverted; `powersync.yaml`
documents this.

## Decision

WAFI-122 does not attempt to make PowerSync's sync stream itself
role-aware. A cashier's device, once synced, holds a full local SQLite
copy of every table PowerSync is configured to sync — including `staff`
(minus what the app chooses to display), `audit_log`, and other staff
members' `sales` rows — regardless of the RLS policies added in WAFI-122.

This is an accepted, explicitly documented platform limitation, not a
silently dropped requirement.

## Consequences

- The WAFI-122 threat model's "Does NOT prevent" list (design spec §8)
  includes offline SQLite inspection on a synced device as an explicit,
  known gap.
- Confidentiality for financial/staff data on a cashier's device currently
  depends entirely on the client application choosing not to query or
  display synced-but-sensitive local tables — NOT on any database-level
  control. This is weaker than the RLS guarantee WAFI-122 provides for
  direct API access, and should be understood as such by anyone reasoning
  about this system's security posture.
- Follow-up ticket **WAFI-201** is filed to investigate: (a) whether a
  newer PowerSync edition/version supports parameterized sync buckets
  reliably, (b) encrypted local SQLite as a mitigation independent of sync
  branching, (c) device attestation / remote revoke as compensating
  controls (partially already possible via the existing `devices` remote
  sign-out flow).

## Alternatives Considered

- **Re-attempt PowerSync role branching as part of WAFI-122** — rejected;
  effort/outcome was unknown given the prior revert, and would have
  blocked shipping the direct-access fix (the more acute, provably-fixable
  vulnerability) on an open-ended spike.
- **Silently accept the gap without documenting it** — rejected; violates
  this project's own principle that server-side authorization must be
  authoritative and explicit about its boundaries (design spec §3.1, INV-007).
```

- [ ] **Step 3: Write the WAFI-201 ticket stub**

```markdown
# WAFI-201: Investigate Role-Aware PowerSync Sync Buckets (Offline Confidentiality Gap)

**Type:** Spike | **Priority:** P2 | **Depends on:** WAFI-122

**Problem:** WAFI-122 closes direct-API role enforcement via RLS, but
PowerSync's own bulk-sync path bypasses RLS entirely (documented in
ADR-0XX). A cashier's synced device holds a full local copy of
role-restricted tables (staff, audit_log, other staff's sales) in SQLite,
regardless of RLS.

**Goal:** Determine whether this gap can be closed, and at what cost.

**Investigate:**
1. Current PowerSync version/edition's actual support for
   `subscription.parameter()`-based bucket branching — the prior attempt
   (ADR-009) returned zero rows; confirm whether this was a version
   limitation, a syntax error, or an edition-3 constraint, and whether a
   newer version fixes it.
2. Encrypted local SQLite as an independent mitigation (protects against
   device theft / rooted-device inspection even if sync stays unbranched).
3. Device attestation feasibility on the target hardware (cheap Android
   tablets, per CLAUDE.md's hardware section).
4. Cost/complexity of a from-scratch alternative: separate sync streams per
   role tier, if PowerSync itself cannot branch reliably.

**Definition of Done:** A written recommendation (accept the gap
long-term / fix via PowerSync config change / fix via encryption / fix via
custom sync-stream architecture), with an updated ADR-0XX status.
```

- [ ] **Step 4: Commit**

```bash
mkdir -p docs/tickets
git add docs/adr/ADR-0XX-powersync-role-based-sync-gap.md docs/tickets/WAFI-201.md
git commit -m "docs(wafi-122): ADR + WAFI-201 follow-up for PowerSync role-branching gap"
```
