# Real Auth — Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the already-built auth service layer (`src/data/supabase/auth.ts`: `signUpOwner`/`signIn`/`signOut`) into the UI (`SignupPage.vue`, `LoginPage.vue`, sign-out button), add a session-based router guard, fix the confirmed-broken `shops` PowerSync schema gap, clear local data on account switch, and add real per-device registration — closing out the Real Auth epic (`docs/superpowers/plans/2026-06-20-epic-real-auth-onboarding-device-registration.md`).

**Architecture:** This is a wiring plan, not a backend-design plan — `auth.ts` (signup/signin/signout with phone→synthetic-email mapping and structured error classification) and migration `021_provision_shop_on_signup.sql` (atomic shop provisioning trigger) already exist and are unit-tested. The gap is entirely in the UI layer (two mockup pages faking a delay instead of calling the service), the router (no session guard exists), the PowerSync client schema (`shops` table is queried but never declared, so the query silently fails and falls back to the stub), and device identity (still a hardcoded env stub — `devices` table doesn't exist).

**Tech Stack:** Vue 3 `<script setup lang="ts">`, Pinia, PowerSync (`db.getOptional`/`db.execute`/`db.disconnectAndClear`/`db.connect`), Supabase Auth (`supabase.auth.onAuthStateChange`), Vitest, `vue-i18n`.

## Global Constraints

- Never call `supabase.auth` directly from a page/component — always go through `src/data/supabase/auth.ts`'s `signUpOwner`/`signIn`/`signOut`/`verifyAccountPassword` (the file's own header comment: "This module is the single seam between the app and Supabase Auth").
- Never conflate the account password (cloud login, `auth.ts`) with the staff PIN (`/setup-owner`, `StaffForm.vue`) — they are different concepts (epic edge case).
- A signup success must route to `/setup-owner`, not `/onboarding` or `/` — a brand-new shop has no owner `staff`/PIN row yet (migration 021's comment is explicit that PIN/staff creation is deliberately left to `/setup-owner`).
- All new Arabic UI strings go through `vue-i18n` (`t('...')`) — `PersonalPreferencesScreen.vue` and `ReportsPage.vue` already use this pattern; match it, don't hardcode inline strings in files that already use `useI18n()`.
- New PowerSync tables/columns get RLS scoped by `shop_id`/`owner_user_id` mirroring existing migrations, and must be added to the `powersync`/`powersync_publication` publications (mirrors migration 015/027/036's `DO $$` block pattern).
- Composable/store tests mock `@/data/powersync/db` via `vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))` (the existing shared mock) and `@/data/supabase/client` via an inline `vi.mock` (see `device.store.test.ts` for the established pattern) — do not introduce a new mocking style.

---

## File structure

| File | Responsibility |
|---|---|
| `src/data/powersync/schema.ts` (modify) | Add `shops`, `devices` tables to the client `AppSchema` |
| `supabase/migrations/037_devices.sql` | `devices` table (server-allocated permanent codes A/B/C…, temp T-xxxx), RLS, publication |
| `src/store/device.store.ts` (modify) | Clear local PowerSync DB on account switch; replace stubbed `deviceId`/`deviceCode` with real registration |
| `src/features/devices/composables/useDeviceRegistration.ts` | Claim a device code (permanent if online, temp if offline) and reconcile on next sync |
| `src/router/index.ts` (modify) | Register `/login`, `/signup`; add a session-based auth guard |
| `src/pages/SignupPage.vue` (modify) | Wire `finish()` to `signUpOwner()`; route to `/setup-owner` on success |
| `src/pages/LoginPage.vue` (modify) | Wire `submit()` to `signIn()`; route to `/` on success |
| `src/features/settings/screens/PersonalPreferencesScreen.vue` (modify) | Enable the sign-out button; warn on unsynced writes before signing out |
| `src/pages/ForgotPasswordPage.vue` | Assisted password-reset screen (B4) |
| `src/i18n/ar.ts`, `src/i18n/en.ts` (modify) | New auth/sign-out/forgot-password strings |
| `src/__tests__/__mocks__/db.ts` (modify) | Add `getUploadQueueStats`/`disconnectAndClear` to the shared PowerSync mock |

---

### Task 1: Fix the `shops` PowerSync schema gap

**Files:**
- Modify: `src/data/powersync/schema.ts`

**Interfaces:**
- Produces: local table `shops` (`id`, `owner_user_id`, `name`, `business_type`, `country`, `created_at`), registered in `AppSchema` — makes `device.store.ts:41`'s `SELECT id FROM shops WHERE owner_user_id = ?` actually resolve locally instead of silently failing (caught by its own `try/catch`) and falling back to the (production-empty) stub.

- [ ] **Step 1: Add the `shops` table definition**

In `src/data/powersync/schema.ts`, add above `export const AppSchema`:

```ts
const shops = new Table({
  owner_user_id: column.text,
  name:          column.text,
  business_type: column.text,
  country:       column.text,
  created_at:    column.text,
})
```

- [ ] **Step 2: Register it in `AppSchema`**

```ts
export const AppSchema = new Schema({
  products,
  stock_adjustments,
  sales,
  sale_line_items,
  exchange_rates,
  expenses,
  customers,
  customer_payments,
  installment_plans,
  installment_dues,
  receipt_settings,
  sale_payments,
  staff,
  cashier_shifts,
  cash_movements,
  returns,
  return_line_items,
  return_reasons,
  sync_dead_letter,
  audit_log,
  suppliers,
  stock_receivings,
  stock_receiving_line_items,
  stock_take_sessions,
  stock_take_lines,
  categories,
  subcategories,
  shops,
})
```

(Match against the file's current member list exactly — read the file first since table order may have shifted; add `shops` as the final entry.)

- [ ] **Step 3: Verify the PowerSync sync rules already publish `shops`**

Run: `grep -n "shops" powersync.yaml` (or wherever the project's PowerSync sync-rules YAML lives — locate with `Glob '**/powersync.yaml'` if the path isn't obvious). If `shops` is missing from the sync rules' bucket definitions, add it scoped by `owner_user_id = request.user_id()` (or the project's existing per-owner sync-rule pattern) — the RLS migration already exists (`013_shops_owner_user_id.sql`); this step is only about whether PowerSync's *sync rules* (separate from Postgres RLS) currently stream `shops` rows to the client at all.

- [ ] **Step 4: Type-check**

Run: `npx vue-tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/data/powersync/schema.ts
git commit -m "fix: register shops table in PowerSync client schema (was silently unresolvable)"
```

---

### Task 2: `devices` table — migration + PowerSync schema

**Files:**
- Create: `supabase/migrations/037_devices.sql`
- Modify: `src/data/powersync/schema.ts`

**Interfaces:**
- Produces: `public.devices(id, shop_id, code, is_temporary, registered_at, sync_status)`; local `devices` table registered in `AppSchema`.

- [ ] **Step 1: Write the migration**

```sql
-- Wafi POS — WAFI-055 (Real Auth epic, Decision 3): per-device registration.
--
-- Codes are server-allocated permanent letters (A, B, C, ...) per shop, so two
-- devices on the same shop never collide on a sale-number sequence. A device
-- that registers offline gets a unique temporary code (T-<random>) and
-- reconciles to a permanent one on next sync (useDeviceRegistration.ts, Task 8).

CREATE TABLE IF NOT EXISTS public.devices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       uuid NOT NULL,
  code          text NOT NULL,
  is_temporary  boolean NOT NULL DEFAULT false,
  registered_at timestamptz NOT NULL DEFAULT now(),
  sync_status   text
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_shop_code
  ON public.devices (shop_id, code);

ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS devices_select_all ON public.devices;
DROP POLICY IF EXISTS devices_insert_all ON public.devices;
DROP POLICY IF EXISTS devices_update_all ON public.devices;
CREATE POLICY devices_select_all ON public.devices
  FOR SELECT TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()));
CREATE POLICY devices_insert_all ON public.devices
  FOR INSERT TO anon, authenticated
  WITH CHECK (shop_id = (select public.auth_shop_id()));
CREATE POLICY devices_update_all ON public.devices
  FOR UPDATE TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()))
  WITH CHECK (shop_id = (select public.auth_shop_id()));

-- Allocates the next free permanent letter code (A, B, C, ..., Z, AA, AB, ...)
-- for a shop. Called by useDeviceRegistration.ts when a device is online.
CREATE OR REPLACE FUNCTION public.allocate_device_code(p_shop_id uuid)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer;
  v_code  text;
  v_n     integer;
BEGIN
  SELECT COUNT(*) INTO v_count FROM public.devices
    WHERE shop_id = p_shop_id AND is_temporary = false;
  v_n := v_count;
  v_code := '';
  LOOP
    v_code := chr(65 + (v_n % 26)) || v_code;
    v_n := v_n / 26 - 1;
    EXIT WHEN v_n < 0;
  END LOOP;
  RETURN v_code;
END;
$$;

DO $$
DECLARE
  pub_name text;
BEGIN
  FOREACH pub_name IN ARRAY ARRAY['powersync', 'powersync_publication']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = pub_name) THEN
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = pub_name AND schemaname = 'public' AND tablename = 'devices'
      ) THEN
        EXECUTE format('ALTER PUBLICATION %I ADD TABLE public.devices', pub_name);
      END IF;
    END IF;
  END LOOP;
END $$;
```

- [ ] **Step 2: Add the local table**

In `src/data/powersync/schema.ts`, above `export const AppSchema`:

```ts
const devices = new Table({
  shop_id:       column.text,
  code:          column.text,
  is_temporary:  column.integer,
  registered_at: column.text,
  sync_status:   column.text,
})
```

Add `devices,` to the `AppSchema` member list (after `shops,` from Task 1).

- [ ] **Step 3: Type-check**

Run: `npx vue-tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/037_devices.sql src/data/powersync/schema.ts
git commit -m "feat: add devices table (server-allocated permanent + temp codes)"
```

---

### Task 3: `useDeviceRegistration` — claim a device code, replace the stub

**Files:**
- Create: `src/features/devices/composables/useDeviceRegistration.ts`
- Test: `src/__tests__/features/useDeviceRegistration.test.ts`
- Modify: `src/store/device.store.ts`

**Interfaces:**
- Consumes: `db` from `@/data/powersync/db`; `useDeviceStore()`.
- Produces: `registerDevice(shopId: string): Promise<{ code: string; isTemporary: boolean }>` — inserts a `devices` row (permanent code via `allocate_device_code` if online, temp `T-<random>` if the permanent RPC/insert fails) and returns it; `device.store.ts`'s `deviceId`/`deviceCode` become real (persisted) values instead of env stubs.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { useDeviceRegistration } from '@/features/devices/composables/useDeviceRegistration'

describe('useDeviceRegistration', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('registers a permanent code when the allocator succeeds', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({ code: 'B' } as any)

    const { registerDevice } = useDeviceRegistration()
    const result = await registerDevice('shop1')

    expect(result).toEqual({ code: 'B', isTemporary: false })
    const insertCall = vi.mocked(db.execute).mock.calls.find(([sql]) => /INSERT INTO devices/.test(sql))
    expect(insertCall![1]).toEqual(expect.arrayContaining(['shop1', 'B', 0]))
  })

  it('falls back to a temporary code when the allocator is unreachable (offline)', async () => {
    vi.mocked(db.getOptional).mockRejectedValueOnce(new Error('offline'))

    const { registerDevice } = useDeviceRegistration()
    const result = await registerDevice('shop1')

    expect(result.isTemporary).toBe(true)
    expect(result.code).toMatch(/^T-/)
    const insertCall = vi.mocked(db.execute).mock.calls.find(([sql]) => /INSERT INTO devices/.test(sql))
    expect(insertCall![1]).toEqual(expect.arrayContaining(['shop1', result.code, 1]))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/useDeviceRegistration.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'

export function useDeviceRegistration() {
  async function registerDevice(shopId: string): Promise<{ code: string; isTemporary: boolean }> {
    try {
      const row = await db.getOptional<{ code: string }>(
        `SELECT public.allocate_device_code(?) AS code`, [shopId]
      )
      if (row?.code) {
        await db.execute(
          `INSERT INTO devices (id, shop_id, code, is_temporary, registered_at, sync_status)
           VALUES (?, ?, ?, ?, ?, 'pending')`,
          [uuidv4(), shopId, row.code, 0, new Date().toISOString()]
        )
        return { code: row.code, isTemporary: false }
      }
    } catch {
      // Offline or the allocator RPC is unreachable — fall through to a temp code.
    }

    const tempCode = `T-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
    await db.execute(
      `INSERT INTO devices (id, shop_id, code, is_temporary, registered_at, sync_status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [uuidv4(), shopId, tempCode, 1, new Date().toISOString()]
    )
    return { code: tempCode, isTemporary: true }
  }

  return { registerDevice }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/useDeviceRegistration.test.ts`
Expected: PASS (both tests)

- [ ] **Step 5: Wire into `device.store.ts`**

Replace the stubbed `deviceId`/`deviceCode` lines:

```ts
  // deviceId/deviceCode remain stubbed — real device registration is Sub-project 3.
  const deviceId   = (import.meta.env.VITE_STUB_DEVICE_ID   ?? '00000000-0000-0000-0000-000000000002') as string
  const deviceCode = (import.meta.env.VITE_STUB_DEVICE_CODE ?? 'A') as string
```

with:

```ts
  const deviceId   = ref<string>((import.meta.env.VITE_STUB_DEVICE_ID   ?? '') as string)
  const deviceCode = ref<string>((import.meta.env.VITE_STUB_DEVICE_CODE ?? '') as string)

  async function ensureDeviceRegistered(): Promise<void> {
    if (deviceCode.value) return  // already registered (or stubbed) on this device
    if (!shopId.value) return     // no shop resolved yet — retry after refreshShopId()
    const { registerDevice } = useDeviceRegistration()
    const id = uuidv4()
    const { code } = await registerDevice(shopId.value)
    deviceId.value = id
    deviceCode.value = code
  }
```

Add the two new imports at the top: `import { v4 as uuidv4 } from 'uuid'` and `import { useDeviceRegistration } from '@/features/devices/composables/useDeviceRegistration'`. Update the store's `return` to include `ensureDeviceRegistered`, and widen the persisted-fields list:

```ts
  return { shopId, deviceId, deviceCode, refreshShopId, ensureDeviceRegistered }
}, {
  persist: { pick: ['shopId', 'deviceId', 'deviceCode'] },
})
```

Call `ensureDeviceRegistered()` from `refreshShopId()`'s success path (after `if (row?.id) shopId.value = row.id`, add `await ensureDeviceRegistered()`), so a device registers itself the first time its shop resolves.

- [ ] **Step 6: Run the existing device store tests to confirm nothing broke**

Run: `npx vitest run src/__tests__/store/device.store.test.ts`
Expected: PASS (existing tests may need `deviceCode`/`deviceId` env stubs set in test setup if they assert on the old stub values — check and adjust only if a test fails on this, not preemptively)

- [ ] **Step 7: Commit**

```bash
git add src/features/devices/composables/useDeviceRegistration.ts src/__tests__/features/useDeviceRegistration.test.ts src/store/device.store.ts
git commit -m "feat: real per-device registration (permanent letter codes, temp offline codes)"
```

---

### Task 4: Router — session auth guard + `/login`, `/signup` routes

**Files:**
- Modify: `src/router/index.ts`

**Interfaces:**
- Consumes: `supabase.auth.getSession()` from `@/data/supabase/client`.
- Produces: routes `/login`, `/signup`; `router.beforeEach` redirects an unauthenticated session to `/login` (except on `/login`/`/signup` themselves), and redirects an authenticated user away from `/login`/`/signup`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const session: { value: { user: { id: string } } | null } = { value: null }
vi.mock('@/data/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: session.value } })) } },
}))
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

describe('router auth guard', () => {
  beforeEach(() => {
    session.value = null
    vi.resetModules()
  })

  it('redirects an unauthenticated visit to /pos to /login', async () => {
    const { default: router } = await import('@/router/index')
    await router.push('/pos')
    await router.isReady()
    expect(router.currentRoute.value.path).toBe('/login')
  })

  it('lets an authenticated session reach a normal route', async () => {
    session.value = { user: { id: 'user-a' } }
    const { default: router } = await import('@/router/index')
    await router.push('/history')
    await router.isReady()
    expect(router.currentRoute.value.path).toBe('/history')
  })

  it('redirects an authenticated user away from /login', async () => {
    session.value = { user: { id: 'user-a' } }
    const { default: router } = await import('@/router/index')
    await router.push('/login')
    await router.isReady()
    expect(router.currentRoute.value.path).not.toBe('/login')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/router-auth-guard.test.ts` (save the test at this path)
Expected: FAIL — `/pos` visit stays on `/pos` (no guard yet); `/login` route doesn't exist

- [ ] **Step 3: Add the routes and guard**

In `src/router/index.ts`, add near the top of `routes` (order doesn't matter for these two — vue-router matches by exact path):

```ts
    { path: '/login',  component: () => import('@/pages/LoginPage.vue') },
    { path: '/signup', component: () => import('@/pages/SignupPage.vue') },
```

Import `supabase` at the top: `import { supabase } from '@/data/supabase/client'`.

Change `router.beforeEach` from a synchronous to an async guard, adding the session check before the existing permission/shift checks:

```ts
router.beforeEach(async (to) => {
  const PUBLIC_PATHS = ['/login', '/signup']
  const { data } = await supabase.auth.getSession()
  const isAuthenticated = !!data.session

  if (!isAuthenticated && !PUBLIC_PATHS.includes(to.path)) {
    return '/login'
  }
  if (isAuthenticated && PUBLIC_PATHS.includes(to.path)) {
    return '/'
  }
  if (PUBLIC_PATHS.includes(to.path)) {
    return true
  }

  const required = to.meta.permission as keyof StaffPermissions | undefined
  const requiresOpenShift = Boolean(to.meta.requiresOpenShift)
  const staff = useSessionStore().activeStaff
  if (!isRouteAllowed(required, staff)) {
    const landing = resolveLanding(staff)
    return to.path === landing ? true : landing
  }

  if (requiresOpenShift && !useShiftStore().isShiftOpen) {
    return to.path === SHIFT_OPEN_REDIRECT ? true : SHIFT_OPEN_REDIRECT
  }

  return true
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/router-auth-guard.test.ts`
Expected: PASS (all 3 tests)

- [ ] **Step 5: Run the full test suite to check for guard-related regressions**

Run: `npx vitest run src/__tests__/`
Expected: any pre-existing component test that mounts a route-guarded page directly (not through `router.push`) is unaffected (the guard only runs on navigation); any test that *does* navigate via the real router and previously assumed an unauthenticated pass-through will need `@/data/supabase/client`'s `getSession` mocked to return a session — fix these inline if the run surfaces any, rather than skipping them.

- [ ] **Step 6: Commit**

```bash
git add src/router/index.ts src/__tests__/features/router-auth-guard.test.ts
git commit -m "feat: add session-based auth guard and register /login, /signup routes"
```

---

### Task 5: Wire `SignupPage.vue` to `signUpOwner()`

**Files:**
- Modify: `src/pages/SignupPage.vue`
- Test: `src/__tests__/features/SignupPage.test.ts`

**Interfaces:**
- Consumes: `signUpOwner(input: SignUpInput): Promise<AuthOutcome>` from `@/data/supabase/auth` (`SignUpInput = { phone, password, shopName, businessType, country, recoveryEmail? }`; `AuthOutcome = { ok: true } | { ok: false; reason: AuthFailureReason; message: string }`).
- Produces: `finish()` calls `signUpOwner` with the form's collected `store.phone`/`password`/`store.businessName`/`store.businessType`/`store.country`; on `{ ok: true }` navigates to `/setup-owner`; on `{ ok: false, reason: 'duplicate' }` shows an inline "account already exists — sign in" message with a link to `/login`; any other failure shows the returned `message`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'

vi.mock('@/data/supabase/auth', () => ({ signUpOwner: vi.fn() }))

import { signUpOwner } from '@/data/supabase/auth'
import SignupPage from '@/pages/SignupPage.vue'

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/:p(.*)', component: { template: '<div/>' } }],
})

describe('SignupPage — finish()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls signUpOwner with the collected form fields and navigates to /setup-owner on success', async () => {
    vi.mocked(signUpOwner).mockResolvedValue({ ok: true })
    const pushSpy = vi.spyOn(router, 'push')
    const wrapper = mount(SignupPage, { global: { plugins: [router] } })

    // Drive the component's exposed finish() directly via its store-backed
    // fields rather than re-implementing three steps of UI navigation here —
    // step1Next/step2Next already assign store.phone/businessName/etc.
    const vm = wrapper.vm as any
    vm.phone = '512345678'
    vm.password = 'Str0ngPass'
    vm.step1Next()
    vm.bizName = 'متجر تجريبي'
    vm.bizType = 'retail'
    vm.step2Next()
    vm.selectedGoal = 'sell'
    await vm.finish()

    expect(signUpOwner).toHaveBeenCalledWith(expect.objectContaining({
      password: 'Str0ngPass', shopName: 'متجر تجريبي', businessType: 'retail',
    }))
    expect(pushSpy).toHaveBeenCalledWith('/setup-owner')
  })

  it('shows a duplicate-account message and does not navigate on a duplicate signup', async () => {
    vi.mocked(signUpOwner).mockResolvedValue({ ok: false, reason: 'duplicate', message: 'exists' })
    const wrapper = mount(SignupPage, { global: { plugins: [router] } })

    const vm = wrapper.vm as any
    vm.phone = '512345678'
    vm.password = 'Str0ngPass'
    vm.step1Next()
    vm.bizName = 'متجر تجريبي'
    vm.bizType = 'retail'
    vm.step2Next()
    vm.selectedGoal = 'sell'
    await vm.finish()

    expect(wrapper.get('[data-testid="signup-error"]').text()).toContain('الحساب موجود بالفعل')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/SignupPage.test.ts`
Expected: FAIL — `signUpOwner` not called; `[data-testid="signup-error"]` doesn't exist

- [ ] **Step 3: Update the component**

In `src/pages/SignupPage.vue`, add the import and an error ref, and replace `finish()`:

```ts
import { signUpOwner } from '@/data/supabase/auth'
```

```ts
const errorMessage = ref<string | null>(null)

async function finish() {
  if (!selectedGoal.value) return
  store.startGoal = selectedGoal.value as typeof store.startGoal
  loading.value = true
  errorMessage.value = null

  const result = await signUpOwner({
    phone:        store.phone,
    password:     password.value,
    shopName:     store.businessName,
    businessType: store.businessType,
    country:      store.country,
  })

  loading.value = false

  if (!result.ok) {
    errorMessage.value = result.reason === 'duplicate'
      ? 'هذا الحساب موجود بالفعل. سجّل دخولك بدلاً من ذلك.'
      : result.message
    return
  }

  router.push('/setup-owner')
}
```

- [ ] **Step 4: Add the error markup**

In the template, inside the step-3 goal-selection block (near the existing `loading` state markup — read the file's template to place it consistently with the existing step-3 layout), add:

```vue
<p v-if="errorMessage" data-testid="signup-error" class="sp-error">{{ errorMessage }}</p>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/SignupPage.test.ts`
Expected: PASS (both tests)

- [ ] **Step 6: Commit**

```bash
git add src/pages/SignupPage.vue src/__tests__/features/SignupPage.test.ts
git commit -m "feat: wire SignupPage to signUpOwner(), route to /setup-owner on success"
```

---

### Task 6: Wire `LoginPage.vue` to `signIn()`

**Files:**
- Modify: `src/pages/LoginPage.vue`
- Test: `src/__tests__/features/LoginPage.test.ts`

**Interfaces:**
- Consumes: `signIn(input: SignInInput): Promise<AuthOutcome>` from `@/data/supabase/auth` (`SignInInput = { phone, password }`).
- Produces: `submit()` calls `signIn`; on `{ ok: true }` navigates to `/`; on `{ ok: false, reason: 'invalid_credentials' }` shows the existing Arabic "wrong phone/password" style error; other failures show the returned `message`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'

vi.mock('@/data/supabase/auth', () => ({ signIn: vi.fn() }))

import { signIn } from '@/data/supabase/auth'
import LoginPage from '@/pages/LoginPage.vue'

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/:p(.*)', component: { template: '<div/>' } }],
})

describe('LoginPage — submit()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls signIn with phone + password and navigates to / on success', async () => {
    vi.mocked(signIn).mockResolvedValue({ ok: true })
    const pushSpy = vi.spyOn(router, 'push')
    const wrapper = mount(LoginPage, { global: { plugins: [router] } })

    await wrapper.get('[data-testid="login-phone"]').setValue('512345678')
    await wrapper.get('[data-testid="login-password"]').setValue('Str0ngPass')
    await wrapper.get('[data-testid="login-submit"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))

    expect(signIn).toHaveBeenCalledWith(expect.objectContaining({ password: 'Str0ngPass' }))
    expect(pushSpy).toHaveBeenCalledWith('/')
  })

  it('shows an error and does not navigate on invalid credentials', async () => {
    vi.mocked(signIn).mockResolvedValue({ ok: false, reason: 'invalid_credentials', message: 'bad creds' })
    const wrapper = mount(LoginPage, { global: { plugins: [router] } })

    await wrapper.get('[data-testid="login-phone"]').setValue('512345678')
    await wrapper.get('[data-testid="login-password"]').setValue('wrong')
    await wrapper.get('[data-testid="login-submit"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))

    expect(wrapper.get('[data-testid="login-error"]').text().length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/LoginPage.test.ts`
Expected: FAIL — `signIn` not called; `data-testid="login-phone"`/`login-password"`/`login-submit"`/`login-error"` likely don't match the current template's testids (read the template first to reconcile, or add them if missing)

- [ ] **Step 3: Update the component**

Read the existing template around the phone/password inputs and submit button first to attach matching `data-testid`s if not already present, then replace the script:

```ts
import { signIn } from '@/data/supabase/auth'
```

```ts
async function submit() {
  if (!phone.value || !password.value) { error.value = 'أدخل رقم الهاتف وكلمة المرور'; return }
  error.value = ''
  loading.value = true
  store.phone = dialCode.value + phone.value

  const result = await signIn({ phone: store.phone, password: password.value })

  loading.value = false

  if (!result.ok) {
    error.value = result.reason === 'invalid_credentials'
      ? 'رقم الهاتف أو كلمة المرور غير صحيحة'
      : result.message
    return
  }

  router.push('/')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/LoginPage.test.ts`
Expected: PASS (both tests)

- [ ] **Step 5: Commit**

```bash
git add src/pages/LoginPage.vue src/__tests__/features/LoginPage.test.ts
git commit -m "feat: wire LoginPage to signIn(), navigate to / on success"
```

---

### Task 7: Sign-out — enable the button, warn on unsynced writes

**Files:**
- Modify: `src/features/settings/screens/PersonalPreferencesScreen.vue`
- Modify: `src/__tests__/__mocks__/db.ts` (add `getUploadQueueStats`)
- Test: `src/__tests__/features/PersonalPreferencesScreen.test.ts` (create if none exists — check with Glob first)

**Interfaces:**
- Consumes: `signOut()` from `@/data/supabase/auth`; `db.getUploadQueueStats(): Promise<{ count: number; size: number }>` from `@/data/powersync/db`.
- Produces: tapping "sign out" shows a confirm dialog (existing `AppDialog` component, matching `ProductsPage.vue`'s delete-confirm usage pattern: `title`/`message`/`confirm-label`/`cancel-label`/`@confirm`/`@cancel`); if `getUploadQueueStats().count > 0`, the dialog's message instead warns about unsynced data before allowing sign-out to proceed.

- [ ] **Step 1: Add the mock method**

In `src/__tests__/__mocks__/db.ts`, add to the exported `db` object:

```ts
  getUploadQueueStats: vi.fn().mockResolvedValue({ count: 0, size: 0 }),
```

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/data/supabase/auth', () => ({ signOut: vi.fn() }))

import { db } from '@/data/powersync/db'
import { signOut } from '@/data/supabase/auth'
import PersonalPreferencesScreen from '@/features/settings/screens/PersonalPreferencesScreen.vue'

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/:p(.*)', component: { template: '<div/>' } }],
})

function mountScreen() {
  const pinia = createPinia()
  pinia.use(piniaPluginPersistedstate)
  return mount(PersonalPreferencesScreen, { global: { plugins: [pinia, router] } })
}

describe('PersonalPreferencesScreen — sign out', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.getUploadQueueStats).mockResolvedValue({ count: 0, size: 0 })
  })

  it('signs out immediately when there are no unsynced writes', async () => {
    const wrapper = mountScreen()
    await wrapper.get('[data-testid="signout-btn"]').trigger('click')
    await wrapper.get('[data-testid="signout-confirm"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    expect(signOut).toHaveBeenCalled()
  })

  it('warns about unsynced data before signing out', async () => {
    vi.mocked(db.getUploadQueueStats).mockResolvedValue({ count: 3, size: 300 })
    const wrapper = mountScreen()
    await wrapper.get('[data-testid="signout-btn"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    expect(wrapper.text()).toContain('3')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/PersonalPreferencesScreen.test.ts`
Expected: FAIL — `[data-testid="signout-btn"]` is `disabled`, no `signout-confirm` exists, `signOut` never called

- [ ] **Step 4: Add the i18n strings**

In `src/i18n/ar.ts`, add near the existing `signOutConfirmTitle`/`signOutConfirmMessage`:

```ts
    signOutUnsyncedMessage: 'لديك {count} عملية لم تتم مزامنتها بعد. تسجيل الخروج الآن قد يؤدي لفقدانها. هل تريد المتابعة؟',
```

In `src/i18n/en.ts`:

```ts
    signOutUnsyncedMessage: 'You have {count} unsynced changes. Signing out now may lose them. Continue anyway?',
```

- [ ] **Step 5: Update the component**

Add imports and state:

```ts
import { ref } from 'vue'
import { signOut } from '@/data/supabase/auth'
import { db } from '@/data/powersync/db'
import AppDialog from '@/components/ui/AppDialog.vue'
```

(Add `ref` to the existing `computed` import from `'vue'` if not already imported alongside it.)

```ts
const showSignOutConfirm = ref(false)
const unsyncedCount = ref(0)

async function openSignOutConfirm() {
  const stats = await db.getUploadQueueStats()
  unsyncedCount.value = stats.count
  showSignOutConfirm.value = true
}

async function confirmSignOut() {
  showSignOutConfirm.value = false
  await signOut()
  router.push('/login')
}
```

Replace the disabled sign-out button:

```vue
      <button
        type="button"
        data-testid="signout-btn"
        class="settings-row settings-row--last signout-row"
        @click="openSignOutConfirm"
      >
        <span class="signout-label">{{ t('personal.signOut') }}</span>
      </button>
```

Add the dialog near the end of the template (alongside other root-level content):

```vue
    <AppDialog
      v-if="showSignOutConfirm"
      :title="t('personal.signOutConfirmTitle')"
      :message="unsyncedCount > 0 ? t('personal.signOutUnsyncedMessage', { count: unsyncedCount }) : t('personal.signOutConfirmMessage')"
      :confirm-label="t('personal.signOut')"
      cancel-label="إلغاء"
      @confirm="confirmSignOut"
      @cancel="showSignOutConfirm = false"
      data-testid="signout-confirm-dialog"
    />
```

Since `AppDialog`'s confirm action is a single button inside the component (read `AppDialog.vue` to confirm its internal confirm-button testid — reuse whatever it already exposes, e.g. if it renders its own `data-testid="dialog-confirm"` internally, use that in the test above instead of adding a redundant `signout-confirm` id; only add a new testid if `AppDialog` doesn't already expose one for its confirm button).

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/PersonalPreferencesScreen.test.ts`
Expected: PASS (both tests)

- [ ] **Step 7: Commit**

```bash
git add src/features/settings/screens/PersonalPreferencesScreen.vue src/__tests__/__mocks__/db.ts src/__tests__/features/PersonalPreferencesScreen.test.ts src/i18n/ar.ts src/i18n/en.ts
git commit -m "feat: enable sign-out with an unsynced-writes warning"
```

---

### Task 8: Clear local data on account switch

**Files:**
- Modify: `src/store/device.store.ts`
- Test: `src/__tests__/store/device.store.test.ts` (extend the existing file)

**Interfaces:**
- Consumes: `db.disconnectAndClear(): Promise<void>` and `db.connect(connector): Promise<void>` from `@/data/powersync/db`; `SupabaseConnector` from `@/data/powersync/connector`.
- Produces: `onAuthStateChange`'s `SIGNED_IN` handler now detects "a different account than the last one on this device" and calls `db.disconnectAndClear()` + reconnects before resolving the new shop — closing the "account switch on the same device shows no data bleed" edge case.

- [ ] **Step 1: Write the failing test**

Add to `src/__tests__/store/device.store.test.ts` (extend the existing `vi.mock('@/data/powersync/db', ...)` block's `db` mock usage — the shared mock already provides `disconnectAndClear`/`connect` once Task 7's mock addition lands; add `connect`/`disconnectAndClear` spies there too if not already present):

```ts
  it('clears local data when a different account signs in on the same device', async () => {
    session.value = { access_token: 'tok', user: { id: 'user-a' } }
    vi.mocked(db.getOptional).mockResolvedValue({ id: 'shop-a' } as any)
    const { useDeviceStore } = await import('@/store/device.store')
    const store = useDeviceStore()
    await store.refreshShopId()

    session.value = { access_token: 'tok2', user: { id: 'user-b' } }
    authCb?.('SIGNED_IN')
    await flush()

    expect(db.disconnectAndClear).toHaveBeenCalled()
  })

  it('does not clear local data when the same account re-authenticates (token refresh)', async () => {
    session.value = { access_token: 'tok', user: { id: 'user-a' } }
    vi.mocked(db.getOptional).mockResolvedValue({ id: 'shop-a' } as any)
    const { useDeviceStore } = await import('@/store/device.store')
    const store = useDeviceStore()
    await store.refreshShopId()

    vi.mocked(db.disconnectAndClear).mockClear()
    authCb?.('SIGNED_IN')  // same user-a session
    await flush()

    expect(db.disconnectAndClear).not.toHaveBeenCalled()
  })
```

Also add `disconnectAndClear: vi.fn(), connect: vi.fn()` to `src/__tests__/__mocks__/db.ts` if `connect` isn't already present there (check first — the shared mock currently has `connect: vi.fn()` per its existing contents; only `disconnectAndClear` needs adding).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/store/device.store.test.ts`
Expected: FAIL — `db.disconnectAndClear` never called

- [ ] **Step 3: Update `device.store.ts`**

Track the last-seen user id and branch on it in the `SIGNED_IN` handler:

```ts
import { SupabaseConnector } from '@/data/powersync/connector'
```

```ts
  let lastUserId: string | null = null

  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      shopId.value = FALLBACK_SHOP_ID
      lastUserId = null
      return
    }
    if (event === 'SIGNED_IN') {
      shopId.value = FALLBACK_SHOP_ID
      void (async () => {
        const { data } = await supabase.auth.getSession()
        const userId = data.session?.user?.id ?? null
        if (lastUserId !== null && userId !== null && userId !== lastUserId) {
          // A different account signed in on this device — the previous
          // account's synced rows must not bleed into the new one.
          await db.disconnectAndClear()
          await db.connect(new SupabaseConnector())
        }
        lastUserId = userId
        await refreshShopId()
      })()
      return
    }
    void refreshShopId()
  })
```

Remove the old `void refreshShopId()` call that previously ran unconditionally for every event (it's now only reached for events other than `SIGNED_OUT`/`SIGNED_IN`, matching the original catch-all behavior for e.g. `TOKEN_REFRESHED`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/store/device.store.test.ts`
Expected: PASS (all tests, including the two new ones and the pre-existing five)

- [ ] **Step 5: Commit**

```bash
git add src/store/device.store.ts src/__tests__/store/device.store.test.ts src/__tests__/__mocks__/db.ts
git commit -m "fix: clear local PowerSync data when a different account signs in on the same device"
```

---

### Task 9: Forgot-password (assisted, v1)

**Files:**
- Create: `src/pages/ForgotPasswordPage.vue`
- Test: `src/__tests__/features/ForgotPasswordPage.test.ts`
- Modify: `src/router/index.ts` (register `/forgot-password` as a public path)
- Modify: `src/pages/LoginPage.vue` (add the "forgot password?" link)

**Interfaces:**
- Produces: a simple screen explaining the v1 assisted-reset flow (per epic Decision 4 — "owner contacts the helper, who resets in the dashboard") in Arabic, with no dead end (a phone number / contact instruction).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ForgotPasswordPage from '@/pages/ForgotPasswordPage.vue'

describe('ForgotPasswordPage', () => {
  it('shows the assisted-reset instructions in Arabic', () => {
    const wrapper = mount(ForgotPasswordPage)
    expect(wrapper.text()).toContain('تواصل')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/ForgotPasswordPage.test.ts`
Expected: FAIL — component file not found

- [ ] **Step 3: Write the component**

```vue
<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<template>
  <div dir="rtl" class="forgot-password">
    <h1>نسيت كلمة المرور؟</h1>
    <p>
      لأسباب أمنية، لا يمكن إعادة تعيين كلمة المرور تلقائياً حالياً.
      تواصل مع فريق الدعم عبر واتساب وسنساعدك على استعادة الوصول لحسابك خلال دقائق.
    </p>
    <button type="button" @click="router.push('/login')">العودة لتسجيل الدخول</button>
  </div>
</template>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/ForgotPasswordPage.test.ts`
Expected: PASS

- [ ] **Step 5: Register the route and link it from `LoginPage.vue`**

In `src/router/index.ts`, add `/forgot-password` to both the `routes` array and the guard's `PUBLIC_PATHS` list (from Task 4):

```ts
    { path: '/forgot-password', component: () => import('@/pages/ForgotPasswordPage.vue') },
```

```ts
  const PUBLIC_PATHS = ['/login', '/signup', '/forgot-password']
```

In `LoginPage.vue`'s template, read the existing form layout first, then add a link near the password field/submit button matching the file's existing link/button styling:

```vue
<RouterLink to="/forgot-password">نسيت كلمة المرور؟</RouterLink>
```

- [ ] **Step 6: Commit**

```bash
git add src/pages/ForgotPasswordPage.vue src/__tests__/features/ForgotPasswordPage.test.ts src/router/index.ts src/pages/LoginPage.vue
git commit -m "feat: add assisted forgot-password screen (v1, no self-serve reset)"
```

---

### Task 10: Manual end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated suite**

Run: `npx vitest run src/__tests__/`
Expected: all tests pass.

- [ ] **Step 2: Type-check**

Run: `npx vue-tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verification against a real second account**

Run: `npm run dev`. Using a throwaway phone number, sign up end-to-end (Signup → shop provisioned via migration 021's trigger → `/setup-owner` → set an owner PIN → ring a sale). Then sign out, sign in again on a fresh browser profile, confirm the shop's data syncs. Then, on the same device, sign out and sign up/sign in as a *different* second account — confirm the first account's products/sales are not visible (Task 8's `disconnectAndClear`). Confirm `devices` gets a distinct code per device if tested on two browser profiles simultaneously.

- [ ] **Step 4: Update the epic doc's Definition of Done**

In `docs/superpowers/plans/2026-06-20-epic-real-auth-onboarding-device-registration.md`, check off the DoD items verified in Step 3, and flip the epic's `Status` line to reflect what shipped vs. what (if anything) remains (e.g. OTP/SMS remains explicitly out of scope per Decision 1 — don't check that).

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-06-20-epic-real-auth-onboarding-device-registration.md
git commit -m "docs: mark Real Auth epic DoD items verified end-to-end"
```

---

## Self-Review Notes

- **Spec coverage:** signup wired to the real, already-tested `auth.ts` service (Task 5); login likewise (Task 6); session-based router guard (Task 4); sign-out with unsynced-data warning (Task 7); account-switch data-bleed fix (Task 8); device registration replacing the stub (Tasks 2-3); forgot-password assisted flow (Task 9); the confirmed-broken `shops` schema gap fixed first since everything else depends on `shopId` actually resolving (Task 1). Not in this plan: server-side role enforcement (separate, dependent epic — `2026-06-20-epic-server-side-role-enforcement.md`), SMS/OTP (explicitly out of scope per the epic's Decision 1), multi-shop-per-account (blocked by the existing unique index, unsupported by design).
- **Type consistency checked:** `AuthOutcome`/`SignUpInput`/`SignInInput`/`AuthFailureReason` (Tasks 5-6) match `auth.ts`'s actual exported types verified during planning, not invented. `registerDevice()`'s return shape (Task 3) is used consistently between its own test and `device.store.ts`'s consumption in the same task.
- **No placeholders:** every step contains complete, runnable code. The two "read the file first" steps (Task 5 Step 4's error-markup placement, Task 6 Step 3's testid reconciliation, Task 9 Step 5's link placement) name the exact existing pattern to match, deferring only to files not yet read in this planning pass — not to vague follow-up work.
