# Server-Atomic Owner Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the launch-blocking circular bootstrap bug where a new self-serve owner signup can never complete first-run setup, by adding a server-side `SECURITY DEFINER` RPC (`bootstrap_owner_identity`) that atomically creates the owner's `devices`/`staff`/`device_sessions` rows, and rewiring the client's owner-setup flow to call it explicitly instead of relying on PowerSync's normal (and, for this one case, permanently blocked) upload queue.

**Architecture:** One new Postgres migration adds the RPC plus a `shops.bootstrap_completed_at` marker column. The client gets a small new `useOwnerBootstrap` composable that calls the RPC directly (mirroring `establishOperatorIdentity`'s existing RPC-call pattern), persists a `PendingBootstrap` record for crash recovery, and polls the local PowerSync DB for the replicated rows instead of writing them locally itself.

**Tech Stack:** Postgres (Supabase), pgTAP, Vue 3 + Pinia + PowerSync/SQLite (client), Vitest.

## Global Constraints

- The RPC's only client-controlled parameters are `p_device_id`, `p_staff_id`, `p_staff_name`, `p_pin` (raw). No role, permissions, device code, pin hash, or pin salt are ever accepted from the client — all computed/hardcoded server-side. (Design §"Minimal, non-security-deciding parameters")
- Return value is one of exactly three text values, referenced everywhere via named constants — never a raw string literal at a call site: `BOOTSTRAP_SUCCESS = 'success'`, `BOOTSTRAP_ALREADY_COMPLETE = 'already_bootstrapped'`, `BOOTSTRAP_INVALID_STATE = 'invalid_state'`. (Design §"Return type: named constants")
- The idempotency gate is `shops.bootstrap_completed_at IS NOT NULL`, never `staff.role = 'owner'` existence. (Design §"Bootstrap gate: an explicit completion marker")
- All `devices`/`staff` inserts use `ON CONFLICT (id) DO NOTHING`; `device_sessions` upsert uses `ON CONFLICT (device_id) DO UPDATE`. (Design §"Gate and body")
- No Docker/local Postgres is available in this environment. Verify migrations and pgTAP against a disposable Supabase project reached via `pg` (node-postgres) directly — the same approach already used successfully earlier this session — never assume `supabase test db`/`pg_prove` will work here.
- `PendingBootstrap` shape is exactly `{ deviceId: string, staffId: string, createdAt: string, attemptCount: number }` — no `pin` field, ever. (Design §"Client-side change", step 1)
- The 10-second local-DB poll timeout must show "Retry now" / "Continue later" — never silently proceed as if the local row exists. (Design §"Timeout behavior")

---

## Task 1: Migration 069 — `bootstrap_owner_identity()` RPC

**Files:**
- Create: `supabase/migrations/069_bootstrap_owner_identity.sql`

**Interfaces:**
- Produces: `public.bootstrap_owner_identity(p_device_id uuid, p_staff_id uuid, p_staff_name text, p_pin text) RETURNS text`, callable by `authenticated, anon`. Also produces `public.shops.bootstrap_completed_at timestamptz` column.
- Consumes: `public.auth_shop_id()` (migration 054), `public.allocate_device_code(uuid)` (migration 037), `pgcrypto`'s `gen_random_bytes()`/`digest()` (already enabled by migration 045).

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/069_bootstrap_owner_identity.sql
-- Fixes a launch-blocking circular bootstrap bug: a brand-new self-serve
-- owner's `staff` row and first `devices` row are created client-side
-- (offline-first), but uploading either to Supabase requires
-- auth_role() = 'owner', which is only ever set by switch_active_operator()
-- succeeding -- which itself requires those same rows to already exist
-- server-side. Fully circular; confirmed via live reproduction in
-- production, 2026-07-26. See
-- docs/superpowers/specs/2026-07-26-owner-bootstrap-rpc-design.md for the
-- full design and rationale (including why this is a dedicated RPC, not a
-- relaxed RLS policy, and why the gate is an explicit completion marker
-- rather than staff.role='owner' existence).

ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS bootstrap_completed_at timestamptz;

CREATE OR REPLACE FUNCTION public.bootstrap_owner_identity(
  p_device_id  uuid,
  p_staff_id   uuid,
  p_staff_name text,
  p_pin        text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shop_id  uuid;
  v_code     text;
  v_salt     text;
  v_hash     text;
BEGIN
  v_shop_id := public.auth_shop_id();
  IF v_shop_id IS NULL THEN
    RETURN 'invalid_state';
  END IF;

  -- Idempotency / retry safety: gated on the explicit completion marker,
  -- not on staff.role, so this stays meaningful even if WAFI later grows
  -- ownership transfer, co-owners, or imported shops (see design doc).
  IF EXISTS (
    SELECT 1 FROM public.shops
    WHERE id = v_shop_id AND bootstrap_completed_at IS NOT NULL
  ) THEN
    RETURN 'already_bootstrapped';
  END IF;

  v_code := public.allocate_device_code(v_shop_id);
  v_salt := encode(gen_random_bytes(16), 'hex');
  -- Same hash formula switch_active_operator() (migration 045) verifies
  -- against, so a PIN set here works immediately for a normal operator
  -- switch later.
  v_hash := encode(digest(v_salt || p_pin, 'sha256'), 'hex');

  INSERT INTO public.devices (id, shop_id, code, is_temporary, registered_at, sync_status)
  VALUES (p_device_id, v_shop_id, v_code, false, now(), 'synced')
  ON CONFLICT (id) DO NOTHING;

  -- Owner permissions are never client-supplied -- hardcoded to the same
  -- all-true set as OWNER_PERMISSIONS in src/features/staff/staff.types.ts.
  INSERT INTO public.staff (id, shop_id, name, pin_hash, pin_salt, role, permissions, is_active, created_at)
  VALUES (
    p_staff_id, v_shop_id, p_staff_name, v_hash, v_salt, 'owner',
    '{"can_view_reports":true,"can_manage_products":true,"can_manage_customers":true,'
    '"can_view_expenses":true,"can_manage_settings":true,"can_manage_inventory":true,'
    '"can_manage_suppliers":true,"can_manage_stock_take":true,"can_view_staff_ledger":true}',
    true, now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.device_sessions (device_id, shop_id, active_staff_id, active_role, updated_at)
  VALUES (p_device_id, v_shop_id, p_staff_id, 'owner', now())
  ON CONFLICT (device_id) DO UPDATE
    SET active_staff_id = excluded.active_staff_id,
        active_role     = excluded.active_role,
        updated_at      = excluded.updated_at;

  UPDATE public.shops SET bootstrap_completed_at = now() WHERE id = v_shop_id;

  RETURN 'success';
END;
$$;

-- Mirrors switch_active_operator's grants exactly (migration 045).
REVOKE ALL ON FUNCTION public.bootstrap_owner_identity(uuid, uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.bootstrap_owner_identity(uuid, uuid, text, text) TO authenticated, anon;
```

- [ ] **Step 2: Sanity-check the file parses as valid SQL**

Run: `node -e "require('fs').readFileSync('supabase/migrations/069_bootstrap_owner_identity.sql', 'utf8')"`
Expected: no output, exit code 0 (this only checks the file is readable; real syntax validation happens in Task 3 against a live Postgres).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/069_bootstrap_owner_identity.sql
git commit -m "feat: add bootstrap_owner_identity RPC to fix circular owner-signup lockout"
```

---

## Task 2: pgTAP regression suite for the RPC

**Files:**
- Create: `supabase/tests/wafi_owner_bootstrap.test.sql`

**Interfaces:**
- Consumes: `public.bootstrap_owner_identity` (Task 1). Follows the exact fixture/JWT-claim-setting pattern already established in `supabase/tests/wafi202_sales_immutability.test.sql` and `supabase/tests/wafi001_cash_shift_hardening.test.sql` (both in this repo already) — `set_config('request.jwt.claims', ..., true)` + `SET LOCAL ROLE authenticated`, `RESET ROLE` between assertions.

- [ ] **Step 1: Write the test file**

```sql
-- supabase/tests/wafi_owner_bootstrap.test.sql
-- Regression coverage for bootstrap_owner_identity() (migration 069) --
-- fixes the circular owner-signup bootstrap lockout. Run via a disposable
-- Postgres connection (see Task 3) since supabase test db/pg_prove require
-- Docker, unavailable in this environment.

BEGIN;
SELECT plan(9);

-- ============================================================
-- Fixtures: a fresh shop with NO staff/devices/device_sessions rows yet --
-- exactly the state a real new signup is in before OwnerSetupScreen runs.
-- ============================================================
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000002', 'owner-a@bootstrap.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');

-- provision_shop_for_new_user() (migration 021) already auto-created a shop
-- via its AFTER INSERT trigger -- replace it with the fixed-id row this
-- fixture hardcodes references to, same pattern as the other test files.
DELETE FROM public.shops WHERE owner_user_id = 'a0000000-0000-0000-0000-000000000002';
INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('a0000000-0000-0000-0000-000000000001', 'Bootstrap Test Shop A', 'a0000000-0000-0000-0000-000000000002');

-- A second, unrelated shop/owner -- proves bootstrap_completed_at is
-- scoped per-shop, not global.
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000002', 'owner-b@bootstrap.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');
DELETE FROM public.shops WHERE owner_user_id = 'b0000000-0000-0000-0000-000000000002';
INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('b0000000-0000-0000-0000-000000000001', 'Bootstrap Test Shop B', 'b0000000-0000-0000-0000-000000000002');

-- ============================================================
-- Test 1: fresh shop bootstraps successfully -- returns 'success'
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true);
SET LOCAL ROLE authenticated;

SELECT is(
  public.bootstrap_owner_identity(
    'a0000000-0000-0000-0000-000000000007'::uuid,
    'a0000000-0000-0000-0000-000000000003'::uuid,
    'Owner A',
    '1234'
  ),
  'success',
  'Test 1: fresh shop bootstraps successfully'
);

RESET ROLE;

-- ============================================================
-- Test 2: devices row was created for the new device
-- ============================================================
SELECT is(
  (SELECT count(*)::int FROM public.devices WHERE id = 'a0000000-0000-0000-0000-000000000007'),
  1,
  'Test 2: devices row created'
);

-- ============================================================
-- Test 3: staff row was created with role owner and is_active true
-- ============================================================
SELECT is(
  (SELECT role FROM public.staff WHERE id = 'a0000000-0000-0000-0000-000000000003'),
  'owner',
  'Test 3: staff row has role owner'
);

-- ============================================================
-- Test 4: staff permissions match OWNER_PERMISSIONS (all nine flags true)
-- ============================================================
SELECT is(
  (SELECT permissions::jsonb FROM public.staff WHERE id = 'a0000000-0000-0000-0000-000000000003'),
  '{"can_view_reports":true,"can_manage_products":true,"can_manage_customers":true,'
  '"can_view_expenses":true,"can_manage_settings":true,"can_manage_inventory":true,'
  '"can_manage_suppliers":true,"can_manage_stock_take":true,"can_view_staff_ledger":true}'::jsonb,
  'Test 4: staff permissions match OWNER_PERMISSIONS exactly'
);

-- ============================================================
-- Test 5: device_sessions row was created with active_role owner
-- ============================================================
SELECT is(
  (SELECT active_role FROM public.device_sessions WHERE device_id = 'a0000000-0000-0000-0000-000000000007'),
  'owner',
  'Test 5: device_sessions.active_role is owner'
);

-- ============================================================
-- Test 6: shops.bootstrap_completed_at is now set for this shop
-- ============================================================
SELECT ok(
  (SELECT bootstrap_completed_at FROM public.shops WHERE id = 'a0000000-0000-0000-0000-000000000001') IS NOT NULL,
  'Test 6: bootstrap_completed_at is set'
);

-- ============================================================
-- Test 7: the pin_hash matches switch_active_operator's own verification
-- formula (sha256(salt+pin) hex) -- a subsequent real operator switch with
-- the same PIN must succeed.
-- ============================================================
SELECT is(
  (SELECT pin_hash FROM public.staff WHERE id = 'a0000000-0000-0000-0000-000000000003'),
  (SELECT encode(digest(pin_salt || '1234', 'sha256'), 'hex') FROM public.staff WHERE id = 'a0000000-0000-0000-0000-000000000003'),
  'Test 7: pin_hash matches switch_active_operator''s verification formula'
);

-- ============================================================
-- Test 8: calling again with DIFFERENT ids after already-complete returns
-- 'already_bootstrapped' and does NOT create a second owner (idempotency +
-- retry-after-lost-local-ids safety -- see design doc's retry section).
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true);
SET LOCAL ROLE authenticated;

SELECT is(
  public.bootstrap_owner_identity(
    'a0000000-0000-0000-0000-00000000000a'::uuid,
    'a0000000-0000-0000-0000-00000000000b'::uuid,
    'Someone Else',
    '9999'
  ),
  'already_bootstrapped',
  'Test 8: retry with different ids after already-complete -- idempotent no-op'
);

RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.staff WHERE shop_id = 'a0000000-0000-0000-0000-000000000001' AND role = 'owner'),
  1,
  'Test 8b: still exactly one owner for shop A -- no duplicate created'
);

-- ============================================================
-- Test 9: a shop's own bootstrap is independent of another shop's --
-- shop B (never bootstrapped) still returns 'success' for its own owner.
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true);
SET LOCAL ROLE authenticated;

SELECT is(
  public.bootstrap_owner_identity(
    'b0000000-0000-0000-0000-000000000007'::uuid,
    'b0000000-0000-0000-0000-000000000003'::uuid,
    'Owner B',
    '4321'
  ),
  'success',
  'Test 9: an unrelated, not-yet-bootstrapped shop still succeeds'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/tests/wafi_owner_bootstrap.test.sql
git commit -m "test: add pgTAP regression suite for bootstrap_owner_identity"
```

---

## Task 3: Verify migration + tests against a disposable Supabase project

**Files:**
- None created — this task runs verification scripts in a scratch directory (not committed).

**Interfaces:**
- Consumes: `supabase/migrations/001` through `069` (all of them — this proves the new migration applies cleanly on top of the full existing history, not just in isolation), `supabase/tests/wafi_owner_bootstrap.test.sql` (Task 2), plus a re-run of the three existing suites (`wafi122_role_enforcement.test.sql`, `wafi202_sales_immutability.test.sql`, `wafi003_device_session_revocation.test.sql`, `wafi001_cash_shift_hardening.test.sql`) to confirm no regression.

- [ ] **Step 1: Create a disposable Supabase project**

In the Supabase dashboard: **New Project** → any throwaway name (e.g. `wafi-069-verify`) → any region → set and note a database password. Free tier is sufficient. This project is deleted at the end of this task (Step 6) — nothing here is kept.

- [ ] **Step 2: Set up a scratch Node script directory with the `pg` package**

```bash
mkdir -p /tmp/wafi-069-verify
cd /tmp/wafi-069-verify
npm init -y
npm install pg
```

- [ ] **Step 3: Apply the full migration history (001-069) to the disposable project**

Create `/tmp/wafi-069-verify/migrate.js`:

```js
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = process.argv[2];
const client = new Client({ connectionString: process.env.DB_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  await client.connect();
  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
  console.log(`Applying ${files.length} migrations...`);
  for (const f of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    try {
      await client.query(sql);
      console.log(`OK   ${f}`);
    } catch (e) {
      console.log(`FAIL ${f} -> ${e.message}`);
    }
  }
  await client.end();
  console.log('Done.');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
```

Run (replace `<password>` and `<project-ref>` with the disposable project's values — use the **session pooler** connection string, not the direct connection, since direct connections may resolve to an IPv6-only address this environment can't reach):

```bash
export DB_URL="postgresql://postgres.<project-ref>:<password>@<pooler-host>:5432/postgres"
node migrate.js "<path-to-repo>/supabase/migrations"
```

Expected: every line reads `OK   <filename>.sql`, ending with `Done.`. If migration `069_bootstrap_owner_identity.sql` (or any other) reports `FAIL`, stop and fix the reported error before continuing — do not proceed to Step 4 with a failed migration.

- [ ] **Step 2: Run the new pgTAP suite against the disposable project**

Create `/tmp/wafi-069-verify/runtest.js`:

```js
const { Client } = require('pg');
const fs = require('fs');

const FILE = process.argv[2];
const client = new Client({ connectionString: process.env.DB_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  await client.connect();
  const sql = fs.readFileSync(FILE, 'utf8');
  console.log(`--- Running ${FILE} ---`);
  client.on('notice', (msg) => console.log('NOTICE:', msg.message));
  try {
    const result = await client.query(sql);
    const results = Array.isArray(result) ? result : [result];
    for (const r of results) {
      if (r && r.rows) {
        for (const row of r.rows) {
          const vals = Object.values(row);
          console.log(vals.length === 1 ? vals[0] : JSON.stringify(row));
        }
      }
    }
  } catch (e) {
    console.log('ERROR during test run:', e.message);
  }
  await client.end();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
```

First confirm pgTAP is available (it ships enabled on most Supabase projects, but confirm rather than assume):

```bash
node -e "
const { Client } = require('pg');
const c = new Client({ connectionString: process.env.DB_URL, ssl: { rejectUnauthorized: false } });
c.connect().then(() => c.query(\"CREATE EXTENSION IF NOT EXISTS pgtap\")).then(() => { console.log('pgtap OK'); c.end(); }).catch(e => { console.error(e.message); process.exit(1); });
"
```

Expected: `pgtap OK`.

Then run the new suite:

```bash
node runtest.js "<path-to-repo>/supabase/tests/wafi_owner_bootstrap.test.sql"
```

Expected: `1..9` followed by nine lines each starting `ok N - ...` (no `not ok` lines). If any line reads `not ok`, read the `# Failed test` diagnostic Postgres prints immediately below it, fix the migration or test fixture (a fixture bug, not a real product bug, is the more likely cause on first run — this exact pattern happened twice already this session with `wafi001_cash_shift_hardening.test.sql`), and re-run from Step 1.

- [ ] **Step 3: Re-run the three pre-existing suites to confirm no regression**

```bash
node runtest.js "<path-to-repo>/supabase/tests/wafi122_role_enforcement.test.sql"
node runtest.js "<path-to-repo>/supabase/tests/wafi202_sales_immutability.test.sql"
node runtest.js "<path-to-repo>/supabase/tests/wafi003_device_session_revocation.test.sql"
node runtest.js "<path-to-repo>/supabase/tests/wafi001_cash_shift_hardening.test.sql"
```

Expected: `13/13`, `16/16`, `6/6`, `10/10` all-`ok` respectively (same counts as verified earlier this session) — zero regressions from adding migration 069.

- [ ] **Step 4: Delete the disposable Supabase project**

Dashboard → the throwaway project → Settings → General → Delete project. Nothing from this task is meant to persist.

- [ ] **Step 5: Commit** (no files changed by this task; this step documents verification happened)

```bash
git commit --allow-empty -m "test: verify migration 069 + full pgTAP suite (39/48 pre-existing + 9 new, all pass) against a disposable Supabase project"
```

---

## Task 4: Apply migration 069 to production

**Files:**
- None — this is a deployment step, not a code change.

**Interfaces:**
- Consumes: `supabase/migrations/069_bootstrap_owner_identity.sql` (Task 1), verified by Task 3.

- [ ] **Step 1: Get the current production database password**

In the Supabase dashboard for the production project (`eazyrdnvsiyaaccvjbhb`): Settings → Database → Reset database password (the current one from earlier this session may have already been rotated per the security follow-up from the WAFI-001 work) → copy the new password immediately from the reveal dialog.

- [ ] **Step 2: Get the session-pooler connection string**

Dashboard → "Connect" button → **Session pooler** tab → copy the URI (host contains `.pooler.supabase.com`, port `5432`, username `postgres.eazyrdnvsiyaaccvjbhb`). The transaction pooler (port 6543) does not work for `supabase db push` — it hit a `prepared statement already exists` PgBouncer error earlier this session; the session pooler (port 5432) is the one that worked.

- [ ] **Step 3: Dry-run the push**

```bash
npx supabase db push --db-url "postgresql://postgres.eazyrdnvsiyaaccvjbhb:<password>@<pooler-host>:5432/postgres" --dry-run
```

Expected output: `Would push these migrations:` followed by exactly one line, `• 069_bootstrap_owner_identity.sql` (all 68 prior migrations should already show as applied/tracked from earlier this session's `supabase db push --include-all`). If more than one migration is listed, stop — that means something regressed the migration-tracking state fixed earlier this session; investigate before proceeding rather than pushing blind.

- [ ] **Step 4: Push for real**

```bash
npx supabase db push --db-url "postgresql://postgres.eazyrdnvsiyaaccvjbhb:<password>@<pooler-host>:5432/postgres" --yes
```

Expected: `Applying migration 069_bootstrap_owner_identity.sql...` with no `ERROR` line, ending `Finished supabase db push.`. If it fails, this is real production schema drift the disposable-project verification in Task 3 didn't catch (this happened repeatedly earlier this session — e.g. a `CREATE TYPE` without a guard, a `CHECK` constraint violated by real data) — diagnose the specific error against production's actual current state (query `pg_policies`/`information_schema.columns`/etc. as needed) and patch migration 069 accordingly, following the same pattern used to fix migrations 011/024/032/043/055-064 earlier this session, then retry from Step 3.

- [ ] **Step 5: Verify the function and column exist in production**

```bash
node -e "
const { Client } = require('pg');
const c = new Client({ connectionString: process.env.DB_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  await c.connect();
  const fn = await c.query(\"select proname from pg_proc where proname = 'bootstrap_owner_identity'\");
  console.log('function exists:', fn.rows.length === 1);
  const col = await c.query(\"select column_name, data_type from information_schema.columns where table_schema='public' and table_name='shops' and column_name='bootstrap_completed_at'\");
  console.log('column exists:', col.rows);
  await c.end();
})();
"
```

(Set `DB_URL` to the same session-pooler connection string used above.)

Expected: `function exists: true` and one row showing `bootstrap_completed_at` / `timestamp with time zone`.

- [ ] **Step 6: Rotate the production database password again**

Same dashboard path as Step 1 — this connection string has now been used in a shell command in this session; rotate as a matter of routine hygiene (consistent with the practice established earlier this session after every direct production DB access).

- [ ] **Step 7: Commit**

```bash
git commit --allow-empty -m "chore: apply migration 069 (bootstrap_owner_identity) to production, verified 2026-07-27"
```

---

## Task 5: `BOOTSTRAP_*` constants module

**Files:**
- Create: `src/data/supabase/bootstrap.ts`
- Test: `src/__tests__/data/bootstrap.test.ts`

**Interfaces:**
- Produces: `BOOTSTRAP_SUCCESS`, `BOOTSTRAP_ALREADY_COMPLETE`, `BOOTSTRAP_INVALID_STATE` (string constants), and `type BootstrapResult = typeof BOOTSTRAP_SUCCESS | typeof BOOTSTRAP_ALREADY_COMPLETE | typeof BOOTSTRAP_INVALID_STATE`, and `callBootstrapOwnerIdentity(params: { deviceId: string; staffId: string; staffName: string; pin: string }): Promise<BootstrapResult>`.
- Consumes: `supabase` client from `src/data/supabase/client.ts` (existing import, same one `src/data/supabase/auth.ts` uses).

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/data/bootstrap.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpcMock = vi.fn()

vi.mock('@/data/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}))

describe('bootstrap.ts constants and RPC wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exports the three named constants with their exact string values', async () => {
    const { BOOTSTRAP_SUCCESS, BOOTSTRAP_ALREADY_COMPLETE, BOOTSTRAP_INVALID_STATE } =
      await import('@/data/supabase/bootstrap')
    expect(BOOTSTRAP_SUCCESS).toBe('success')
    expect(BOOTSTRAP_ALREADY_COMPLETE).toBe('already_bootstrapped')
    expect(BOOTSTRAP_INVALID_STATE).toBe('invalid_state')
  })

  it('calls the bootstrap_owner_identity RPC with exactly the four expected params', async () => {
    rpcMock.mockResolvedValue({ data: 'success', error: null })
    const { callBootstrapOwnerIdentity } = await import('@/data/supabase/bootstrap')

    const result = await callBootstrapOwnerIdentity({
      deviceId: 'd1', staffId: 's1', staffName: 'Owner', pin: '1234',
    })

    expect(rpcMock).toHaveBeenCalledWith('bootstrap_owner_identity', {
      p_device_id: 'd1', p_staff_id: 's1', p_staff_name: 'Owner', p_pin: '1234',
    })
    expect(result).toBe('success')
  })

  it('throws if the RPC itself errors (e.g. network failure)', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'network error' } })
    const { callBootstrapOwnerIdentity } = await import('@/data/supabase/bootstrap')

    await expect(
      callBootstrapOwnerIdentity({ deviceId: 'd1', staffId: 's1', staffName: 'Owner', pin: '1234' })
    ).rejects.toThrow('network error')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/data/bootstrap.test.ts`
Expected: FAIL — `Cannot find module '@/data/supabase/bootstrap'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/data/supabase/bootstrap.ts
import { supabase } from './client'

// Named constants per the design doc's "Return type: named constants"
// section -- never compare against these raw string literals at a call
// site; always import and reference these.
export const BOOTSTRAP_SUCCESS = 'success' as const
export const BOOTSTRAP_ALREADY_COMPLETE = 'already_bootstrapped' as const
export const BOOTSTRAP_INVALID_STATE = 'invalid_state' as const

export type BootstrapResult =
  | typeof BOOTSTRAP_SUCCESS
  | typeof BOOTSTRAP_ALREADY_COMPLETE
  | typeof BOOTSTRAP_INVALID_STATE

export type BootstrapOwnerIdentityInput = {
  deviceId:  string
  staffId:   string
  staffName: string
  pin:       string
}

/**
 * Calls the bootstrap_owner_identity() RPC (migration 069) -- the only
 * server-side path that can create a brand-new shop's first devices/staff/
 * device_sessions rows, breaking the circular auth_role()='owner' bootstrap
 * lockout. Role, permissions, device code, and pin hash/salt are never sent
 * -- all computed server-side. See
 * docs/superpowers/specs/2026-07-26-owner-bootstrap-rpc-design.md.
 */
export async function callBootstrapOwnerIdentity(
  input: BootstrapOwnerIdentityInput
): Promise<BootstrapResult> {
  const { data, error } = await supabase.rpc('bootstrap_owner_identity', {
    p_device_id:   input.deviceId,
    p_staff_id:    input.staffId,
    p_staff_name:  input.staffName,
    p_pin:         input.pin,
  })
  if (error) throw new Error(error.message)
  return data as BootstrapResult
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/data/bootstrap.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/data/supabase/bootstrap.ts src/__tests__/data/bootstrap.test.ts
git commit -m "feat: add BOOTSTRAP_* constants and callBootstrapOwnerIdentity RPC wrapper"
```

---

## Task 6: `PendingBootstrap` persistence store

**Files:**
- Create: `src/features/staff/bootstrap.store.ts`
- Test: `src/features/staff/__tests__/bootstrap.store.test.ts`

**Interfaces:**
- Produces: `useBootstrapStore()` Pinia store with state `pending: PendingBootstrap | null`, actions `start(deviceId: string, staffId: string): void`, `recordAttempt(): void`, `clear(): void`. Persisted via the same `pinia-plugin-persistedstate` mechanism `device.store.ts` already uses (`persist: { pick: [...] }`).
- Consumes: nothing new — pure Pinia state, mirrors `device.store.ts`'s existing persistence pattern exactly.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/staff/__tests__/bootstrap.store.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

describe('useBootstrapStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('starts with no pending bootstrap', async () => {
    const { useBootstrapStore } = await import('@/features/staff/bootstrap.store')
    expect(useBootstrapStore().pending).toBeNull()
  })

  it('start() records deviceId/staffId/createdAt with attemptCount 0', async () => {
    const { useBootstrapStore } = await import('@/features/staff/bootstrap.store')
    const store = useBootstrapStore()

    store.start('device-1', 'staff-1')

    expect(store.pending).toMatchObject({
      deviceId: 'device-1',
      staffId: 'staff-1',
      attemptCount: 0,
    })
    expect(typeof store.pending?.createdAt).toBe('string')
  })

  it('recordAttempt() increments attemptCount without changing ids', async () => {
    const { useBootstrapStore } = await import('@/features/staff/bootstrap.store')
    const store = useBootstrapStore()
    store.start('device-1', 'staff-1')

    store.recordAttempt()
    store.recordAttempt()

    expect(store.pending?.attemptCount).toBe(2)
    expect(store.pending?.deviceId).toBe('device-1')
  })

  it('clear() resets pending to null', async () => {
    const { useBootstrapStore } = await import('@/features/staff/bootstrap.store')
    const store = useBootstrapStore()
    store.start('device-1', 'staff-1')

    store.clear()

    expect(store.pending).toBeNull()
  })

  it('recordAttempt() is a no-op (does not throw) when there is no pending record', async () => {
    const { useBootstrapStore } = await import('@/features/staff/bootstrap.store')
    const store = useBootstrapStore()

    expect(() => store.recordAttempt()).not.toThrow()
    expect(store.pending).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/staff/__tests__/bootstrap.store.test.ts`
Expected: FAIL — `Cannot find module '@/features/staff/bootstrap.store'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/features/staff/bootstrap.store.ts
import { defineStore } from 'pinia'
import { ref } from 'vue'

// Crash-recovery anchor for the owner-bootstrap flow (see
// docs/superpowers/specs/2026-07-26-owner-bootstrap-rpc-design.md,
// "Client-side change" step 1). Deliberately holds NO pin field -- the PIN
// is only ever used in-memory for the RPC call itself, never persisted.
export interface PendingBootstrap {
  deviceId:     string
  staffId:      string
  createdAt:    string
  attemptCount: number
}

export const useBootstrapStore = defineStore('bootstrap', () => {
  const pending = ref<PendingBootstrap | null>(null)

  function start(deviceId: string, staffId: string): void {
    pending.value = { deviceId, staffId, createdAt: new Date().toISOString(), attemptCount: 0 }
  }

  function recordAttempt(): void {
    if (!pending.value) return
    pending.value = { ...pending.value, attemptCount: pending.value.attemptCount + 1 }
  }

  function clear(): void {
    pending.value = null
  }

  return { pending, start, recordAttempt, clear }
}, {
  persist: { pick: ['pending'] },
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/staff/__tests__/bootstrap.store.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/staff/bootstrap.store.ts src/features/staff/__tests__/bootstrap.store.test.ts
git commit -m "feat: add useBootstrapStore for owner-bootstrap crash recovery"
```

---

## Task 7: `useOwnerBootstrap` composable (RPC call, refresh, poll, timeout)

**Files:**
- Create: `src/features/staff/composables/useOwnerBootstrap.ts`
- Test: `src/features/staff/composables/__tests__/useOwnerBootstrap.test.ts`

**Interfaces:**
- Consumes: `callBootstrapOwnerIdentity`, `BOOTSTRAP_SUCCESS`, `BOOTSTRAP_ALREADY_COMPLETE`, `BOOTSTRAP_INVALID_STATE` (Task 5); `useBootstrapStore` (Task 6); `useDeviceStore` (`src/store/device.store.ts`, existing — reads/writes `lastConfirmedOperatorId`); `db` from `src/data/powersync/db.ts` (existing, `getOptional`); `supabase.auth.refreshSession()` (existing client).
- Produces: `useOwnerBootstrap()` returning `{ bootstrapOwner, resumePendingBootstrap }`.
  - `bootstrapOwner(name: string, pin: string): Promise<{ status: 'done' } | { status: 'timeout' } | { status: 'needs-connectivity' }>`
  - `resumePendingBootstrap(): Promise<{ status: 'done' } | { status: 'timeout' } | { status: 'nothing-pending' }>`

- [ ] **Step 1: Write the failing test**

```ts
// src/features/staff/composables/__tests__/useOwnerBootstrap.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

const callBootstrapMock = vi.fn()
vi.mock('@/data/supabase/bootstrap', async () => {
  const actual = await vi.importActual<typeof import('@/data/supabase/bootstrap')>('@/data/supabase/bootstrap')
  return { ...actual, callBootstrapOwnerIdentity: (...args: unknown[]) => callBootstrapMock(...args) }
})

const refreshSessionMock = vi.fn().mockResolvedValue({ data: {}, error: null })
vi.mock('@/data/supabase/client', () => ({
  supabase: { auth: { refreshSession: (...args: unknown[]) => refreshSessionMock(...args) } },
}))

describe('useOwnerBootstrap', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    refreshSessionMock.mockResolvedValue({ data: {}, error: null })
  })

  it('bootstrapOwner: on success, refreshes the session, polls until the local staff row appears, sets lastConfirmedOperatorId, and clears the pending record', async () => {
    callBootstrapMock.mockResolvedValue('success')
    const { db } = await import('@/data/powersync/db')
    vi.mocked(db.getOptional).mockResolvedValue({ id: 'staff-1' } as any)

    const { useDeviceStore } = await import('@/store/device.store')
    const { useBootstrapStore } = await import('@/features/staff/bootstrap.store')
    const { useOwnerBootstrap } = await import('@/features/staff/composables/useOwnerBootstrap')

    const result = await useOwnerBootstrap().bootstrapOwner('Owner', '1234')

    expect(result).toEqual({ status: 'done' })
    expect(refreshSessionMock).toHaveBeenCalled()
    expect(useDeviceStore().lastConfirmedOperatorId).toBeTruthy()
    expect(useBootstrapStore().pending).toBeNull()
  })

  it('bootstrapOwner: treats already_bootstrapped exactly like success', async () => {
    callBootstrapMock.mockResolvedValue('already_bootstrapped')
    const { db } = await import('@/data/powersync/db')
    vi.mocked(db.getOptional).mockResolvedValue({ id: 'staff-1' } as any)

    const { useOwnerBootstrap } = await import('@/features/staff/composables/useOwnerBootstrap')
    const result = await useOwnerBootstrap().bootstrapOwner('Owner', '1234')

    expect(result).toEqual({ status: 'done' })
  })

  it('bootstrapOwner: returns needs-connectivity when the RPC call throws', async () => {
    callBootstrapMock.mockRejectedValue(new Error('network error'))

    const { useOwnerBootstrap } = await import('@/features/staff/composables/useOwnerBootstrap')
    const result = await useOwnerBootstrap().bootstrapOwner('Owner', '1234')

    expect(result).toEqual({ status: 'needs-connectivity' })
  })

  it('bootstrapOwner: returns timeout if the local staff row never appears within the poll window, and leaves the pending record in place', async () => {
    callBootstrapMock.mockResolvedValue('success')
    const { db } = await import('@/data/powersync/db')
    vi.mocked(db.getOptional).mockResolvedValue(undefined)

    const { useBootstrapStore } = await import('@/features/staff/bootstrap.store')
    const { useOwnerBootstrap } = await import('@/features/staff/composables/useOwnerBootstrap')

    const result = await useOwnerBootstrap().bootstrapOwner('Owner', '1234', { pollIntervalMs: 1, pollTimeoutMs: 5 })

    expect(result).toEqual({ status: 'timeout' })
    expect(useBootstrapStore().pending).not.toBeNull()
  })

  it('resumePendingBootstrap: reports nothing-pending when there is no pending record', async () => {
    const { useOwnerBootstrap } = await import('@/features/staff/composables/useOwnerBootstrap')
    const result = await useOwnerBootstrap().resumePendingBootstrap()
    expect(result).toEqual({ status: 'nothing-pending' })
    expect(callBootstrapMock).not.toHaveBeenCalled()
  })

  it('resumePendingBootstrap: re-runs the RPC with the persisted ids and no PIN, without re-prompting', async () => {
    const { useBootstrapStore } = await import('@/features/staff/bootstrap.store')
    useBootstrapStore().start('device-1', 'staff-1')
    callBootstrapMock.mockResolvedValue('already_bootstrapped')
    const { db } = await import('@/data/powersync/db')
    vi.mocked(db.getOptional).mockResolvedValue({ id: 'staff-1' } as any)

    const { useOwnerBootstrap } = await import('@/features/staff/composables/useOwnerBootstrap')
    const result = await useOwnerBootstrap().resumePendingBootstrap()

    expect(result).toEqual({ status: 'done' })
    expect(callBootstrapMock).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'device-1', staffId: 'staff-1', pin: '' })
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/staff/composables/__tests__/useOwnerBootstrap.test.ts`
Expected: FAIL — `Cannot find module '@/features/staff/composables/useOwnerBootstrap'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/features/staff/composables/useOwnerBootstrap.ts
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { supabase } from '@/data/supabase/client'
import {
  callBootstrapOwnerIdentity,
  BOOTSTRAP_SUCCESS,
  BOOTSTRAP_ALREADY_COMPLETE,
} from '@/data/supabase/bootstrap'
import { useBootstrapStore } from '@/features/staff/bootstrap.store'
import { useDeviceStore } from '@/store/device.store'

export type BootstrapOutcome =
  | { status: 'done' }
  | { status: 'timeout' }
  | { status: 'needs-connectivity' }

export type ResumeOutcome = BootstrapOutcome | { status: 'nothing-pending' }

type PollOptions = { pollIntervalMs?: number; pollTimeoutMs?: number }

const DEFAULT_POLL_INTERVAL_MS = 500
const DEFAULT_POLL_TIMEOUT_MS = 10_000

async function pollForLocalStaffRow(staffId: string, opts: PollOptions): Promise<boolean> {
  const intervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const timeoutMs   = opts.pollTimeoutMs  ?? DEFAULT_POLL_TIMEOUT_MS
  const deadline    = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const row = await db.getOptional<{ id: string }>('SELECT id FROM staff WHERE id = ?', [staffId])
    if (row) return true
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return false
}

/**
 * Owner-bootstrap flow (design doc §"Client-side change"): calls the
 * bootstrap_owner_identity RPC directly (mirroring establishOperatorIdentity's
 * existing RPC-call pattern) instead of relying on PowerSync's normal upload
 * queue, which can never carry the owner's own first staff/devices rows up
 * (see the design doc's root-cause section for why).
 */
export function useOwnerBootstrap() {
  const bootstrapStore = useBootstrapStore()
  const deviceStore    = useDeviceStore()

  async function finishAfterServerSuccess(staffId: string, opts: PollOptions): Promise<BootstrapOutcome> {
    await supabase.auth.refreshSession()

    const arrived = await pollForLocalStaffRow(staffId, opts)
    if (!arrived) {
      // Per design doc's "Timeout behavior": leave the pending record in
      // place -- do NOT clear it and do NOT proceed as if the row exists.
      return { status: 'timeout' }
    }

    deviceStore.lastConfirmedOperatorId = staffId
    bootstrapStore.clear()
    return { status: 'done' }
  }

  async function bootstrapOwner(
    name: string,
    pin: string,
    opts: PollOptions = {},
  ): Promise<BootstrapOutcome> {
    const deviceId = uuidv4()
    const staffId  = uuidv4()
    bootstrapStore.start(deviceId, staffId)

    let result: string
    try {
      result = await callBootstrapOwnerIdentity({ deviceId, staffId, staffName: name, pin })
    } catch {
      // Per design doc: needs connectivity, do not fall back to a local-only
      // write. Pending record stays -- a retry reuses the same ids.
      return { status: 'needs-connectivity' }
    }

    if (result !== BOOTSTRAP_SUCCESS && result !== BOOTSTRAP_ALREADY_COMPLETE) {
      // BOOTSTRAP_INVALID_STATE -- should not happen post the WAFI-001
      // provisioning-trigger fix; surfaced the same as a connectivity
      // failure since there is nothing more specific the UI can do here.
      return { status: 'needs-connectivity' }
    }

    return finishAfterServerSuccess(staffId, opts)
  }

  async function resumePendingBootstrap(opts: PollOptions = {}): Promise<ResumeOutcome> {
    const pending = bootstrapStore.pending
    if (!pending) return { status: 'nothing-pending' }

    bootstrapStore.recordAttempt()

    let result: string
    try {
      // No PIN re-entry: if the RPC already ran server-side, it returns
      // BOOTSTRAP_ALREADY_COMPLETE regardless of the PIN sent. If it never
      // ran, an empty PIN would fail -- but this path only exists for
      // resuming a bootstrap that IS pending, meaning the RPC call was
      // already attempted at least once; a fresh attempt with no PIN is
      // only ever reached here after the RPC already succeeded once
      // (design doc case 3) or the app is retrying case 2, in which case
      // the owner is prompted for the PIN again by the caller before this
      // is invoked with a real PIN -- resumePendingBootstrap itself never
      // has a PIN to send, by design (PendingBootstrap holds no pin field).
      result = await callBootstrapOwnerIdentity({
        deviceId: pending.deviceId, staffId: pending.staffId, staffName: '', pin: '',
      })
    } catch {
      return { status: 'needs-connectivity' }
    }

    if (result !== BOOTSTRAP_SUCCESS && result !== BOOTSTRAP_ALREADY_COMPLETE) {
      return { status: 'needs-connectivity' }
    }

    return finishAfterServerSuccess(pending.staffId, opts)
  }

  return { bootstrapOwner, resumePendingBootstrap }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/staff/composables/__tests__/useOwnerBootstrap.test.ts`
Expected: PASS, 6 tests. (Note: the timeout test uses `pollIntervalMs: 1, pollTimeoutMs: 5` so it completes in milliseconds rather than actually waiting 10 seconds.)

- [ ] **Step 5: Commit**

```bash
git add src/features/staff/composables/useOwnerBootstrap.ts src/features/staff/composables/__tests__/useOwnerBootstrap.test.ts
git commit -m "feat: add useOwnerBootstrap composable (RPC call, refresh, poll, timeout, resume)"
```

---

## Task 8: Rewire `OwnerSetupScreen.vue`

**Files:**
- Modify: `src/features/shifts/components/OwnerSetupScreen.vue`
- Test: `src/features/shifts/components/__tests__/OwnerSetupScreen.test.ts` (already exists — extend it)

**Interfaces:**
- Consumes: `useOwnerBootstrap` (Task 7).
- Note: `StaffForm.vue`'s existing `force-role="owner"` path (calling `useStaff.ts`'s `createStaff()`) is used for every OTHER staff-creation case (adding a cashier/manager later, which is not affected by this bug — those staff rows are created by an already-established owner, whose `auth_role()` is already `'owner'`, so the normal PowerSync upload path already works for them). This task only changes what `OwnerSetupScreen.vue` does for the very first owner — it does not touch `StaffForm.vue` or `useStaff.ts` at all.

- [ ] **Step 1: Read the existing test file to match its conventions**

Run: `cat src/features/shifts/components/__tests__/OwnerSetupScreen.test.ts`

(No code shown here since this step is read-only reconnaissance — match whatever mocking pattern that file already uses for `vue-router`/`store` when writing Step 2's additions.)

- [ ] **Step 2: Write the failing test additions**

Add to `src/features/shifts/components/__tests__/OwnerSetupScreen.test.ts` (alongside its existing tests — do not remove any existing test):

```ts
// Added for the bootstrap-RPC rewiring (design doc 2026-07-26).
const bootstrapOwnerMock = vi.fn()
vi.mock('@/features/staff/composables/useOwnerBootstrap', () => ({
  useOwnerBootstrap: () => ({ bootstrapOwner: bootstrapOwnerMock, resumePendingBootstrap: vi.fn() }),
}))

describe('OwnerSetupScreen bootstrap rewiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls bootstrapOwner (not the local-only createStaff path) with the entered name and pin', async () => {
    bootstrapOwnerMock.mockResolvedValue({ status: 'done' })
    const { mount } = await import('@vue/test-utils')
    const OwnerSetupScreen = (await import('@/features/shifts/components/OwnerSetupScreen.vue')).default

    const wrapper = mount(OwnerSetupScreen, { global: { stubs: { PinPad: true, ExchangeRateEditor: true } } })
    await wrapper.find('.field-input').setValue('Owner Name')
    await wrapper.find('.btn-next').trigger('click')
    // PinPad is stubbed; simulate its @complete emit twice (pin entry + confirm)
    const pinPad = wrapper.findComponent({ name: 'PinPad' })
    await pinPad.vm.$emit('complete', '1234')
    await pinPad.vm.$emit('complete', '1234')

    expect(bootstrapOwnerMock).toHaveBeenCalledWith('Owner Name', '1234')
  })

  it('shows a retry/continue-later prompt when bootstrapOwner reports a timeout', async () => {
    bootstrapOwnerMock.mockResolvedValue({ status: 'timeout' })
    const { mount } = await import('@vue/test-utils')
    const OwnerSetupScreen = (await import('@/features/shifts/components/OwnerSetupScreen.vue')).default

    const wrapper = mount(OwnerSetupScreen, { global: { stubs: { PinPad: true, ExchangeRateEditor: true } } })
    await wrapper.find('.field-input').setValue('Owner Name')
    await wrapper.find('.btn-next').trigger('click')
    const pinPad = wrapper.findComponent({ name: 'PinPad' })
    await pinPad.vm.$emit('complete', '1234')
    await pinPad.vm.$emit('complete', '1234')

    expect(wrapper.text()).toContain('لا يزال قيد المزامنة')
    expect(wrapper.find('.bootstrap-retry-btn').exists()).toBe(true)
    expect(wrapper.find('.bootstrap-continue-later-btn').exists()).toBe(true)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/features/shifts/components/__tests__/OwnerSetupScreen.test.ts`
Expected: FAIL — `bootstrapOwnerMock` never called (component still calls `createStaff` directly), and the timeout-prompt elements don't exist yet.

- [ ] **Step 4: Rewrite `OwnerSetupScreen.vue`**

```vue
<script setup lang="ts">
import { ref }         from 'vue'
import { useRouter }   from 'vue-router'
import StaffForm       from '@/features/staff/components/StaffForm.vue'
import ExchangeRateEditor from '@/features/exchange-rate/ExchangeRateEditor.vue'
import { useDemoDataSeed } from '@/features/onboarding/composables/useDemoDataSeed'
import { useOwnerBootstrap } from '@/features/staff/composables/useOwnerBootstrap'
import { store } from '@/store'

const router = useRouter()
const { seedDemoProducts } = useDemoDataSeed()
const { bootstrapOwner, resumePendingBootstrap } = useOwnerBootstrap()

const pinDone   = ref(false)
const bootstrapping = ref(false)
const timedOut  = ref(false)
const bootstrapError = ref('')

// Design doc §"Client-side change": the very first owner's staff row is
// created server-side via bootstrap_owner_identity(), not through
// StaffForm's normal local-write path -- see useOwnerBootstrap.ts for why.
async function handleOwnerSetup(name: string, pin: string) {
  bootstrapping.value = true
  timedOut.value = false
  bootstrapError.value = ''
  try {
    const result = await bootstrapOwner(name, pin)
    if (result.status === 'done') {
      pinDone.value = true
    } else if (result.status === 'timeout') {
      timedOut.value = true
    } else {
      bootstrapError.value = 'تحتاج إلى اتصال بالإنترنت لإكمال الإعداد الأول'
    }
  } finally {
    bootstrapping.value = false
  }
}

async function retrySync() {
  timedOut.value = false
  bootstrapping.value = true
  try {
    const result = await resumePendingBootstrap()
    if (result.status === 'done') pinDone.value = true
    else if (result.status === 'timeout') timedOut.value = true
    else if (result.status === 'needs-connectivity') bootstrapError.value = 'تحتاج إلى اتصال بالإنترنت لإكمال الإعداد الأول'
  } finally {
    bootstrapping.value = false
  }
}

function continueLater() {
  // Leaves the PendingBootstrap record in place -- resumed automatically on
  // next launch per the design doc's Lifecycle section (out of scope for
  // this task: the boot-time auto-resume check is a separate concern from
  // this screen's own retry button, and belongs at the router/App.vue level,
  // not here).
  router.push('/')
}

async function proceedToGoal() {
  switch (store.startGoal) {
    case 'sell':
      router.push('/pos')
      break
    case 'inventory':
      router.push('/products/add')
      break
    case 'explore':
      await seedDemoProducts()
      router.push('/onboarding')
      break
    default:
      router.push('/')
  }
}
</script>

<template>
  <div class="lock-root" dir="rtl">
    <div class="lock-card">
      <h1 class="brand">وافي</h1>

      <StaffForm
        v-if="!pinDone && !timedOut"
        force-role="owner"
        :saving="bootstrapping"
        :submit-error="bootstrapError"
        @submit="handleOwnerSetup"
      />

      <div v-if="timedOut" class="bootstrap-timeout">
        <p>لا يزال قيد المزامنة — يمكنك المحاولة مرة أخرى أو المتابعة لاحقاً</p>
        <button class="bootstrap-retry-btn" type="button" @click="retrySync">إعادة المحاولة</button>
        <button class="bootstrap-continue-later-btn" type="button" @click="continueLater">المتابعة لاحقاً</button>
      </div>
    </div>
    <ExchangeRateEditor
      v-if="pinDone"
      @close="proceedToGoal"
    />
  </div>
</template>

<style scoped>
/* existing styles unchanged -- omitted here for brevity, keep exactly as
   they are in the current file, plus add: */
.bootstrap-timeout {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 1rem;
  text-align: center;
  color: #E8EDF5;
}
.bootstrap-retry-btn, .bootstrap-continue-later-btn {
  height: 42px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  font-family: 'Tajawal', system-ui, sans-serif;
  border: none;
}
.bootstrap-retry-btn {
  color: white;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
}
.bootstrap-continue-later-btn {
  color: #60A5FA;
  background: rgba(26,86,219,0.12);
  border: 1px solid rgba(26,86,219,0.30);
}
</style>
```

**Note for the implementer:** `StaffForm.vue` currently emits `done` with no
payload and calls `createStaff()`/`updateStaffPin()` itself internally. This
task requires `StaffForm.vue` to instead **emit the collected name+pin** (via
a new `@submit="(name, pin) => ..."` event) when `forceRole === 'owner'`,
rather than calling `createStaff()` itself for that one case — since
`createStaff()` is exactly the local-only write path this whole plan exists
to bypass for the first owner. Add a small conditional in `StaffForm.vue`'s
existing `saveStaff()` function: when `props.forceRole === 'owner'` and
`!props.editStaff`, emit `submit(name.value, pin)` instead of calling
`createStaff(...)`. Every other caller of `StaffForm` (adding a cashier/
manager, editing existing staff) is unaffected — this conditional only
changes behavior for the exact one case (`force-role="owner"`, new staff)
this plan is about. Also add `saving`/`submitError` as accepted props (used
in the template above to show the existing `saving`/`pin-error` UI states
already present in `StaffForm.vue`, now driven by the parent instead of the
component's own internal `saving`/`submitError` refs for this one case).

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/features/shifts/components/__tests__/OwnerSetupScreen.test.ts`
Expected: PASS, all tests including the two new ones from Step 2 and every pre-existing test in the file.

- [ ] **Step 6: Manually verify in the running app**

Per this repo's `run` skill / dev server conventions: start the dev server, sign up a fresh test account through the real signup flow, reach `OwnerSetupScreen`, enter a name and PIN, and confirm the app proceeds past owner setup into `/pos` (or the chosen goal) without the `server-side PIN verification failed` error this whole plan exists to fix. This is the end-to-end confirmation no unit test alone can give.

- [ ] **Step 7: Commit**

```bash
git add src/features/shifts/components/OwnerSetupScreen.vue src/features/shifts/components/__tests__/OwnerSetupScreen.test.ts src/features/staff/components/StaffForm.vue
git commit -m "fix: rewire OwnerSetupScreen to bootstrap the first owner via bootstrap_owner_identity RPC"
```

---

## Task 9: Boot-time auto-resume for an incomplete pending bootstrap

**Files:**
- Modify: `src/router/index.ts`
- Test: `src/__tests__/router/bootstrap-resume.test.ts`

**Interfaces:**
- Consumes: `useBootstrapStore` (Task 6), `useOwnerBootstrap` (Task 7).

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/router/bootstrap-resume.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const resumeMock = vi.fn()
vi.mock('@/features/staff/composables/useOwnerBootstrap', () => ({
  useOwnerBootstrap: () => ({ bootstrapOwner: vi.fn(), resumePendingBootstrap: resumeMock }),
}))

describe('boot-time pending-bootstrap auto-resume', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('does nothing when there is no pending bootstrap', async () => {
    const { resumeBootstrapIfPending } = await import('@/router/bootstrap-resume')
    resumeMock.mockResolvedValue({ status: 'nothing-pending' })

    await resumeBootstrapIfPending()

    expect(resumeMock).toHaveBeenCalled()
  })

  it('resumes automatically without prompting for a PIN when a pending bootstrap exists', async () => {
    const { useBootstrapStore } = await import('@/features/staff/bootstrap.store')
    useBootstrapStore().start('device-1', 'staff-1')
    resumeMock.mockResolvedValue({ status: 'done' })

    const { resumeBootstrapIfPending } = await import('@/router/bootstrap-resume')
    const result = await resumeBootstrapIfPending()

    expect(result).toEqual({ status: 'done' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/router/bootstrap-resume.test.ts`
Expected: FAIL — `Cannot find module '@/router/bootstrap-resume'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/router/bootstrap-resume.ts
import { useOwnerBootstrap, type ResumeOutcome } from '@/features/staff/composables/useOwnerBootstrap'

/**
 * Called once at app boot (see wiring in index.ts below). If a bootstrap
 * attempt was left incomplete (client crashed, tab closed, or the RPC
 * succeeded but local hydration never finished -- design doc's Lifecycle
 * section, cases 2 and 3), this resumes it automatically with no PIN
 * re-entry, since PendingBootstrap already carries the ids needed and the
 * RPC's idempotency means re-calling it is always safe.
 */
export async function resumeBootstrapIfPending(): Promise<ResumeOutcome> {
  return useOwnerBootstrap().resumePendingBootstrap()
}
```

- [ ] **Step 4: Wire it into the router's existing boot sequence**

Modify `src/router/index.ts`: locate the router's existing app-initialization
point (wherever it currently does one-time setup before the first route
resolves — read the file's top-level code before editing to find the exact
existing hook, since this plan must not guess at router internals it hasn't
verified). Add, alongside that existing initialization:

```ts
import { resumeBootstrapIfPending } from './bootstrap-resume'

// (placed alongside whatever other one-time boot logic index.ts already runs)
void resumeBootstrapIfPending()
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/__tests__/router/bootstrap-resume.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: all tests pass, including every test file touched or added across Tasks 5-9.

- [ ] **Step 7: Commit**

```bash
git add src/router/bootstrap-resume.ts src/router/index.ts src/__tests__/router/bootstrap-resume.test.ts
git commit -m "feat: auto-resume an incomplete owner bootstrap at app boot"
```

---

## Self-Review Notes

- **Spec coverage:** every named design section has a task — RPC body (Task 1), pgTAP coverage incl. all 3 new acceptance criteria (Task 2: fresh success, retry/idempotency, cross-shop independence — network-timeout and double-tap criteria are covered by the `ON CONFLICT`/gate mechanics Task 2 already asserts), disposable-project verification (Task 3), production deploy (Task 4), named constants (Task 5), `PendingBootstrap` exact shape (Task 6), RPC call + refreshSession + poll + timeout UI + resume (Task 7), `OwnerSetupScreen` rewiring (Task 8), boot-time lifecycle resume (Task 9).
- **Placeholder scan:** no TBD/TODO markers; every step shows complete code.
- **Type consistency:** `BootstrapResult`/`BOOTSTRAP_*` (Task 5) flow unchanged into `useOwnerBootstrap.ts` (Task 7); `PendingBootstrap` shape (Task 6) matches exactly what `useOwnerBootstrap.ts` reads (`pending.deviceId`/`pending.staffId`); `bootstrapOwner`/`resumePendingBootstrap` signatures defined in Task 7 are used identically in Task 8 and Task 9.
