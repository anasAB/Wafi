# WAFI-100 Discounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add capped, PIN-escalated, audited line and sale discounts to the POS cart, replacing the existing unaudited free-form price editor.

**Architecture:** Pure discount-math helpers feed a Pinia cart store extension; a small authorization composable decides when a PIN is required; the checkout write path (`usePayment.ts`) persists the already-net prices plus discount metadata into existing tables via new columns. No new tables — three existing tables gain columns.

**Tech Stack:** Vue 3 `<script setup>`, TypeScript, Pinia, PowerSync (`@powersync/web`) local SQLite synced to Supabase Postgres, Vitest.

## Global Constraints

- Rate lock (WAFI-002): `saleStore.lockedExchangeRate` is set once per sale and never changes mid-cart. Any SYP fixed-amount discount converts using this locked rate, never a live rate.
- Payment invariants: `sale_line_items.unit_price_usd` and `sales.total_usd` must always be **net of discount** — everything downstream (COGS, profit, Z-report, returns) reads these columns directly and must never re-derive net amounts from list price.
- Offline-first: every DB write here goes through the existing `db.writeTransaction` / `db.execute` PowerSync client — no network calls, no new dependencies.
- Arabic-first UI: all new user-facing strings are Arabic, RTL, following existing component patterns (see `SalePanel.vue`).
- `shops.cashier_discount_cap_pct` / `shops.manager_discount_cap_pct` must be **client-writable** (unlike `shops.features`, which has a server-only trigger per ADR-008) — do not copy that trigger onto these columns.
- Audit: PIN-approved or below-cost discounts are accountability-sensitive and must use `_logSensitive` (surfaces write failures), matching `logPinChanged`/`logCashMovementVoided`.

---

### Task 1: Migration — discount columns on `shops`, `sales`, `sale_line_items`

**Files:**
- Create: `supabase/migrations/045_sale_discounts.sql`
- Modify: `src/data/powersync/schema.ts:34-63` (the `sales` and `sale_line_items` Table definitions), and add two fields to the `shops` Table at `src/data/powersync/schema.ts:394-401`

**Interfaces:**
- Produces (columns every later task relies on):
  - `shops.cashier_discount_cap_pct NUMERIC`, `shops.manager_discount_cap_pct NUMERIC`
  - `sales.sale_discount_type TEXT`, `sales.sale_discount_value NUMERIC`, `sales.sale_discount_amount_usd NUMERIC`
  - `sale_line_items.discount_type TEXT`, `sale_line_items.discount_value NUMERIC`, `sale_line_items.discount_amount_usd NUMERIC`

- [ ] **Step 1: Write the migration SQL**

```sql
-- 045_sale_discounts.sql
-- WAFI-100: capped/audited line + sale discounts.
-- Caps are OWNER-EDITABLE from the client (unlike shops.features in ADR-008/041,
-- which is server-only) — do NOT add a client-update-blocking trigger here.

ALTER TABLE public.shops
  ADD COLUMN IF NOT EXISTS cashier_discount_cap_pct NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (cashier_discount_cap_pct >= 0 AND cashier_discount_cap_pct <= 100),
  ADD COLUMN IF NOT EXISTS manager_discount_cap_pct NUMERIC(5,2) NOT NULL DEFAULT 15
    CHECK (manager_discount_cap_pct >= 0 AND manager_discount_cap_pct <= 100);

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS sale_discount_type TEXT
    CHECK (sale_discount_type IN ('percent', 'fixed')),
  ADD COLUMN IF NOT EXISTS sale_discount_value NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS sale_discount_amount_usd NUMERIC(10,2) NOT NULL DEFAULT 0
    CHECK (sale_discount_amount_usd >= 0);

ALTER TABLE public.sale_line_items
  ADD COLUMN IF NOT EXISTS discount_type TEXT
    CHECK (discount_type IN ('percent', 'fixed')),
  ADD COLUMN IF NOT EXISTS discount_value NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS discount_amount_usd NUMERIC(10,2) NOT NULL DEFAULT 0
    CHECK (discount_amount_usd >= 0);
```

- [ ] **Step 2: Apply the migration locally and verify columns exist**

Run: `npx supabase db reset` (or the project's existing local-migration-apply command — check `package.json` scripts for the exact one used elsewhere, e.g. `npm run db:migrate`)
Expected: no errors; `\d sales`, `\d sale_line_items`, `\d shops` in `psql` (or the Supabase Studio table view) show the new columns.

- [ ] **Step 3: Add the new columns to the PowerSync client schema**

In `src/data/powersync/schema.ts`, update the `sales` table (currently lines 34-53):

```ts
const sales = new Table({
  shop_id:                  column.text,
  device_id:                column.text,
  device_sequence:          column.integer,
  display_sale_number:      column.text,
  created_at:               column.text,
  total_usd:                column.real,
  total_syp:                column.real,
  exchange_rate_at_sale:    column.real,
  payment_method:           column.text,
  amount_received:          column.real,
  amount_received_currency: column.text,
  change_due:               column.real,
  customer_id:              column.text,
  is_credit:                column.integer,
  is_split:                 column.integer,
  shift_id:                 column.text,
  staff_id:                 column.text,
  sale_discount_type:       column.text,   // WAFI-100
  sale_discount_value:      column.real,   // WAFI-100
  sale_discount_amount_usd: column.real,   // WAFI-100
  sync_status:              column.text,
})
```

Update the `sale_line_items` table (currently lines 55-63):

```ts
const sale_line_items = new Table({
  sale_id:              column.text,
  shop_id:               column.text,
  product_id:            column.text,
  quantity:              column.integer,
  unit_price_usd:        column.real,
  unit_cost_usd:         column.real,
  line_total_usd:        column.real,
  discount_type:         column.text,   // WAFI-100
  discount_value:        column.real,   // WAFI-100
  discount_amount_usd:   column.real,   // WAFI-100
})
```

Update the `shops` table (currently lines 394-401):

```ts
const shops = new Table({
  owner_user_id:               column.text,
  name:                        column.text,
  business_type:                column.text,
  country:                     column.text,
  created_at:                  column.text,
  features:                    column.text,
  cashier_discount_cap_pct:    column.real,   // WAFI-100
  manager_discount_cap_pct:    column.real,   // WAFI-100
})
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/045_sale_discounts.sql src/data/powersync/schema.ts
git commit -m "feat(WAFI-100): add discount columns to shops/sales/sale_line_items"
```

**Note for whoever deploys this:** the hosted Supabase instance and PowerSync dashboard sync rules need this migration applied and redeployed before the discount feature works end-to-end (same manual step this repo already tracks for prior migrations — see project memory on pending migrations).

---

### Task 2: Pure discount math module

**Files:**
- Create: `src/features/pos/discounts.ts`
- Test: `src/__tests__/features/discounts.test.ts`

**Interfaces:**
- Produces:
  - `type DiscountType = 'percent' | 'fixed'`
  - `interface DiscountInput { type: DiscountType; value: number }`
  - `function computeDiscountedPrice(basePriceUsd: number, discount: DiscountInput | null, lockedRateForFixedSyp?: number): number` — returns the final unit price (basePriceUsd if discount is null). A `fixed` discount's `value` is always expressed in USD by this function's caller (SYP→USD conversion happens before calling in, using the locked rate) — see Task 2 Step 3 for why.
  - `function computeDiscountAmount(basePriceUsd: number, finalPriceUsd: number): number` — `basePriceUsd - finalPriceUsd`, rounded to 2 decimals.
  - `function isBelowCost(finalPriceUsd: number, unitCostUsd: number): boolean`

- [ ] **Step 1: Write the failing tests**

```ts
// src/__tests__/features/discounts.test.ts
import { describe, it, expect } from 'vitest'
import { computeDiscountedPrice, computeDiscountAmount, isBelowCost } from '@/features/pos/discounts'

describe('computeDiscountedPrice', () => {
  it('returns base price when discount is null', () => {
    expect(computeDiscountedPrice(10, null)).toBe(10)
  })

  it('applies a percent discount', () => {
    expect(computeDiscountedPrice(10, { type: 'percent', value: 20 })).toBeCloseTo(8, 2)
  })

  it('applies a fixed-amount discount (already in USD)', () => {
    expect(computeDiscountedPrice(10, { type: 'fixed', value: 2.5 })).toBeCloseTo(7.5, 2)
  })

  it('clamps a fixed discount larger than the base price to zero, never negative', () => {
    expect(computeDiscountedPrice(10, { type: 'fixed', value: 50 })).toBe(0)
  })

  it('clamps a percent discount over 100 to zero', () => {
    expect(computeDiscountedPrice(10, { type: 'percent', value: 150 })).toBe(0)
  })
})

describe('computeDiscountAmount', () => {
  it('is the difference between base and final, rounded to cents', () => {
    expect(computeDiscountAmount(10, 7.999)).toBeCloseTo(2, 2)
  })
})

describe('isBelowCost', () => {
  it('is true when final price is under unit cost', () => {
    expect(isBelowCost(4, 5)).toBe(true)
  })

  it('is false when final price equals unit cost', () => {
    expect(isBelowCost(5, 5)).toBe(false)
  })

  it('is false when final price is above unit cost', () => {
    expect(isBelowCost(6, 5)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/features/discounts.test.ts`
Expected: FAIL — `Cannot find module '@/features/pos/discounts'`

- [ ] **Step 3: Write the implementation**

```ts
// src/features/pos/discounts.ts

export type DiscountType = 'percent' | 'fixed'

export interface DiscountInput {
  type:  DiscountType
  value: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Computes the final unit price after a discount. `value` for a 'fixed'
 * discount is always in USD — callers converting a SYP-entered fixed amount
 * must divide by the sale's locked exchange rate BEFORE calling this, since
 * this module has no knowledge of currency (WAFI-002: only the locked rate,
 * never the live rate, may do that conversion).
 */
export function computeDiscountedPrice(basePriceUsd: number, discount: DiscountInput | null): number {
  if (!discount) return basePriceUsd
  if (discount.type === 'percent') {
    const pct = Math.min(Math.max(discount.value, 0), 100)
    return round2(basePriceUsd * (1 - pct / 100))
  }
  return round2(Math.max(0, basePriceUsd - discount.value))
}

export function computeDiscountAmount(basePriceUsd: number, finalPriceUsd: number): number {
  return round2(basePriceUsd - finalPriceUsd)
}

export function isBelowCost(finalPriceUsd: number, unitCostUsd: number): boolean {
  return finalPriceUsd < unitCostUsd
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/features/discounts.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/pos/discounts.ts src/__tests__/features/discounts.test.ts
git commit -m "feat(WAFI-100): add pure discount math helpers"
```

---

### Task 3: Discount authorization (caps + below-cost + PIN requirement)

**Files:**
- Create: `src/features/pos/useDiscountAuthorization.ts`
- Test: `src/__tests__/features/useDiscountAuthorization.test.ts`

**Interfaces:**
- Consumes: `StaffRole` from `src/features/staff/staff.types.ts:1`; `isBelowCost` from `src/features/pos/discounts.ts` (Task 2).
- Produces:
  - `interface DiscountCaps { cashierPct: number; managerPct: number }`
  - `function requiresPinApproval(params: { role: StaffRole; discountPct: number; finalPriceUsd: number; unitCostUsd: number; caps: DiscountCaps }): boolean`
    - Below-cost (`finalPriceUsd < unitCostUsd`) → `true` regardless of role or cap.
    - `role === 'owner'` → `false` (never capped) unless below-cost.
    - `role === 'manager'` → `true` iff `discountPct > caps.managerPct` (or below-cost).
    - `role === 'cashier'` → `true` iff `discountPct > caps.cashierPct` (or below-cost).

- [ ] **Step 1: Write the failing tests**

```ts
// src/__tests__/features/useDiscountAuthorization.test.ts
import { describe, it, expect } from 'vitest'
import { requiresPinApproval, type DiscountCaps } from '@/features/pos/useDiscountAuthorization'

const caps: DiscountCaps = { cashierPct: 5, managerPct: 15 }

describe('requiresPinApproval', () => {
  it('never requires PIN for the owner, at any discount, above cost', () => {
    expect(requiresPinApproval({
      role: 'owner', discountPct: 90, finalPriceUsd: 10, unitCostUsd: 1, caps,
    })).toBe(false)
  })

  it('requires PIN for the owner when the sale would go below cost', () => {
    expect(requiresPinApproval({
      role: 'owner', discountPct: 10, finalPriceUsd: 4, unitCostUsd: 5, caps,
    })).toBe(true)
  })

  it('cashier within cap does not require PIN', () => {
    expect(requiresPinApproval({
      role: 'cashier', discountPct: 5, finalPriceUsd: 10, unitCostUsd: 1, caps,
    })).toBe(false)
  })

  it('cashier over cap requires PIN', () => {
    expect(requiresPinApproval({
      role: 'cashier', discountPct: 5.01, finalPriceUsd: 10, unitCostUsd: 1, caps,
    })).toBe(true)
  })

  it('manager within cap does not require PIN', () => {
    expect(requiresPinApproval({
      role: 'manager', discountPct: 15, finalPriceUsd: 10, unitCostUsd: 1, caps,
    })).toBe(false)
  })

  it('manager over cap requires PIN', () => {
    expect(requiresPinApproval({
      role: 'manager', discountPct: 15.01, finalPriceUsd: 10, unitCostUsd: 1, caps,
    })).toBe(true)
  })

  it('below-cost overrides an in-cap discount for any role', () => {
    expect(requiresPinApproval({
      role: 'cashier', discountPct: 1, finalPriceUsd: 0.5, unitCostUsd: 1, caps,
    })).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/features/useDiscountAuthorization.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// src/features/pos/useDiscountAuthorization.ts
import type { StaffRole } from '@/features/staff/staff.types'
import { isBelowCost } from '@/features/pos/discounts'

export interface DiscountCaps {
  cashierPct: number
  managerPct: number
}

export function requiresPinApproval(params: {
  role:          StaffRole
  discountPct:   number
  finalPriceUsd: number
  unitCostUsd:   number
  caps:          DiscountCaps
}): boolean {
  const { role, discountPct, finalPriceUsd, unitCostUsd, caps } = params

  if (isBelowCost(finalPriceUsd, unitCostUsd)) return true
  if (role === 'owner') return false

  const cap = role === 'manager' ? caps.managerPct : caps.cashierPct
  return discountPct > cap
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/features/useDiscountAuthorization.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/pos/useDiscountAuthorization.ts src/__tests__/features/useDiscountAuthorization.test.ts
git commit -m "feat(WAFI-100): add discount PIN-authorization rule"
```

---

### Task 4: Shop discount caps — read/write composable

**Files:**
- Create: `src/features/pos/useDiscountCaps.ts`
- Test: `src/__tests__/features/useDiscountCaps.test.ts`

**Interfaces:**
- Consumes: `db` from `@/data/powersync/db`; `useDeviceStore` from `@/store/device.store` (both already used identically in `src/features/flags/flags.store.ts:1-4`).
- Produces:
  - `function useDiscountCaps()` returning `{ cashierPct: Ref<number>, managerPct: Ref<number>, loaded: Ref<boolean>, load(): Promise<void>, save(next: { cashierPct: number; managerPct: number }): Promise<void> }`
  - `save` writes `UPDATE shops SET cashier_discount_cap_pct = ?, manager_discount_cap_pct = ? WHERE id = ?` — unlike `shops.features`, this column has no server-only trigger, so a normal client `UPDATE` is expected to succeed.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/features/useDiscountCaps.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const mockGetOptional = vi.fn()
const mockExecute     = vi.fn()

vi.mock('@/data/powersync/db', () => ({
  db: {
    getOptional: (...args: unknown[]) => mockGetOptional(...args),
    execute:     (...args: unknown[]) => mockExecute(...args),
  },
}))

vi.mock('@/store/device.store', () => ({
  useDeviceStore: () => ({ shopId: 'shop-1' }),
}))

import { useDiscountCaps } from '@/features/pos/useDiscountCaps'

beforeEach(() => {
  setActivePinia(createPinia())
  mockGetOptional.mockReset()
  mockExecute.mockReset()
})

describe('useDiscountCaps', () => {
  it('loads caps from the synced shops row', async () => {
    mockGetOptional.mockResolvedValue({ cashier_discount_cap_pct: 5, manager_discount_cap_pct: 15 })
    const caps = useDiscountCaps()
    await caps.load()
    expect(caps.cashierPct.value).toBe(5)
    expect(caps.managerPct.value).toBe(15)
    expect(caps.loaded.value).toBe(true)
  })

  it('defaults to 0/15 when the shop row has no caps yet', async () => {
    mockGetOptional.mockResolvedValue(undefined)
    const caps = useDiscountCaps()
    await caps.load()
    expect(caps.cashierPct.value).toBe(0)
    expect(caps.managerPct.value).toBe(15)
  })

  it('save() writes both caps to the shops row', async () => {
    mockGetOptional.mockResolvedValue({ cashier_discount_cap_pct: 0, manager_discount_cap_pct: 15 })
    const caps = useDiscountCaps()
    await caps.load()
    await caps.save({ cashierPct: 10, managerPct: 20 })
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE shops SET cashier_discount_cap_pct'),
      [10, 20, 'shop-1'],
    )
    expect(caps.cashierPct.value).toBe(10)
    expect(caps.managerPct.value).toBe(20)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/useDiscountCaps.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// src/features/pos/useDiscountCaps.ts
import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

export function useDiscountCaps() {
  const cashierPct = ref(0)
  const managerPct = ref(15)
  const loaded     = ref(false)

  async function load(): Promise<void> {
    const device = useDeviceStore()
    const row = await db.getOptional<{
      cashier_discount_cap_pct: number | null
      manager_discount_cap_pct: number | null
    }>(
      `SELECT cashier_discount_cap_pct, manager_discount_cap_pct FROM shops WHERE id = ?`,
      [device.shopId],
    )
    cashierPct.value = row?.cashier_discount_cap_pct ?? 0
    managerPct.value = row?.manager_discount_cap_pct ?? 15
    loaded.value = true
  }

  async function save(next: { cashierPct: number; managerPct: number }): Promise<void> {
    const device = useDeviceStore()
    await db.execute(
      `UPDATE shops SET cashier_discount_cap_pct = ?, manager_discount_cap_pct = ? WHERE id = ?`,
      [next.cashierPct, next.managerPct, device.shopId],
    )
    cashierPct.value = next.cashierPct
    managerPct.value = next.managerPct
  }

  return { cashierPct, managerPct, loaded, load, save }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/useDiscountCaps.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/pos/useDiscountCaps.ts src/__tests__/features/useDiscountCaps.test.ts
git commit -m "feat(WAFI-100): add shop discount-cap read/write composable"
```

---

### Task 5: Cart store — line discount, markup, sale-level discount

**Files:**
- Modify: `src/store/sale.store.ts:6-20` (the `SaleLine` interface), `src/store/sale.store.ts:34-52` (`addLine`), `src/store/sale.store.ts:59-67` (replace `updateUnitPrice`), `src/store/sale.store.ts:144-161` (the returned object)
- Test: `src/__tests__/store/sale.store.test.ts` (existing file — add new test blocks; do not remove existing ones for `addLine`/`removeLine`/etc.)

**Interfaces:**
- Consumes: `computeDiscountedPrice`, `computeDiscountAmount` from `src/features/pos/discounts.ts` (Task 2).
- Produces (what Task 6/7/8 rely on):
  - `SaleLine` gains: `discountType?: DiscountType`, `discountValue?: number`, `discountAmountUsd?: number`
  - `applyLineDiscount(productId: string, discount: { type: DiscountType; value: number } | null): void` — `null` clears the discount, restoring `unitPriceUsd` to `listPriceUsd`.
  - `applyMarkup(productId: string, newUnitPriceUsd: number): void` — sets a price at or above `listPriceUsd` with no discount fields touched; rejects (no-ops) if `newUnitPriceUsd < listPriceUsd`.
  - `saleDiscount: Ref<{ type: DiscountType; value: number; amountUsd: number } | null>`
  - `applySaleDiscount(discount: { type: DiscountType; value: number } | null): void`
  - `totalUsd` computed becomes net of both line discounts (already baked into `lineTotalUsd`) and `saleDiscount.amountUsd`.
  - `updateUnitPrice` is **removed** from the returned object (no longer a public API — `SalePanel.vue` in Task 6 must stop calling it).

- [ ] **Step 1: Write the failing tests**

Add to `src/__tests__/store/sale.store.test.ts` (append; keep existing tests intact):

```ts
describe('discounts', () => {
  it('applyLineDiscount applies a percent discount to the line', () => {
    const store = useSaleStore()
    store.addLine({
      productId: 'p1', nameAr: 'Test', quantity: 2,
      unitPriceUsd: 10, unitCostUsd: 4, lineTotalUsd: 20,
      availableStock: 10, listPriceUsd: 10,
    })
    store.applyLineDiscount('p1', { type: 'percent', value: 20 })
    const line = store.lines.find(l => l.productId === 'p1')!
    expect(line.unitPriceUsd).toBeCloseTo(8, 2)
    expect(line.lineTotalUsd).toBeCloseTo(16, 2)
    expect(line.discountType).toBe('percent')
    expect(line.discountValue).toBe(20)
    expect(line.discountAmountUsd).toBeCloseTo(2, 2)
  })

  it('applyLineDiscount(null) clears the discount and restores list price', () => {
    const store = useSaleStore()
    store.addLine({
      productId: 'p1', nameAr: 'Test', quantity: 1,
      unitPriceUsd: 10, unitCostUsd: 4, lineTotalUsd: 10,
      availableStock: 10, listPriceUsd: 10,
    })
    store.applyLineDiscount('p1', { type: 'fixed', value: 3 })
    store.applyLineDiscount('p1', null)
    const line = store.lines.find(l => l.productId === 'p1')!
    expect(line.unitPriceUsd).toBe(10)
    expect(line.discountType).toBeUndefined()
    expect(line.discountAmountUsd).toBeUndefined()
  })

  it('applyMarkup sets a price above list with no discount fields', () => {
    const store = useSaleStore()
    store.addLine({
      productId: 'p1', nameAr: 'Test', quantity: 1,
      unitPriceUsd: 10, unitCostUsd: 4, lineTotalUsd: 10,
      availableStock: 10, listPriceUsd: 10,
    })
    store.applyMarkup('p1', 12)
    const line = store.lines.find(l => l.productId === 'p1')!
    expect(line.unitPriceUsd).toBe(12)
    expect(line.discountType).toBeUndefined()
  })

  it('applyMarkup no-ops if the price is below list', () => {
    const store = useSaleStore()
    store.addLine({
      productId: 'p1', nameAr: 'Test', quantity: 1,
      unitPriceUsd: 10, unitCostUsd: 4, lineTotalUsd: 10,
      availableStock: 10, listPriceUsd: 10,
    })
    store.applyMarkup('p1', 9)
    const line = store.lines.find(l => l.productId === 'p1')!
    expect(line.unitPriceUsd).toBe(10)
  })

  it('applySaleDiscount reduces totalUsd on top of line totals (stacking)', () => {
    const store = useSaleStore()
    store.addLine({
      productId: 'p1', nameAr: 'Test', quantity: 1,
      unitPriceUsd: 10, unitCostUsd: 4, lineTotalUsd: 10,
      availableStock: 10, listPriceUsd: 10,
    })
    store.applyLineDiscount('p1', { type: 'percent', value: 10 }) // line net = 9
    store.applySaleDiscount({ type: 'fixed', value: 1 })          // sale net = 8
    expect(store.totalUsd).toBeCloseTo(8, 2)
    expect(store.saleDiscount?.amountUsd).toBeCloseTo(1, 2)
  })

  it('clear() resets saleDiscount', () => {
    const store = useSaleStore()
    store.applySaleDiscount({ type: 'fixed', value: 1 })
    store.clear()
    expect(store.saleDiscount).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/store/sale.store.test.ts`
Expected: FAIL — `store.applyLineDiscount is not a function` (and similar for the other new methods)

- [ ] **Step 3: Implement the store changes**

Replace the top of `src/store/sale.store.ts` (imports) with:

```ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { computeDiscountedPrice, computeDiscountAmount, type DiscountType } from '@/features/pos/discounts'
```

Replace the `SaleLine` interface (currently lines 6-20):

```ts
export interface SaleLine {
  productId:    string
  nameAr:       string
  quantity:     number
  unitPriceUsd: number       // actual price charged (net of any discount/markup)
  /** Cost snapshot at add-to-cart time, used for in-cart profit preview. */
  unitCostUsd?: number
  lineTotalUsd: number
  /** Stock available for this product at the time it was added. Acts as the
   *  hard ceiling on quantity so the cart can never oversell. */
  availableStock: number
  /** Catalog/list price snapshot, so the cart can flag when an item is sold
   *  above or below its listed price. Optional for back-compat. */
  listPriceUsd?: number
  /** WAFI-100: set only when a discount (not a markup) is applied to this line. */
  discountType?:       DiscountType
  discountValue?:      number
  discountAmountUsd?:  number
  /** WAFI-100: true when this discount required (and received) owner/manager
   *  PIN approval — read by usePayment.confirm() to decide which lines need
   *  a sale.discount_applied audit entry once the sale id exists. */
  discountPinApproved?: boolean
}

export interface SaleDiscount {
  type:          DiscountType
  value:         number
  amountUsd:     number
  pinApproved?:  boolean
}
```

Add `saleDiscount` state and update `totalUsd` right after the `deviceSequence` ref (currently lines 26-32):

```ts
  const deviceSequence      = ref<number>(
    parseInt(localStorage.getItem('wafi_device_seq') ?? '0', 10)
  )
  const saleDiscount = ref<SaleDiscount | null>(null)

  const totalUsd = computed(() => {
    const linesTotal = lines.value.reduce((sum, l) => sum + l.lineTotalUsd, 0)
    return Math.max(0, linesTotal - (saleDiscount.value?.amountUsd ?? 0))
  })
```

Replace `updateUnitPrice` (currently lines 59-67) with three new functions — place them right after `removeLine`:

```ts
  // WAFI-100: apply a capped/audited discount to one line. Recomputes the
  // line's unitPriceUsd/lineTotalUsd/discount* fields from listPriceUsd (the
  // undiscounted price), so re-applying a different discount is idempotent —
  // it never compounds on top of a previous discount.
  function applyLineDiscount(
    productId: string,
    discount: { type: DiscountType; value: number } | null,
    pinApproved = false,
  ) {
    const line = lines.value.find(l => l.productId === productId)
    if (!line) return
    const base = line.listPriceUsd ?? line.unitPriceUsd
    if (discount === null) {
      line.unitPriceUsd         = base
      line.lineTotalUsd         = base * line.quantity
      line.discountType         = undefined
      line.discountValue        = undefined
      line.discountAmountUsd    = undefined
      line.discountPinApproved  = undefined
      return
    }
    const finalPrice = computeDiscountedPrice(base, discount)
    line.unitPriceUsd        = finalPrice
    line.lineTotalUsd        = finalPrice * line.quantity
    line.discountType        = discount.type
    line.discountValue       = discount.value
    line.discountAmountUsd   = computeDiscountAmount(base, finalPrice)
    line.discountPinApproved = pinApproved
  }

  // WAFI-100: sell above list price. Uncapped, unaudited (never hurts the
  // shop financially) — a distinct path from applyLineDiscount so a markup
  // is never mistaken for a discount by the cap/PIN system.
  function applyMarkup(productId: string, newUnitPriceUsd: number) {
    const line = lines.value.find(l => l.productId === productId)
    if (!line) return
    const base = line.listPriceUsd ?? line.unitPriceUsd
    if (newUnitPriceUsd < base) return
    line.unitPriceUsd      = newUnitPriceUsd
    line.lineTotalUsd       = newUnitPriceUsd * line.quantity
    line.discountType       = undefined
    line.discountValue      = undefined
    line.discountAmountUsd  = undefined
  }

  // WAFI-100: sale-footer discount, applied on top of the (already net) line
  // totals — stacking, not exclusive with line discounts.
  function applySaleDiscount(
    discount: { type: DiscountType; value: number } | null,
    pinApproved = false,
  ) {
    if (discount === null) {
      saleDiscount.value = null
      return
    }
    const linesTotal = lines.value.reduce((sum, l) => sum + l.lineTotalUsd, 0)
    const finalTotal  = computeDiscountedPrice(linesTotal, discount)
    saleDiscount.value = {
      type:        discount.type,
      value:       discount.value,
      amountUsd:   computeDiscountAmount(linesTotal, finalTotal),
      pinApproved,
    }
  }
```

Update `clear()` (currently lines 136-142) to reset `saleDiscount`:

```ts
  function clear() {
    lines.value               = []
    lockedExchangeRate.value  = null
    hasRateChangeNotice.value = false
    saleDiscount.value        = null
    // deviceSequence is intentionally NOT reset — it is a monotonically increasing
    // per-device counter that persists across sales to guarantee unique receipt numbers.
  }
```

Update the returned object (currently lines 144-161) — remove `updateUnitPrice`, add the four new exports:

```ts
  return {
    lines,
    lockedExchangeRate,
    hasRateChangeNotice,
    deviceSequence,
    saleDiscount,
    totalUsd,
    addLine,
    removeLine,
    updateQuantity,
    applyLineDiscount,
    applyMarkup,
    applySaleDiscount,
    scalePricesToTotal,
    setLockedRate,
    setRateChangeNotice,
    incrementSequence,
    reconcileSequenceFromDb,
    clear,
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/store/sale.store.test.ts`
Expected: PASS, including all pre-existing tests in this file (confirm none broke from removing `updateUnitPrice`)

- [ ] **Step 5: Search for any other caller of the removed `updateUnitPrice`**

Run: `grep -rn "updateUnitPrice" src/`
Expected: only `src/features/pos/SalePanel.vue` (to be fixed in Task 6) — if any other file calls it, note it and fix it in Task 6 as well.

- [ ] **Step 6: Commit**

```bash
git add src/store/sale.store.ts src/__tests__/store/sale.store.test.ts
git commit -m "feat(WAFI-100): add line/sale discount and markup mutations to the cart store"
```

---

### Task 6: `SalePanel.vue` — replace the raw price input with discount/markup/PIN UI

**Files:**
- Modify: `src/features/pos/SalePanel.vue` (script block, and the `line-unit` template block currently at lines 250-268, and the `panel-footer` block currently at lines 318-335)
- Test: Create `src/__tests__/features/SalePanel.discounts.test.ts`

**Interfaces:**
- Consumes: `applyLineDiscount`, `applyMarkup`, `applySaleDiscount`, `saleDiscount` from `useSaleStore()` (Task 5); `requiresPinApproval`, `DiscountCaps` from `src/features/pos/useDiscountAuthorization.ts` (Task 3); `useDiscountCaps` from `src/features/pos/useDiscountCaps.ts` (Task 4); `useSessionStore` from `@/store/session.store` (already used elsewhere, e.g. `usePayment.ts:8`) for `session.activeStaff.role`; `PinPad.vue` from `src/features/staff/components/PinPad.vue`.
- Produces: no new public interface (leaf UI component) — but this is the only place `applyLineDiscount`/`applyMarkup`/`applySaleDiscount` get wired to user input, so later manual QA depends on this task being complete.

This task is UI-heavy; the test verifies the *logic* wiring (PIN gate triggers correctly) rather than pixel layout.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/features/SalePanel.discounts.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { useSaleStore } from '@/store/sale.store'
import { useSessionStore } from '@/store/session.store'

vi.mock('@/data/powersync/db', () => ({ db: { execute: vi.fn(), getOptional: vi.fn() } }))
vi.mock('@/features/payment/useFastCashSettings', () => ({
  useFastCashSettings: () => ({ fastButtons: [] }),
}))
vi.mock('@/composables/useSaleDraft', () => ({
  useSaleDraft: () => ({ clearDraft: vi.fn() }),
}))
vi.mock('@/features/pos/useDiscountCaps', () => ({
  useDiscountCaps: () => ({
    cashierPct: { value: 5 }, managerPct: { value: 15 },
    loaded: { value: true }, load: vi.fn(), save: vi.fn(),
  }),
}))

import SalePanel from '@/features/pos/SalePanel.vue'

beforeEach(() => {
  setActivePinia(createPinia())
})

function seedLine() {
  const store = useSaleStore()
  store.addLine({
    productId: 'p1', nameAr: 'قلم', quantity: 1,
    unitPriceUsd: 10, unitCostUsd: 4, lineTotalUsd: 10,
    availableStock: 10, listPriceUsd: 10,
  })
  return store
}

describe('SalePanel discount flow', () => {
  it('a cashier discount within cap applies without opening the PIN sheet', async () => {
    const store = seedLine()
    const session = useSessionStore()
    session.setActiveStaff({
      id: 's1', shopId: 'shop-1', name: 'Cashier', pinHash: '', pinSalt: null,
      role: 'cashier', isActive: true, createdAt: '',
      permissions: { can_view_reports: false, can_manage_products: false, can_manage_customers: false, can_view_expenses: false, can_manage_settings: false },
    })
    const wrapper = mount(SalePanel)
    await wrapper.vm.$nextTick()

    // Component exposes applyDiscount for the discount sheet's confirm handler.
    ;(wrapper.vm as any).applyDiscount('p1', { type: 'percent', value: 5 })
    await wrapper.vm.$nextTick()

    expect(store.lines[0].unitPriceUsd).toBeCloseTo(9.5, 2)
    expect((wrapper.vm as any).pinSheetOpen).toBe(false)
  })

  it('a cashier discount over cap opens the PIN sheet and does not apply until confirmed', async () => {
    const store = seedLine()
    const session = useSessionStore()
    session.setActiveStaff({
      id: 's1', shopId: 'shop-1', name: 'Cashier', pinHash: '', pinSalt: null,
      role: 'cashier', isActive: true, createdAt: '',
      permissions: { can_view_reports: false, can_manage_products: false, can_manage_customers: false, can_view_expenses: false, can_manage_settings: false },
    })
    const wrapper = mount(SalePanel)
    await wrapper.vm.$nextTick()

    ;(wrapper.vm as any).applyDiscount('p1', { type: 'percent', value: 50 })
    await wrapper.vm.$nextTick()

    expect((wrapper.vm as any).pinSheetOpen).toBe(true)
    expect(store.lines[0].unitPriceUsd).toBe(10) // not yet applied
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/SalePanel.discounts.test.ts`
Expected: FAIL — `applyDiscount is not a function` / `pinSheetOpen is undefined`

- [ ] **Step 3: Implement the component changes**

In `src/features/pos/SalePanel.vue`, add to the imports at the top of `<script setup>`:

```ts
import { useSessionStore } from '@/store/session.store'
import { useDiscountCaps } from '@/features/pos/useDiscountCaps'
import { requiresPinApproval } from '@/features/pos/useDiscountAuthorization'
import { verifyPin } from '@/features/staff/composables/usePinAuth'
import { useStaff } from '@/features/staff/composables/useStaff'
import PinPad from '@/features/staff/components/PinPad.vue'
```

`useStaff()` (already used the same way in `LockScreen.vue:5`) provides the list of active staff to filter down to `role === 'owner' || role === 'manager'` for the approver picker — a simple list of name buttons shown before the `PinPad`, setting `approverCandidate.value` on tap. Build this the same way `LockScreen.vue`'s own staff-picker step looks, since it's the exact same "list of eligible staff, tap one, then PIN" shape.

Add state and logic (place after the existing `store`/`clearDraft` declarations near the top):

```ts
const session = useSessionStore()
const caps    = useDiscountCaps()
caps.load()

const discountSheetOpen = ref(false)
const discountSheetProductId = ref<string | null>(null)
const pinSheetOpen = ref(false)
const pendingDiscount = ref<{ productId: string; discount: { type: 'percent' | 'fixed'; value: number } } | null>(null)

const saleDiscountSheetOpen = ref(false)

function openDiscountSheet(productId: string) {
  discountSheetProductId.value = productId
  discountSheetOpen.value = true
}

// Exposed for the discount sheet's confirm button and for tests.
function applyDiscount(productId: string, discount: { type: 'percent' | 'fixed'; value: number }) {
  const line = store.lines.find(l => l.productId === productId)
  if (!line) return
  const base = line.listPriceUsd ?? line.unitPriceUsd
  const finalPrice = discount.type === 'percent'
    ? base * (1 - Math.min(Math.max(discount.value, 0), 100) / 100)
    : Math.max(0, base - discount.value)
  const discountPct = base > 0 ? ((base - finalPrice) / base) * 100 : 0
  const role = session.activeStaff?.role ?? 'cashier'

  const needsPin = requiresPinApproval({
    role,
    discountPct,
    finalPriceUsd: finalPrice,
    unitCostUsd: line.unitCostUsd ?? 0,
    caps: { cashierPct: caps.cashierPct.value, managerPct: caps.managerPct.value },
  })

  if (needsPin) {
    pendingDiscount.value = { productId, discount }
    pinSheetOpen.value = true
    discountSheetOpen.value = false
    return
  }

  store.applyLineDiscount(productId, discount)
  discountSheetOpen.value = false
}

// Approver picker: PIN approval on its own doesn't say WHOSE pin, so the
// PIN sheet is preceded by picking which owner/manager is approving — same
// two-step "pick staff, then PIN" shape as LockScreen.vue's operator-switch
// flow (`src/features/shifts/components/LockScreen.vue:1-20`), reusing the
// same `useStaff`/`verifyPin` composables rather than a new PIN-matching path.
// The audit log entry itself is NOT written here — there is no sale id yet
// while the cart is still open. Instead this only flips the line/sale
// discount's `pinApproved` flag; Task 8's `usePayment.confirm()` reads that
// flag after the sale row exists and calls `logDiscountApplied(saleId, ...)`
// once per discounted line/sale-discount, the same "log only after a
// successful transaction" shape `logSaleCompleted` already uses.
const approverCandidate = ref<import('@/features/staff/staff.types').Staff | null>(null)
const approverError = ref(false)

async function onPinConfirmed(pin: string) {
  if (!approverCandidate.value) return
  const ok = await verifyPin(pin, approverCandidate.value.pinHash, approverCandidate.value.pinSalt)
  if (!ok) {
    approverError.value = true
    return
  }

  if (pendingDiscount.value) {
    const { productId, discount } = pendingDiscount.value
    store.applyLineDiscount(productId, discount, /* pinApproved */ true)
    pendingDiscount.value = null
  } else if (pendingSaleDiscount.value) {
    store.applySaleDiscount(pendingSaleDiscount.value, /* pinApproved */ true)
    pendingSaleDiscount.value = null
  }

  approverCandidate.value = null
  pinSheetOpen.value      = false
}

function applyMarkupInput(productId: string, value: number) {
  store.applyMarkup(productId, value)
}

const pendingSaleDiscount = ref<{ type: 'percent' | 'fixed'; value: number } | null>(null)

// Sale-level discount goes through the same cap check as a line discount,
// checked against the post-line-discount subtotal per the design spec — but
// has no single unit cost to compare against, so only the cap (not the
// below-cost guard) applies here; below-cost is inherently a per-line concept.
function applySaleDiscountConfirm(discount: { type: 'percent' | 'fixed'; value: number } | null) {
  if (discount === null) {
    store.applySaleDiscount(null)
    saleDiscountSheetOpen.value = false
    return
  }
  const linesTotal = store.lines.reduce((s, l) => s + l.lineTotalUsd, 0)
  const finalTotal = discount.type === 'percent'
    ? linesTotal * (1 - Math.min(Math.max(discount.value, 0), 100) / 100)
    : Math.max(0, linesTotal - discount.value)
  const discountPct = linesTotal > 0 ? ((linesTotal - finalTotal) / linesTotal) * 100 : 0
  const role = session.activeStaff?.role ?? 'cashier'

  const needsPin = role !== 'owner' && discountPct > (role === 'manager' ? caps.managerPct.value : caps.cashierPct.value)

  if (needsPin) {
    pendingSaleDiscount.value = discount
    pinSheetOpen.value = true
    saleDiscountSheetOpen.value = false
    return
  }

  store.applySaleDiscount(discount)
  saleDiscountSheetOpen.value = false
}

defineExpose({ applyDiscount, pinSheetOpen, discountSheetOpen, applySaleDiscountConfirm })
```

Replace the `price-edit` block in the template (currently lines 251-260):

```html
            <button
              type="button"
              class="price-edit discount-trigger"
              :aria-label="`تعديل سعر ${line.nameAr}`"
              @click="openDiscountSheet(line.productId)"
            >${{ line.unitPriceUsd.toFixed(2) }}</button>
```

Add the sale-discount control and net total to the footer, right before the existing `total-main-row` (currently line 320):

```html
        <button
          type="button"
          class="sale-discount-trigger"
          @click="saleDiscountSheetOpen = true"
        >
          {{ store.saleDiscount ? `خصم الفاتورة: -$${store.saleDiscount.amountUsd.toFixed(2)}` : 'إضافة خصم على الفاتورة' }}
        </button>
```

Add the two new sheets at the end of the `<template>`, alongside the existing `AppDialog`/`BaseModal`:

```html
  <BaseModal v-if="discountSheetOpen" title="تطبيق خصم" @close="discountSheetOpen = false">
    <!-- percent/fixed input calling applyDiscount(discountSheetProductId, { type, value })
         on confirm — build using the same form-field patterns as other BaseModal
         sheets in this codebase (e.g. ReturnSheet.vue's reason/notes fields). -->
  </BaseModal>

  <BaseModal v-if="pinSheetOpen" title="مطلوب رمز الموافقة" @close="pinSheetOpen = false; pendingDiscount = null">
    <PinPad @complete="onPinConfirmed" />
  </BaseModal>

  <BaseModal v-if="saleDiscountSheetOpen" title="خصم على الفاتورة" @close="saleDiscountSheetOpen = false">
    <!-- percent/fixed input calling applySaleDiscountConfirm({ type, value }) -->
  </BaseModal>
```

Add minimal styling for the new trigger elements near the existing `.price-input`/`.price-delta` rules:

```css
.discount-trigger {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  color: #60A5FA;
  font-weight: 700;
  font-size: inherit;
  font-family: inherit;
}

.sale-discount-trigger {
  align-self: flex-start;
  background: none;
  border: none;
  padding: 0;
  margin-bottom: 4px;
  font-size: 12px;
  color: #60A5FA;
  cursor: pointer;
}
```

Update the main total row to read `store.totalUsd` as before (already net, no change needed there — `totalUsd` is already the net computed value from Task 5).

Also add an approver-picker step before the `PinPad` inside the `pinSheetOpen` `BaseModal` above: list active staff from `useStaff()` filtered to `role === 'owner' || role === 'manager'`, each a tappable button that sets `approverCandidate.value = staff` before showing the `PinPad` — mirror `LockScreen.vue`'s existing staff-picker step for the markup/layout, since it's the same "pick staff, then PIN" shape.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/SalePanel.discounts.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the full existing SalePanel-related test suite to check nothing else broke**

Run: `npx vitest run src/__tests__/features -t SalePanel`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/features/pos/SalePanel.vue src/__tests__/features/SalePanel.discounts.test.ts
git commit -m "feat(WAFI-100): wire discount/markup/PIN UI into SalePanel"
```

---

### Task 7: Audit trail — `sale.discount_applied` event

**Files:**
- Modify: `src/features/audit/audit.types.ts:1-46` (add to the `AuditEvent` union)
- Modify: `src/features/audit/composables/useAuditLog.ts` (add `logDiscountApplied`, export it)
- Test: `src/__tests__/features/useAuditLog.discounts.test.ts`

**Interfaces:**
- Produces: `logDiscountApplied(saleId: string, meta: { operatorId: string | null; tierApplied: 'retail'; basePriceUsd: number; discountType: DiscountType; discountValue: number; finalPriceUsd: number; pinApproval: boolean; belowCost: boolean }): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/features/useAuditLog.discounts.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockExecute = vi.fn().mockResolvedValue(undefined)
vi.mock('@/data/powersync/db', () => ({ db: { execute: (...a: unknown[]) => mockExecute(...a) } }))
vi.mock('@/store/device.store', () => ({ useDeviceStore: () => ({ shopId: 'shop-1' }) }))
vi.mock('@/store/session.store', () => ({
  useSessionStore: () => ({ activeStaff: { id: 'staff-1', name: 'Owner' } }),
}))

import { useAuditLog } from '@/features/audit/composables/useAuditLog'

beforeEach(() => mockExecute.mockClear())

describe('logDiscountApplied', () => {
  it('writes a sale.discount_applied audit row with the required meta fields', async () => {
    const { logDiscountApplied } = useAuditLog()
    await logDiscountApplied('sale-1', {
      operatorId: 'staff-1', tierApplied: 'retail', basePriceUsd: 10,
      discountType: 'percent', discountValue: 20, finalPriceUsd: 8,
      pinApproval: true, belowCost: false,
    })
    const [sql, params] = mockExecute.mock.calls[0]
    expect(sql).toContain('INSERT INTO audit_log')
    expect(params[4]).toBe('sale.discount_applied') // event column
    expect(params[5]).toBe('sale')                  // entity_type column
    expect(JSON.parse(params[7])).toMatchObject({
      operatorId: 'staff-1', discountType: 'percent', pinApproval: true, belowCost: false,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/useAuditLog.discounts.test.ts`
Expected: FAIL — `logDiscountApplied is not a function`

- [ ] **Step 3: Implement**

In `src/features/audit/audit.types.ts`, add one line to the `AuditEvent` union (after `'category.deleted_with_reassign'`, before `'device.renamed'`, currently around line 44):

```ts
  | 'sale.discount_applied'
```

In `src/features/audit/composables/useAuditLog.ts`, add the import for `DiscountType` near the top:

```ts
import type { DiscountType } from '@/features/pos/discounts'
```

Add the helper right after `logSaleCompleted`/`logSaleDeleted` (near line 262), following the `_logSensitive` pattern used by `logPinChanged`:

```ts
  // WAFI-100: a below-cost or PIN-approved discount is accountability-critical
  // — a failed audit write must surface, not silently vanish (_logSensitive).
  const logDiscountApplied = (
    saleId: string,
    meta: {
      operatorId:    string | null
      tierApplied:   'retail'
      basePriceUsd:  number
      discountType:  DiscountType
      discountValue: number
      finalPriceUsd: number
      pinApproval:   boolean
      belowCost:     boolean
    },
  ) => _logSensitive('sale.discount_applied', 'sale', saleId, meta)
```

Add `logDiscountApplied` to the returned object at the bottom of the file (next to `logSaleCompleted`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/useAuditLog.discounts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/audit/audit.types.ts src/features/audit/composables/useAuditLog.ts src/__tests__/features/useAuditLog.discounts.test.ts
git commit -m "feat(WAFI-100): add sale.discount_applied audit event"
```

---

### Task 8: Persist discount fields at checkout (`usePayment.ts`)

**Files:**
- Modify: `src/features/payment/usePayment.ts:210-216` (the `CompletedSale.lines` mapping), `src/features/payment/usePayment.ts:222-240` (the `sales` INSERT), `src/features/payment/usePayment.ts:273-278` (the `sale_line_items` INSERT), and the `CompletedSale`/line type in `src/features/payment/payment.types.ts` if it declares the `lines` shape
- Test: existing `src/__tests__/features/usePayment.test.ts` — add new test cases

**Interfaces:**
- Consumes: `saleStore.saleDiscount` (Task 5); each `line.discountType`/`discountValue`/`discountAmountUsd`/`discountPinApproved` (Task 5); `logDiscountApplied` from `useAuditLog()` (Task 7).
- Produces: `sales.sale_discount_type/value/amount_usd` and `sale_line_items.discount_type/value/amount_usd` are populated on every completed sale; a `sale.discount_applied` audit row is written for every discounted line and/or sale-level discount once the sale has committed.

- [ ] **Step 1: Write the failing test**

Add to `src/__tests__/features/usePayment.test.ts` (follow that file's existing setup/mocking conventions — it already mocks `db`, `useDeviceStore`, `useShiftStore`, `useSessionStore`; reuse the same mocks):

```ts
it('persists line and sale discount fields on a discounted sale', async () => {
  const saleStore = useSaleStore()
  saleStore.addLine({
    productId: 'p1', nameAr: 'قلم', quantity: 1,
    unitPriceUsd: 10, unitCostUsd: 4, lineTotalUsd: 10,
    availableStock: 10, listPriceUsd: 10,
  })
  saleStore.setLockedRate(1)
  saleStore.applyLineDiscount('p1', { type: 'percent', value: 20 }) // net line = 8
  saleStore.applySaleDiscount({ type: 'fixed', value: 1 })          // net sale = 7

  const payment = usePayment()
  payment.selectMethod('cash_usd')
  payment.amountReceived = 7
  await payment.confirm()

  const lineInsertCall = mockExecute.mock.calls.find(
    (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO sale_line_items'),
  )
  expect(lineInsertCall[0]).toContain('discount_type')
  expect(lineInsertCall[1]).toContain('percent')
  expect(lineInsertCall[1]).toContain(2) // discount_amount_usd for this line

  const saleInsertCall = mockExecute.mock.calls.find(
    (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO sales'),
  )
  expect(saleInsertCall[0]).toContain('sale_discount_type')
  expect(saleInsertCall[1]).toContain('fixed')
  expect(saleInsertCall[1]).toContain(1) // sale_discount_amount_usd
})
```

(If the existing test file's mock of `db.execute` isn't named `mockExecute` or doesn't record calls this way, match whatever mock helper the file already uses — read the file first and adapt the assertion style, not the intent.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/usePayment.test.ts -t "persists line and sale discount"`
Expected: FAIL — inserted SQL/params don't contain discount columns yet

- [ ] **Step 3: Implement**

In `src/features/payment/usePayment.ts`, update the `sales` INSERT (currently lines 222-240):

```ts
        await tx.execute(
          `INSERT INTO sales (id, shop_id, device_id, device_sequence, display_sale_number,
            created_at, total_usd, total_syp, exchange_rate_at_sale, payment_method,
            amount_received, amount_received_currency, change_due, customer_id, is_credit, is_split,
            shift_id, staff_id, sale_discount_type, sale_discount_value, sale_discount_amount_usd, sync_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            saleId, deviceStore.shopId, deviceStore.deviceId,
            saleSeq, displayNum, now,
            totalUsd.value, totalSyp.value, saleStore.lockedExchangeRate,
            primaryMethod, totalReceived, 'USD', lastChange || null,
            customerId ?? null, isCredit ? 1 : 0, isSplit ? 1 : 0,
            shiftStore.activeShiftId,
            sessionStore.activeStaff?.id ?? null,
            saleStore.saleDiscount?.type ?? null,
            saleStore.saleDiscount?.value ?? null,
            saleStore.saleDiscount?.amountUsd ?? 0,
            'pending',
          ]
        )
```

Update the `sale_line_items` INSERT (currently lines 273-278):

```ts
          await tx.execute(
            `INSERT INTO sale_line_items
              (id, sale_id, shop_id, product_id, quantity, unit_price_usd, unit_cost_usd, line_total_usd,
               discount_type, discount_value, discount_amount_usd)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [uuidv4(), saleId, deviceStore.shopId, line.productId,
             line.quantity, line.unitPriceUsd, unitCostUsd, line.lineTotalUsd,
             line.discountType ?? null, line.discountValue ?? null, line.discountAmountUsd ?? 0]
          )
```

**Important ordering note:** `saleStore.clear()` runs (at the current line 294) BEFORE `logSaleCompleted` (line 298) — so by the time we'd add discount-audit logging after `logSaleCompleted`, `saleStore.lines`/`saleStore.saleDiscount` are already wiped. Fix this by capturing the discount data into the local `sale` object (built earlier, before `clear()` runs) instead of reading the store after the fact.

First, extend the `CompletedSale.lines` mapping (currently lines 210-215) to carry the discount fields through:

```ts
      lines:                  saleStore.lines.map(l => ({
        nameAr:              l.nameAr,
        quantity:            l.quantity,
        unitPriceUsd:        l.unitPriceUsd,
        lineTotalUsd:        l.lineTotalUsd,
        discountType:        l.discountType,
        discountValue:       l.discountValue,
        discountPinApproved: l.discountPinApproved,
        unitCostUsd:         l.unitCostUsd,
        listPriceUsd:        l.listPriceUsd,
      })),
      saleDiscount:           saleStore.saleDiscount,
```

(Update `CompletedSale`'s type in `src/features/payment/payment.types.ts` to add the matching optional fields to its `lines` entries and a top-level `saleDiscount?: SaleDiscount` field — mirror `SaleLine`/`SaleDiscount` from `src/store/sale.store.ts` Task 5.)

Then, after the existing `await logSaleCompleted(saleId, sale.totalUsd, sale.lines.length)` call (currently line 298) — which runs AFTER `clear()`, but now reads from the captured `sale` object rather than the live store, so ordering relative to `clear()` no longer matters:

```ts
      await logSaleCompleted(saleId, sale.totalUsd, sale.lines.length)

      // WAFI-100: one audit entry per discounted line, plus one for a
      // sale-level discount if present. Reads from the captured `sale`
      // snapshot (built before saleStore.clear() ran above), not the live
      // store, which has already been wiped by this point.
      for (const line of sale.lines) {
        if (!line.discountType) continue
        const base = line.listPriceUsd ?? line.unitPriceUsd
        await logDiscountApplied(saleId, {
          operatorId:    sessionStore.activeStaff?.id ?? null,
          tierApplied:   'retail',
          basePriceUsd:  base,
          discountType:  line.discountType,
          discountValue: line.discountValue ?? 0,
          finalPriceUsd: line.unitPriceUsd,
          pinApproval:   Boolean(line.discountPinApproved),
          belowCost:     line.unitPriceUsd < (line.unitCostUsd ?? 0),
        })
      }
      if (sale.saleDiscount) {
        const sd = sale.saleDiscount
        await logDiscountApplied(saleId, {
          operatorId:    sessionStore.activeStaff?.id ?? null,
          tierApplied:   'retail',
          basePriceUsd:  sale.totalUsd + sd.amountUsd,
          discountType:  sd.type,
          discountValue: sd.value,
          finalPriceUsd: sale.totalUsd,
          pinApproval:   Boolean(sd.pinApproved),
          belowCost:     false,
        })
      }
```

Add `logDiscountApplied` to the existing `useAuditLog()` destructure at the top of the file (next to `logSaleCompleted`).

Confirm via the Step 1 test that these calls fire — add an assertion that the mocked `logDiscountApplied` (from this file's existing `useAuditLog` mock) was called with the expected discount metadata.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/usePayment.test.ts`
Expected: PASS (all tests in the file, including the new one)

- [ ] **Step 5: Commit**

```bash
git add src/features/payment/usePayment.ts src/__tests__/features/usePayment.test.ts
git commit -m "feat(WAFI-100): persist discount fields and audit trail on sale completion"
```

---

### Task 9: Z-report — per-operator discount rollup

**Files:**
- Modify: `src/features/shifts/shift.types.ts:64-89` (`ZReportMetrics`) — add fields after `varianceSyp` and before the duration comment
- Modify: `src/features/shifts/composables/useZReport.ts:22-131` (add a query + wire into `result`), and `useZReport.ts:218-291` (`printZReport`, add a line to the receipt text)
- Test: `src/features/shifts/composables/__tests__/useZReport.test.ts` (existing file — add a case)

**Interfaces:**
- Produces: `ZReportMetrics.totalDiscountsUsd: number` and `ZReportMetrics.byOperator[].discountsUsd: number` (extends the existing `OperatorSales` interface at `src/features/shifts/shift.types.ts` near line 58-62).

- [ ] **Step 1: Write the failing test**

Read `src/features/shifts/composables/__tests__/useZReport.test.ts` first to match its existing mock/query-ordering conventions (the `compute()` function issues its DB reads via `Promise.all` in a fixed order the test file's mock likely depends on positionally — preserve that order and append the new query at the end of the array, not in the middle, to avoid reordering every existing assertion). Then add:

```ts
it('includes totalDiscountsUsd and per-operator discountsUsd in the metrics', async () => {
  // Arrange the mock db so the new discount-sum query and the updated
  // per-operator query both return non-zero figures, following this file's
  // existing pattern for mocking db.getOptional/db.getAll per call.
  // ... (mirror the existing "computes metrics" test's arrange block, adding
  // the discount totals to the mocked rows)

  const { compute } = useZReport()
  const metrics = await compute(shift, closingCashUsd, closingCashSyp)

  expect(metrics.totalDiscountsUsd).toBeGreaterThanOrEqual(0)
  expect(metrics.byOperator[0]).toHaveProperty('discountsUsd')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/shifts/composables/__tests__/useZReport.test.ts`
Expected: FAIL — `metrics.totalDiscountsUsd` is `undefined`

- [ ] **Step 3: Implement**

In `src/features/shifts/shift.types.ts`, extend `OperatorSales` (near line 58-62):

```ts
export interface OperatorSales {
  staffId:      string | null
  name:         string | null
  salesCount:   number
  totalUsd:     number
  discountsUsd: number   // WAFI-100
}
```

Add `totalDiscountsUsd` to `ZReportMetrics`, right after `varianceSyp` (currently line 88, before the `// duration` comment):

```ts
  varianceSyp:     number
  totalDiscountsUsd: number   // WAFI-100: sum of line + sale discount_amount_usd this shift
```

In `src/features/shifts/composables/useZReport.ts`, add a new query to the `Promise.all` array (append at the end, after `creditPaySypRow`, currently around line 24):

```ts
      const [countRow, revenueRow, cashUsdRow, cashSypRow, cardRow, creditRow,
             expUsdRow, expSypRow, refundUsdRow, refundSypRow,
             creditPayUsdRow, creditPaySypRow, discountRow] =
        await Promise.all([
          // ...(all existing entries unchanged)...
          db.getOptional<{ total: number }>(
            `SELECT COALESCE(SUM(sli.discount_amount_usd), 0) +
                    COALESCE((SELECT SUM(sale_discount_amount_usd) FROM sales
                              WHERE shop_id = ? AND device_id = ? AND created_at BETWEEN ? AND ?), 0) AS total
             FROM sale_line_items sli
             JOIN sales s ON s.id = sli.sale_id
             WHERE s.shop_id = ? AND s.device_id = ? AND s.created_at BETWEEN ? AND ?`,
            [device.shopId, shift.deviceId, shift.openedAt, closedAt,
             device.shopId, shift.deviceId, shift.openedAt, closedAt],
          ),
        ])
```

Update the `operatorRows` query to include per-operator discounts (currently lines 122-130):

```ts
      const operatorRows = await db.getAll<OperatorSales>(
        `SELECT s.staff_id AS staffId, st.name AS name,
                COUNT(*) AS salesCount, COALESCE(SUM(s.total_usd), 0) AS totalUsd,
                COALESCE(SUM(s.sale_discount_amount_usd), 0) +
                  COALESCE((SELECT SUM(sli.discount_amount_usd) FROM sale_line_items sli
                            WHERE sli.sale_id = s.id), 0) AS discountsUsd
         FROM sales s LEFT JOIN staff st ON st.id = s.staff_id
         WHERE s.shop_id = ? AND s.device_id = ? AND s.created_at BETWEEN ? AND ?
         GROUP BY s.staff_id, st.name
         ORDER BY totalUsd DESC`,
        [device.shopId, shift.deviceId, shift.openedAt, closedAt]
      )
```

Add `totalDiscountsUsd` to the `result` object (currently lines 181-206, right after `varianceSyp`):

```ts
        varianceSyp:     recon.varianceSyp,
        totalDiscountsUsd: discountRow?.total ?? 0,
```

In `printZReport`, add a line after the invoice-count/revenue block (currently around line 245):

```ts
      `إجمالي:         ${fmtUsd(m.totalRevenueUsd)}`,
      ...(m.totalDiscountsUsd > 0 ? [`إجمالي الخصومات: ${fmtUsd(m.totalDiscountsUsd)}`] : []),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/shifts/composables/__tests__/useZReport.test.ts`
Expected: PASS, including every pre-existing test in the file (confirm the new query didn't shift positional mock ordering for the others)

- [ ] **Step 5: Commit**

```bash
git add src/features/shifts/shift.types.ts src/features/shifts/composables/useZReport.ts src/features/shifts/composables/__tests__/useZReport.test.ts
git commit -m "feat(WAFI-100): add discount totals to the Z-report"
```

---

### Task 10: Owner Settings screen for discount caps

**Files:**
- Create: `src/features/pos/DiscountCapsSettingsScreen.vue`
- Modify: `src/router/index.ts` (add a child route under `/settings`, near line 45's `receipt`/`staff` entries)
- Modify: `src/pages/SettingsPage.vue` (add a nav row in the mobile list, following the exact pattern of the existing `receipt`/`staff` nav-row buttons at lines 76-111)
- Test: `src/features/pos/__tests__/DiscountCapsSettingsScreen.test.ts`

**Interfaces:**
- Consumes: `useDiscountCaps` (Task 4).

- [ ] **Step 1: Write the failing test**

```ts
// src/features/pos/__tests__/DiscountCapsSettingsScreen.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const mockLoad = vi.fn().mockResolvedValue(undefined)
const mockSave = vi.fn().mockResolvedValue(undefined)
vi.mock('@/features/pos/useDiscountCaps', () => ({
  useDiscountCaps: () => ({
    cashierPct: { value: 5 }, managerPct: { value: 15 }, loaded: { value: true },
    load: mockLoad, save: mockSave,
  }),
}))

import DiscountCapsSettingsScreen from '@/features/pos/DiscountCapsSettingsScreen.vue'

beforeEach(() => {
  setActivePinia(createPinia())
  mockSave.mockClear()
})

describe('DiscountCapsSettingsScreen', () => {
  it('loads caps on mount', () => {
    mount(DiscountCapsSettingsScreen)
    expect(mockLoad).toHaveBeenCalled()
  })

  it('calls save with the edited values on submit', async () => {
    const wrapper = mount(DiscountCapsSettingsScreen)
    await (wrapper.vm as any).submit(10, 25)
    expect(mockSave).toHaveBeenCalledWith({ cashierPct: 10, managerPct: 25 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/pos/__tests__/DiscountCapsSettingsScreen.test.ts`
Expected: FAIL — component file doesn't exist

- [ ] **Step 3: Implement the screen**

```vue
<!-- src/features/pos/DiscountCapsSettingsScreen.vue -->
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import AppHeader from '@/components/ui/AppHeader.vue'
import { useDiscountCaps } from '@/features/pos/useDiscountCaps'

const caps = useDiscountCaps()
const cashierInput = ref(0)
const managerInput = ref(15)
const saved = ref(false)

onMounted(async () => {
  await caps.load()
  cashierInput.value = caps.cashierPct.value
  managerInput.value = caps.managerPct.value
})

async function submit(cashierPct: number, managerPct: number) {
  await caps.save({ cashierPct, managerPct })
  saved.value = true
  setTimeout(() => { saved.value = false }, 2000)
}

defineExpose({ submit })
</script>

<template>
  <div class="page-root" dir="rtl">
    <AppHeader title="حدود الخصم" />
    <main class="content">
      <p class="hint">أقصى نسبة خصم يمكن لكل رتبة تطبيقها بدون رمز موافقة المالك.</p>

      <label class="field">
        <span>الكاشير</span>
        <input type="number" min="0" max="100" v-model.number="cashierInput" />
        <span class="suffix">%</span>
      </label>

      <label class="field">
        <span>المدير</span>
        <input type="number" min="0" max="100" v-model.number="managerInput" />
        <span class="suffix">%</span>
      </label>

      <button type="button" class="save-btn" @click="submit(cashierInput, managerInput)">
        حفظ
      </button>
      <p v-if="saved" class="saved-note">تم الحفظ</p>
    </main>
  </div>
</template>

<style scoped>
.content { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.hint { font-size: 12px; color: #637285; }
.field { display: flex; align-items: center; gap: 8px; }
.field input { width: 70px; }
.suffix { color: #637285; }
.save-btn {
  align-self: flex-start;
  background: #1A56DB;
  color: #fff;
  border: none;
  border-radius: 10px;
  padding: 10px 20px;
  font-weight: 700;
  cursor: pointer;
}
.saved-note { color: #22C55E; font-size: 12px; }
</style>
```

Add the route in `src/router/index.ts`, inside the `/settings` children array (near line 45):

```ts
        { path: 'discount-caps', component: () => import('@/features/pos/DiscountCapsSettingsScreen.vue') },
```

Add the nav row in `src/pages/SettingsPage.vue`, following the exact structure of the `staff` nav-row button (lines 95-111) — copy that button block, change the route to `/settings/discount-caps`, the label to `حدود الخصم`, and reuse any existing "percent/discount" icon already in the codebase's icon set (search `src/components` for one before drawing a new SVG path).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/pos/__tests__/DiscountCapsSettingsScreen.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/pos/DiscountCapsSettingsScreen.vue src/features/pos/__tests__/DiscountCapsSettingsScreen.test.ts src/router/index.ts src/pages/SettingsPage.vue
git commit -m "feat(WAFI-100): add owner-only discount-caps settings screen"
```

---

### Task 11: Returns regression test — confirm net (discounted) refund

**Files:**
- Modify: `src/features/returns/composables/__tests__/useReturnSheet.test.ts` (existing file — locate it first; if it doesn't exist yet, create it following the mocking pattern of `usePayment.test.ts`)

**Interfaces:**
- No new interfaces — this task only adds a regression test proving the existing behavior (documented in the Task 1 investigation: `useReturnSheet.ts:59-65` reads `sli.unit_price_usd` directly, which Task 8 now writes as the already-net price) is correct for discounted lines. No production code change is expected; if the test fails, that means an assumption in this plan was wrong and the discrepancy must be fixed in `useReturnSheet.ts` before proceeding — do not silently adjust the test to match wrong behavior.

- [ ] **Step 1: Write the test**

```ts
it('refunds the net (post-discount) unit price, not the list price', async () => {
  // Arrange: mock db.execute/getAll so the sale-lookup query returns a
  // sale_line_items row with unit_price_usd = 8 (a $10 list price item sold
  // at a 20% discount) — mirror this file's existing db mocking style.
  // ... existing file's mock setup, with the line row's unit_price_usd set to 8 ...

  const sheet = useReturnSheet('sale-1')
  await sheet.load()
  sheet.lines.value[0].selected = true

  expect(sheet.refundTotalUsd.value).toBeCloseTo(8, 2) // NOT 10 (list price)
})
```

- [ ] **Step 2: Run test to verify it currently passes (this is a characterization test, not a new-feature test)**

Run: `npx vitest run src/features/returns/composables/__tests__/useReturnSheet.test.ts`
Expected: PASS immediately — `useReturnSheet.ts` already reads `unit_price_usd` as-is with no re-derivation from list price, so once Task 8 writes the net price there, this is correct by construction. If it fails, stop and investigate `useReturnSheet.ts` before continuing to Task 12.

- [ ] **Step 3: Commit**

```bash
git add src/features/returns/composables/__tests__/useReturnSheet.test.ts
git commit -m "test(WAFI-100): confirm returns refund the net discounted price"
```

---

### Task 12: Full offline sale → return → Z-report cycle test

**Files:**
- Create: `src/__tests__/integration/wafi100-discount-cycle.test.ts`

**Interfaces:**
- Consumes everything from Tasks 2, 4, 5, 8, 9, 11 together — this is the Definition-of-Done integration test the ticket requires. This repo has no real in-memory SQLite test double: `src/__tests__/__mocks__/db.ts` is a shared `vi.fn()`-based mock (`execute`, `getAll`, `getOptional`, `writeTransaction` all resolve to canned values) that every existing test configures per-call via `mockResolvedValueOnce`/`mockImplementationOnce`. This test follows that same shape — it is "integration" in the sense of driving the real `useSale`/`usePayment`/`useReturnSheet`/`useZReport` composables together in one test rather than each in isolation, not in the sense of hitting a real database.

- [ ] **Step 1: Write the test**

```ts
// src/__tests__/integration/wafi100-discount-cycle.test.ts
//
// Drives the real composables together end-to-end against the shared mock
// db (src/__tests__/__mocks__/db.ts), proving the discount fields survive
// the full sale -> return -> Z-report path. Mirror the mocking conventions
// already used by src/__tests__/features/usePayment.test.ts and
// src/features/shifts/composables/__tests__/useZReport.test.ts (both already
// configure the shared db mock's calls in sequence) rather than inventing a
// new mocking style.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/data/powersync/db'   // resolves to src/__tests__/__mocks__/db.ts via vitest config
import { useSaleStore } from '@/store/sale.store'
import { useSessionStore } from '@/store/session.store'
import { useShiftStore } from '@/features/shifts/shift.store'
import { usePayment } from '@/features/payment/usePayment'
import { useReturnSheet } from '@/features/returns/composables/useReturnSheet'
import { useZReport } from '@/features/shifts/composables/useZReport'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('WAFI-100 discount cycle', () => {
  it('sale discount -> completed sale -> return -> Z-report totals reconcile', async () => {
    const saleStore    = useSaleStore()
    const sessionStore = useSessionStore()
    const shiftStore   = useShiftStore()

    sessionStore.setActiveStaff({
      id: 'staff-1', shopId: 'shop-1', name: 'Cashier', pinHash: '', pinSalt: null,
      role: 'cashier', isActive: true, createdAt: '',
      permissions: { can_view_reports: false, can_manage_products: false, can_manage_customers: false, can_view_expenses: false, can_manage_settings: false },
    })
    // useShiftStore's activeShiftId is whatever field the real store exposes
    // for "shift currently open" — read src/features/shifts/shift.store.ts
    // to confirm the exact property name/shape rather than guessing here,
    // and set it directly (this is a Pinia store under test, not the DB).

    saleStore.addLine({
      productId: 'p1', nameAr: 'قلم', quantity: 1,
      unitPriceUsd: 10, unitCostUsd: 4, lineTotalUsd: 10,
      availableStock: 10, listPriceUsd: 10,
    })
    saleStore.setLockedRate(1)
    saleStore.applyLineDiscount('p1', { type: 'percent', value: 10 }) // net line = 9

    // db.execute (writeTransaction's inner tx.execute) just resolves to an
    // empty rows array by default per the shared mock — no special
    // configuration needed for the INSERTs themselves. The cost/stock SELECT
    // inside usePayment.confirm() needs one queued response:
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn) => {
      const tx = {
        execute: vi.fn().mockResolvedValue({ rows: { _array: [{ cost_price_usd: 4, current_stock: 10 }] } }),
      }
      await fn(tx as any)
    })

    const payment = usePayment()
    payment.selectMethod('cash_usd')
    payment.amountReceived.value = 9
    const completed = await payment.confirm()

    expect(completed.lines[0].discountAmountUsd === undefined ? undefined : completed.lines[0].discountType).toBe('percent')

    // Return: mock the sale/line lookup usePayment's sibling composable needs.
    vi.mocked(db.execute).mockResolvedValueOnce({ rows: { _array: [{ id: completed.saleId, display_sale_number: completed.displaySaleNumber, customer_id: null, customer_name: null }] } } as any)
    vi.mocked(db.execute).mockResolvedValueOnce({ rows: { _array: [{ rate: 1 }] } } as any)
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { product_id: 'p1', product_name: 'قلم', quantity: 1, unit_price_usd: 9 },
    ] as any)
    vi.mocked(db.getAll).mockResolvedValueOnce([] as any) // no prior returns

    const returnSheet = useReturnSheet(completed.saleId)
    await returnSheet.load()
    expect(returnSheet.lines.value[0].unitPriceUsd).toBe(9) // net, not list price 10
    returnSheet.lines.value[0].selected = true

    // Z-report: configure the discount-sum query (Task 9) to return the
    // discount given, matching the sequence this repo's useZReport test uses.
    // Read src/features/shifts/composables/__tests__/useZReport.test.ts's
    // existing "computes metrics" test to copy its exact db.getOptional/
    // db.getAll call sequence, appending the new discount query's mocked
    // response at the correct position (see Task 9, Step 1's ordering note).
    const zReport = useZReport()
    // ... configure remaining mocked calls per the existing test's pattern ...
    // const metrics = await zReport.compute(shift, closingCashUsd, closingCashSyp)
    // expect(metrics.totalDiscountsUsd).toBeCloseTo(1, 2) // 10% of $10 = $1
  })
})
```

Because the exact `db.getOptional`/`db.getAll` call ORDER inside `useZReport.compute()` is positional (Task 9 appends one new query to an existing `Promise.all` array), the implementer must finish wiring the Z-report portion of this test by copying the precise mock sequence from `useZReport.test.ts`'s own "computes metrics" test rather than guessing the order here — get that file's existing test passing first (Task 9), then reuse its exact mock list in this integration test.

- [ ] **Step 2: Run the test and iterate until it passes**

Run: `npx vitest run src/__tests__/integration/wafi100-discount-cycle.test.ts`
Expected: PASS once the real composables are wired against a real fake-db instance

- [ ] **Step 3: Run the FULL test suite to check for regressions**

Run: `npm run test -- --run`
Expected: all tests pass (matching the "~933 passed" baseline this branch started from before WAFI-100)

- [ ] **Step 4: Run the production build**

Run: `npm run build`
Expected: succeeds with no TypeScript errors (this repo's build type-checks the whole project including tests)

- [ ] **Step 5: Commit**

```bash
git add src/__tests__/integration/wafi100-discount-cycle.test.ts
git commit -m "test(WAFI-100): add full offline sale->return->Z-report discount cycle test"
```

---

## Explicitly out of scope for this plan (flagged, not silently dropped)

- **WAFI-110 two-tier pricing integration**: this plan's cap-check uses retail list price as "tier price in effect" per the approved design. When WAFI-110 lands, `applyLineDiscount`'s `base` must switch from `listPriceUsd` to the active tier price — noted as a follow-up in the WAFI-110 ticket, not handled here.
- **`scalePricesToTotal`** (fast-cash overpay path in `sale.store.ts`) is left untouched by this plan, per the open question flagged in the design spec — it still directly rewrites `unitPriceUsd`/`lineTotalUsd` without going through the new discount fields. This means a fast-cash overpay after a discount was applied will silently clear that line's `discountType`/`discountValue`/`discountAmountUsd` fields (since it never sets them) while leaving the *price* changed — a small drift between displayed discount and actual price that should be tracked as a fast-follow ticket, not fixed silently inside this plan.
- **Approver-picker UI layout** in Task 6 (the list of owner/manager staff shown before the PIN pad) is specified at the logic/composable level (`useStaff`, `verifyPin`, `approverCandidate`) but its exact markup is left to mirror `LockScreen.vue`'s existing staff-picker step rather than being redrawn here, since duplicating that layout verbatim would drift from the real component the moment either one is restyled.
