# WAFI-003 Device Remote Sign-Out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an owner remotely sign out a device by deactivating it in `DevicesScreen.vue` — deleting that device's actual Supabase Auth session, not just flipping a soft flag it only notices at its next shift-open.

**Architecture:** Two new `SECURITY DEFINER` Postgres functions (`record_device_session_id`, `revoke_device_session`), following the exact tenant-check pattern of `switch_active_operator` (migrations 045/048). No new schema — reuses the existing `device_sessions.session_id` column. Client-side: `device.store.ts` records the device's own session id on every sign-in (independent of PIN-switch activity, which has an offline shortcut that would otherwise leave it stale); `useDevices.ts::setActive` calls the revoke RPC when deactivating.

**Tech Stack:** Vue 3, Pinia, Supabase (Postgres + `@supabase/supabase-js`), PowerSync, Vitest, pgTAP.

## Global Constraints

- No schema changes to `devices` (it's `SELECT *`-synced to every device in the shop per `powersync.yaml:41` — anything added there leaks to every other device). `device_sessions` stays server-only, as it already is.
- Do not touch `switch_active_operator`, `device_sessions.active_role`/`active_staff_id`/`failed_attempts`/`locked_until`, or any PIN-switch logic — this plan only adds two new functions and reads/writes `session_id`.
- The new RPCs follow `switch_active_operator`'s exact conventions: `SECURITY DEFINER`, `SET search_path = public, pg_temp`, tenant check via `d.shop_id = public.auth_shop_id()` returning a no-op (not an error) when the device isn't the caller's, and `REVOKE ALL ... GRANT EXECUTE TO authenticated, anon` at the end.
- Reuse `decodeSessionIdClaim` from `src/features/staff/composables/useOperatorSwitch.ts` — do not reimplement JWT decoding.
- Reactivating a device (`setActive(id, true)`) must NOT call the revoke RPC — only deactivating does.
- The self-lockout guard (a device cannot deactivate itself) already exists in `useDevices.ts::setActive` and must be preserved unchanged.
- Verify every migration/pgTAP change against a real local Supabase (`npx supabase db reset` then `npx supabase test db`) — this repo's pgTAP suites now actually execute (fixed 2026-07-22); do not settle for "traced against the SQL" the way earlier, now-corrected documentation once did.

---

### Task 1: Migration 067 — session-recording and revoke RPCs

**Files:**
- Create: `supabase/migrations/067_device_session_revocation.sql`
- Create: `supabase/tests/wafi003_device_session_revocation.test.sql`

**Interfaces:**
- Produces: `public.record_device_session_id(p_device_id uuid, p_session_id uuid) RETURNS void` and `public.revoke_device_session(p_device_id uuid) RETURNS void`, both `SECURITY DEFINER`, both granted to `authenticated, anon`. Task 2 and Task 3 call these by name via `supabase.rpc(...)`.
- Consumes: existing `public.auth_shop_id()` (migration 054), existing `public.devices`/`public.device_sessions` tables (migrations 037/044/048).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/067_device_session_revocation.sql`:

```sql
-- WAFI-003: remote sign-out. Folds into the existing device-deactivation
-- toggle (useDevices.ts::setActive) rather than adding a separate button --
-- deactivating a device now also revokes its actual Supabase Auth session,
-- not just the soft is_active flag it previously only enforced at its next
-- shift-open after sync.
--
-- No schema change: device_sessions.session_id already exists (migration
-- 048), populated by switch_active_operator() on every PIN switch. But
-- establishOperatorIdentity's offline-same-identity shortcut (WAFI-203)
-- returns without calling switch_active_operator when the same operator
-- resumes on an already-trusted device, so session_id can go stale across a
-- sign-out/sign-in cycle. record_device_session_id() keeps it fresh on
-- every sign-in, independent of PIN-switch activity.
--
-- See docs/superpowers/specs/2026-07-22-wafi-003-device-remote-signout-design.md.

CREATE OR REPLACE FUNCTION public.record_device_session_id(
  p_device_id  uuid,
  p_session_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shop_id uuid;
BEGIN
  SELECT d.shop_id INTO v_shop_id
  FROM public.devices d
  WHERE d.id = p_device_id AND d.shop_id = public.auth_shop_id();

  IF v_shop_id IS NULL THEN
    RETURN;  -- not this account's device; silently no-op, mirrors switch_active_operator's fail-closed style
  END IF;

  INSERT INTO public.device_sessions (device_id, shop_id, session_id, updated_at)
  VALUES (p_device_id, v_shop_id, p_session_id, now())
  ON CONFLICT (device_id) DO UPDATE
    SET session_id = excluded.session_id,
        updated_at = excluded.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.record_device_session_id(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.record_device_session_id(uuid, uuid) TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.revoke_device_session(p_device_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shop_id    uuid;
  v_session_id uuid;
BEGIN
  SELECT d.shop_id INTO v_shop_id
  FROM public.devices d
  WHERE d.id = p_device_id AND d.shop_id = public.auth_shop_id();

  IF v_shop_id IS NULL THEN
    RETURN;  -- not this account's device
  END IF;

  SELECT ds.session_id INTO v_session_id
  FROM public.device_sessions ds
  WHERE ds.device_id = p_device_id;

  IF v_session_id IS NOT NULL THEN
    DELETE FROM auth.sessions WHERE id = v_session_id;
  END IF;
  -- v_session_id NULL means this device has no device_sessions row yet
  -- (never switched an operator, never called record_device_session_id) --
  -- nothing to revoke, not an error.
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_device_session(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.revoke_device_session(uuid) TO authenticated, anon;
```

- [ ] **Step 2: Write the pgTAP suite**

Create `supabase/tests/wafi003_device_session_revocation.test.sql`. This follows the exact fixture-and-fix pattern established in `supabase/tests/wafi202_sales_immutability.test.sql` (delete the trigger-auto-created shop before the fixture's own insert; use `code` not `device_code` for the `devices` table):

```sql
-- supabase/tests/wafi003_device_session_revocation.test.sql
-- WAFI-003: pgTAP coverage for record_device_session_id / revoke_device_session.
-- Run via: npx supabase test db

BEGIN;
SELECT plan(6);

-- ============================================================
-- Fixtures
-- ============================================================

-- Shop A: owner account + one device.
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000002', 'owner-a@wafi003.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');

DELETE FROM public.shops WHERE owner_user_id = 'a0000000-0000-0000-0000-000000000002';
INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('a0000000-0000-0000-0000-000000000001', 'WAFI-003 Test Shop A', 'a0000000-0000-0000-0000-000000000002');

INSERT INTO public.devices (id, shop_id, code)
VALUES ('a0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000001', 'A');

-- Shop B: separate tenant, one device (cross-tenant regression).
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000002', 'owner-b@wafi003.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');

DELETE FROM public.shops WHERE owner_user_id = 'b0000000-0000-0000-0000-000000000002';
INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('b0000000-0000-0000-0000-000000000001', 'WAFI-003 Test Shop B', 'b0000000-0000-0000-0000-000000000002');

INSERT INTO public.devices (id, shop_id, code)
VALUES ('b0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000001', 'A');

-- A real auth.sessions row for Shop A's device, to prove revoke actually
-- deletes it (not just no-ops). auth.sessions requires user_id; minimal
-- columns filled in matching what GoTrue itself would write.
INSERT INTO auth.sessions (id, user_id, created_at, updated_at)
VALUES ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', now(), now());

-- ============================================================
-- Test 1: record_device_session_id writes session_id for the caller's own device
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.record_device_session_id('a0000000-0000-0000-0000-000000000007'::uuid, 'c0000000-0000-0000-0000-000000000001'::uuid)$$,
  'Test 1: record_device_session_id succeeds for the caller''s own device'
);
RESET ROLE;

SELECT is(
  (SELECT session_id::text FROM public.device_sessions WHERE device_id = 'a0000000-0000-0000-0000-000000000007'),
  'c0000000-0000-0000-0000-000000000001',
  'Test 2: device_sessions.session_id was written'
);

-- ============================================================
-- Test 3: record_device_session_id no-ops for a device in another shop
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.record_device_session_id('b0000000-0000-0000-0000-000000000007'::uuid, 'c0000000-0000-0000-0000-000000000001'::uuid)$$,
  'Test 3: record_device_session_id on another shop''s device does not error'
);
RESET ROLE;

SELECT is(
  (SELECT count(*) FROM public.device_sessions WHERE device_id = 'b0000000-0000-0000-0000-000000000007')::int,
  0,
  'Test 4: cross-tenant call wrote nothing for shop B''s device'
);

-- ============================================================
-- Test 5: revoke_device_session actually deletes the auth.sessions row
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.revoke_device_session('a0000000-0000-0000-0000-000000000007'::uuid)$$,
  'Test 5: revoke_device_session succeeds for the caller''s own device'
);
RESET ROLE;

SELECT is(
  (SELECT count(*) FROM auth.sessions WHERE id = 'c0000000-0000-0000-0000-000000000001')::int,
  0,
  'Test 6: the auth.sessions row was actually deleted'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 3: Run the suite for real against a local Supabase**

```bash
npx supabase db reset
npx supabase test db
```

Expected: `wafi003_device_session_revocation.test.sql` reports `ok` with all 6 assertions passing (alongside the existing `wafi122_role_enforcement.test.sql` and `wafi202_sales_immutability.test.sql`, which should still pass unchanged). If `auth.sessions` requires columns this plan's `INSERT` didn't provide (e.g. a `NOT NULL` this repo's Supabase image enforces that a hosted project's real GoTrue-written rows would also have but this minimal fixture omits), add the missing columns to the fixture `INSERT` — check the actual error message first, don't guess.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/067_device_session_revocation.sql supabase/tests/wafi003_device_session_revocation.test.sql
git commit -m "feat(wafi-003): add record_device_session_id and revoke_device_session RPCs

Reuses the existing device_sessions.session_id column (migration 048) --
no new schema. Verified against a real local Supabase: revoke_device_session
actually deletes the target auth.sessions row, and both functions no-op
(not error) for a device in another shop."
```

---

### Task 2: Record the device's session id on every sign-in

**Files:**
- Modify: `src/store/device.store.ts`
- Test: `src/__tests__/store/device.store.test.ts`

**Interfaces:**
- Consumes: `decodeSessionIdClaim(accessToken: string): string | null` from `src/features/staff/composables/useOperatorSwitch.ts` (already exported — read it, do not redefine it). Calls `supabase.rpc('record_device_session_id', { p_device_id, p_session_id })` from Task 1.
- Produces: no new exports — this is an internal addition to `refreshShopId()`'s existing body.

- [ ] **Step 1: Read the current `refreshShopId()` and `onAuthStateChange` handler**

Current relevant section of `src/store/device.store.ts` (for context — do not copy this into the file, it's already there):

```ts
  async function refreshShopId(): Promise<void> {
    const { data } = await supabase.auth.getSession()
    const userId = data.session?.user?.id
    if (!userId) return
    try {
      const row = await db.getOptional<{ id: string }>(
        'SELECT id FROM shops WHERE owner_user_id = ? LIMIT 1', [userId]
      )
      if (row?.id) {
        shopId.value = row.id
        await ensureDeviceRegistered()
        if (!lastSeenTouched) {
          lastSeenTouched = true
          void touchDeviceLastSeen(shopId.value, deviceCode.value)
        }
      }
    } catch {
      // DB not ready yet (pre-connect) — keep persisted/fallback value.
    }
  }
```

- [ ] **Step 2: Write the failing test**

Add to `src/__tests__/store/device.store.test.ts`. First, extend the existing `supabase` mock at the top of the file to include `rpc` (it currently only mocks `auth.getSession`/`onAuthStateChange`):

```ts
const rpcMock = vi.fn().mockResolvedValue({ data: null, error: null })

vi.mock('@/data/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: session.value } })),
      onAuthStateChange: vi.fn((cb: (event: string) => void) => { authCb = cb }),
    },
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}))
```

Then add this test (place it near the other `SIGNED_IN`-driven tests, after the `it('resolves shopId from the locally-synced shops row when signed in', ...)` block):

```ts
  it('records the device session id via RPC once a device is registered', async () => {
    const b64url = (obj: unknown) =>
      btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const fakeAccessToken = (sessionId: string) =>
      `${b64url({ alg: 'HS256' })}.${b64url({ session_id: sessionId })}.sig`

    session.value = { access_token: fakeAccessToken('session-xyz'), user: { id: 'user-a' } }
    vi.mocked(db.getOptional).mockResolvedValue({ id: 'shop-a' } as any)
    registerDeviceMock.mockResolvedValue({ code: 'A' })

    const { useDeviceStore } = await import('@/store/device.store')
    const store = useDeviceStore()
    await store.refreshShopId()

    expect(rpcMock).toHaveBeenCalledWith('record_device_session_id', {
      p_device_id:  store.deviceId,
      p_session_id: 'session-xyz',
    })
  })

  it('does not call record_device_session_id when the access token has no session_id claim', async () => {
    const b64url = (obj: unknown) =>
      btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const fakeAccessTokenNoClaim = () => `${b64url({ alg: 'HS256' })}.${b64url({})}.sig`

    session.value = { access_token: fakeAccessTokenNoClaim(), user: { id: 'user-a' } }
    vi.mocked(db.getOptional).mockResolvedValue({ id: 'shop-a' } as any)
    registerDeviceMock.mockResolvedValue({ code: 'A' })

    const { useDeviceStore } = await import('@/store/device.store')
    await useDeviceStore().refreshShopId()

    expect(rpcMock).not.toHaveBeenCalledWith('record_device_session_id', expect.anything())
  })
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/store/device.store.test.ts`
Expected: FAIL — `rpcMock` was never called (the RPC call doesn't exist yet), or a TypeScript/runtime error if `rpc` isn't yet part of the mocked `supabase` shape the store code references.

- [ ] **Step 4: Implement**

In `src/store/device.store.ts`:

1. Add the import at the top (alongside the existing imports):

```ts
import { decodeSessionIdClaim } from '@/features/staff/composables/useOperatorSwitch'
```

2. Add a guard variable near `lastSeenTouched` (same section, same style):

```ts
  // WAFI-003: record this device's own auth session id once per app session,
  // independent of PIN-switch activity — establishOperatorIdentity's
  // offline-same-identity shortcut (WAFI-203) can leave device_sessions
  // .session_id stale across a sign-out/sign-in cycle otherwise, which would
  // make a later revoke_device_session() call target a dead session.
  let sessionIdRecorded = false
```

3. Update `refreshShopId()`'s body to call the RPC once, right after `ensureDeviceRegistered()`:

```ts
  async function refreshShopId(): Promise<void> {
    const { data } = await supabase.auth.getSession()
    const userId = data.session?.user?.id
    if (!userId) return
    try {
      const row = await db.getOptional<{ id: string }>(
        'SELECT id FROM shops WHERE owner_user_id = ? LIMIT 1', [userId]
      )
      if (row?.id) {
        shopId.value = row.id
        await ensureDeviceRegistered()
        if (!lastSeenTouched) {
          lastSeenTouched = true
          void touchDeviceLastSeen(shopId.value, deviceCode.value)
        }
        if (!sessionIdRecorded && deviceId.value) {
          const accessToken = data.session?.access_token
          const sessionId = accessToken ? decodeSessionIdClaim(accessToken) : null
          if (sessionId) {
            sessionIdRecorded = true
            void supabase.rpc('record_device_session_id', {
              p_device_id:  deviceId.value,
              p_session_id: sessionId,
            })
          }
        }
      }
    } catch {
      // DB not ready yet (pre-connect) — keep persisted/fallback value.
    }
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/store/device.store.test.ts`
Expected: PASS, all tests including the two new ones.

- [ ] **Step 6: Run the full test suite once**

Run: `npm test`
Expected: PASS (167 files, no new failures — the pre-existing flaky `router-auth-guard.test.ts` timeout, if it recurs, is unrelated and already documented as pre-existing in this project's WAFI-002 work).

- [ ] **Step 7: Commit**

```bash
git add src/store/device.store.ts src/__tests__/store/device.store.test.ts
git commit -m "feat(wafi-003): record device session id on sign-in

refreshShopId() now calls record_device_session_id once per app session
after a device is registered, using the existing decodeSessionIdClaim()
helper from useOperatorSwitch.ts. Keeps device_sessions.session_id fresh
independent of PIN-switch activity, which establishOperatorIdentity's
offline-same-identity shortcut can otherwise skip across a sign-in cycle."
```

---

### Task 3: Revoke the session when deactivating a device

**Files:**
- Modify: `src/features/devices/composables/useDevices.ts`
- Modify: `src/features/audit/composables/useAuditLog.ts`
- Test: `src/__tests__/features/useDevices.test.ts`

**Interfaces:**
- Consumes: `supabase.rpc('revoke_device_session', { p_device_id })` from Task 1.
- Produces: `logDeviceActivation` gains an optional 4th parameter; Task 3 is the only caller that passes it, so no other call site needs updating (`grep -rn "logDeviceActivation" src/` first to confirm there is exactly one call site outside its own definition/export, in `useDevices.ts`).

- [ ] **Step 1: Write the failing tests**

First, extend `src/__tests__/features/useDevices.test.ts`'s existing `@/data/supabase/client` — it currently has none, since `useDevices.ts` doesn't yet import `supabase`. Add this mock near the top of the file (alongside the existing `@/data/powersync/db` mock):

```ts
const rpcMock = vi.fn().mockResolvedValue({ data: null, error: null })
vi.mock('@/data/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}))
```

Add `rpcMock.mockClear()` to the existing `beforeEach`'s reset block (alongside the existing `vi.clearAllMocks()` — `vi.clearAllMocks()` already resets `rpcMock` since it's a `vi.fn()`, so no separate line is actually needed; just confirm `vi.clearAllMocks()` covers it).

Update the existing `'deactivation writes is_active = 0 and audit-logs as sensitive action'` test to also assert the new RPC call:

```ts
  it('deactivation writes is_active = 0, revokes the session, and audit-logs it', async () => {
    vi.mocked(db.getAll).mockResolvedValue([deviceRow({ code: 'B' })] as any)
    const { load, setActive } = useDevices()
    await load()

    await setActive('dev-row-1', false)

    const update = vi.mocked(db.execute).mock.calls.find(([sql]) => /UPDATE devices SET is_active/.test(sql as string))!
    expect(update[1]).toEqual([0, 'dev-row-1'])
    expect(rpcMock).toHaveBeenCalledWith('revoke_device_session', { p_device_id: 'dev-row-1' })
    expect(logDeviceActivation).toHaveBeenCalledWith('dev-row-1', 'B', false, true)
  })

  it('reactivation does not call revoke_device_session', async () => {
    vi.mocked(db.getAll).mockResolvedValue([deviceRow({ code: 'B', is_active: 0 })] as any)
    const { load, setActive } = useDevices()
    await load()

    await setActive('dev-row-1', true)

    expect(rpcMock).not.toHaveBeenCalled()
    expect(logDeviceActivation).toHaveBeenCalledWith('dev-row-1', 'B', true, false)
  })
```

This replaces the previous `'deactivation writes is_active = 0 and audit-logs as sensitive action'` test (same scenario, extended assertions) — do not keep both.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/features/useDevices.test.ts`
Expected: FAIL — `rpcMock` was never called, and `logDeviceActivation`'s 4th-argument assertion fails (current signature only takes 3 args).

- [ ] **Step 3: Implement**

In `src/features/audit/composables/useAuditLog.ts`, update `logDeviceActivation` (around line 462) to accept and forward an optional `sessionRevoked` flag:

```ts
  const logDeviceActivation = (deviceRowId: string, code: string, active: boolean, sessionRevoked = false) =>
    _logSensitive(active ? 'device.reactivated' : 'device.deactivated', 'device', deviceRowId,
      sessionRevoked ? { code, sessionRevoked } : { code })
```

In `src/features/devices/composables/useDevices.ts`:

1. Add the import at the top:

```ts
import { supabase } from '@/data/supabase/client'
```

2. Update `setActive` to call the revoke RPC when deactivating, and pass the flag through to the audit log:

```ts
  async function setActive(id: string, active: boolean): Promise<void> {
    const d = devices.value.find(x => x.id === id)
    if (!active && d?.isThisDevice) {
      throw new Error('لا يمكن إيقاف الجهاز الذي تستخدمه الآن')
    }
    await db.execute(
      `UPDATE devices SET is_active = ?, sync_status = 'pending' WHERE id = ?`,
      [active ? 1 : 0, id]
    )
    let sessionRevoked = false
    if (!active) {
      const { error } = await supabase.rpc('revoke_device_session', { p_device_id: id })
      sessionRevoked = !error
    }
    await logDeviceActivation(id, d?.code ?? id, active, sessionRevoked)
    await load()
  }
```

Note: `sessionRevoked` reflects whether the RPC call itself succeeded (no network/RPC error) — it does not confirm a live session actually existed to revoke (the RPC no-ops safely when there's nothing to revoke, by design from Task 1). This is a call-succeeded flag, not a "something was actually killed" flag; that distinction is fine for an audit log entry, but do not read it as stronger evidence than that.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/features/useDevices.test.ts`
Expected: PASS, all tests including the two new/updated ones.

- [ ] **Step 5: Check for other `logDeviceActivation` call sites**

Run: `grep -rn "logDeviceActivation" src/`
Expected: exactly two matches — the definition/export in `useAuditLog.ts`, and the one call site in `useDevices.ts` updated above. If there's a third call site anywhere else, it still works unchanged (the new parameter is optional, defaulting to `false`), but note it in your report since it means another deactivation path exists that this task didn't know about.

- [ ] **Step 6: Run the full test suite once**

Run: `npm test`
Expected: PASS (167 files, no new failures).

- [ ] **Step 7: Commit**

```bash
git add src/features/devices/composables/useDevices.ts src/features/audit/composables/useAuditLog.ts src/__tests__/features/useDevices.test.ts
git commit -m "feat(wafi-003): revoke device session when deactivating

useDevices.ts::setActive now calls the revoke_device_session RPC when
deactivating a device (not on reactivate), and audit-logs whether the
session revocation call succeeded via logDeviceActivation's new optional
sessionRevoked parameter."
```

---

### Task 4: Final verification pass

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Full local Supabase reset + pgTAP**

```bash
npx supabase db reset
npx supabase test db
```

Expected: all three pgTAP suites pass — `wafi003_device_session_revocation.test.sql` (new, 6 assertions), `wafi122_role_enforcement.test.sql` (13), `wafi202_sales_immutability.test.sql` (16). 35 total.

- [ ] **Step 2: Full Vitest suite**

Run: `npm test`
Expected: PASS, 167 test files (169 after Tasks 2–3 add no new files, only extend existing ones — file count should stay 167).

- [ ] **Step 3: Type-check**

Run: `npm run build`
Expected: exit 0, no TypeScript errors referencing `device.store.ts`, `useDevices.ts`, `useAuditLog.ts`, or the new migration's callers.

- [ ] **Step 4: Manually confirm the revoke mechanism against a real local Supabase**

This confirms the design's core assumption for real (per the design doc's Testing section) rather than trusting the pgTAP fixture alone, since Task 1's pgTAP test inserts a synthetic `auth.sessions` row rather than a genuine GoTrue-issued one:

```bash
npx supabase start
```

Then, with the local Supabase running, sign up a test owner account through the actual app (`npm run dev`, use the real signup flow), open the app in a second browser profile/incognito window signed in with the same credentials (simulating a second device), and in the Supabase Studio SQL editor (`http://127.0.0.1:54323`) run:

```sql
SELECT id, user_id FROM auth.sessions ORDER BY created_at DESC LIMIT 5;
```

Confirm there are two distinct session rows (one per browser profile). Then, as the owner in the first window, deactivate the second device via `DevicesScreen.vue`, and confirm in Supabase Studio that the corresponding `auth.sessions` row is gone, and that the second browser window is signed out (or gets signed out on its next action) rather than continuing to work.

- [ ] **Step 5: No commit needed** — this task is verification only; if any check fails, return to the relevant earlier task and fix it there.
