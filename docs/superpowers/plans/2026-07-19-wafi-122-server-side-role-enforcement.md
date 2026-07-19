# WAFI-122 Server-Side Financial Role Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Tasks 3 and 9 require human action outside this codebase** (Supabase
> Dashboard access, and two physical/emulated devices against the hosted
> instance). An autonomous agent cannot complete them — they must be handed
> to the CTO/PO, or executed by an agent with verified dashboard credentials
> and a second real session available. Every other task is fully
> code-executable.

**Goal:** Give the sync layer a way to know which staff role (owner/manager/cashier) is active on a device, so `powersync.yaml` can withhold cost/profit/expense data from cashier sessions at the server — not just hide it client-side.

**Architecture:** Per ADR-009 (`docs/adr/ADR-009-server-side-financial-role-enforcement.md`): a new `device_sessions` table holds the currently-active staff role per device; a `SECURITY DEFINER` RPC (`switch_active_operator`) is the only writer, re-verifying the staff PIN server-side; a Supabase Custom Access Token Hook stamps `active_role` into the JWT on every mint/refresh, keyed off a `device_id` claim embedded once at sign-in; the client forces a token refresh immediately after every PIN switch; `powersync.yaml` gains role-branched query variants for every cost-bearing table.

**Tech Stack:** Postgres (Supabase), `pgcrypto` (added by this plan), Supabase Auth Hooks, Vue 3 + TypeScript client, PowerSync sync streams (`powersync.yaml`, edition 3).

## Global Constraints

- `active_role` is a role-visibility claim only — it must NEVER be used for shop/tenant scoping. Every existing RLS policy and `powersync.yaml` query keeps using `shops.owner_user_id = auth.user_id()` exactly as today; this plan only ADDS role-branching on top, never replaces tenant scoping.
- `switch_active_operator` is the only writer of `device_sessions.active_role`. No other function, trigger, or client code may write that column.
- The PIN hash comparison in the RPC must reproduce `usePinAuth.ts`'s exact algorithm: `sha256(coalesce(pin_salt, '') || pin)`, hex-encoded, so existing staff PINs (salted or legacy unsalted) verify correctly without requiring every staff member to reset their PIN.
- The Custom Access Token Hook must fail closed: any lookup failure (missing `device_id` claim, missing/deleted `device_sessions` row, malformed input) resolves to `active_role = 'cashier'` — never `owner` or `manager`.
- `device_sessions` is server-only role state. It must NOT be added to `src/data/powersync/schema.ts` / `AppSchema` and must NOT appear in `powersync.yaml` — it is queried only via the RPC, never synced to any device.
- Every cost/profit-bearing table's `powersync.yaml` entry must get a role-branched pair (owner/manager variant with cost columns, cashier variant without) in this same pass — not partially covered. The tables in scope: `products` (`cost_price_usd`), `expenses` (entire table), `stock_receivings`/`stock_receiving_line_items` (`unit_cost_usd`, `total_cost_usd`), `stock_take_lines` (`unit_cost_usd`, `cost_updated`), `suppliers` (payment-term/cost fields), `staff_ledger`/`staff_settlements` (entire tables, from WAFI-138).
- This plan does NOT touch tenant scoping, does NOT create per-staff-member Supabase Auth accounts, and does NOT change `permissionsForRole()`/`canUserDo()` (client-side gating stays as UX, unchanged).

---

### Task 1: Migration — `device_sessions` table

**Files:**
- Create: `supabase/migrations/044_device_sessions.sql`

**Interfaces:**
- Consumes: `public.devices` (migration 037/042), `public.staff` (migration 003/019).
- Produces: `public.device_sessions` table, columns `device_id uuid PRIMARY KEY REFERENCES devices(id)`, `shop_id uuid NOT NULL`, `active_staff_id uuid REFERENCES staff(id)`, `active_role text NOT NULL DEFAULT 'cashier'`, `updated_at timestamptz NOT NULL DEFAULT now()` — consumed by Task 2's RPC and Task 3's hook function.

- [ ] **Step 1: Write the migration file**

```sql
-- WAFI-122: per-device active-operator role state.
--
-- device_sessions holds, for each registered device, which staff role is
-- CURRENTLY active on it (per PIN switch). This is server-only state — it is
-- never synced to any client (not in schema.ts, not in powersync.yaml) and is
-- written by exactly one function: switch_active_operator() (migration 045),
-- which re-verifies the staff PIN server-side before writing. No other write
-- path may ever touch active_role.
--
-- See docs/adr/ADR-009-server-side-financial-role-enforcement.md.

CREATE TABLE IF NOT EXISTS public.device_sessions (
  device_id       uuid PRIMARY KEY REFERENCES public.devices(id),
  shop_id         uuid NOT NULL,
  active_staff_id uuid REFERENCES public.staff(id),
  active_role     text NOT NULL DEFAULT 'cashier'
                    CHECK (active_role IN ('owner', 'manager', 'cashier')),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_sessions_shop ON public.device_sessions (shop_id);

-- RLS: readable/writable only by the owning shop's account, mirroring every
-- other table's auth_shop_id() scoping (migration 015). Note this RLS is
-- belt-and-suspenders only — the RPC in migration 045 is SECURITY DEFINER and
-- bypasses RLS internally, so RLS here protects against any other client
-- attempting a raw read/write, not the RPC's own operation.
ALTER TABLE public.device_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS device_sessions_select_own_shop ON public.device_sessions;
CREATE POLICY device_sessions_select_own_shop ON public.device_sessions
  FOR SELECT TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()));

-- No INSERT/UPDATE/DELETE policy for anon/authenticated: every write goes
-- through switch_active_operator() (SECURITY DEFINER), which is not subject
-- to RLS. This table has zero client-writable columns by design.
```

- [ ] **Step 2: Verify the migration applies cleanly**

Run: check `package.json` for a `db:migrate`/`supabase:reset` script first and prefer that; otherwise `npx supabase db reset` if a local Supabase instance is configured. If no local instance is available (as was the case for WAFI-138's migration 043), do a manual SQL review instead: confirm the `CHECK` constraint values match exactly `'owner' | 'manager' | 'cashier'` as used in `src/features/staff/staff.types.ts`'s `StaffRole` type, and that `auth_shop_id()` (migration 015) exists and is callable.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/044_device_sessions.sql
git commit -m "feat(wafi-122): add device_sessions table for active-operator role state"
```

---

### Task 2: Migration — `switch_active_operator` RPC

**Files:**
- Create: `supabase/migrations/045_switch_active_operator.sql`

**Interfaces:**
- Consumes: `public.device_sessions` (Task 1), `public.staff.pin_hash`/`pin_salt` (migration 003/019), `public.auth_shop_id()` (migration 015).
- Produces: `public.switch_active_operator(p_device_id uuid, p_staff_id uuid, p_pin text) RETURNS boolean` — consumed by Task 5's client wiring.

- [ ] **Step 1: Write the migration file**

```sql
-- WAFI-122: server-side PIN re-verification + active-operator write.
--
-- This is the ONLY writer of device_sessions.active_role. It re-implements
-- usePinAuth.ts's exact hash algorithm (sha256(salt + pin), hex) in Postgres
-- via pgcrypto's digest(), so existing staff PINs verify without requiring a
-- reset. Returns true/false rather than raising, so the client can show a
-- plain "wrong PIN" message without parsing a Postgres error string.
--
-- See docs/adr/ADR-009-server-side-financial-role-enforcement.md.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.switch_active_operator(
  p_device_id uuid,
  p_staff_id  uuid,
  p_pin       text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shop_id   uuid;
  v_pin_hash  text;
  v_pin_salt  text;
  v_role      text;
  v_computed  text;
BEGIN
  -- The device must belong to the caller's own shop — SECURITY DEFINER
  -- bypasses RLS, so this check is the only tenant boundary inside the
  -- function body.
  SELECT d.shop_id INTO v_shop_id
  FROM public.devices d
  WHERE d.id = p_device_id AND d.shop_id = public.auth_shop_id();

  IF v_shop_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT s.pin_hash, s.pin_salt, s.role INTO v_pin_hash, v_pin_salt, v_role
  FROM public.staff s
  WHERE s.id = p_staff_id AND s.shop_id = v_shop_id AND s.is_active;

  IF v_pin_hash IS NULL THEN
    RETURN false;
  END IF;

  v_computed := encode(digest(coalesce(v_pin_salt, '') || p_pin, 'sha256'), 'hex');

  IF v_computed <> v_pin_hash THEN
    RETURN false;
  END IF;

  INSERT INTO public.device_sessions (device_id, shop_id, active_staff_id, active_role, updated_at)
  VALUES (p_device_id, v_shop_id, p_staff_id, v_role, now())
  ON CONFLICT (device_id) DO UPDATE
    SET active_staff_id = excluded.active_staff_id,
        active_role     = excluded.active_role,
        updated_at      = excluded.updated_at;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.switch_active_operator(uuid, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.switch_active_operator(uuid, uuid, text) TO authenticated, anon;
```

- [ ] **Step 2: Manual verification (no local Supabase instance available)**

Confirm by inspection:
1. `coalesce(v_pin_salt, '') || p_pin` matches `usePinAuth.ts`'s `(salt ?? '') + pin` concatenation order exactly.
2. `digest(..., 'sha256')` + `encode(..., 'hex')` produces the same lowercase hex format as `crypto.subtle.digest('SHA-256', ...)` mapped through `.toString(16).padStart(2, '0')` in `hashPin`.
3. `v_role` is read from `staff.role`, which must already be constrained to `'owner' | 'manager' | 'cashier'` (check `supabase/migrations/003_staff.sql` for the existing CHECK/enum) — if `staff.role` allows any other value, add a `CASE` to normalize or reject before insert.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/045_switch_active_operator.sql
git commit -m "feat(wafi-122): add switch_active_operator RPC with server-side PIN re-verification"
```

---

### Task 3: Migration — Custom Access Token Hook function

**Files:**
- Create: `supabase/migrations/046_custom_access_token_hook.sql`

**Interfaces:**
- Consumes: `public.device_sessions` (Task 1).
- Produces: `public.custom_access_token_hook(event jsonb) RETURNS jsonb` — a Postgres function matching Supabase's Auth Hooks contract, to be wired up manually in the dashboard (Step 3 below — **this half of the task requires human action and cannot be automated by an agent**).

- [ ] **Step 1: Write the migration file**

```sql
-- WAFI-122: Custom Access Token Hook — stamps active_role into every minted
-- JWT for a session that has already embedded a device_id claim (embedded
-- once at sign-in, see Task 4's client change). Fails closed to 'cashier' on
-- any lookup miss, per ADR-009's Architecture Guidelines.
--
-- Supabase's Auth Hooks contract: the function receives `event` shaped as
-- { "user_id": "<uuid>", "claims": { ...existing claims incl. any prior
-- device_id... } } and must return { "claims": { ...same shape, mutated } }.
-- This function must be registered in the Supabase Dashboard under
-- Authentication → Hooks → Customize Access Token (JWT) Claims — see Task 3
-- Step 3 below; the SQL alone does nothing until that dashboard wiring exists.

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  claims     jsonb;
  v_device   text;
  v_role     text;
BEGIN
  claims := event -> 'claims';
  v_device := claims ->> 'device_id';

  IF v_device IS NULL THEN
    -- No device_id claim yet on this session (e.g. first token before the
    -- client has completed device registration) — fail closed.
    claims := jsonb_set(claims, '{active_role}', '"cashier"');
    RETURN jsonb_build_object('claims', claims);
  END IF;

  SELECT active_role INTO v_role
  FROM public.device_sessions
  WHERE device_id = v_device::uuid;

  IF v_role IS NULL THEN
    v_role := 'cashier';
  END IF;

  claims := jsonb_set(claims, '{active_role}', to_jsonb(v_role));
  RETURN jsonb_build_object('claims', claims);
END;
$$;

-- Per Supabase's Auth Hooks requirements: the auth admin role must be able to
-- execute this function, and it must NOT be callable by ordinary clients.
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
```

- [ ] **Step 2: Manual verification (no local Supabase instance available)**

Confirm by inspection: the function signature and `event`/`claims` shape match Supabase's documented Auth Hooks "Customize Access Token" contract at the time of implementation (verify against current Supabase docs, since this API has evolved — the shape above reflects the documented contract as of this plan's writing). If the platform's actual contract differs, adjust the function body's key names accordingly before relying on it.

- [ ] **Step 3: HUMAN ACTION REQUIRED — enable the hook in the Supabase Dashboard**

This step cannot be performed by an autonomous coding agent; it requires Supabase Dashboard access with admin privileges on the hosted project (`eazyrdnvsiyaaccvjbhb`, per project memory).

1. Go to Authentication → Hooks in the Supabase Dashboard.
2. Under "Customize Access Token (JWT) Claims", select `public.custom_access_token_hook` as the Postgres function.
3. Enable the hook.
4. **Do not proceed to Task 5 (forced-refresh wiring) until this is confirmed enabled** — Task 9's isolation test is the actual proof it works, but enabling it is a prerequisite for that test to mean anything.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/046_custom_access_token_hook.sql
git commit -m "feat(wafi-122): add custom_access_token_hook for JWT active_role claim"
```

---

### Task 4: Client — embed `device_id` at sign-in

**Files:**
- Modify: `src/data/supabase/auth.ts:106-116` (the `signIn` function)
- Test: `src/__tests__/features/auth.deviceIdClaim.test.ts`

**Interfaces:**
- Consumes: `useDeviceStore().deviceId` (`src/store/device.store.ts`).
- Produces: `signIn` now passes `options: { data: { device_id } }` to `supabase.auth.signInWithPassword` — consumed by Task 3's hook (which reads `claims.device_id`, populated by Supabase from this `data` object into the session's user metadata / initial claims, per Supabase's documented behavior of `data` on sign-in becoming available to Auth Hooks).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const signInWithPasswordMock = vi.fn().mockResolvedValue({ error: null })
vi.mock('@/data/supabase/client', () => ({
  supabase: { auth: { signInWithPassword: signInWithPasswordMock } },
}))

import { signIn } from '@/data/supabase/auth'
import { useDeviceStore } from '@/store/device.store'

describe('signIn embeds device_id for the access-token hook', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    signInWithPasswordMock.mockClear()
    useDeviceStore().deviceId = 'device-123'
  })

  it('passes the current device_id in signInWithPassword options.data', async () => {
    await signIn({ phone: '0999999999', password: 'x' })

    expect(signInWithPasswordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ data: { device_id: 'device-123' } }),
      }),
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- auth.deviceIdClaim`
Expected: FAIL — `signInWithPassword` was not called with an `options.data.device_id` field (current `signIn` calls it with only `{ email, password }`).

- [ ] **Step 3: Modify `signIn`**

In `src/data/supabase/auth.ts`, change the `signIn` function to:

```typescript
import { useDeviceStore } from '@/store/device.store'

/** Sign a returning owner in by phone + password. */
export async function signIn(input: SignInInput): Promise<AuthOutcome> {
  try {
    const device = useDeviceStore()
    const { error } = await supabase.auth.signInWithPassword({
      email:    phoneToEmail(input.phone),
      password: input.password,
      options:  { data: { device_id: device.deviceId } },
    })
    if (error) return fail(classifyAuthError(error.message), error.message)
    return { ok: true }
  } catch (e) {
    return fail('offline', e instanceof Error ? e.message : 'network error')
  }
}
```

Note: `useDeviceStore()` requires an active Pinia instance at call time — confirm `signIn` is only ever invoked after Pinia is installed (it already is, since every existing caller is a Vue page/component with the app's Pinia instance active; this composable-in-a-non-composable-function pattern already exists elsewhere in this file's `verifyAccountPassword`, which calls `supabase.auth.getUser()` similarly outside a `<script setup>` context).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- auth.deviceIdClaim`
Expected: PASS

- [ ] **Step 5: Run the full existing `auth.ts` test suite to confirm no regression**

Run: `npm run test -- auth.test` (or whatever the existing test file for `src/data/supabase/auth.ts` is named — locate it first via `grep -rl "from '@/data/supabase/auth'" src/__tests__/`)
Expected: PASS, no regressions to `signUp`/`verifyAccountPassword`/error-classification tests.

- [ ] **Step 6: Commit**

```bash
git add src/data/supabase/auth.ts src/__tests__/features/auth.deviceIdClaim.test.ts
git commit -m "feat(wafi-122): embed device_id in sign-in for the access-token hook"
```

---

### Task 5: Client — wire `switch_active_operator` + forced refresh into staff switch

**Files:**
- Modify: `src/features/staff/composables/useOperatorSwitch.ts:22` (the `switchTo` function)
- Test: `src/__tests__/features/useOperatorSwitch.test.ts` (extend existing file)

**Interfaces:**
- Consumes: `useDeviceStore().deviceId`, `supabase` client (`src/data/supabase/client.ts`), `usePinAuth().verifyPin` (existing, unchanged — client-side PIN check still gates the UI before this RPC call, so a wrong PIN never even reaches the network in the common case).
- Produces: `switchTo(staff: Staff, pin: string)` — signature changes from `switchTo(staff: Staff)` to also take the PIN, since the RPC needs it. Consumed by every call site of `switchTo` (locate via `grep -rn "switchTo(" src/` before editing — update every call site in the same commit).

- [ ] **Step 1: Read the current `useOperatorSwitch.ts` and every call site**

Run: `grep -rn "switchTo(" src/` to find every place this function is called (the exploration for this plan found at least `src/features/staff/composables/useOperatorSwitch.ts:22` itself; there may be UI call sites in a PIN-entry component — locate and list them before writing the failing test, since Step 3 must update all of them).

- [ ] **Step 2: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const rpcMock = vi.fn().mockResolvedValue({ data: true, error: null })
const refreshSessionMock = vi.fn().mockResolvedValue({ data: {}, error: null })
vi.mock('@/data/supabase/client', () => ({
  supabase: { rpc: rpcMock, auth: { refreshSession: refreshSessionMock } },
}))

import { useOperatorSwitch } from '@/features/staff/composables/useOperatorSwitch'
import { useSessionStore } from '@/store/session.store'
import { useDeviceStore } from '@/store/device.store'
import type { Staff } from '@/features/staff/staff.types'

const cashier: Staff = {
  id: 'staff-1', shopId: 'shop-1', name: 'Ahmed', pinHash: 'abc', pinSalt: 'salt1',
  role: 'cashier',
  permissions: { can_view_reports: false, can_manage_products: false, can_manage_customers: true, can_view_expenses: false, can_manage_settings: false },
  isActive: true, createdAt: '2026-01-01T00:00:00Z',
}

describe('useOperatorSwitch.switchTo calls switch_active_operator and forces a token refresh', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    rpcMock.mockClear()
    refreshSessionMock.mockClear()
    useDeviceStore().deviceId = 'device-1'
  })

  it('calls switch_active_operator with device_id/staff_id/pin, then refreshSession, then sets the active staff', async () => {
    const { switchTo } = useOperatorSwitch()
    await switchTo(cashier, '1234')

    expect(rpcMock).toHaveBeenCalledWith('switch_active_operator', {
      p_device_id: 'device-1', p_staff_id: 'staff-1', p_pin: '1234',
    })
    expect(refreshSessionMock).toHaveBeenCalledOnce()
    expect(useSessionStore().activeStaff?.id).toBe('staff-1')
  })

  it('does not set the active staff or refresh the session if the RPC returns false (server-side PIN mismatch)', async () => {
    rpcMock.mockResolvedValueOnce({ data: false, error: null })
    const { switchTo } = useOperatorSwitch()
    await expect(switchTo(cashier, '9999')).rejects.toThrow(/pin/i)

    expect(refreshSessionMock).not.toHaveBeenCalled()
    expect(useSessionStore().activeStaff).toBeNull()
  })

  it('does not block the switch on offline RPC failure — logs and proceeds with client-side state only', async () => {
    rpcMock.mockRejectedValueOnce(new Error('network error'))
    const { switchTo } = useOperatorSwitch()
    await switchTo(cashier, '1234')

    // Offline-first: the device's local role claim will be stale until the RPC
    // succeeds on reconnect, but the operator switch itself must not be blocked
    // by a network failure (client-side PIN check already gated entry to this
    // function; the server call is a best-effort sync-layer update, not a
    // blocking authorization gate for local POS use).
    expect(useSessionStore().activeStaff?.id).toBe('staff-1')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- useOperatorSwitch`
Expected: FAIL — current `switchTo` takes only `(staff: Staff)`, calls neither `supabase.rpc` nor `refreshSession`.

- [ ] **Step 4: Modify `useOperatorSwitch.ts`**

```typescript
import { supabase } from '@/data/supabase/client'
import { useDeviceStore } from '@/store/device.store'
import { useSessionStore } from '@/store/session.store'
import type { Staff } from '@/features/staff/staff.types'

export function useOperatorSwitch() {
  const session = useSessionStore()

  async function switchTo(staff: Staff, pin: string): Promise<void> {
    const device = useDeviceStore()

    try {
      const { data: ok, error } = await supabase.rpc('switch_active_operator', {
        p_device_id: device.deviceId,
        p_staff_id:  staff.id,
        p_pin:       pin,
      })

      if (error) {
        // Offline-first: a network/transport error must not block the local
        // operator switch — the server-side active_role claim will simply
        // stay stale until the next successful call. This is a best-effort
        // sync-layer update, not a local authorization gate (client-side
        // usePinAuth().verifyPin already gated entry to this function).
        session.setActiveStaff(staff)
        return
      }

      if (!ok) {
        throw new Error('server-side PIN verification failed')
      }

      await supabase.auth.refreshSession()
      session.setActiveStaff(staff)
    } catch (e) {
      if (e instanceof Error && /pin/i.test(e.message)) throw e
      // Any other thrown error (e.g. a rejected promise from a transport
      // failure that surfaces as a throw rather than an `{ error }` result)
      // is treated the same as the offline case above.
      session.setActiveStaff(staff)
    }
  }

  return { switchTo }
}
```

- [ ] **Step 5: Update every other call site found in Step 1**

Each existing call to `switchTo(staff)` must be updated to `switchTo(staff, pin)`, threading through whatever PIN value that call site already has in scope (it must already have one, since `usePinAuth().verifyPin` was already being called somewhere before `switchTo` — locate that existing PIN variable rather than re-collecting the PIN from the user a second time).

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test -- useOperatorSwitch`
Expected: PASS (all 3 new tests, plus any pre-existing tests in this file)

- [ ] **Step 7: Run the full suite**

Run: `npm run test`
Expected: PASS, 0 failures (this confirms the Step 5 call-site updates didn't break any other test that mocks `switchTo`).

- [ ] **Step 8: Commit**

```bash
git add src/features/staff/composables/useOperatorSwitch.ts src/__tests__/features/useOperatorSwitch.test.ts
git commit -m "feat(wafi-122): call switch_active_operator + force session refresh on staff switch"
```

---

### Task 6: `powersync.yaml` — role-branch cost-bearing streams

**Files:**
- Modify: `powersync.yaml`

**Interfaces:**
- Consumes: the `active_role` claim minted by Task 3's hook, readable in stream queries via `request.jwt() ->> 'active_role'` (verify this exact accessor syntax against PowerSync's edition-3 docs before writing — the file's own header comment already flags "VERIFY ON DEPLOY" for a different subquery-shape concern, so this file already carries that verification discipline).
- Produces: two query variants per cost-bearing table, replacing the single existing line for each.

- [ ] **Step 1: Replace the `products` line**

Change:
```yaml
      - SELECT * FROM public.products                   WHERE shop_id IN (SELECT id FROM public.shops WHERE owner_user_id = auth.user_id())
```
to:
```yaml
      # WAFI-122: cost_price_usd withheld from cashier sessions (server-side
      # enforcement — see ADR-009). Column list here must be kept in sync with
      # products' full column list minus cost_price_usd; verify against
      # supabase/migrations for the current authoritative column list before
      # each edit, since this list will drift as products gains columns.
      - SELECT id, shop_id, name, barcode, price_usd, price_syp, stock_qty,
               category_id, subcategory_id, is_active, created_at, sync_status
        FROM public.products
        WHERE shop_id IN (SELECT id FROM public.shops WHERE owner_user_id = auth.user_id())
          AND (request.jwt() ->> 'active_role') = 'cashier'
      - SELECT * FROM public.products
        WHERE shop_id IN (SELECT id FROM public.shops WHERE owner_user_id = auth.user_id())
          AND (request.jwt() ->> 'active_role') IN ('owner', 'manager')
```

Before finalizing this specific query, read `src/data/powersync/schema.ts`'s `products` table definition (and cross-check the latest `supabase/migrations/*.sql` touching `products`) to get the CURRENT full column list minus `cost_price_usd` — the column list above is illustrative from this plan's research and must be verified against the live schema at implementation time, not copied verbatim without checking.

- [ ] **Step 2: Apply the same two-variant pattern to every other cost-bearing table**

Repeat Step 1's pattern for: `expenses` (entire table withheld from cashier — cashier variant returns zero rows via a query with an always-false predicate for the cashier branch, e.g. `WHERE false`, since expenses carry no non-cost data cashiers need), `stock_receivings`/`stock_receiving_line_items` (withhold `unit_cost_usd`/`total_cost_usd`), `stock_take_lines` (withhold `unit_cost_usd`, `cost_updated`), `suppliers` (withhold payment-term/cost fields — check the current `suppliers` migration for the exact column list), `staff_ledger`/`staff_settlements` (entire tables withheld from cashier, same `WHERE false` pattern as `expenses` — these are the WAFI-138 tables this whole effort exists to unblock).

For each table, get the exact current column list from `src/data/powersync/schema.ts` before writing the cashier-safe variant — do not guess column names.

- [ ] **Step 3: Add the verification comment**

At the top of the modified section, add:

```yaml
      # ⚠️ VERIFY ON DEPLOY (WAFI-122): confirm `request.jwt() ->> 'active_role'`
      # is a valid accessor in this PowerSync edition/version, and that the
      # Customize Access Token Hook (migration 046, enabled in the dashboard
      # per that migration's Task 3) is actually live BEFORE deploying this
      # file — otherwise every session's active_role claim is absent and every
      # row falls through neither branch (visible as missing data, not a
      # security hole, but confirm the failure mode in staging first).
```

- [ ] **Step 4: Commit**

```bash
git add powersync.yaml
git commit -m "feat(wafi-122): role-branch cost-bearing sync streams on active_role claim"
```

---

### Task 7: Fail-closed default test for the hook function

**Files:**
- Create: `supabase/migrations/__tests__/custom_access_token_hook.test.sql` (or, if this repo has no existing pattern for testing SQL functions directly — check first via `find supabase -iname "*test*"` — fall back to a documented manual verification procedure in the same location instead of inventing a new test framework)

**Interfaces:**
- Consumes: `public.custom_access_token_hook` (Task 3).
- Produces: verification that the fail-closed behavior (missing `device_id`, missing `device_sessions` row) genuinely returns `active_role = 'cashier'`, not a null or missing key.

- [ ] **Step 1: Check for an existing SQL-testing convention**

Run: `find supabase -iname "*test*"` and `grep -rn "pgTAP\|pg_prove" package.json supabase/`. If no SQL-testing framework exists in this repo (most likely, since none was found in WAFI-138's migration work), do NOT introduce one for a single function — instead write a manual verification script.

- [ ] **Step 2: Write the manual verification script** (assuming no SQL test framework — adjust if Step 1 found one)

Create `supabase/migrations/verification/verify_custom_access_token_hook.sql`:

```sql
-- Manual verification for WAFI-122's custom_access_token_hook fail-closed
-- behavior. Run this against a Supabase SQL editor (staging/local) after
-- migration 046 is applied. Not part of the automated migration set —
-- this is a documented check, run and inspected by hand.

-- Case 1: no device_id claim at all → must return 'cashier'.
SELECT public.custom_access_token_hook(
  '{"user_id": "00000000-0000-0000-0000-000000000000", "claims": {}}'::jsonb
) = '{"claims": {"active_role": "cashier"}}'::jsonb AS case_1_pass;

-- Case 2: device_id claim present but no matching device_sessions row →
-- must return 'cashier', not null/error.
SELECT public.custom_access_token_hook(
  '{"user_id": "00000000-0000-0000-0000-000000000000",
    "claims": {"device_id": "11111111-1111-1111-1111-111111111111"}}'::jsonb
) = '{"claims": {"device_id": "11111111-1111-1111-1111-111111111111", "active_role": "cashier"}}'::jsonb
  AS case_2_pass;

-- Case 3 (requires a real device_sessions row for a test device/shop —
-- insert one first, then verify the correct role round-trips):
-- INSERT INTO public.device_sessions (device_id, shop_id, active_role)
--   VALUES ('11111111-1111-1111-1111-111111111111', '<a real shop_id>', 'owner');
-- SELECT public.custom_access_token_hook(
--   '{"user_id": "...", "claims": {"device_id": "11111111-1111-1111-1111-111111111111"}}'::jsonb
-- ) -> 'claims' ->> 'active_role' = 'owner' AS case_3_pass;
```

Document in a comment at the top of this file: run each `SELECT` in the Supabase SQL editor, confirm each returns `true`, then delete any inserted test row.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/verification/verify_custom_access_token_hook.sql
git commit -m "docs(wafi-122): add manual fail-closed verification script for the access-token hook"
```

---

### Task 8: ADR status update

**Files:**
- Modify: `docs/adr/ADR-009-server-side-financial-role-enforcement.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Update the Status field**

Change the header table's `Status` row from `Proposed (spike output — not yet implemented)` to `Accepted (implementation landed; hosted-Supabase dashboard hook wiring and two-session isolation test pending — see Definition of Done)`.

- [ ] **Step 2: Commit**

```bash
git add docs/adr/ADR-009-server-side-financial-role-enforcement.md
git commit -m "docs(wafi-122): update ADR-009 status to reflect landed implementation"
```

---

### Task 9: HUMAN ACTION REQUIRED — two-session isolation test (Definition of Done)

**Files:** none — this is a manual verification procedure, not a code task. **Cannot be executed by an autonomous coding agent**; requires two real or emulated devices signed into the same hosted-Supabase shop account, plus dashboard access to confirm the hook is enabled (Task 3 Step 3 must be done first).

- [ ] **Step 1: Register two devices under one shop**

Using the app itself (not code), sign in on Device A and Device B under the same shop account (per WAFI-119's model, they share the one Supabase Auth account for that shop).

- [ ] **Step 2: Set Device A to a cashier operator, Device B to the owner**

On Device A, PIN-switch to a cashier-role staff member. On Device B, PIN-switch to the owner. Confirm both `switch_active_operator` calls succeed (check `device_sessions` rows in the Supabase dashboard directly — two rows, one per `device_id`, with the expected `active_role` each).

- [ ] **Step 3: Force both devices to refresh, then inspect local data**

Confirm both devices actually called `refreshSession()` (Task 5's wiring does this automatically on switch). Then, on Device A (cashier), inspect the local PowerSync SQLite database directly (e.g. via browser dev tools' IndexedDB/OPFS inspector, or whatever this project's existing debug tooling is) and confirm: `products.cost_price_usd` is absent/null for all rows, `expenses` table is empty, `staff_ledger`/`staff_settlements` tables are empty. On Device B (owner), confirm all of the above ARE present and correct.

- [ ] **Step 4: Confirm the "propagates within one sync cycle" acceptance criterion**

On Device A, PIN-switch FROM cashier TO the owner role (promote the operator mid-session). Confirm that within one sync cycle (i.e., shortly after the forced `refreshSession()`), Device A's local database now DOES receive the previously-withheld cost/expense/ledger data.

- [ ] **Step 5: Confirm existing-device rollout safety**

Using a device that was already signed in and syncing BEFORE this feature was deployed (i.e., an existing session that has never called `switch_active_operator` and so has no `device_sessions` row), confirm it falls back to `cashier`-level data (fail-closed) rather than erroring or crashing — an existing owner device that hasn't yet done a PIN switch since this feature deployed should re-run Task 5's `switchTo` flow (or the app should prompt an explicit sign-in refresh) to establish its `device_sessions` row and regain full data. Document the actual observed behavior here, since this is exactly the "existing synced devices" rollout risk ADR-009 flags as a trade-off.

- [ ] **Step 6: Record the outcome**

Write the pass/fail result of each step above into `.superpowers/sdd/progress.md` (or wherever this plan's execution is being tracked) — this is the actual proof required by WAFI-122's Definition of Done ("two-session isolation test on hosted Supabase").
