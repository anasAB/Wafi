# WAFI-155 Feature Flag Framework (Engineering Rollout Flags) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-shop "engineering rollout flag" mechanism (`dashboard_v2`, `pos_brain`, `insights`) distinct from WAFI-131's pricing-pack flags, gated by a new cross-shop `platform_admins` concept, with an internal admin screen to toggle flags per shop.

**Architecture:** A `rollout` sub-object inside the existing `shops.features` jsonb column, mutated only through two new `SECURITY DEFINER` RPCs (`set_rollout_flag`, `list_shops_for_rollout_admin`) gated by a new `platform_admins` table. Client reads via a fail-closed TypeScript resolver (`resolveRollout`) parallel to WAFI-131's `resolveFlag`. An internal-only Vue screen at `/admin/rollouts` calls the RPCs directly.

**Tech Stack:** Postgres/Supabase (migrations, pgTAP), Vue 3 + Pinia + TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-13-wafi155-feature-flag-framework-design.md`

## Global Constraints

- Migration file: `supabase/migrations/090_wafi155_rollout_flags.sql` (090 is the next free number after `089_profit_cache_rebuild_revoke_public.sql` — re-confirm this is still true at implementation time).
- pgTAP suite: `supabase/tests/wafi155_rollout_flags.test.sql`, run via `npx supabase test db`.
- Every `SECURITY DEFINER` function: plain `SECURITY DEFINER`, `SET search_path = public, pg_temp`, explicit `REVOKE ALL ... FROM PUBLIC` + `REVOKE ALL ... FROM anon` + `GRANT EXECUTE ... TO authenticated`. No custom function-owner role.
- Error codes: `P0001` = not authorized, `P0002` = shop/id not found or NULL required id, `P0003` = invalid/unknown flag value.
- `throws_ok(sql, sqlstate, description)` in pgTAP is a KNOWN TRAP in this codebase when `sqlstate` is exactly 5 characters — pgtap's 3-arg form treats the third argument as an expected error **message**, not a description. Always use the 4-arg form: `throws_ok(sql, sqlstate, NULL, description)`.
- Rollout flags: `ROLLOUT_FLAG_KEYS = ['dashboard_v2', 'pos_brain', 'insights']`, kept in a separate TypeScript type (`RolloutFlagKey`) from WAFI-131's `FlagKey`, and a separate resolver (`resolveRollout`) — never merged into one generic function.
- `resolveRollout` fail-closed contract: only the literal boolean `true` reads as enabled; `undefined`/`null`/`false`/`0`/`'true'` (string)/`{}`/`[]` all read as `false`.

---

## Task 1: `platform_admins` table + fixtures + RLS/grant tests

**Files:**
- Create: `supabase/migrations/090_wafi155_rollout_flags.sql`
- Create: `supabase/tests/wafi155_rollout_flags.test.sql`

**Interfaces:**
- Produces: `public.platform_admins(user_id uuid PK, created_at timestamptz)` table, RLS enabled, self-select policy, explicit grants. Later tasks (2, 3) add `SECURITY DEFINER` functions in the same migration file that read this table.
- Produces (in the test file): three fixture `auth.users` rows — platform admin `d1111111-1111-1111-1111-111111111111`, owner A `d2222222-2222-2222-2222-222222222222` (auto-provisioned shop, `features` left `NULL`), owner B `d3333333-3333-3333-3333-333333333333` (auto-provisioned shop, `features` left `NULL`, kept untouched by other tests until Task 2's step for it). Tasks 2 and 3 append more assertions to this same file and bump `SELECT plan(N);`.

- [ ] **Step 1: Write the migration's table/RLS/grants SQL**

Create `supabase/migrations/090_wafi155_rollout_flags.sql`:

```sql
-- WAFI-155: engineering rollout flags, distinct from WAFI-131's pricing-pack
-- flags. See docs/superpowers/specs/2026-08-13-wafi155-feature-flag-framework-design.md
-- for full design and the NULL-grandfathering / trigger-interaction findings
-- this migration's set_rollout_flag (Task 2) exists to handle correctly.

CREATE TABLE public.platform_admins (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.platform_admins IS
  'Platform-level operators, orthogonal to any shop''s staff/role model.
   Membership is managed only through the trusted Supabase dashboard SQL
   path; there is no authenticated/anon client write policy for this table.';

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

CREATE POLICY platform_admins_self_select ON public.platform_admins
  FOR SELECT TO authenticated USING (user_id = auth.uid());

GRANT SELECT ON public.platform_admins TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.platform_admins FROM authenticated;
REVOKE ALL ON public.platform_admins FROM anon;
```

- [ ] **Step 2: Apply the migration locally**

Run: `npx supabase db reset`
Expected: migration `090` applies with no errors (run alongside every prior migration).

- [ ] **Step 3: Write the pgTAP test file with fixtures and the platform_admins RLS/grant tests**

Create `supabase/tests/wafi155_rollout_flags.test.sql`:

```sql
-- supabase/tests/wafi155_rollout_flags.test.sql
-- WAFI-155: platform_admins + set_rollout_flag + list_shops_for_rollout_admin.
-- Run via: npx supabase test db

BEGIN;
SELECT plan(6);

-- ========================================================================
-- Fixtures
-- ========================================================================

-- Platform admin (not a shop owner).
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'd1111111-1111-1111-1111-111111111111', 'admin@wafi155.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');
INSERT INTO public.platform_admins (user_id) VALUES ('d1111111-1111-1111-1111-111111111111');

-- Owner A: provision_shop_for_new_user() (021) auto-creates a shop with
-- features left NULL -- exactly the real-world state Task 2's tests need.
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'd2222222-2222-2222-2222-222222222222', 'owner@wafi155.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');

-- Owner B: a second, pristine NULL-features shop, kept untouched until
-- Task 2's p_enabled=false materialization test.
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'd3333333-3333-3333-3333-333333333333', 'owner2@wafi155.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');

-- ========================================================================
-- platform_admins RLS/grants
-- ========================================================================

-- 7a: platform admin can SELECT their own row.
SELECT set_config('request.jwt.claims', '{"sub":"d1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.platform_admins WHERE user_id = 'd1111111-1111-1111-1111-111111111111'),
  1, '7a: platform admin can SELECT their own platform_admins row'
);
RESET ROLE;

-- 7b: a non-admin cannot see the admin's row (RLS scopes to auth.uid()).
SELECT set_config('request.jwt.claims', '{"sub":"d2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.platform_admins WHERE user_id = 'd1111111-1111-1111-1111-111111111111'),
  0, '7b: a non-admin cannot SELECT another user''s platform_admins row'
);

-- 7c/7d/7e: authenticated cannot INSERT/UPDATE/DELETE platform_admins.
SELECT throws_ok(
  $$ INSERT INTO public.platform_admins (user_id) VALUES ('d2222222-2222-2222-2222-222222222222') $$,
  '42501', NULL, '7c: authenticated cannot INSERT into platform_admins'
);
SELECT throws_ok(
  $$ UPDATE public.platform_admins SET user_id = user_id $$,
  '42501', NULL, '7d: authenticated cannot UPDATE platform_admins'
);
SELECT throws_ok(
  $$ DELETE FROM public.platform_admins $$,
  '42501', NULL, '7e: authenticated cannot DELETE from platform_admins'
);
RESET ROLE;

-- 7f: anon has no privilege at all.
SELECT is(has_table_privilege('anon', 'public.platform_admins', 'SELECT'), false,
  '7f: anon has no SELECT privilege on platform_admins');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 4: Run the pgTAP suite**

Run: `npx supabase test db`
Expected: `1..6`, all 6 tests pass (`ok 1` .. `ok 6`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/090_wafi155_rollout_flags.sql supabase/tests/wafi155_rollout_flags.test.sql
git commit -m "feat(WAFI-155): add platform_admins table with RLS and explicit grants"
```

---

## Task 2: `set_rollout_flag` RPC

**Files:**
- Modify: `supabase/migrations/090_wafi155_rollout_flags.sql`
- Modify: `supabase/tests/wafi155_rollout_flags.test.sql`

**Interfaces:**
- Consumes: `public.platform_admins` (Task 1).
- Produces: `public.set_rollout_flag(p_shop_id uuid, p_flag_key text, p_enabled boolean) RETURNS void`, `EXECUTE` granted to `authenticated` only. Task 3's `list_shops_for_rollout_admin` reads the same `shops.features -> 'rollout'` shape this function writes; the client tasks (4+) call this RPC by name with these exact parameter names.

- [ ] **Step 1: Append the RPC to the migration file**

Append to `supabase/migrations/090_wafi155_rollout_flags.sql`:

```sql
CREATE OR REPLACE FUNCTION public.set_rollout_flag(
  p_shop_id  uuid,
  p_flag_key text,
  p_enabled  boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Authorization first, before any parameter is validated -- an
  -- unauthorized caller must not learn whether p_shop_id/p_flag_key are
  -- even well-formed.
  IF NOT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = 'P0001';
  END IF;

  IF p_shop_id IS NULL THEN
    RAISE EXCEPTION 'shop id is required' USING ERRCODE = 'P0002';
  END IF;
  IF p_flag_key IS NULL OR p_enabled IS NULL THEN
    RAISE EXCEPTION 'flag key and enabled value are required' USING ERRCODE = 'P0003';
  END IF;

  IF p_flag_key NOT IN ('dashboard_v2', 'pos_brain', 'insights') THEN
    RAISE EXCEPTION 'unknown rollout flag: %', p_flag_key USING ERRCODE = 'P0003';
  END IF;

  -- protect_shop_server_only_columns (075) reverts `features` on ANY
  -- request carrying a JWT, with no exception for a trusted SECURITY
  -- DEFINER RPC's own write -- SECURITY DEFINER changes privilege-checking
  -- identity, not this custom GUC, which stays set for the whole request
  -- regardless of which function runs inside it. Authorization has already
  -- been verified above; this is a narrowly scoped, single-statement
  -- override, transaction-local (is_local=true) so it cannot leak into any
  -- other request. Do not copy this pattern elsewhere without the same
  -- preceding authorization guarantee.
  PERFORM set_config('request.jwt.claims', '', true);

  -- A NULL (or otherwise non-object) features blob means resolveFlag()
  -- (flagRegistry.ts) currently grants this shop every pack. Materialize
  -- that same all-on state before applying the rollout path -- not
  -- migration 041's one-time backfill literal, which used different values
  -- for a different, already-known set of shops at a different time.
  UPDATE shops
     SET features = jsonb_set(
           CASE
             WHEN features IS NULL OR jsonb_typeof(features) IS DISTINCT FROM 'object' THEN
               '{"staff_pack": true, "customer_pack": true, "reporting_pack": true, "electronics_pro": true}'::jsonb
             ELSE features
           END,
           ARRAY['rollout', p_flag_key],
           to_jsonb(p_enabled),
           true)
   WHERE id = p_shop_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop not found: %', p_shop_id USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_rollout_flag(uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_rollout_flag(uuid, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_rollout_flag(uuid, text, boolean) TO authenticated;
```

- [ ] **Step 2: Apply the updated migration**

Run: `npx supabase db reset`
Expected: no errors.

- [ ] **Step 3: Append the new pgTAP tests**

In `supabase/tests/wafi155_rollout_flags.test.sql`, change `SELECT plan(6);` to `SELECT plan(19);`, then insert this block right before `SELECT * FROM finish();`:

```sql
-- ========================================================================
-- 1. Authorization boundary (set_rollout_flag half)
-- ========================================================================

SELECT set_config('request.jwt.claims', '{"sub":"d2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.set_rollout_flag(
       (SELECT id FROM public.shops WHERE owner_user_id = 'd2222222-2222-2222-2222-222222222222'),
       'dashboard_v2', true) $$,
  'P0001', NULL, '1a: non-admin authenticated caller gets P0001 from set_rollout_flag'
);
RESET ROLE;

SELECT is(has_function_privilege('anon', 'public.set_rollout_flag(uuid, text, boolean)', 'EXECUTE'), false,
  '1c: anon has no EXECUTE on set_rollout_flag');

-- ========================================================================
-- 2. NULL-features grandfathering (the blocking design-review finding)
-- ========================================================================

SELECT set_config('request.jwt.claims', '{"sub":"d1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$ SELECT public.set_rollout_flag(
       (SELECT id FROM public.shops WHERE owner_user_id = 'd2222222-2222-2222-2222-222222222222'),
       'dashboard_v2', true) $$,
  '2a: platform admin can set a rollout flag on a NULL-features shop'
);
RESET ROLE;

-- 2b: re-read in a FRESH query -- the actual regression test for the
-- trigger-bypass fix; a silently-reverted write would still pass 2a.
SELECT is(
  (SELECT features FROM public.shops WHERE owner_user_id = 'd2222222-2222-2222-2222-222222222222'),
  '{"rollout": {"dashboard_v2": true}, "staff_pack": true, "customer_pack": true, "reporting_pack": true, "electronics_pro": true}'::jsonb,
  '2b: features persisted the rollout key AND materialized all four packs true, matching pre-write resolveFlag(null,...) behavior'
);

-- ========================================================================
-- 3. Sequential path-preservation (not a concurrency test)
-- ========================================================================

SELECT set_config('request.jwt.claims', '{"sub":"d1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT public.set_rollout_flag(
  (SELECT id FROM public.shops WHERE owner_user_id = 'd2222222-2222-2222-2222-222222222222'),
  'pos_brain', true);
RESET ROLE;
SELECT is(
  (SELECT features FROM public.shops WHERE owner_user_id = 'd2222222-2222-2222-2222-222222222222'),
  '{"rollout": {"dashboard_v2": true, "pos_brain": true}, "staff_pack": true, "customer_pack": true, "reporting_pack": true, "electronics_pro": true}'::jsonb,
  '3a: setting pos_brain preserves dashboard_v2 and all pack keys'
);

-- ========================================================================
-- 4. NULL materialization for p_enabled = false (pristine second shop)
-- ========================================================================

SELECT set_config('request.jwt.claims', '{"sub":"d1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT public.set_rollout_flag(
  (SELECT id FROM public.shops WHERE owner_user_id = 'd3333333-3333-3333-3333-333333333333'),
  'dashboard_v2', false);
RESET ROLE;
SELECT is(
  (SELECT features FROM public.shops WHERE owner_user_id = 'd3333333-3333-3333-3333-333333333333'),
  '{"rollout": {"dashboard_v2": false}, "staff_pack": true, "customer_pack": true, "reporting_pack": true, "electronics_pro": true}'::jsonb,
  '4: a disabling write to a NULL-features shop still materializes pack defaults true'
);

-- ========================================================================
-- 5. Parameter validation
-- ========================================================================

SELECT set_config('request.jwt.claims', '{"sub":"d1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.set_rollout_flag(NULL, 'dashboard_v2', true) $$,
  'P0002', NULL, '5a: NULL shop id raises P0002'
);
SELECT throws_ok(
  $$ SELECT public.set_rollout_flag(
       (SELECT id FROM public.shops WHERE owner_user_id = 'd2222222-2222-2222-2222-222222222222'),
       NULL, true) $$,
  'P0003', NULL, '5b: NULL flag key raises P0003'
);
SELECT throws_ok(
  $$ SELECT public.set_rollout_flag(
       (SELECT id FROM public.shops WHERE owner_user_id = 'd2222222-2222-2222-2222-222222222222'),
       'dashboard_v2', NULL) $$,
  'P0003', NULL, '5c: NULL enabled value raises P0003'
);
SELECT throws_ok(
  $$ SELECT public.set_rollout_flag(
       (SELECT id FROM public.shops WHERE owner_user_id = 'd2222222-2222-2222-2222-222222222222'),
       'not_a_real_flag', true) $$,
  'P0003', NULL, '5d: unknown flag key raises P0003'
);
SELECT throws_ok(
  $$ SELECT public.set_rollout_flag('00000000-0000-0000-0000-000000000099', 'dashboard_v2', true) $$,
  'P0002', NULL, '5e: nonexistent shop id raises P0002'
);
RESET ROLE;

-- ========================================================================
-- 8. Direct-client-write regression guard (both directions of the trigger)
-- ========================================================================

-- 8a: a non-admin owner's direct UPDATE to their own shop's features is
-- reverted by protect_shop_server_only_columns.
SELECT set_config('request.jwt.claims', '{"sub":"d3333333-3333-3333-3333-333333333333","role":"authenticated","active_role":"owner"}', true);
SET LOCAL ROLE authenticated;
UPDATE public.shops
   SET features = '{"staff_pack": false}'::jsonb
 WHERE owner_user_id = 'd3333333-3333-3333-3333-333333333333';
RESET ROLE;
SELECT isnt(
  (SELECT features FROM public.shops WHERE owner_user_id = 'd3333333-3333-3333-3333-333333333333'),
  '{"staff_pack": false}'::jsonb,
  '8a: a direct client UPDATE to features is reverted by protect_shop_server_only_columns'
);

-- 8b: the trusted RPC's own write (2a/2b/3a above) is NOT reverted -- named
-- separately since it is the opposite direction of 8a.
SELECT is(
  (SELECT features -> 'rollout' ->> 'dashboard_v2' FROM public.shops WHERE owner_user_id = 'd2222222-2222-2222-2222-222222222222'),
  'true',
  '8b: set_rollout_flag''s own write from 2a/3a is still persisted, proving the trigger does not revert the trusted RPC path'
);
```

- [ ] **Step 4: Run the pgTAP suite**

Run: `npx supabase test db`
Expected: `1..19`, all 19 tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/090_wafi155_rollout_flags.sql supabase/tests/wafi155_rollout_flags.test.sql
git commit -m "feat(WAFI-155): add set_rollout_flag RPC with NULL-materialization and trigger-bypass fixes"
```

---

## Task 3: `list_shops_for_rollout_admin` RPC

**Files:**
- Modify: `supabase/migrations/090_wafi155_rollout_flags.sql`
- Modify: `supabase/tests/wafi155_rollout_flags.test.sql`

**Interfaces:**
- Consumes: `public.platform_admins` (Task 1), reads `shops.features -> 'rollout'` written by `set_rollout_flag` (Task 2).
- Produces: `public.list_shops_for_rollout_admin(p_query text DEFAULT NULL) RETURNS TABLE (shop_id uuid, shop_name text, dashboard_v2 boolean, pos_brain boolean, insights boolean)`. Task 8's `useRolloutAdmin` composable calls this RPC by name and destructures exactly these five column names.

- [ ] **Step 1: Append the RPC to the migration file**

Append to `supabase/migrations/090_wafi155_rollout_flags.sql`:

```sql
CREATE OR REPLACE FUNCTION public.list_shops_for_rollout_admin(p_query text DEFAULT NULL)
RETURNS TABLE (
  shop_id      uuid,
  shop_name    text,
  dashboard_v2 boolean,
  pos_brain    boolean,
  insights     boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = 'P0001';
  END IF;

  -- Fail-closed flag parsing, matching the TypeScript resolver's contract:
  -- only the JSON literal `true` reads as enabled. `= 'true'::jsonb` on a
  -- non-boolean value evaluates to NULL rather than throwing, so
  -- coalesce(..., false) safely reduces every malformed case to "off".
  RETURN QUERY
  SELECT s.id, s.name,
         coalesce(s.features -> 'rollout' -> 'dashboard_v2' = 'true'::jsonb, false),
         coalesce(s.features -> 'rollout' -> 'pos_brain'    = 'true'::jsonb, false),
         coalesce(s.features -> 'rollout' -> 'insights'     = 'true'::jsonb, false)
    FROM shops s
   WHERE NULLIF(trim(p_query), '') IS NULL
      OR s.name ILIKE '%' || trim(p_query) || '%'
   ORDER BY s.name, s.id
   LIMIT 100;
END;
$$;

REVOKE ALL ON FUNCTION public.list_shops_for_rollout_admin(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_shops_for_rollout_admin(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_shops_for_rollout_admin(text) TO authenticated;
```

- [ ] **Step 2: Apply the updated migration**

Run: `npx supabase db reset`
Expected: no errors.

- [ ] **Step 3: Append the new pgTAP tests**

In `supabase/tests/wafi155_rollout_flags.test.sql`, change `SELECT plan(19);` to `SELECT plan(25);`, then insert this block right before `SELECT * FROM finish();`:

```sql
-- ========================================================================
-- 1. Authorization boundary (list_shops_for_rollout_admin half)
-- ========================================================================

SELECT set_config('request.jwt.claims', '{"sub":"d2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT * FROM public.list_shops_for_rollout_admin(NULL) $$,
  'P0001', NULL, '1b: non-admin authenticated caller gets P0001 from list_shops_for_rollout_admin'
);
RESET ROLE;

SELECT is(has_function_privilege('anon', 'public.list_shops_for_rollout_admin(text)', 'EXECUTE'), false,
  '1d: anon has no EXECUTE on list_shops_for_rollout_admin');

-- ========================================================================
-- 6. list_shops_for_rollout_admin behavior
-- ========================================================================

SELECT set_config('request.jwt.claims', '{"sub":"d1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.list_shops_for_rollout_admin(NULL)),
  (SELECT count(*)::int FROM public.list_shops_for_rollout_admin('')),
  '6a: NULL and empty-string query return the same row count'
);
SELECT is(
  (SELECT count(*)::int FROM public.list_shops_for_rollout_admin('')),
  (SELECT count(*)::int FROM public.list_shops_for_rollout_admin('   ')),
  '6b: empty-string and whitespace-only query return the same row count'
);
SELECT is(
  (SELECT (dashboard_v2, pos_brain, insights) FROM public.list_shops_for_rollout_admin(NULL)
     WHERE shop_id = (SELECT id FROM public.shops WHERE owner_user_id = 'd2222222-2222-2222-2222-222222222222')),
  (true, true, false),
  '6c: list RPC reports the correct rollout state for a shop with mixed flags'
);

RESET ROLE;

-- 6d: malformed rollout value resolves to false, not an error.
UPDATE public.shops
   SET features = jsonb_set(features, '{rollout,insights}', '"true"'::jsonb)
 WHERE owner_user_id = 'd2222222-2222-2222-2222-222222222222';
SELECT set_config('request.jwt.claims', '{"sub":"d1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT insights FROM public.list_shops_for_rollout_admin(NULL)
     WHERE shop_id = (SELECT id FROM public.shops WHERE owner_user_id = 'd2222222-2222-2222-2222-222222222222')),
  false,
  '6d: a malformed (string, not boolean) rollout value resolves to false, not an error'
);
RESET ROLE;
```

- [ ] **Step 4: Run the pgTAP suite**

Run: `npx supabase test db`
Expected: `1..25`, all 25 tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/090_wafi155_rollout_flags.sql supabase/tests/wafi155_rollout_flags.test.sql
git commit -m "feat(WAFI-155): add list_shops_for_rollout_admin RPC with fail-closed flag parsing"
```

---

## Task 4: TypeScript rollout registry + resolver

**Files:**
- Modify: `src/features/flags/flagRegistry.ts`
- Modify: `src/__tests__/features/featureFlags.test.ts`

**Interfaces:**
- Produces: `ROLLOUT_FLAG_KEYS`, `type RolloutFlagKey`, `resolveRollout(features, key): boolean`. Task 5's `flags.store.ts` imports all three.

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/features/featureFlags.test.ts`:

```ts
import { resolveRollout, ROLLOUT_FLAG_KEYS } from '@/features/flags/flagRegistry'

describe('flagRegistry.resolveRollout (WAFI-155 semantics)', () => {
  it('is fail-closed for every non-true rollout value', () => {
    const cases: unknown[] = [undefined, null, false, 0, 'true', {}, []]
    for (const rollout of cases) {
      expect(resolveRollout({ rollout } as any, 'dashboard_v2')).toBe(false)
    }
  })

  it('resolves true only when the value is the literal boolean true', () => {
    expect(resolveRollout({ rollout: { dashboard_v2: true } }, 'dashboard_v2')).toBe(true)
  })

  it('resolves false when features itself is null', () => {
    expect(resolveRollout(null, 'dashboard_v2')).toBe(false)
  })

  it('exposes exactly the three documented rollout keys', () => {
    expect(ROLLOUT_FLAG_KEYS).toEqual(['dashboard_v2', 'pos_brain', 'insights'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/featureFlags.test.ts`
Expected: FAIL — `resolveRollout`/`ROLLOUT_FLAG_KEYS` not exported from `flagRegistry.ts`.

- [ ] **Step 3: Add the registry and resolver**

Append to `src/features/flags/flagRegistry.ts`:

```ts
/**
 * WAFI-155: engineering rollout flags -- "should this implementation
 * currently run for this shop?", independent of WAFI-131's pack
 * entitlements above ("does the shop's subscription include this?").
 * Deliberately a separate type/resolver, never merged into FlagKey/
 * resolveFlag: that would risk WAFI-131's null-blob "grandfathered -> all
 * on" pack semantics leaking into rollout-flag semantics, which must
 * always default closed for safety.
 */
export const ROLLOUT_FLAG_KEYS = ['dashboard_v2', 'pos_brain', 'insights'] as const
export type RolloutFlagKey = typeof ROLLOUT_FLAG_KEYS[number]

/** Fail-closed: missing/absent/malformed rollout config -> false. Only the
 *  literal boolean `true` ever enables a rollout. */
export function resolveRollout(
  features: Record<string, unknown> | null,
  key: RolloutFlagKey,
): boolean {
  const rollout = features?.rollout
  if (typeof rollout !== 'object' || rollout === null) return false
  return (rollout as Record<string, unknown>)[key] === true
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/featureFlags.test.ts`
Expected: PASS, all new tests green.

- [ ] **Step 5: Commit**

```bash
git add src/features/flags/flagRegistry.ts src/__tests__/features/featureFlags.test.ts
git commit -m "feat(WAFI-155): add ROLLOUT_FLAG_KEYS registry and fail-closed resolveRollout"
```

---

## Task 5: `flags.store.ts` — `isRolloutEnabled`

**Files:**
- Modify: `src/features/flags/flags.store.ts`
- Modify: `src/__tests__/features/featureFlags.test.ts`

**Interfaces:**
- Consumes: `resolveRollout`, `RolloutFlagKey` (Task 4).
- Produces: `useFlagsStore().isRolloutEnabled(key: RolloutFlagKey): boolean`. Tasks 7-9 (router guard, admin screen consumers, and any future rollout-gated feature) call this method.

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/features/featureFlags.test.ts`:

```ts
describe('useFlagsStore.isRolloutEnabled', () => {
  it('reads rollout state from the same loaded features as isEnabled, with no extra query', async () => {
    const store = useFlagsStore()
    store.features = { staff_pack: true, rollout: { dashboard_v2: true } }
    store.loaded = true
    expect(store.isRolloutEnabled('dashboard_v2')).toBe(true)
    expect(store.isRolloutEnabled('pos_brain')).toBe(false)
  })
})
```

(This test lives alongside the existing `useFlagsStore` describe block in the same file — check the existing block's imports/setup (`setActivePinia(createPinia())` in a `beforeEach`) and reuse it rather than duplicating.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/featureFlags.test.ts`
Expected: FAIL — `store.isRolloutEnabled` is not a function.

- [ ] **Step 3: Add `isRolloutEnabled` to the store**

In `src/features/flags/flags.store.ts`, update the import and add the method:

```ts
import { resolveFlag, resolveRollout, type FlagKey, type RolloutFlagKey } from './flagRegistry'
```

```ts
  function isRolloutEnabled(key: RolloutFlagKey): boolean {
    return resolveRollout(features.value, key)
  }

  return { features, loaded, load, ensureLoaded, isEnabled, isRolloutEnabled }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/featureFlags.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/flags/flags.store.ts src/__tests__/features/featureFlags.test.ts
git commit -m "feat(WAFI-155): add isRolloutEnabled to flags.store.ts"
```

---

## Task 6: `usePlatformAdminStore`

**Files:**
- Create: `src/features/admin/platformAdmin.store.ts`
- Create: `src/features/admin/__tests__/platformAdmin.store.test.ts`

**Interfaces:**
- Consumes: `supabase` client (`@/data/supabase/client`), specifically `supabase.auth.getSession()`, `supabase.auth.onAuthStateChange()`, `supabase.from('platform_admins').select('user_id').eq('user_id', uid).maybeSingle()`.
- Produces: `usePlatformAdminStore()` returning `{ isAdmin: Ref<boolean>, ensureChecked(): Promise<boolean> }`. Tasks 7 (router guard, sidebar) and 9 (admin screen) call `ensureChecked()` and read `isAdmin`.

- [ ] **Step 1: Write the failing tests**

Create `src/features/admin/__tests__/platformAdmin.store.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const maybeSingleMock = vi.fn()
const getSessionMock = vi.fn()
let authChangeCb: ((event: string) => void) | undefined

vi.mock('@/data/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => getSessionMock(...args),
      onAuthStateChange: (cb: (event: string) => void) => {
        authChangeCb = cb
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
    },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: (...args: unknown[]) => maybeSingleMock(...args) }),
      }),
    }),
  },
}))

import { usePlatformAdminStore } from '@/features/admin/platformAdmin.store'

function session(userId: string | null) {
  return { data: { session: userId ? { user: { id: userId } } : null } }
}

describe('usePlatformAdminStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    authChangeCb = undefined
  })

  it('queries once and caches isAdmin for the current user', async () => {
    getSessionMock.mockResolvedValue(session('user-1'))
    maybeSingleMock.mockResolvedValue({ data: { user_id: 'user-1' }, error: null })

    const store = usePlatformAdminStore()
    expect(await store.ensureChecked()).toBe(true)
    expect(await store.ensureChecked()).toBe(true)
    expect(maybeSingleMock).toHaveBeenCalledTimes(1)
  })

  it('returns false and does not cache on no current user', async () => {
    getSessionMock.mockResolvedValue(session(null))

    const store = usePlatformAdminStore()
    expect(await store.ensureChecked()).toBe(false)
    expect(maybeSingleMock).not.toHaveBeenCalled()
  })

  it('resets on a different user (sign-out then sign-in as a non-admin)', async () => {
    getSessionMock.mockResolvedValueOnce(session('admin-1'))
    maybeSingleMock.mockResolvedValueOnce({ data: { user_id: 'admin-1' }, error: null })
    const store = usePlatformAdminStore()
    expect(await store.ensureChecked()).toBe(true)

    authChangeCb?.('SIGNED_OUT')

    getSessionMock.mockResolvedValueOnce(session('user-2'))
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null })
    expect(await store.ensureChecked()).toBe(false)
    expect(maybeSingleMock).toHaveBeenCalledTimes(2)
  })

  it('leaves a failed check retryable, not permanently cached as non-admin', async () => {
    getSessionMock.mockResolvedValue(session('user-1'))
    maybeSingleMock
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({ data: { user_id: 'user-1' }, error: null })

    const store = usePlatformAdminStore()
    expect(await store.ensureChecked()).toBe(false)
    expect(await store.ensureChecked()).toBe(true)
    expect(maybeSingleMock).toHaveBeenCalledTimes(2)
  })

  it('deduplicates concurrent calls for the same user into one query', async () => {
    getSessionMock.mockResolvedValue(session('user-1'))
    let resolveQuery: (v: unknown) => void = () => {}
    maybeSingleMock.mockReturnValue(new Promise(r => { resolveQuery = r }))

    const store = usePlatformAdminStore()
    const p1 = store.ensureChecked()
    const p2 = store.ensureChecked()
    resolveQuery({ data: { user_id: 'user-1' }, error: null })

    expect(await p1).toBe(true)
    expect(await p2).toBe(true)
    expect(maybeSingleMock).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/admin/__tests__/platformAdmin.store.test.ts`
Expected: FAIL — module `@/features/admin/platformAdmin.store` does not exist.

- [ ] **Step 3: Implement the store**

Create `src/features/admin/platformAdmin.store.ts`:

```ts
import { ref } from 'vue'
import { defineStore } from 'pinia'
import { supabase } from '@/data/supabase/client'

/**
 * WAFI-155: platform-admin identity, orthogonal to any shop's staff/role
 * model (session.store.ts). Tied to auth.uid() directly -- a platform
 * admin need not have a `staff` row in any shop. Not persisted: cheap
 * enough to re-check once per session, and a security-relevant flag
 * shouldn't live in local storage.
 */
export const usePlatformAdminStore = defineStore('platformAdmin', () => {
  const checkedForUserId = ref<string | null>(null)
  const isAdmin = ref(false)
  let pendingPromise: Promise<boolean> | null = null

  async function ensureChecked(): Promise<boolean> {
    const { data } = await supabase.auth.getSession()
    const userId = data.session?.user.id ?? null

    // No current authenticated user (e.g. app boot before session restore
    // completes) -- not a real check, must not be cached as one.
    if (!userId) {
      isAdmin.value = false
      return false
    }

    if (checkedForUserId.value === userId) return isAdmin.value
    if (pendingPromise) return pendingPromise

    pendingPromise = (async () => {
      try {
        const { data: row } = await supabase
          .from('platform_admins')
          .select('user_id')
          .eq('user_id', userId)
          .maybeSingle()
        checkedForUserId.value = userId
        isAdmin.value = Boolean(row)
        return isAdmin.value
      } catch {
        // Network/query error: remains retryable on the next call rather
        // than being permanently and incorrectly cached as "not admin."
        isAdmin.value = false
        return false
      } finally {
        pendingPromise = null
      }
    })()

    return pendingPromise
  }

  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      checkedForUserId.value = null
      isAdmin.value = false
    }
  })

  return { isAdmin, ensureChecked }
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/admin/__tests__/platformAdmin.store.test.ts`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/features/admin/platformAdmin.store.ts src/features/admin/__tests__/platformAdmin.store.test.ts
git commit -m "feat(WAFI-155): add usePlatformAdminStore with per-user caching and in-flight dedup"
```

---

## Task 7: Router guard + sidebar nav item

**Files:**
- Modify: `src/router/index.ts`
- Modify: `src/router/__tests__/index.test.ts`
- Modify: `src/components/layout/AppSidebar.vue`

**Interfaces:**
- Consumes: `usePlatformAdminStore` (Task 6).
- Produces: route `/admin/rollouts` with `meta: { requiresPlatformAdmin: true }`, reachable only by a platform admin; a "Feature Rollouts" sidebar entry visible only to a platform admin. Task 9's `RolloutAdminScreen.vue` is the component this route loads.

- [ ] **Step 1: Write the failing router guard test**

Check the existing test file's mocking setup first (`src/router/__tests__/index.test.ts` already mocks `supabase.auth.getSession` for the auth guard) and add a case in the same style:

```ts
import { usePlatformAdminStore } from '@/features/admin/platformAdmin.store'

it('redirects away from /admin/rollouts for a non-platform-admin', async () => {
  // ... reuse this file's existing pattern for setting an authenticated
  // session, then:
  const admin = usePlatformAdminStore()
  vi.spyOn(admin, 'ensureChecked').mockResolvedValue(false)
  const result = await router.push('/admin/rollouts')
  expect(router.currentRoute.value.path).not.toBe('/admin/rollouts')
})

it('allows a platform admin to reach /admin/rollouts', async () => {
  const admin = usePlatformAdminStore()
  vi.spyOn(admin, 'ensureChecked').mockResolvedValue(true)
  await router.push('/admin/rollouts')
  expect(router.currentRoute.value.path).toBe('/admin/rollouts')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/router/__tests__/index.test.ts`
Expected: FAIL — `/admin/rollouts` route does not exist (404 or no match).

- [ ] **Step 3: Add the route and guard**

In `src/router/index.ts`, add the import:

```ts
import { usePlatformAdminStore } from '@/features/admin/platformAdmin.store'
```

Add the route to the `routes` array:

```ts
    { path: '/admin/rollouts', component: () => import('@/features/admin/RolloutAdminScreen.vue'), meta: { requiresPlatformAdmin: true } },
```

In the `router.beforeEach` guard, add this block right after the `PUBLIC_PATHS` early-returns and before the `const required = to.meta.permission` line:

```ts
  // WAFI-155: platform-admin gate, independent of the staff/permission
  // model above -- a platform admin need not have a staff row anywhere.
  // Redirect away as if the route doesn't exist, not to a "not allowed"
  // page, so the route isn't advertised to non-admins. A failed check
  // (network error) is treated the same as isAdmin=false; because the
  // store never caches a failed check as complete, navigating here again
  // later retries rather than permanently locking the admin out.
  if (to.meta.requiresPlatformAdmin) {
    const isAdmin = await usePlatformAdminStore().ensureChecked()
    return isAdmin ? true : '/'
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/router/__tests__/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the sidebar nav item**

In `src/components/layout/AppSidebar.vue`, add the import and store:

```ts
import { usePlatformAdminStore } from '@/features/admin/platformAdmin.store'
```

```ts
const platformAdmin = usePlatformAdminStore()
onMounted(() => { void platformAdmin.ensureChecked() })
```

Add a nav item, rendered separately from `navItems` (it has no `permission`/`feature` gate — it's gated on `platformAdmin.isAdmin` alone, a different axis than the rest of the sidebar):

```html
<RouterLink v-if="platformAdmin.isAdmin" to="/admin/rollouts" class="nav-item">
  {{ $t('nav.featureRollouts') }}
</RouterLink>
```

(Check the existing template's nav-item markup structure and match its exact classes/wrapper elements — the `v-if`/`to`/label pattern above is the logic; the surrounding markup must match the file's existing nav items exactly, e.g. icon slot if present.)

Add the i18n key `nav.featureRollouts: 'Feature Rollouts'` (and the Arabic translation, matching this file's existing i18n key convention) to the locale files this codebase already uses for `nav.*` keys.

- [ ] **Step 6: Run the full test suite for this file**

Run: `npx vitest run src/router/__tests__/index.test.ts src/components/layout/__tests__/AppSidebar.test.ts` (adjust the second path if the actual sidebar test file has a different name — check via `find src/components/layout -iname "*sidebar*test*"` first)
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/router/index.ts src/router/__tests__/index.test.ts src/components/layout/AppSidebar.vue
git commit -m "feat(WAFI-155): gate /admin/rollouts route and sidebar nav item on platform-admin status"
```

---

## Task 8: `useRolloutAdmin` composable — load & search

**Files:**
- Create: `src/features/admin/composables/useRolloutAdmin.ts`
- Create: `src/features/admin/composables/__tests__/useRolloutAdmin.test.ts`

**Interfaces:**
- Consumes: `supabase.rpc('list_shops_for_rollout_admin', { p_query })` (Task 3's RPC), `ROLLOUT_FLAG_KEYS` (Task 4).
- Produces: `useRolloutAdmin()` returning `{ shops: Ref<RolloutShopRow[]>, query: Ref<string>, loading: Ref<boolean>, capped: Ref<boolean>, refresh(): Promise<void> }` in this task; Task 9 extends the same composable with the toggle/mutation half (`pending`, `toggle()`, `valueFor()`) and `RolloutAdminScreen.vue` consumes the combined return.

- [ ] **Step 1: Write the failing tests**

Create `src/features/admin/composables/__tests__/useRolloutAdmin.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'

const rpcMock = vi.fn()
vi.mock('@/data/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}))

import { useRolloutAdmin } from '@/features/admin/composables/useRolloutAdmin'

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    shop_id: 's1', shop_name: 'Al Noor Pharmacy',
    dashboard_v2: false, pos_brain: false, insights: false,
    ...overrides,
  }
}

describe('useRolloutAdmin: load & search', () => {
  beforeEach(() => vi.clearAllMocks())

  it('loads shops on refresh()', async () => {
    rpcMock.mockResolvedValueOnce({ data: [row()], error: null })
    const admin = useRolloutAdmin()
    await admin.refresh()
    expect(rpcMock).toHaveBeenCalledWith('list_shops_for_rollout_admin', { p_query: '' })
    expect(admin.shops.value).toHaveLength(1)
    expect(admin.shops.value[0].shopName).toBe('Al Noor Pharmacy')
  })

  it('sets capped=true when exactly 100 rows return', async () => {
    rpcMock.mockResolvedValueOnce({ data: Array.from({ length: 100 }, (_, i) => row({ shop_id: `s${i}` })), error: null })
    const admin = useRolloutAdmin()
    await admin.refresh()
    expect(admin.capped.value).toBe(true)
  })

  it('discards a stale response that resolves after a newer request', async () => {
    let resolveFirst: (v: unknown) => void = () => {}
    rpcMock.mockReturnValueOnce(new Promise(r => { resolveFirst = r }))
    rpcMock.mockResolvedValueOnce({ data: [row({ shop_name: 'Second' })], error: null })

    const admin = useRolloutAdmin()
    const firstRefresh = admin.refresh()
    admin.query.value = 'Al'
    const secondRefresh = admin.refresh()

    // Second (newer) request resolves first.
    await secondRefresh
    // Now the first (now-stale) request resolves.
    resolveFirst({ data: [row({ shop_name: 'First' })], error: null })
    await firstRefresh
    await nextTick()

    expect(admin.shops.value).toHaveLength(1)
    expect(admin.shops.value[0].shopName).toBe('Second')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/admin/composables/__tests__/useRolloutAdmin.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the load/search half of the composable**

Create `src/features/admin/composables/useRolloutAdmin.ts`:

```ts
import { ref } from 'vue'
import { supabase } from '@/data/supabase/client'
import { ROLLOUT_FLAG_KEYS, type RolloutFlagKey } from '@/features/flags/flagRegistry'

export interface RolloutShopRow {
  shopId: string
  shopName: string
  flags: Record<RolloutFlagKey, boolean>
}

/**
 * WAFI-155: drives the internal-only /admin/rollouts screen. `latestRequestId`
 * is bumped both by a new list request AND by a successful mutation commit
 * (Task 9) -- the single mechanism that keeps a stale list response from
 * clobbering either a newer search result or a just-committed toggle.
 */
export function useRolloutAdmin() {
  const shops = ref<RolloutShopRow[]>([])
  const query = ref('')
  const loading = ref(false)
  const capped = ref(false)

  let latestRequestId = 0

  async function refresh(): Promise<void> {
    const requestId = ++latestRequestId
    loading.value = true
    const { data } = await supabase.rpc('list_shops_for_rollout_admin', { p_query: query.value })
    if (requestId !== latestRequestId) return // superseded by a newer request or mutation
    loading.value = false
    capped.value = (data ?? []).length === 100
    shops.value = (data ?? []).map((r: any) => ({
      shopId: r.shop_id,
      shopName: r.shop_name,
      flags: Object.fromEntries(ROLLOUT_FLAG_KEYS.map(k => [k, Boolean(r[k])])) as Record<RolloutFlagKey, boolean>,
    }))
  }

  return { shops, query, loading, capped, refresh, __bumpRequestId: () => ++latestRequestId }
}
```

(The `__bumpRequestId` escape hatch exists so Task 9's mutation-commit step can invalidate in-flight list requests without duplicating the `latestRequestId` counter in a second module-level variable — Task 9 will call it directly rather than reimplementing request-id tracking.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/admin/composables/__tests__/useRolloutAdmin.test.ts`
Expected: PASS, all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/features/admin/composables/useRolloutAdmin.ts src/features/admin/composables/__tests__/useRolloutAdmin.test.ts
git commit -m "feat(WAFI-155): add useRolloutAdmin composable with stale-response-guarded search"
```

---

## Task 9: `useRolloutAdmin` — toggle mutation + `RolloutAdminScreen.vue`

**Files:**
- Modify: `src/features/admin/composables/useRolloutAdmin.ts`
- Modify: `src/features/admin/composables/__tests__/useRolloutAdmin.test.ts`
- Create: `src/features/admin/RolloutAdminScreen.vue`

**Interfaces:**
- Consumes: `supabase.rpc('set_rollout_flag', { p_shop_id, p_flag_key, p_enabled })` (Task 2's RPC), the load/search half from Task 8.
- Produces: `useRolloutAdmin()`'s full return — `{ shops, query, loading, capped, refresh, isPending(shopId, flagKey), valueFor(shop, flagKey), toggle(shopId, flagKey) }` — and the screen component that renders it.

- [ ] **Step 1: Write the failing tests**

Append to `src/features/admin/composables/__tests__/useRolloutAdmin.test.ts`:

```ts
describe('useRolloutAdmin: toggle mutation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('commits the optimistic value into local state on success, with no dependency on a fresh refresh', async () => {
    rpcMock.mockResolvedValueOnce({ data: [row({ shop_id: 's1', dashboard_v2: false })], error: null })
    const admin = useRolloutAdmin()
    await admin.refresh()

    rpcMock.mockResolvedValueOnce({ data: null, error: null }) // set_rollout_flag success
    await admin.toggle('s1', 'dashboard_v2')

    expect(admin.valueFor(admin.shops.value[0], 'dashboard_v2')).toBe(true)
    expect(admin.isPending('s1', 'dashboard_v2')).toBe(false)
  })

  it('reverts to the last known server value on RPC failure', async () => {
    rpcMock.mockResolvedValueOnce({ data: [row({ shop_id: 's1', dashboard_v2: false })], error: null })
    const admin = useRolloutAdmin()
    await admin.refresh()

    rpcMock.mockResolvedValueOnce({ data: null, error: new Error('boom') })
    await admin.toggle('s1', 'dashboard_v2')

    expect(admin.valueFor(admin.shops.value[0], 'dashboard_v2')).toBe(false)
    expect(admin.isPending('s1', 'dashboard_v2')).toBe(false)
  })

  it('a second click while the first is pending is a no-op', async () => {
    rpcMock.mockResolvedValueOnce({ data: [row({ shop_id: 's1', dashboard_v2: false })], error: null })
    const admin = useRolloutAdmin()
    await admin.refresh()

    let resolveSet: (v: unknown) => void = () => {}
    rpcMock.mockReturnValueOnce(new Promise(r => { resolveSet = r }))
    const first = admin.toggle('s1', 'dashboard_v2')
    const second = admin.toggle('s1', 'dashboard_v2') // no-op: already pending

    resolveSet({ data: null, error: null })
    await first
    await second
    expect(rpcMock).toHaveBeenCalledTimes(2) // 1 refresh + 1 set_rollout_flag, not 2
  })

  it('a stale list response arriving after a successful mutation does not revert it', async () => {
    rpcMock.mockResolvedValueOnce({ data: [row({ shop_id: 's1', dashboard_v2: false })], error: null })
    const admin = useRolloutAdmin()
    await admin.refresh()

    // A search request starts but hasn't resolved yet.
    let resolveStaleList: (v: unknown) => void = () => {}
    rpcMock.mockReturnValueOnce(new Promise(r => { resolveStaleList = r }))
    const staleRefresh = admin.refresh()

    // The mutation completes before that stale search response arrives.
    rpcMock.mockResolvedValueOnce({ data: null, error: null })
    await admin.toggle('s1', 'dashboard_v2')

    // Now the stale (pre-mutation) search response arrives.
    resolveStaleList({ data: [row({ shop_id: 's1', dashboard_v2: false })], error: null })
    await staleRefresh

    expect(admin.valueFor(admin.shops.value[0], 'dashboard_v2')).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/admin/composables/__tests__/useRolloutAdmin.test.ts`
Expected: FAIL — `toggle`/`valueFor`/`isPending` are not functions.

- [ ] **Step 3: Implement the toggle/mutation half**

Replace `useRolloutAdmin.ts`'s return and add the mutation logic:

```ts
import { ref } from 'vue'
import { supabase } from '@/data/supabase/client'
import { ROLLOUT_FLAG_KEYS, type RolloutFlagKey } from '@/features/flags/flagRegistry'

export interface RolloutShopRow {
  shopId: string
  shopName: string
  flags: Record<RolloutFlagKey, boolean>
}

function pendingKey(shopId: string, flagKey: RolloutFlagKey): string {
  return `${shopId}:${flagKey}`
}

export function useRolloutAdmin() {
  const shops = ref<RolloutShopRow[]>([])
  const query = ref('')
  const loading = ref(false)
  const capped = ref(false)
  const pending = ref<Record<string, boolean>>({})

  let latestRequestId = 0

  async function refresh(): Promise<void> {
    const requestId = ++latestRequestId
    loading.value = true
    const { data } = await supabase.rpc('list_shops_for_rollout_admin', { p_query: query.value })
    if (requestId !== latestRequestId) return
    loading.value = false
    capped.value = (data ?? []).length === 100
    shops.value = (data ?? []).map((r: any) => ({
      shopId: r.shop_id,
      shopName: r.shop_name,
      flags: Object.fromEntries(ROLLOUT_FLAG_KEYS.map(k => [k, Boolean(r[k])])) as Record<RolloutFlagKey, boolean>,
    }))
  }

  function isPending(shopId: string, flagKey: RolloutFlagKey): boolean {
    return pendingKey(shopId, flagKey) in pending.value
  }

  /** Pending optimistic value if present, else the last-known server value. */
  function valueFor(shop: RolloutShopRow, flagKey: RolloutFlagKey): boolean {
    const key = pendingKey(shop.shopId, flagKey)
    return key in pending.value ? pending.value[key] : shop.flags[flagKey]
  }

  async function toggle(shopId: string, flagKey: RolloutFlagKey): Promise<void> {
    const key = pendingKey(shopId, flagKey)
    if (key in pending.value) return // already in flight -- no-op

    const shop = shops.value.find(s => s.shopId === shopId)
    if (!shop) return
    const newValue = !valueFor(shop, flagKey)
    pending.value = { ...pending.value, [key]: newValue }

    const { error } = await supabase.rpc('set_rollout_flag', {
      p_shop_id: shopId, p_flag_key: flagKey, p_enabled: newValue,
    })

    const { [key]: _, ...rest } = pending.value
    pending.value = rest

    if (!error) {
      // Commit into local server-state BEFORE clearing pending (already done
      // above) -- without this, the cell would fall back to the stale
      // pre-mutation value the instant `pending` is cleared.
      shop.flags = { ...shop.flags, [flagKey]: newValue }
      // Any list response already in flight predates this mutation and must
      // not be allowed to overwrite it -- bump the shared request counter so
      // refresh()'s staleness check discards that in-flight response.
      latestRequestId++
    }
    // On error: pending is already cleared above; shop.flags was never
    // touched, so valueFor() naturally reverts to the last known server value.
  }

  return { shops, query, loading, capped, refresh, isPending, valueFor, toggle }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/admin/composables/__tests__/useRolloutAdmin.test.ts`
Expected: PASS, all 7 tests green (3 from Task 8 + 4 new).

- [ ] **Step 5: Write `RolloutAdminScreen.vue`**

Create `src/features/admin/RolloutAdminScreen.vue`. Check `src/features/customers/MoneyOwedPage.vue` or another simple table-page component first for this codebase's page-header/table markup conventions (spacing, `dir="rtl"` handling, Tajawal typography classes) and match them — the logic below is the required behavior; the exact template markup/classes must match this codebase's existing page style:

```vue
<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { useRolloutAdmin } from './composables/useRolloutAdmin'
import { ROLLOUT_FLAG_KEYS } from '@/features/flags/flagRegistry'

const admin = useRolloutAdmin()
onMounted(() => { void admin.refresh() })

let debounceTimer: ReturnType<typeof setTimeout> | undefined
watch(admin.query, () => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => { void admin.refresh() }, 300)
})
</script>

<template>
  <div>
    <h1>Engineering rollout controls</h1>
    <p>
      These flags control unreleased or staged implementations. Changes are
      shop-wide and affect all devices belonging to the shop, applied after
      the shop's next device sync.
    </p>

    <input v-model="admin.query.value" placeholder="Search shop..." />

    <table>
      <thead>
        <tr>
          <th>Shop</th>
          <th v-for="key in ROLLOUT_FLAG_KEYS" :key="key">{{ key }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="shop in admin.shops.value" :key="shop.shopId">
          <td>{{ shop.shopName }}</td>
          <td v-for="key in ROLLOUT_FLAG_KEYS" :key="key">
            <button
              :disabled="admin.isPending(shop.shopId, key)"
              @click="admin.toggle(shop.shopId, key)"
            >
              {{ admin.valueFor(shop, key) ? 'ON' : 'OFF' }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <p v-if="admin.capped.value">
      Showing first 100 matches. Refine your search to find a specific shop.
    </p>
  </div>
</template>
```

- [ ] **Step 6: Manual smoke check**

Run the dev server (`npm run dev`), sign in as a user manually inserted into `platform_admins` in the local Supabase instance, navigate to `/admin/rollouts`, confirm the table loads, search filters it, and a toggle click flips a flag with no console errors. (This is a manual step — there is no automated end-to-end test in this plan for the full page render, matching the project's existing test-pyramid: composable logic is unit-tested above, the page itself is thin wiring.)

- [ ] **Step 7: Commit**

```bash
git add src/features/admin/composables/useRolloutAdmin.ts src/features/admin/composables/__tests__/useRolloutAdmin.test.ts src/features/admin/RolloutAdminScreen.vue
git commit -m "feat(WAFI-155): add rollout-flag toggle mutation and RolloutAdminScreen.vue"
```

---

## Post-implementation: production rollout (not automated, run manually)

After all tasks are merged and migration `090` is deployed to production:

1. Resolve each founder's `auth.users.id` (Supabase Auth dashboard) and run, once per founder, directly in the Supabase SQL editor:
   ```sql
   INSERT INTO platform_admins (user_id) VALUES ('<uuid>');
   ```
2. Confirm the "Feature Rollouts" sidebar entry appears for that founder's session and `/admin/rollouts` loads real shop data.
3. Regenerate Supabase's generated TypeScript types (whatever command this project already uses for that — check `package.json` scripts) to pick up `platform_admins` and the two new RPC signatures.
