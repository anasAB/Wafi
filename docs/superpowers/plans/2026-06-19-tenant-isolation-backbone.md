# Tenant Isolation Backbone Implementation Plan

> ⚠️ **SUPERSEDED — DO NOT IMPLEMENT THE JWT-CLAIM DESIGN BELOW.**
> The shipped architecture does **not** use a `shop_id` JWT claim or a Custom
> Access Token Hook. Both server and client scope on the
> `shops.owner_user_id → auth.uid()` mapping instead:
> - **RLS** (migration `015`) uses `public.auth_shop_id()` (owner mapping); no claim.
> - **Sync rules** (`powersync.yaml`) filter by `owner_user_id = auth.user_id()`; no claim.
> - **Client** (`device.store.ts`) reads `shopId` from the locally-synced `shops`
>   row; no JWT decoding (`jwt.ts` was removed).
> - Migration `014` (the access-token hook) was **deleted** — do not recreate it,
>   and skip the "enable the hook" dashboard step (Task 2 below).
>
> The task-by-task content below is kept only for historical context.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scope every synced table to the signed-in shop via a `shop_id` JWT claim, replacing the wide-open RLS policies and the hardcoded client `shop_id` stub.

**Architecture:** A Postgres Custom Access Token Hook injects a top-level `shop_id` claim (derived from `shops.owner_user_id`) at every token mint. RLS on all 19 synced tables is rewritten to `shop_id = auth_shop_id()`. PowerSync sync rules already read `request.jwt() ->> 'shop_id'` (unchanged). The client decodes the locally-stored JWT to populate `deviceStore.shopId` (offline-safe).

**Tech Stack:** Supabase (Postgres + Auth Hooks), PostgREST RLS, PowerSync, Vue 3 + Pinia, Vitest, TypeScript.

## Global Constraints

- Migrations are expand-only and idempotent (`IF EXISTS` / `IF NOT EXISTS`); never `DROP`/`RENAME` live data (ENFORCEMENT.md §6).
- No new runtime dependencies without an ADR — JWT decoding is hand-rolled, not a library.
- Offline-first must hold: client reads `shop_id` from the local token, never a network call (Sacred Rule #1).
- Plain-language Arabic for any user-facing string.
- Migration numbering continues from existing `012`: new files are `013`, `014`, `015`.
- **Hard rollout gate:** the scoped-RLS migration (Task 3) must NOT be applied until the token is verified to carry `shop_id` (end of Task 2). Applying it early locks the account out of its own data.

---

### Task 1: Add `shops.owner_user_id` (claim source of truth)

**Files:**
- Create: `supabase/migrations/013_shops_owner_user_id.sql`

**Interfaces:**
- Produces: `public.shops.owner_user_id uuid` (unique when not null) — read by the hook in Task 2.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/013_shops_owner_user_id.sql`:

```sql
-- Wafi POS — Link a shop to its owning Supabase Auth account.
-- This column is the single source of truth the access-token hook reads to
-- inject the shop_id claim. Sub-project 2 (signup) will populate it; for now it
-- is set by hand on the seed shop. Safe + idempotent.

ALTER TABLE public.shops
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES auth.users(id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_shops_owner_user
  ON public.shops (owner_user_id)
  WHERE owner_user_id IS NOT NULL;
```

- [ ] **Step 2: Apply the migration**

Paste the file's contents into the Supabase SQL Editor and run (or `supabase db push` if linked).
Expected: `Success. No rows returned`.

- [ ] **Step 3: Find the dev user's uid**

Run in SQL Editor:

```sql
select id, email from auth.users order by created_at limit 5;
```
Expected: at least your dev user's row. Copy its `id`.

- [ ] **Step 4: Link the seed shop to the dev user**

Run, substituting the uid from Step 3:

```sql
update public.shops
set owner_user_id = '<DEV_USER_UID>'
where id = '00000000-0000-0000-0000-000000000001';
```
Expected: `UPDATE 1`. (If `UPDATE 0`, the seed shop row is missing — insert it from `supabase/seed.sql` first.)

- [ ] **Step 5: Verify**

```sql
select id, name, owner_user_id from public.shops
where id = '00000000-0000-0000-0000-000000000001';
```
Expected: one row with `owner_user_id` = the dev uid.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/013_shops_owner_user_id.sql
git commit -m "feat(auth): add shops.owner_user_id as shop_id claim source"
```

---

### Task 2: Custom Access Token Hook + enable + GATE verification

**Files:**
- Create: `supabase/migrations/014_custom_access_token_hook.sql`

**Interfaces:**
- Consumes: `public.shops.owner_user_id` (Task 1).
- Produces: a top-level `shop_id` claim in every issued access token — read by RLS (Task 3), sync rules (existing), and the client (Task 4).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/014_custom_access_token_hook.sql`:

```sql
-- Wafi POS — Custom Access Token Hook: inject shop_id claim from shops.owner_user_id.
-- Enable it afterward in: Supabase Dashboard → Authentication → Hooks →
-- "Custom Access Token" → select public.custom_access_token_hook.
-- Idempotent (CREATE OR REPLACE / GRANT / REVOKE).

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb;
  v_shop_id uuid;
begin
  select id into v_shop_id
  from public.shops
  where owner_user_id = (event->>'user_id')::uuid
  limit 1;

  claims := event->'claims';
  if v_shop_id is not null then
    claims := jsonb_set(claims, '{shop_id}', to_jsonb(v_shop_id::text));
  else
    claims := claims - 'shop_id';
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- The hook runs as the supabase_auth_admin role.
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
grant select on table public.shops to supabase_auth_admin;

-- Never callable by client roles.
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
```

- [ ] **Step 2: Apply the migration**

Run the file in the Supabase SQL Editor.
Expected: `Success. No rows returned`.

- [ ] **Step 3: Enable the hook (config, not SQL)**

In the Supabase Dashboard → Authentication → Hooks → "Custom Access Token" → enable and select `public.custom_access_token_hook`. Save.

- [ ] **Step 4: Mint a fresh token**

In the app, sign out and sign back in (forces a new token). If using dev auto-sign-in, clear the session: in the browser console run `await window.localStorage.clear()` then reload.

- [ ] **Step 5: GATE — verify the claim is present**

In the browser console (app tab):

```js
const { data } = await (await import('/src/data/supabase/client.ts')).supabase.auth.getSession()
const payload = JSON.parse(atob(data.session.access_token.split('.')[1]))
console.log('shop_id claim:', payload.shop_id)
```
Expected: `shop_id claim: 00000000-0000-0000-0000-000000000001`.

**STOP if this is undefined/empty.** Do not proceed to Task 3 — the hook is not wired and applying scoped RLS would lock you out. Re-check Steps 3–4 and the seed-shop link from Task 1.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/014_custom_access_token_hook.sql
git commit -m "feat(auth): custom access token hook injecting shop_id claim"
```

---

### Task 3: Scope all RLS policies to the shop_id claim

**Files:**
- Create: `supabase/migrations/015_rls_tenant_scoping.sql`

**Interfaces:**
- Consumes: the `shop_id` claim (Task 2), verified present at the Task 2 gate.
- Produces: `public.auth_shop_id() returns uuid`; tenant-scoped RLS on all 19 synced tables.

> **Precondition:** the Task 2 gate (Step 5) passed. Do not start otherwise.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/015_rls_tenant_scoping.sql`:

```sql
-- Wafi POS — Replace permissive RLS (USING true) with per-shop scoping.
-- Reads the shop_id claim injected by the access-token hook (migration 014).
-- Covers every synced table, including products/staff/audit_log (previously
-- USING true from 005/006/008). Idempotent: drops old policies, recreates scoped.

create or replace function public.auth_shop_id()
returns uuid
language sql
stable
as $$ select nullif(auth.jwt() ->> 'shop_id', '')::uuid $$;

do $$
declare
  t text;
  tables text[] := array[
    'products','stock_adjustments','sales','sale_line_items','exchange_rates',
    'expenses','customers','customer_payments','receipt_settings','sale_payments',
    'staff','cashier_shifts','returns','return_line_items','return_reasons',
    'audit_log','suppliers','stock_receivings','stock_receiving_line_items'
  ];
  p text;
begin
  foreach t in array tables loop
    if exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t and c.relkind = 'r'
    ) then
      execute format('alter table public.%I enable row level security', t);

      -- Drop any prior policies we created (permissive or scoped) so this is re-runnable.
      foreach p in array array['_select_all','_insert_all','_update_all','_delete_all'] loop
        execute format('drop policy if exists %I on public.%I', t || p, t);
      end loop;

      execute format(
        'create policy %I on public.%I for select to anon, authenticated using (shop_id = public.auth_shop_id())',
        t || '_select_all', t);
      execute format(
        'create policy %I on public.%I for insert to anon, authenticated with check (shop_id = public.auth_shop_id())',
        t || '_insert_all', t);
      execute format(
        'create policy %I on public.%I for update to anon, authenticated using (shop_id = public.auth_shop_id()) with check (shop_id = public.auth_shop_id())',
        t || '_update_all', t);
      execute format(
        'create policy %I on public.%I for delete to anon, authenticated using (shop_id = public.auth_shop_id())',
        t || '_delete_all', t);
    end if;
  end loop;
end $$;
```

- [ ] **Step 2: Apply the migration**

Run the file in the Supabase SQL Editor.
Expected: `Success. No rows returned`.

- [ ] **Step 3: Verify policies are scoped (not `true`)**

```sql
select tablename, policyname, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'sales'
order by policyname;
```
Expected: `qual` / `with_check` contain `auth_shop_id()` (not `true`).

- [ ] **Step 4: Test isolation WITHOUT needing two real users (RLS impersonation)**

Run as a single block in the SQL Editor:

```sql
-- Act as an authenticated user belonging to shop ...0001
set local role authenticated;
set local request.jwt.claims = '{"shop_id":"00000000-0000-0000-0000-000000000001"}';

-- Allowed: reads own shop
select count(*) as own_rows from public.sales;

-- Denied: inserting a row for a DIFFERENT shop must fail the WITH CHECK
insert into public.sales (id, shop_id, device_id, device_sequence, display_sale_number,
  created_at, total_usd, total_syp, exchange_rate_at_sale, payment_method,
  amount_received, amount_received_currency, change_due)
values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000FF',
  '00000000-0000-0000-0000-000000000002', 999, 'TEST-ISO',
  now(), 1, 1, 1, 'cash_usd', 1, 'USD', 0);

reset role;
```
Expected: the `select` returns your own row count; the `insert` **fails** with `new row violates row-level security policy for table "sales"`. (If the insert succeeds, scoping is broken — investigate before continuing.)

- [ ] **Step 5: Regression — app still syncs**

In the app (signed in as the dev user), make a test sale. Confirm rows appear:

```sql
select count(*) from public.sales;
```
Expected: count increases; no `403` in the console.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/015_rls_tenant_scoping.sql
git commit -m "feat(auth): scope all synced-table RLS to shop_id claim"
```

---

### Task 4: Client reads shop_id from the JWT (replace the stub)

**Files:**
- Create: `src/data/supabase/jwt.ts`
- Create: `src/__tests__/data/jwt.test.ts`
- Modify: `src/store/device.store.ts`
- Create: `src/__tests__/store/device.store.test.ts`

**Interfaces:**
- Produces: `decodeJwtPayload(token: string): Record<string, unknown> | null`; `shopIdFromToken(token: string | null | undefined): string | null`.
- Modifies: `useDeviceStore().shopId` changes type from `string` to `string | null` (a ref, populated from the session token and kept in sync via `onAuthStateChange`).

- [ ] **Step 1: Write the failing test for the JWT util**

Create `src/__tests__/data/jwt.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { decodeJwtPayload, shopIdFromToken } from '@/data/supabase/jwt'

// header.payload.signature — payload is base64url of {"shop_id":"shop-123"}
function tokenWith(payload: object): string {
  const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `h.${b64}.s`
}

describe('decodeJwtPayload', () => {
  it('decodes a base64url payload', () => {
    expect(decodeJwtPayload(tokenWith({ shop_id: 'shop-123' }))).toEqual({ shop_id: 'shop-123' })
  })
  it('returns null for a malformed token', () => {
    expect(decodeJwtPayload('not-a-jwt')).toBeNull()
  })
})

describe('shopIdFromToken', () => {
  it('returns the shop_id claim', () => {
    expect(shopIdFromToken(tokenWith({ shop_id: 'shop-123' }))).toBe('shop-123')
  })
  it('returns null when claim is missing', () => {
    expect(shopIdFromToken(tokenWith({ sub: 'u1' }))).toBeNull()
  })
  it('returns null for null/empty token', () => {
    expect(shopIdFromToken(null)).toBeNull()
    expect(shopIdFromToken(undefined)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run src/__tests__/data/jwt.test.ts`
Expected: FAIL — cannot resolve `@/data/supabase/jwt`.

- [ ] **Step 3: Implement the JWT util**

Create `src/data/supabase/jwt.ts`:

```ts
/**
 * Minimal JWT payload decoding — no dependency, no network.
 * We only ever read the locally-stored Supabase access token to learn the
 * shop_id claim, so this must work offline (Sacred Rule #1).
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    return JSON.parse(atob(padded)) as Record<string, unknown>
  } catch {
    return null
  }
}

/** Extract the shop_id claim, or null when absent/blank/unparsable. */
export function shopIdFromToken(token: string | null | undefined): string | null {
  if (!token) return null
  const shopId = decodeJwtPayload(token)?.shop_id
  return typeof shopId === 'string' && shopId.length > 0 ? shopId : null
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run src/__tests__/data/jwt.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing test for the device store**

Create `src/__tests__/store/device.store.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const session = { access_token: '' }
vi.mock('@/data/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: session.access_token ? session : null } })),
      onAuthStateChange: vi.fn(),
    },
  },
}))

function tokenWith(payload: object): string {
  const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `h.${b64}.s`
}

describe('useDeviceStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('starts with null shopId before auth', async () => {
    const { useDeviceStore } = await import('@/store/device.store')
    expect(useDeviceStore().shopId).toBeNull()
  })

  it('reads shopId from the session token on refreshShopId()', async () => {
    session.access_token = tokenWith({ shop_id: 'shop-xyz' })
    const { useDeviceStore } = await import('@/store/device.store')
    const store = useDeviceStore()
    await store.refreshShopId()
    expect(store.shopId).toBe('shop-xyz')
  })
})
```

- [ ] **Step 6: Run the test, verify it fails**

Run: `npx vitest run src/__tests__/store/device.store.test.ts`
Expected: FAIL — `shopId` is the old string stub / `refreshShopId` is not a function.

- [ ] **Step 7: Rewrite the device store**

Replace `src/store/device.store.ts` with:

```ts
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '@/data/supabase/client'
import { shopIdFromToken } from '@/data/supabase/jwt'

export const useDeviceStore = defineStore('device', () => {
  // shop_id now comes from the signed-in account's JWT claim (set by the
  // custom access token hook). Null until auth completes.
  const shopId = ref<string | null>(null)

  // deviceId/deviceCode remain stubbed — real device registration is Sub-project 3.
  const deviceId   = (import.meta.env.VITE_STUB_DEVICE_ID   ?? '00000000-0000-0000-0000-000000000002') as string
  const deviceCode = (import.meta.env.VITE_STUB_DEVICE_CODE ?? 'A') as string

  async function refreshShopId(): Promise<void> {
    const { data } = await supabase.auth.getSession()
    shopId.value = shopIdFromToken(data.session?.access_token)
  }

  // Keep shopId in sync with sign-in / refresh / sign-out.
  supabase.auth.onAuthStateChange((_event, sess) => {
    shopId.value = shopIdFromToken(sess?.access_token)
  })

  return { shopId, deviceId, deviceCode, refreshShopId }
})
```

- [ ] **Step 8: Run the test, verify it passes**

Run: `npx vitest run src/__tests__/store/device.store.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: Typecheck the whole app (catch `string | null` fallout)**

Run: `npx vue-tsc --noEmit -p tsconfig.json`
Expected: exit 0. If a consumer requires a non-null `shopId`, guard it (`if (!device.shopId) return`) at that call site — do not revert the type.

- [ ] **Step 10: Commit**

```bash
git add src/data/supabase/jwt.ts src/store/device.store.ts src/__tests__/data/jwt.test.ts src/__tests__/store/device.store.test.ts
git commit -m "feat(auth): read shop_id from JWT claim into device store"
```

---

## Self-Review

**Spec coverage:**
- `shops.owner_user_id` source of truth → Task 1 ✓
- Custom Access Token Hook + grants + enablement → Task 2 ✓
- `auth_shop_id()` helper + scoped RLS on all 19 tables (incl. products/staff/audit_log) → Task 3 ✓
- Sync rules unchanged → no task needed (verified by Task 3 Step 5 regression) ✓
- Client decodes JWT → `deviceStore.shopId` (offline, no dep) → Task 4 ✓
- Rollout order / self-lockout gate → enforced by Task 2 Step 5 gate + Task 3 precondition ✓
- Edge cases (no shop, offline, malformed claim, upload under RLS, existing data) → covered by impl (`shopIdFromToken` null-handling, `nullif`, seed-shop link) and Task 3/4 tests ✓
- Cross-tenant test → Task 3 Step 4 (RLS impersonation) ✓; regression → Task 3 Step 5 ✓; client unit → Task 4 ✓

**Placeholder scan:** `<DEV_USER_UID>` in Task 1 is an intentional per-environment fill-in with explicit instructions to obtain it (Step 3), not a gap. No other placeholders.

**Type consistency:** `shopIdFromToken` / `decodeJwtPayload` signatures match between `jwt.ts`, its test, and the store. `refreshShopId(): Promise<void>` and `shopId: string | null` consistent across store, test, and Task 4 interface block.
