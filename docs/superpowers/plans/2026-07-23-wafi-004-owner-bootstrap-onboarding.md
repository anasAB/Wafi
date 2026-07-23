# WAFI-004 Owner Bootstrap & Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the already-captured signup "start goal" (`sell`/`inventory`/`explore`) actually route the new owner somewhere meaningful after PIN setup, add a skippable first-run exchange-rate prompt, and seed demo products for the "explore" choice.

**Architecture:** Purely client-side, no migrations. A new composable (`useDemoDataSeed.ts`) seeds 5 sample products via the existing `useProducts().save()` path, tagged `created_via: 'demo_seed'`. `OwnerSetupScreen.vue` gains a post-PIN step that shows the existing `ExchangeRateEditor.vue` (skippable), then routes by `store.startGoal`, calling the seed composable only for `'explore'`.

**Tech Stack:** Vue 3, Vitest, PowerSync (`db`).

## Global Constraints

- No new migrations — `products.created_via` (migration 051) is a plain `text` column with no `CHECK` constraint.
- Do not modify `SignupPage.vue`, `ExchangeRateEditor.vue`, `useExchangeRate.ts`, or `useProducts.ts` — all are reused exactly as they are.
- Demo seeding is products only — no demo customers or sales.
- The exchange-rate prompt must be skippable, never a hard block on proceeding.
- Seeding must be idempotent: skip if the shop already has any products (guards against `/setup-owner` being revisited).
- `store.startGoal` (`src/store.ts`) is a plain `reactive()` field, not Pinia-persisted — an empty/missing value must fall back to today's behavior (route to `/`), not throw or hang.

---

### Task 1: `useDemoDataSeed` composable

**Files:**
- Create: `src/features/onboarding/composables/useDemoDataSeed.ts`
- Test: `src/__tests__/features/useDemoDataSeed.test.ts`

**Interfaces:**
- Produces: `useDemoDataSeed(): { seedDemoProducts(): Promise<void> }`. Task 2 calls `seedDemoProducts()` when `startGoal === 'explore'`.
- Consumes: `useProducts()` from `src/features/products/composables/useProducts.ts` (`load()`, `products`, `save()` — exact shape: `save(data: { shopId, nameAr, salePriceUsd, costPriceUsd, currentStock, lowStockThreshold, isActive, createdVia? })`), `useDeviceStore()` from `src/store/device.store.ts` (`.shopId`).

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/features/useDemoDataSeed.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

const logProductCreated = vi.fn(async () => {})
vi.mock('@/features/audit/composables/useAuditLog', () => ({
  useAuditLog: () => ({
    logProductCreated, logProductUpdated: vi.fn(), logProductPriceChanged: vi.fn(),
    logProductDeleted: vi.fn(), logStockAdjusted: vi.fn(),
  }),
}))

import { useDemoDataSeed } from '@/features/onboarding/composables/useDemoDataSeed'
import { db } from '@/data/powersync/db'

describe('useDemoDataSeed', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([])
    vi.mocked(db.getOptional).mockResolvedValue(null)
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
  })

  it('seeds 5 demo products tagged created_via=demo_seed when the shop has none', async () => {
    const { seedDemoProducts } = useDemoDataSeed()
    await seedDemoProducts()

    const inserts = vi.mocked(db.execute).mock.calls.filter(
      ([sql]) => /INSERT INTO products/.test(sql as string)
    )
    expect(inserts).toHaveLength(5)
    for (const [, params] of inserts) {
      expect((params as unknown[])[(params as unknown[]).length - 1]).toBe('demo_seed')
    }
  })

  it('does nothing when the shop already has products (idempotent)', async () => {
    vi.mocked(db.getAll).mockResolvedValue([{
      id: 'p1', shop_id: 's1', name_ar: 'موجود', name_en: null,
      price_usd: 1, cost_price_usd: 1, barcode: null, category: null,
      current_stock: 1, low_stock_threshold: 1, photo_url: null,
      created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
      is_active: 1, deleted: 0, sync_status: 'synced',
    }] as any)

    const { seedDemoProducts } = useDemoDataSeed()
    await seedDemoProducts()

    const inserts = vi.mocked(db.execute).mock.calls.filter(
      ([sql]) => /INSERT INTO products/.test(sql as string)
    )
    expect(inserts).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/features/useDemoDataSeed.test.ts`
Expected: FAIL — module `@/features/onboarding/composables/useDemoDataSeed` does not exist yet.

- [ ] **Step 3: Implement**

Create `src/features/onboarding/composables/useDemoDataSeed.ts`:

```ts
import { useProducts } from '@/features/products/composables/useProducts'
import { useDeviceStore } from '@/store/device.store'

interface DemoProduct {
  nameAr: string
  salePriceUsd: number
  costPriceUsd: number
  currentStock: number
}

// Generic-retail staples (Year 1 vertical is general retail, not
// electronics-specific — see CLAUDE.md Strategic Locks). Products only;
// no demo customers or sales (WAFI-004 design, "out of scope").
const DEMO_PRODUCTS: DemoProduct[] = [
  { nameAr: 'مياه معدنية ١.٥ لتر', salePriceUsd: 0.50, costPriceUsd: 0.30, currentStock: 50 },
  { nameAr: 'شيبس بطاطا',         salePriceUsd: 1.00, costPriceUsd: 0.60, currentStock: 30 },
  { nameAr: 'صابون استحمام',      salePriceUsd: 1.50, costPriceUsd: 0.90, currentStock: 20 },
  { nameAr: 'شاي علبة ١٠٠ غرام',  salePriceUsd: 2.00, costPriceUsd: 1.20, currentStock: 15 },
  { nameAr: 'سكر كيلو',           salePriceUsd: 1.20, costPriceUsd: 0.80, currentStock: 25 },
]

export function useDemoDataSeed() {
  async function seedDemoProducts(): Promise<void> {
    const { products, load, save } = useProducts()
    const device = useDeviceStore()

    await load()
    if (products.value.length > 0) return  // idempotent: shop already has products

    for (const p of DEMO_PRODUCTS) {
      await save({
        shopId:           device.shopId,
        nameAr:           p.nameAr,
        salePriceUsd:     p.salePriceUsd,
        costPriceUsd:     p.costPriceUsd,
        currentStock:     p.currentStock,
        lowStockThreshold: 5,
        isActive:         true,
        createdVia:       'demo_seed',
      })
    }
  }

  return { seedDemoProducts }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/features/useDemoDataSeed.test.ts`
Expected: PASS, both tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/onboarding/composables/useDemoDataSeed.ts src/__tests__/features/useDemoDataSeed.test.ts
git commit -m "feat(wafi-004): add useDemoDataSeed composable

Seeds 5 generic-retail sample products tagged created_via=demo_seed via
the existing useProducts().save() path -- no schema change, no demo
customers/sales. Idempotent: skips if the shop already has any products."
```

---

### Task 2: Route `OwnerSetupScreen.vue` by `startGoal`, add exchange-rate prompt

**Files:**
- Modify: `src/features/shifts/components/OwnerSetupScreen.vue`
- Test: `src/features/shifts/components/__tests__/OwnerSetupScreen.test.ts` (new)

**Interfaces:**
- Consumes: `useDemoDataSeed().seedDemoProducts()` from Task 1; `store.startGoal` from `src/store.ts`; `ExchangeRateEditor` from `src/features/exchange-rate/ExchangeRateEditor.vue` (emits `close`, `saved`, no props required).
- Produces: no new exports — this is a UI-only change to an existing component.

- [ ] **Step 1: Read the current file**

Current `src/features/shifts/components/OwnerSetupScreen.vue` (for context — already shown in full in the design doc; reproduced here so the diff is unambiguous):

```vue
<script setup lang="ts">
import { useRouter }  from 'vue-router'
import StaffForm      from '@/features/staff/components/StaffForm.vue'

const router = useRouter()

function onDone() {
  router.push('/')
}
</script>

<template>
  <div class="lock-root" dir="rtl">
    <div class="lock-card">
      <h1 class="brand">وافي</h1>
      <StaffForm force-role="owner" @done="onDone" />
    </div>
  </div>
</template>

<style scoped>
.lock-root {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: #06090F;
  font-family: 'Tajawal', system-ui, sans-serif;
}

.lock-card {
  width: 100%;
  max-width: 24rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 2rem 1.5rem;
  border-radius: 1.25rem;
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.16), rgba(26, 86, 219, 0.06));
  border: 1px solid rgba(26, 86, 219, 0.40);
  box-shadow: 0 8px 48px rgba(26, 86, 219, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.09);
  text-align: center;
  gap: 0.5rem;
}

.brand {
  font-family: var(--font-display-ar, 'Tajawal'), serif;
  margin: 0;
  color: var(--color-gold-primary);
  font-size: 2.5rem;
  line-height: 1;
  font-weight: 800;
  margin-bottom: 1rem;
}
</style>
```

- [ ] **Step 2: Write the failing test**

Create `src/features/shifts/components/__tests__/OwnerSetupScreen.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

const pushMock = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push: pushMock }) }))

vi.mock('@/features/staff/components/StaffForm.vue', () => ({
  default: { template: '<button @click="$emit(\'done\')">done</button>' },
}))

const seedDemoProducts = vi.fn(async () => {})
vi.mock('@/features/onboarding/composables/useDemoDataSeed', () => ({
  useDemoDataSeed: () => ({ seedDemoProducts }),
}))

vi.mock('@/features/exchange-rate/ExchangeRateEditor.vue', () => ({
  default: { template: '<div class="stub-rate-editor" @click="$emit(\'close\')"></div>' },
}))

import { store } from '@/store'
import OwnerSetupScreen from '@/features/shifts/components/OwnerSetupScreen.vue'

describe('OwnerSetupScreen', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    store.startGoal = ''
  })

  it('shows the exchange-rate prompt after PIN setup, then routes to /pos for the "sell" goal', async () => {
    store.startGoal = 'sell'
    const wrapper = mount(OwnerSetupScreen)
    await wrapper.find('button').trigger('click')  // StaffForm stub emits 'done'

    expect(wrapper.find('.stub-rate-editor').exists()).toBe(true)
    expect(pushMock).not.toHaveBeenCalled()  // not yet -- rate prompt still showing

    await wrapper.find('.stub-rate-editor').trigger('click')  // emits 'close' (skip)
    expect(pushMock).toHaveBeenCalledWith('/pos')
  })

  it('routes to /products/add for the "inventory" goal', async () => {
    store.startGoal = 'inventory'
    const wrapper = mount(OwnerSetupScreen)
    await wrapper.find('button').trigger('click')
    await wrapper.find('.stub-rate-editor').trigger('click')
    expect(pushMock).toHaveBeenCalledWith('/products/add')
  })

  it('seeds demo products and routes to /onboarding for the "explore" goal', async () => {
    store.startGoal = 'explore'
    const wrapper = mount(OwnerSetupScreen)
    await wrapper.find('button').trigger('click')
    await wrapper.find('.stub-rate-editor').trigger('click')

    expect(seedDemoProducts).toHaveBeenCalledTimes(1)
    expect(pushMock).toHaveBeenCalledWith('/onboarding')
  })

  it('falls back to / when startGoal is empty', async () => {
    store.startGoal = ''
    const wrapper = mount(OwnerSetupScreen)
    await wrapper.find('button').trigger('click')
    await wrapper.find('.stub-rate-editor').trigger('click')
    expect(pushMock).toHaveBeenCalledWith('/')
    expect(seedDemoProducts).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/features/shifts/components/__tests__/OwnerSetupScreen.test.ts`
Expected: FAIL — the component doesn't show an exchange-rate editor yet, `router.push` is still always called with `/`.

- [ ] **Step 4: Implement**

Replace `src/features/shifts/components/OwnerSetupScreen.vue`'s script and template with:

```vue
<script setup lang="ts">
import { ref }         from 'vue'
import { useRouter }   from 'vue-router'
import StaffForm       from '@/features/staff/components/StaffForm.vue'
import ExchangeRateEditor from '@/features/exchange-rate/ExchangeRateEditor.vue'
import { useDemoDataSeed } from '@/features/onboarding/composables/useDemoDataSeed'
import { store } from '@/store'

const router = useRouter()
const { seedDemoProducts } = useDemoDataSeed()

const pinDone = ref(false)

function onPinDone() {
  pinDone.value = true  // reveal the (skippable) exchange-rate prompt
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
      <StaffForm v-if="!pinDone" force-role="owner" @done="onPinDone" />
    </div>
    <ExchangeRateEditor
      v-if="pinDone"
      @close="proceedToGoal"
      @saved="proceedToGoal"
    />
  </div>
</template>

<style scoped>
.lock-root {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: #06090F;
  font-family: 'Tajawal', system-ui, sans-serif;
}

.lock-card {
  width: 100%;
  max-width: 24rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 2rem 1.5rem;
  border-radius: 1.25rem;
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.16), rgba(26, 86, 219, 0.06));
  border: 1px solid rgba(26, 86, 219, 0.40);
  box-shadow: 0 8px 48px rgba(26, 86, 219, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.09);
  text-align: center;
  gap: 0.5rem;
}

.brand {
  font-family: var(--font-display-ar, 'Tajawal'), serif;
  margin: 0;
  color: var(--color-gold-primary);
  font-size: 2.5rem;
  line-height: 1;
  font-weight: 800;
  margin-bottom: 1rem;
}
</style>
```

Note: the `<style>` block is unchanged from the original file — this task only adds `pinDone`-gated conditional rendering and the `ExchangeRateEditor` mount; no new CSS classes are introduced (the editor brings its own scoped styles).

Note: `ExchangeRateEditor`'s own "cancel" button already emits `close` (skip) with no separate "skip" wiring needed on this side — reusing it as-is satisfies "skippable, not a hard block" per the design. Both `close` (skip/cancel) and `saved` (rate was set) call the same `proceedToGoal()`, since either way the owner is done with this step.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/features/shifts/components/__tests__/OwnerSetupScreen.test.ts`
Expected: PASS, all four tests.

- [ ] **Step 6: Run the full test suite once**

Run: `npm test`
Expected: PASS (167 → 169 test files after Task 1 + Task 2 each add one new file; the pre-existing flaky `router-auth-guard.test.ts` timeout, if it recurs, is unrelated — already documented in this project's WAFI-002/003 work).

- [ ] **Step 7: Commit**

```bash
git add src/features/shifts/components/OwnerSetupScreen.vue src/features/shifts/components/__tests__/OwnerSetupScreen.test.ts
git commit -m "feat(wafi-004): route by startGoal after PIN setup, add exchange-rate prompt

OwnerSetupScreen.vue now shows the existing ExchangeRateEditor.vue
(skippable) after PIN creation, then routes by store.startGoal --
sell -> /pos, inventory -> /products/add, explore -> seed demo products
then /onboarding, empty/missing -> / (unchanged fallback). Makes the
signup goal choice, previously written and never read, actually mean
something."
```

---

### Task 3: Final verification pass

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS, 169 test files (167 + 2 new from Tasks 1-2).

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: exit 0, no TypeScript errors referencing `OwnerSetupScreen.vue`, `useDemoDataSeed.ts`, or `store.ts`.

- [ ] **Step 3: Manual walkthrough**

With `npm run dev` running against a local Supabase (`npx supabase start`), sign up as a brand-new owner three times (three different phone numbers, or clear the local DB between runs) choosing each of the three goals in turn:

- `sell` → after PIN + rate prompt, confirm you land on `/pos`.
- `inventory` → confirm you land on `/products/add`.
- `explore` → confirm you land on `/onboarding` AND that 5 products now appear in the product list (check Back Office / `/products`), each visually normal (not flagged or broken) despite being tagged `demo_seed` under the hood.

Also confirm the exchange-rate prompt's "skip"/cancel path and its "save" path both correctly proceed to the goal-based routing (don't get stuck on the modal either way).

- [ ] **Step 4: No commit needed** — this task is verification only; if any check fails, return to the relevant earlier task and fix it there.
