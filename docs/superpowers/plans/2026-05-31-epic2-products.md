# Epic 2 — Manage Products & Track Stock: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add product CRUD, barcode scanning on the product list, automatic stock deduction on sale, and low-stock alerts on the home screen.

**Architecture:** Feature-first — new `src/features/products/` folder owns all product management UI and logic. A Back Office hub page at `/back-office` links to Products (and future modules). The existing PowerSync `products` table is extended in-place; a new `stock_adjustments` table is added. Stock deduction is wired into the existing `usePayment.ts` confirm flow.

**Tech Stack:** Vue 3 + TypeScript + Tailwind, PowerSync (`db.execute`, `db.getAll`, `db.writeTransaction`), Vitest + `@vue/test-utils`, `uuid` for UUIDs, Canvas API for WebP photo compression, `@zxing/browser` (already installed) for camera barcode scan.

---

## File Map

**Create:**
- `src/features/products/product.types.ts` — `AdjustmentReason`, `StockAdjustment` types
- `src/features/products/composables/useProducts.ts` — all DB reads/writes for products
- `src/features/products/composables/useLowStockAlerts.ts` — reactive low-stock query for home screen
- `src/features/products/composables/useStockAdjustment.ts` — dialog UI state (open/close, reason, notes)
- `src/features/products/components/ProductPhotoUpload.vue` — camera/upload + WebP compression to 200KB
- `src/features/products/components/StockAdjustmentDialog.vue` — reason-capture modal
- `src/features/products/components/ProductForm.vue` — add/edit form (mode prop)
- `src/features/products/components/ProductList.vue` — phone card list + desktop table
- `src/features/products/BackOfficePage.vue` — 2×2 nav launcher hub
- `src/features/products/ProductsPage.vue` — wraps ProductList + search + FAB
- `src/features/products/AddProductPage.vue` — thin page wrapper (add mode)
- `src/features/products/EditProductPage.vue` — thin page wrapper (edit mode)
- `src/__tests__/features/useProducts.test.ts`
- `src/__tests__/features/useStockAdjustment.test.ts`
- `src/__tests__/features/ProductForm.test.ts`
- `src/__tests__/features/ProductList.test.ts`

**Modify:**
- `src/data/powersync/schema.ts` — extend `products`, add `stock_adjustments`
- `src/features/pos/pos.types.ts` — add missing fields to `Product` interface
- `src/router/index.ts` — add `/back-office`, `/products`, `/products/add`, `/products/:id/edit`
- `src/components/ui/AppHeader.vue` — add `showBackOffice` prop + grid icon link
- `src/features/payment/usePayment.ts` — add stock deduction in `confirm()`
- `src/pages/HomePage.vue` — add low-stock card wired to `useLowStockAlerts`
- `src/__tests__/features/usePayment.test.ts` — extend with stock deduction assertion

---

## Task 1: Extend schema — products table + stock_adjustments table

**Files:**
- Modify: `src/data/powersync/schema.ts`

- [ ] **Step 1: Update schema**

Replace the file contents of `src/data/powersync/schema.ts`:

```ts
import { column, Schema, Table } from '@powersync/web'

const products = new Table({
  shop_id:             column.text,
  name_ar:             column.text,
  name_en:             column.text,
  price_usd:           column.real,   // sale price — kept for POS backward compat
  cost_price_usd:      column.real,
  barcode:             column.text,
  category:            column.text,
  photo_url:           column.text,
  current_stock:       column.integer,
  low_stock_threshold: column.integer,
  is_active:           column.integer,
  deleted:             column.integer,
  sync_status:         column.text,
  created_at:          column.text,
  updated_at:          column.text,
})

const stock_adjustments = new Table({
  product_id: column.text,
  old_value:  column.integer,
  new_value:  column.integer,
  reason:     column.text,   // stocktake | damaged | lost | other | sale
  notes:      column.text,
  created_at: column.text,
  device_id:  column.text,
})

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
})

const sale_line_items = new Table({
  sale_id:        column.text,
  shop_id:        column.text,
  product_id:     column.text,
  quantity:       column.integer,
  unit_price_usd: column.real,
  line_total_usd: column.real,
})

const exchange_rates = new Table({
  shop_id:   column.text,
  device_id: column.text,
  rate:      column.real,
  set_at:    column.text,
  set_by:    column.text,
})

export const AppSchema = new Schema({
  products,
  stock_adjustments,
  sales,
  sale_line_items,
  exchange_rates,
})
```

- [ ] **Step 2: Verify no TypeScript errors**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/data/powersync/schema.ts
git commit -m "feat(schema): extend products table, add stock_adjustments"
```

---

## Task 2: Update Product type + add AdjustmentReason / StockAdjustment types

**Files:**
- Modify: `src/features/pos/pos.types.ts`
- Create: `src/features/products/product.types.ts`

- [ ] **Step 1: Update Product interface**

Replace `src/features/pos/pos.types.ts`:

```ts
export interface Product {
  id:                 string
  shopId:             string
  nameAr:             string
  nameEn?:            string
  salePriceUsd:       number   // stored as price_usd in DB
  costPriceUsd:       number
  barcode?:           string
  category?:          string
  photoUrl?:          string
  currentStock:       number
  lowStockThreshold:  number
  isActive:           boolean
  createdAt:          string
  updatedAt:          string
}
```

- [ ] **Step 2: Create product.types.ts**

Create `src/features/products/product.types.ts`:

```ts
export type AdjustmentReason = 'stocktake' | 'damaged' | 'lost' | 'other' | 'sale'

export interface StockAdjustment {
  id:        string
  productId: string
  oldValue:  number
  newValue:  number
  reason:    AdjustmentReason
  notes?:    string
  createdAt: string
  deviceId:  string
}
```

- [ ] **Step 3: Fix broken references from Product field rename**

`useSale.ts` references `price_usd` from DB (fine — that's the column name) but the mapped object uses `priceUsd`. Search for any TypeScript usage of `priceUsd` in the codebase:

Run: `npx grep -r "priceUsd" src --include="*.ts" --include="*.vue"`

Fix any references: rename `priceUsd` → `salePriceUsd` in component/composable code that uses the Product type. The DB column name `price_usd` stays unchanged.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/features/pos/pos.types.ts src/features/products/product.types.ts
git commit -m "feat(types): extend Product interface, add AdjustmentReason + StockAdjustment"
```

---

## Task 3: useProducts composable

**Files:**
- Create: `src/features/products/composables/useProducts.ts`
- Create: `src/__tests__/features/useProducts.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/features/useProducts.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useProducts } from '@/features/products/composables/useProducts'
import { db } from '@/data/powersync/db'

const mockRow = (overrides = {}) => ({
  id: 'p1', shop_id: 's1', name_ar: 'منتج', name_en: null,
  price_usd: 10, cost_price_usd: 7, barcode: null, category: null,
  current_stock: 5, low_stock_threshold: 3, photo_url: null,
  created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
  is_active: 1, deleted: 0, sync_status: 'synced',
  ...overrides,
})

describe('useProducts', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('load populates products from db', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([mockRow()])
    const { products, load } = useProducts()
    await load()
    expect(products.value).toHaveLength(1)
    expect(products.value[0].nameAr).toBe('منتج')
    expect(products.value[0].salePriceUsd).toBe(10)
    expect(products.value[0].costPriceUsd).toBe(7)
    expect(products.value[0].currentStock).toBe(5)
  })

  it('lowStockProducts returns products at or below threshold', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([
      mockRow({ id: 'p1', current_stock: 2, low_stock_threshold: 5 }),
      mockRow({ id: 'p2', current_stock: 10, low_stock_threshold: 5 }),
    ])
    const { lowStockProducts, load } = useProducts()
    await load()
    expect(lowStockProducts.value).toHaveLength(1)
    expect(lowStockProducts.value[0].id).toBe('p1')
  })

  it('save calls INSERT for a new product (no id)', async () => {
    vi.mocked(db.getAll).mockResolvedValue([])
    const { save } = useProducts()
    await save({
      shopId: 's1', nameAr: 'جديد', salePriceUsd: 10, costPriceUsd: 7,
      currentStock: 20, lowStockThreshold: 5, isActive: true,
      createdAt: '', updatedAt: '',
    })
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO products'),
      expect.any(Array)
    )
  })

  it('save calls UPDATE for an existing product (has id)', async () => {
    vi.mocked(db.getAll).mockResolvedValue([])
    const { save } = useProducts()
    await save({
      id: 'p1', shopId: 's1', nameAr: 'معدّل', salePriceUsd: 12, costPriceUsd: 8,
      currentStock: 20, lowStockThreshold: 5, isActive: true,
      createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
    })
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE products'),
      expect.any(Array)
    )
  })

  it('softDelete sets deleted = 1', async () => {
    vi.mocked(db.getAll).mockResolvedValue([])
    const { softDelete } = useProducts()
    await softDelete('p1')
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('deleted = 1'),
      expect.arrayContaining(['p1'])
    )
  })

  it('adjustStock uses writeTransaction', async () => {
    vi.mocked(db.getAll).mockResolvedValue([])
    const { adjustStock } = useProducts()
    await adjustStock('p1', 8, 'stocktake')
    expect(db.writeTransaction).toHaveBeenCalled()
  })

  it('getById returns product by id after load', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([mockRow({ id: 'p1' })])
    const { getById, load } = useProducts()
    await load()
    expect(getById('p1')?.id).toBe('p1')
    expect(getById('missing')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify tests fail**

Run: `npx vitest run src/__tests__/features/useProducts.test.ts`
Expected: FAIL — `Cannot find module '@/features/products/composables/useProducts'`

- [ ] **Step 3: Implement useProducts**

Create `src/features/products/composables/useProducts.ts`:

```ts
import { ref, computed } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import type { Product } from '@/features/pos/pos.types'
import type { AdjustmentReason } from '@/features/products/product.types'

type ProductRow = {
  id: string; shop_id: string; name_ar: string; name_en: string | null
  price_usd: number; cost_price_usd: number; barcode: string | null
  category: string | null; current_stock: number; low_stock_threshold: number
  photo_url: string | null; created_at: string; updated_at: string
  is_active: number; deleted: number; sync_status: string
}

function rowToProduct(r: ProductRow): Product {
  return {
    id: r.id, shopId: r.shop_id, nameAr: r.name_ar,
    nameEn: r.name_en ?? undefined, salePriceUsd: r.price_usd,
    costPriceUsd: r.cost_price_usd ?? 0, barcode: r.barcode ?? undefined,
    category: r.category ?? undefined, photoUrl: r.photo_url ?? undefined,
    currentStock: r.current_stock ?? 0, lowStockThreshold: r.low_stock_threshold ?? 5,
    isActive: r.is_active === 1, createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

export function useProducts() {
  const products = ref<Product[]>([])

  const lowStockProducts = computed(() =>
    products.value.filter(p => p.currentStock <= p.lowStockThreshold)
  )

  async function load() {
    const rows = await db.getAll<ProductRow>(
      'SELECT * FROM products WHERE deleted = 0 OR deleted IS NULL ORDER BY name_ar'
    )
    products.value = rows.map(rowToProduct)
  }

  function getById(id: string): Product | undefined {
    return products.value.find(p => p.id === id)
  }

  async function save(data: Partial<Product> & { shopId: string; nameAr: string; salePriceUsd: number; costPriceUsd: number; currentStock: number; lowStockThreshold: number; isActive: boolean }) {
    const now = new Date().toISOString()
    if (data.id) {
      await db.execute(
        `UPDATE products SET name_ar=?, name_en=?, barcode=?, category=?,
         price_usd=?, cost_price_usd=?, current_stock=?, low_stock_threshold=?,
         photo_url=?, updated_at=?, sync_status='pending' WHERE id=?`,
        [data.nameAr, data.nameEn ?? null, data.barcode ?? null, data.category ?? null,
         data.salePriceUsd, data.costPriceUsd, data.currentStock, data.lowStockThreshold,
         data.photoUrl ?? null, now, data.id]
      )
    } else {
      const id = uuidv4()
      await db.execute(
        `INSERT INTO products
         (id, shop_id, name_ar, name_en, barcode, category, price_usd, cost_price_usd,
          current_stock, low_stock_threshold, photo_url, is_active, deleted,
          sync_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 'pending', ?, ?)`,
        [id, data.shopId, data.nameAr, data.nameEn ?? null, data.barcode ?? null,
         data.category ?? null, data.salePriceUsd, data.costPriceUsd,
         data.currentStock, data.lowStockThreshold, data.photoUrl ?? null, now, now]
      )
    }
    await load()
  }

  async function softDelete(id: string) {
    await db.execute(
      `UPDATE products SET deleted = 1, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
      [new Date().toISOString(), id]
    )
    await load()
  }

  async function adjustStock(
    productId: string,
    newValue: number,
    reason: AdjustmentReason,
    notes?: string
  ) {
    const device = useDeviceStore()
    const old = products.value.find(p => p.id === productId)
    const oldValue = old?.currentStock ?? 0
    const now = new Date().toISOString()

    await db.writeTransaction(async (tx) => {
      await tx.execute(
        `UPDATE products SET current_stock = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
        [newValue, now, productId]
      )
      await tx.execute(
        `INSERT INTO stock_adjustments (id, product_id, old_value, new_value, reason, notes, created_at, device_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuidv4(), productId, oldValue, newValue, reason, notes ?? null, now, device.deviceId]
      )
    })

    await load()
  }

  return { products, lowStockProducts, load, getById, save, softDelete, adjustStock }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/features/useProducts.test.ts`
Expected: 7 passing

- [ ] **Step 5: Commit**

```bash
git add src/features/products/composables/useProducts.ts src/__tests__/features/useProducts.test.ts
git commit -m "feat(products): add useProducts composable with CRUD + stock adjustment"
```

---

## Task 3b: Extract shared rowToProduct helper

**Files:**
- Create: `src/features/products/product.utils.ts`
- Modify: `src/features/products/composables/useProducts.ts` (import from utils, remove local copy)

- [ ] **Step 1: Create shared util**

Create `src/features/products/product.utils.ts`:

```ts
import type { Product } from '@/features/pos/pos.types'

export type ProductRow = {
  id: string; shop_id: string; name_ar: string; name_en: string | null
  price_usd: number; cost_price_usd: number; barcode: string | null
  category: string | null; current_stock: number; low_stock_threshold: number
  photo_url: string | null; created_at: string; updated_at: string
  is_active: number; deleted: number; sync_status: string
}

export function rowToProduct(r: ProductRow): Product {
  return {
    id: r.id, shopId: r.shop_id, nameAr: r.name_ar,
    nameEn: r.name_en ?? undefined, salePriceUsd: r.price_usd,
    costPriceUsd: r.cost_price_usd ?? 0, barcode: r.barcode ?? undefined,
    category: r.category ?? undefined, photoUrl: r.photo_url ?? undefined,
    currentStock: r.current_stock ?? 0, lowStockThreshold: r.low_stock_threshold ?? 5,
    isActive: r.is_active === 1, createdAt: r.created_at, updatedAt: r.updated_at,
  }
}
```

- [ ] **Step 2: Update useProducts.ts to import from utils**

At the top of `src/features/products/composables/useProducts.ts`, replace the local `ProductRow` type definition and `rowToProduct` function with:

```ts
import { rowToProduct, type ProductRow } from '@/features/products/product.utils'
```

Remove the `type ProductRow = { ... }` block and the `function rowToProduct(r: ProductRow): Product { ... }` function from the file.

- [ ] **Step 3: Verify**

Run: `npx vitest run src/__tests__/features/useProducts.test.ts`
Expected: all 7 tests still pass

- [ ] **Step 4: Commit**

```bash
git add src/features/products/product.utils.ts src/features/products/composables/useProducts.ts
git commit -m "refactor(products): extract rowToProduct to shared product.utils"
```

---

## Task 4: useLowStockAlerts composable

**Files:**
- Create: `src/features/products/composables/useLowStockAlerts.ts`

- [ ] **Step 1: Implement**

Create `src/features/products/composables/useLowStockAlerts.ts`:

```ts
import { ref, computed } from 'vue'
import { db } from '@/data/powersync/db'
import { rowToProduct, type ProductRow } from '@/features/products/product.utils'

export function useLowStockAlerts() {
  const items = ref<Product[]>([])
  const count = computed(() => items.value.length)
  const top3  = computed(() => items.value.slice(0, 3))
  const allClear = computed(() => items.value.length === 0)

  async function load() {
    const rows = await db.getAll<ProductRow>(
      `SELECT * FROM products
       WHERE (deleted = 0 OR deleted IS NULL)
         AND current_stock <= low_stock_threshold
       ORDER BY (low_stock_threshold - current_stock) DESC`
    )
    items.value = rows.map(rowToProduct)
  }

  return { items, count, top3, allClear, load }
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/features/products/composables/useLowStockAlerts.ts
git commit -m "feat(products): add useLowStockAlerts composable"
```

---

## Task 5: useStockAdjustment composable

**Files:**
- Create: `src/features/products/composables/useStockAdjustment.ts`
- Create: `src/__tests__/features/useStockAdjustment.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/features/useStockAdjustment.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { useStockAdjustment } from '@/features/products/composables/useStockAdjustment'

describe('useStockAdjustment', () => {
  it('starts closed', () => {
    const { isOpen } = useStockAdjustment()
    expect(isOpen.value).toBe(false)
  })

  it('open sets pending values and shows dialog', () => {
    const { isOpen, pendingProductId, pendingOldValue, pendingNewValue, pendingProductName, open } =
      useStockAdjustment()
    open('p1', 'كابل HDMI', 10, 8)
    expect(isOpen.value).toBe(true)
    expect(pendingProductId.value).toBe('p1')
    expect(pendingProductName.value).toBe('كابل HDMI')
    expect(pendingOldValue.value).toBe(10)
    expect(pendingNewValue.value).toBe(8)
  })

  it('cancel closes dialog', () => {
    const { isOpen, open, cancel } = useStockAdjustment()
    open('p1', 'منتج', 10, 8)
    cancel()
    expect(isOpen.value).toBe(false)
  })

  it('open resets reason to stocktake and clears notes', () => {
    const { reason, notes, open } = useStockAdjustment()
    reason.value = 'damaged'
    notes.value  = 'ملاحظة'
    open('p1', 'منتج', 10, 8)
    expect(reason.value).toBe('stocktake')
    expect(notes.value).toBe('')
  })
})
```

- [ ] **Step 2: Run to verify tests fail**

Run: `npx vitest run src/__tests__/features/useStockAdjustment.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

Create `src/features/products/composables/useStockAdjustment.ts`:

```ts
import { ref } from 'vue'
import type { AdjustmentReason } from '@/features/products/product.types'

export function useStockAdjustment() {
  const isOpen             = ref(false)
  const reason             = ref<AdjustmentReason>('stocktake')
  const notes              = ref('')
  const pendingProductId   = ref<string | null>(null)
  const pendingProductName = ref('')
  const pendingOldValue    = ref(0)
  const pendingNewValue    = ref(0)

  function open(productId: string, productName: string, oldValue: number, newValue: number) {
    pendingProductId.value   = productId
    pendingProductName.value = productName
    pendingOldValue.value    = oldValue
    pendingNewValue.value    = newValue
    reason.value             = 'stocktake'
    notes.value              = ''
    isOpen.value             = true
  }

  function cancel() {
    isOpen.value = false
  }

  return { isOpen, reason, notes, pendingProductId, pendingProductName, pendingOldValue, pendingNewValue, open, cancel }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/features/useStockAdjustment.test.ts`
Expected: 4 passing

- [ ] **Step 5: Commit**

```bash
git add src/features/products/composables/useStockAdjustment.ts src/__tests__/features/useStockAdjustment.test.ts
git commit -m "feat(products): add useStockAdjustment dialog state composable"
```

---

## Task 6: Router + AppHeader + BackOfficePage

**Files:**
- Modify: `src/router/index.ts`
- Modify: `src/components/ui/AppHeader.vue`
- Create: `src/features/products/BackOfficePage.vue`

- [ ] **Step 1: Add routes**

Replace `src/router/index.ts`:

```ts
import { createRouter, createWebHistory } from 'vue-router'

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/',                  component: () => import('@/pages/HomePage.vue') },
    { path: '/pos',               component: () => import('@/pages/PosPage.vue') },
    { path: '/pos/confirmation',  component: () => import('@/features/pos/SaleConfirmationScreen.vue') },
    { path: '/history',           component: () => import('@/pages/SaleHistoryPage.vue') },
    { path: '/back-office',       component: () => import('@/features/products/BackOfficePage.vue') },
    { path: '/products',          component: () => import('@/features/products/ProductsPage.vue') },
    { path: '/products/add',      component: () => import('@/features/products/AddProductPage.vue') },
    { path: '/products/:id/edit', component: () => import('@/features/products/EditProductPage.vue') },
    {
      path: '/settings',
      component: () => import('@/pages/SettingsPage.vue'),
      children: [
        { path: 'personal', component: () => import('@/features/settings/screens/PersonalPreferencesScreen.vue') },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
})
```

- [ ] **Step 2: Add Back Office icon to AppHeader**

In `src/components/ui/AppHeader.vue`, add a `showBackOffice` prop (defaults to `true`) and insert a grid icon link to `/back-office` alongside the gear icon. Add `data-testid="back-office-link"` for testability.

Replace the `<script setup>` block:

```vue
<script setup lang="ts">
import SyncIndicator      from '@/features/sync/SyncIndicator.vue'
import ExchangeRateWidget from '@/features/exchange-rate/ExchangeRateWidget.vue'
import ExchangeRateEditor from '@/features/exchange-rate/ExchangeRateEditor.vue'
import { ref } from 'vue'

withDefaults(defineProps<{
  title:              string
  showExchangeRate?:  boolean
  showBack?:          boolean
  showSettings?:      boolean
  showBackOffice?:    boolean
}>(), {
  showSettings:   true,
  showBackOffice: true,
})

const emit = defineEmits<{ (e: 'back'): void }>()
const editorOpen = ref(false)
</script>
```

In the template, inside the right-side `<div class="flex items-center gap-2">`, add the grid icon after the gear icon `<RouterLink>`:

```html
<RouterLink
  v-if="showBackOffice"
  to="/back-office"
  data-testid="back-office-link"
  class="text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white
         hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg
         min-w-[44px] min-h-[44px] flex items-center justify-center"
  aria-label="الإدارة الخلفية"
>
  <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
    <path stroke-linecap="round" stroke-linejoin="round"
      d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6z" />
    <path stroke-linecap="round" stroke-linejoin="round"
      d="M14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6z" />
    <path stroke-linecap="round" stroke-linejoin="round"
      d="M4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2z" />
    <path stroke-linecap="round" stroke-linejoin="round"
      d="M14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
  </svg>
</RouterLink>
```

- [ ] **Step 3: Create BackOfficePage**

Create `src/features/products/BackOfficePage.vue`:

```vue
<script setup lang="ts">
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'

const router = useRouter()

const modules = [
  { key: 'products', label: 'المنتجات', icon: '📦', route: '/products', active: true },
  { key: 'reports',  label: 'التقارير',  icon: '📊', route: null, active: false },
  { key: 'expenses', label: 'المصاريف', icon: '💰', route: null, active: false },
  { key: 'shifts',   label: 'الكاشيرات', icon: '👥', route: null, active: false },
]

function handleTile(mod: typeof modules[number]) {
  if (mod.route) router.push(mod.route)
}
</script>

<template>
  <div class="flex flex-col min-h-dvh" dir="rtl">
    <AppHeader title="الإدارة الخلفية" :show-back-office="false" />

    <main class="flex-1 px-4 py-6 max-w-lg mx-auto w-full">
      <div class="grid grid-cols-2 gap-4">
        <button
          v-for="mod in modules"
          :key="mod.key"
          type="button"
          :data-testid="`tile-${mod.key}`"
          :disabled="!mod.active"
          class="rounded-2xl p-6 flex flex-col items-center gap-2 text-center transition-all"
          :class="mod.active
            ? 'bg-blue-600 text-white shadow-md active:scale-95'
            : 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed'"
          @click="handleTile(mod)"
        >
          <span class="text-3xl">{{ mod.icon }}</span>
          <span class="text-sm font-semibold">{{ mod.label }}</span>
          <span v-if="!mod.active" class="text-xs opacity-60">قريباً</span>
        </button>
      </div>
    </main>
  </div>
</template>
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors, all existing tests still pass

- [ ] **Step 5: Commit**

```bash
git add src/router/index.ts src/components/ui/AppHeader.vue src/features/products/BackOfficePage.vue
git commit -m "feat(nav): add Back Office hub page, routes, and header icon"
```

---

## Task 7: ProductPhotoUpload component

**Files:**
- Create: `src/features/products/components/ProductPhotoUpload.vue`

- [ ] **Step 1: Implement**

Create `src/features/products/components/ProductPhotoUpload.vue`:

```vue
<script setup lang="ts">
import { ref } from 'vue'

const emit = defineEmits<{
  (e: 'change', blobUrl: string | null): void
  (e: 'error', message: string): void
}>()

defineProps<{ modelValue?: string | null }>()

const fileInput = ref<HTMLInputElement | null>(null)
const MAX_BYTES = 200 * 1024

async function compressToWebP(file: File): Promise<Blob> {
  const img = new Image()
  const objectUrl = URL.createObjectURL(file)
  img.src = objectUrl
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('load'))
  })
  URL.revokeObjectURL(objectUrl)

  const canvas = document.createElement('canvas')
  const MAX_SIDE = 800
  let { width, height } = img
  if (width > MAX_SIDE || height > MAX_SIDE) {
    if (width >= height) { height = Math.round(height * MAX_SIDE / width); width = MAX_SIDE }
    else                 { width  = Math.round(width  * MAX_SIDE / height); height = MAX_SIDE }
  }
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)

  let quality = 0.85
  let blob!: Blob
  do {
    blob = await new Promise<Blob>(res => canvas.toBlob(b => res(b!), 'image/webp', quality))
    quality -= 0.1
  } while (blob.size > MAX_BYTES && quality > 0.1)

  return blob
}

async function handleFile(file: File) {
  try {
    const blob = await compressToWebP(file)
    if (blob.size > MAX_BYTES) {
      emit('error', 'تعذّر ضغط الصورة — حاول بصورة أخرى')
      return
    }
    emit('change', URL.createObjectURL(blob))
  } catch {
    emit('error', 'تعذّر ضغط الصورة — حاول بصورة أخرى')
  }
}

function handleInputChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) handleFile(file)
}

function clear() {
  emit('change', null)
  if (fileInput.value) fileInput.value.value = ''
}
</script>

<template>
  <div>
    <div
      v-if="modelValue"
      class="relative w-24 h-24 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700"
    >
      <img :src="modelValue" alt="صورة المنتج" class="w-full h-full object-cover" />
      <button
        type="button"
        class="absolute top-1 left-1 bg-black/50 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs"
        aria-label="حذف الصورة"
        @click="clear"
      >✕</button>
    </div>

    <label
      v-else
      class="flex flex-col items-center justify-center gap-2 w-full border-2 border-dashed
             border-gray-300 dark:border-gray-600 rounded-xl p-6 cursor-pointer
             hover:border-blue-400 transition-colors text-gray-400 dark:text-gray-500"
    >
      <span class="text-2xl">📷</span>
      <span class="text-sm">اضغط لإضافة صورة</span>
      <input
        ref="fileInput"
        type="file"
        accept="image/*"
        class="hidden"
        data-testid="photo-input"
        @change="handleInputChange"
      />
    </label>
  </div>
</template>
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/features/products/components/ProductPhotoUpload.vue
git commit -m "feat(products): add ProductPhotoUpload with WebP compression to 200KB"
```

---

## Task 8: StockAdjustmentDialog component

**Files:**
- Create: `src/features/products/components/StockAdjustmentDialog.vue`

- [ ] **Step 1: Implement**

Create `src/features/products/components/StockAdjustmentDialog.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue'
import type { AdjustmentReason } from '@/features/products/product.types'

const props = defineProps<{
  isOpen:       boolean
  productName:  string
  oldValue:     number
  newValue:     number
  reason:       AdjustmentReason
  notes:        string
}>()

const emit = defineEmits<{
  (e: 'update:reason', v: AdjustmentReason): void
  (e: 'update:notes',  v: string): void
  (e: 'confirm'): void
  (e: 'cancel'):  void
}>()

const reasonOptions: { value: AdjustmentReason; label: string }[] = [
  { value: 'stocktake', label: 'جرد (Stocktake)' },
  { value: 'damaged',   label: 'تالف (Damaged)' },
  { value: 'lost',      label: 'مفقود (Lost)' },
  { value: 'other',     label: 'أخرى (Other)' },
]

const canConfirm = computed(() =>
  props.reason !== 'other' || props.notes.trim().length > 0
)
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
      dir="rtl"
      @click.self="emit('cancel')"
    >
      <div class="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl w-full max-w-sm p-6 shadow-xl">
        <h2 class="text-base font-semibold text-gray-900 dark:text-white mb-1">
          سبب تعديل المخزون
        </h2>
        <p class="text-sm text-gray-500 dark:text-gray-400 mb-5">
          {{ productName }}: {{ oldValue }} → {{ newValue }}
        </p>

        <div class="flex flex-col gap-2 mb-5">
          <label
            v-for="opt in reasonOptions"
            :key="opt.value"
            class="flex items-center gap-3 border rounded-xl p-3 cursor-pointer transition-colors"
            :class="reason === opt.value
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
              : 'border-gray-200 dark:border-gray-700'"
          >
            <input
              type="radio"
              :value="opt.value"
              :checked="reason === opt.value"
              :data-testid="`reason-${opt.value}`"
              class="accent-blue-600"
              @change="emit('update:reason', opt.value)"
            />
            <span class="text-sm text-gray-800 dark:text-gray-200">{{ opt.label }}</span>
          </label>
        </div>

        <textarea
          v-if="reason === 'other'"
          :value="notes"
          data-testid="notes-input"
          placeholder="ملاحظات (مطلوبة)"
          rows="2"
          class="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2
                 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 mb-4
                 focus:outline-none focus:ring-2 focus:ring-blue-500"
          @input="emit('update:notes', ($event.target as HTMLTextAreaElement).value)"
        />

        <div class="flex gap-3">
          <button
            type="button"
            data-testid="confirm-btn"
            :disabled="!canConfirm"
            class="flex-1 h-11 rounded-xl text-sm font-semibold text-white bg-blue-600
                   hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            @click="emit('confirm')"
          >تأكيد</button>
          <button
            type="button"
            data-testid="cancel-btn"
            class="h-11 px-5 rounded-xl text-sm text-gray-600 dark:text-gray-300
                   border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
            @click="emit('cancel')"
          >إلغاء</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/features/products/components/StockAdjustmentDialog.vue
git commit -m "feat(products): add StockAdjustmentDialog component"
```

---

## Task 9: ProductForm component

**Files:**
- Create: `src/features/products/components/ProductForm.vue`
- Create: `src/__tests__/features/ProductForm.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/features/ProductForm.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import ProductForm from '@/features/products/components/ProductForm.vue'
import { db } from '@/data/powersync/db'
import type { Product } from '@/features/pos/pos.types'

const router = createRouter({
  history: createMemoryHistory(),
  routes:  [{ path: '/:p(.*)', component: { template: '<div/>' } }],
})

function mountForm(props: Record<string, unknown> = {}) {
  const pinia = createPinia()
  pinia.use(piniaPluginPersistedstate)
  return mount(ProductForm, {
    props: { mode: 'add', ...props },
    global: { plugins: [pinia, router] },
  })
}

const baseProduct: Product = {
  id: 'p1', shopId: 's1', nameAr: 'كابل', salePriceUsd: 10, costPriceUsd: 7,
  currentStock: 5, lowStockThreshold: 3, isActive: true,
  createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
}

describe('ProductForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([])
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
  })

  it('shows required-field error for empty Arabic name on save', async () => {
    const w = mountForm()
    await w.find('[data-testid="save-btn"]').trigger('click')
    expect(w.find('[data-testid="error-name-ar"]').exists()).toBe(true)
  })

  it('shows margin percentage when both prices are set', async () => {
    const w = mountForm()
    await w.find('[data-testid="cost-price"]').setValue('7')
    await w.find('[data-testid="sale-price"]').setValue('10')
    const marginText = w.find('[data-testid="margin-display"]').text()
    expect(marginText).toContain('43%')
  })

  it('shows sale-below-cost warning when sale price < cost price on save', async () => {
    const w = mountForm()
    await w.find('[data-testid="name-ar"]').setValue('منتج')
    await w.find('[data-testid="cost-price"]').setValue('10')
    await w.find('[data-testid="sale-price"]').setValue('7')
    await w.find('[data-testid="current-stock"]').setValue('5')
    await w.find('[data-testid="save-btn"]').trigger('click')
    expect(w.find('[data-testid="price-warning"]').exists()).toBe(true)
  })

  it('pre-fills fields in edit mode', () => {
    const w = mountForm({ mode: 'edit', product: baseProduct })
    const input = w.find('[data-testid="name-ar"]').element as HTMLInputElement
    expect(input.value).toBe('كابل')
    const priceInput = w.find('[data-testid="sale-price"]').element as HTMLInputElement
    expect(priceInput.value).toBe('10')
  })

  it('emits saved event after successful save', async () => {
    const w = mountForm()
    await w.find('[data-testid="name-ar"]').setValue('منتج جديد')
    await w.find('[data-testid="cost-price"]').setValue('5')
    await w.find('[data-testid="sale-price"]').setValue('10')
    await w.find('[data-testid="current-stock"]').setValue('20')
    await w.find('[data-testid="save-btn"]').trigger('click')
    // Wait for async save
    await new Promise(r => setTimeout(r, 10))
    expect(w.emitted('saved')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify tests fail**

Run: `npx vitest run src/__tests__/features/ProductForm.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ProductForm**

Create `src/features/products/components/ProductForm.vue`:

```vue
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useDeviceStore } from '@/store/device.store'
import { useProducts } from '@/features/products/composables/useProducts'
import { useStockAdjustment } from '@/features/products/composables/useStockAdjustment'
import { useBarcodeScan } from '@/composables/useBarcodeScan'
import ProductPhotoUpload from './ProductPhotoUpload.vue'
import StockAdjustmentDialog from './StockAdjustmentDialog.vue'
import type { Product } from '@/features/pos/pos.types'

const props = defineProps<{
  mode:            'add' | 'edit'
  product?:        Product
  initialBarcode?: string   // pre-filled from a failed barcode scan on the product list
}>()

const emit = defineEmits<{
  (e: 'saved'):   void
  (e: 'cancel'):  void
}>()

const device   = useDeviceStore()
const products = useProducts()
const adj      = useStockAdjustment()
const scanner  = useBarcodeScan()

// Form fields
const nameAr       = ref(props.product?.nameAr       ?? '')
const nameEn       = ref(props.product?.nameEn       ?? '')
const barcode      = ref(props.product?.barcode ?? props.initialBarcode ?? '')
const category     = ref(props.product?.category     ?? '')
const costPrice    = ref(props.product?.costPriceUsd ?? '')
const salePrice    = ref(props.product?.salePriceUsd ?? '')
const stock        = ref(props.product?.currentStock ?? '')
const threshold    = ref(props.product?.lowStockThreshold ?? 5)
const photoUrl     = ref<string | null>(props.product?.photoUrl ?? null)

// Track original stock for adjustment dialog
const originalStock = props.product?.currentStock ?? 0

// Validation errors
const errors = ref<Record<string, string>>({})
const priceWarning    = ref(false)
const saving          = ref(false)
const photoErrorMsg   = ref<string | null>(null)

const margin = computed(() => {
  const cost = parseFloat(String(costPrice.value))
  const sale = parseFloat(String(salePrice.value))
  if (!cost || !sale || cost <= 0) return null
  return Math.round(((sale - cost) / sale) * 100)
})

function validate(): boolean {
  const e: Record<string, string> = {}
  if (!nameAr.value.trim()) e['name-ar'] = 'هذا الحقل مطلوب'
  if (costPrice.value === '' || costPrice.value === null) e['cost-price'] = 'هذا الحقل مطلوب'
  if (salePrice.value === '' || salePrice.value === null) e['sale-price'] = 'هذا الحقل مطلوب'
  if (stock.value === '' || stock.value === null) e['current-stock'] = 'هذا الحقل مطلوب'
  errors.value = e
  return Object.keys(e).length === 0
}

async function handleSave(addAnother = false) {
  if (!validate()) return

  const cost = parseFloat(String(costPrice.value))
  const sale = parseFloat(String(salePrice.value))
  if (sale < cost) {
    priceWarning.value = true
    return
  }

  const newStock = parseInt(String(stock.value), 10)

  // In edit mode, if stock changed, open adjustment dialog first
  if (props.mode === 'edit' && props.product && newStock !== originalStock) {
    adj.open(props.product.id, props.product.nameAr, originalStock, newStock)
    return
  }

  await commitSave(newStock, addAnother)
}

async function commitSave(newStock: number, addAnother = false) {
  saving.value = true
  try {
    await products.save({
      ...(props.product?.id ? { id: props.product.id } : {}),
      shopId:           device.shopId,
      nameAr:           nameAr.value.trim(),
      nameEn:           nameEn.value.trim() || undefined,
      barcode:          barcode.value.trim() || undefined,
      category:         category.value.trim() || undefined,
      costPriceUsd:     parseFloat(String(costPrice.value)),
      salePriceUsd:     parseFloat(String(salePrice.value)),
      currentStock:     newStock,
      lowStockThreshold: Number(threshold.value),
      photoUrl:         photoUrl.value ?? undefined,
      isActive:         true,
      createdAt:        props.product?.createdAt ?? '',
      updatedAt:        '',
    })

    if (addAnother) {
      nameAr.value = ''; nameEn.value = ''; barcode.value = ''; category.value = ''
      costPrice.value = ''; salePrice.value = ''; stock.value = ''; threshold.value = 5
      photoUrl.value = null; errors.value = {}; priceWarning.value = false
    } else {
      emit('saved')
    }
  } finally {
    saving.value = false
  }
}

async function handleAdjConfirm() {
  await products.adjustStock(
    adj.pendingProductId.value!,
    adj.pendingNewValue.value,
    adj.reason.value,
    adj.notes.value || undefined
  )
  adj.cancel()
  await commitSave(adj.pendingNewValue.value)
}

onMounted(() => {
  products.load()
  scanner.onScan((code: string) => { barcode.value = code })
})
</script>

<template>
  <div class="flex flex-col gap-6 pb-24" dir="rtl">

    <!-- Basic info section -->
    <div class="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm flex flex-col gap-3">
      <p class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">المعلومات الأساسية</p>

      <div>
        <label class="block text-sm text-gray-700 dark:text-gray-300 mb-1">الاسم بالعربي *</label>
        <input
          v-model="nameAr"
          data-testid="name-ar"
          type="text"
          class="w-full border rounded-xl px-3 py-2 text-sm dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          :class="errors['name-ar'] ? 'border-red-500' : 'border-gray-200 dark:border-gray-600'"
          placeholder="مثال: شاشة سامسونج 55 بوصة"
          @input="delete errors['name-ar']"
        />
        <p v-if="errors['name-ar']" data-testid="error-name-ar" class="text-xs text-red-500 mt-1">{{ errors['name-ar'] }}</p>
      </div>

      <div>
        <label class="block text-sm text-gray-700 dark:text-gray-300 mb-1">الاسم بالإنجليزي</label>
        <input v-model="nameEn" data-testid="name-en" type="text"
          class="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="اختياري" />
      </div>

      <div>
        <label class="block text-sm text-gray-700 dark:text-gray-300 mb-1">الباركود</label>
        <input v-model="barcode" data-testid="barcode" type="text"
          class="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="اختياري" />
      </div>

      <div>
        <label class="block text-sm text-gray-700 dark:text-gray-300 mb-1">الفئة</label>
        <input v-model="category" data-testid="category" type="text"
          class="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="اختياري" />
      </div>
    </div>

    <!-- Pricing section -->
    <div class="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm flex flex-col gap-3">
      <p class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">التسعير</p>

      <div v-if="priceWarning" data-testid="price-warning"
        class="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 rounded-xl px-3 py-2 text-sm text-yellow-800 dark:text-yellow-200">
        سعر البيع أقل من سعر التكلفة — هل أنت متأكد؟
        <div class="flex gap-2 mt-2">
          <button type="button" class="text-xs font-semibold underline" @click="priceWarning = false; commitSave(parseInt(String(stock), 10))">نعم، احفظ</button>
          <button type="button" class="text-xs" @click="priceWarning = false">لا، تراجع</button>
        </div>
      </div>

      <div class="flex gap-3">
        <div class="flex-1">
          <label class="block text-sm text-gray-700 dark:text-gray-300 mb-1">سعر التكلفة $ *</label>
          <input v-model="costPrice" data-testid="cost-price" type="number" min="0" step="0.01"
            class="w-full border rounded-xl px-3 py-2 text-sm dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            :class="errors['cost-price'] ? 'border-red-500' : 'border-gray-200 dark:border-gray-600'"
            @input="delete errors['cost-price']" />
          <p v-if="errors['cost-price']" class="text-xs text-red-500 mt-1">{{ errors['cost-price'] }}</p>
        </div>
        <div class="flex-1">
          <label class="block text-sm text-gray-700 dark:text-gray-300 mb-1">سعر البيع $ *</label>
          <input v-model="salePrice" data-testid="sale-price" type="number" min="0" step="0.01"
            class="w-full border rounded-xl px-3 py-2 text-sm dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            :class="errors['sale-price'] ? 'border-red-500' : 'border-gray-200 dark:border-gray-600'"
            @input="delete errors['sale-price']" />
          <p v-if="errors['sale-price']" class="text-xs text-red-500 mt-1">{{ errors['sale-price'] }}</p>
        </div>
      </div>

      <p v-if="margin !== null" data-testid="margin-display"
        class="text-xs font-medium"
        :class="margin >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'">
        هامش الربح: {{ margin }}%
      </p>
    </div>

    <!-- Inventory section -->
    <div class="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm flex flex-col gap-3">
      <p class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">المخزون</p>
      <div class="flex gap-3">
        <div class="flex-1">
          <label class="block text-sm text-gray-700 dark:text-gray-300 mb-1">الكمية الحالية *</label>
          <input v-model="stock" data-testid="current-stock" type="number" step="1"
            class="w-full border rounded-xl px-3 py-2 text-sm dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            :class="errors['current-stock'] ? 'border-red-500' : 'border-gray-200 dark:border-gray-600'"
            @input="delete errors['current-stock']" />
          <p v-if="errors['current-stock']" class="text-xs text-red-500 mt-1">{{ errors['current-stock'] }}</p>
        </div>
        <div class="flex-1">
          <label class="block text-sm text-gray-700 dark:text-gray-300 mb-1">حد التنبيه</label>
          <input v-model="threshold" data-testid="threshold" type="number" min="0" step="1"
            class="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>
    </div>

    <!-- Photo section -->
    <div class="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm">
      <p class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">الصورة</p>
      <p v-if="photoErrorMsg" class="text-xs text-red-500 mb-2">{{ photoErrorMsg }}</p>
      <ProductPhotoUpload
        :model-value="photoUrl"
        @change="photoUrl = $event"
        @error="photoErrorMsg = $event"
      />
    </div>

    <!-- Action buttons (fixed bottom) -->
    <div class="fixed bottom-0 inset-x-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 px-4 py-3 flex gap-3" dir="rtl">
      <button
        type="button"
        data-testid="save-btn"
        :disabled="saving"
        class="flex-1 h-12 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700
               disabled:opacity-50 transition-colors"
        @click="handleSave(false)"
      >{{ saving ? '...' : 'حفظ' }}</button>

      <button
        v-if="mode === 'add'"
        type="button"
        data-testid="save-another-btn"
        :disabled="saving"
        class="h-12 px-4 rounded-xl text-sm text-gray-700 dark:text-gray-200
               border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"
        @click="handleSave(true)"
      >إضافة آخر</button>

      <button
        type="button"
        data-testid="cancel-btn"
        class="h-12 px-4 rounded-xl text-sm text-gray-600 dark:text-gray-400
               hover:bg-gray-50 dark:hover:bg-gray-800"
        @click="emit('cancel')"
      >إلغاء</button>
    </div>

    <!-- Stock adjustment dialog -->
    <StockAdjustmentDialog
      :is-open="adj.isOpen.value"
      :product-name="adj.pendingProductName.value"
      :old-value="adj.pendingOldValue.value"
      :new-value="adj.pendingNewValue.value"
      :reason="adj.reason.value"
      :notes="adj.notes.value"
      @update:reason="adj.reason.value = $event"
      @update:notes="adj.notes.value = $event"
      @confirm="handleAdjConfirm"
      @cancel="adj.cancel()"
    />
  </div>
</template>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/features/ProductForm.test.ts`
Expected: 5 passing

- [ ] **Step 5: Commit**

```bash
git add src/features/products/components/ProductForm.vue src/__tests__/features/ProductForm.test.ts
git commit -m "feat(products): add ProductForm component with validation and stock adjustment"
```

---

## Task 10: ProductList component

**Files:**
- Create: `src/features/products/components/ProductList.vue`
- Create: `src/__tests__/features/ProductList.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/features/ProductList.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import ProductList from '@/features/products/components/ProductList.vue'
import type { Product } from '@/features/pos/pos.types'

const router = createRouter({
  history: createMemoryHistory(),
  routes:  [{ path: '/:p(.*)', component: { template: '<div/>' } }],
})

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1', shopId: 's1', nameAr: 'منتج', salePriceUsd: 10, costPriceUsd: 7,
    currentStock: 10, lowStockThreshold: 5, isActive: true,
    createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function mountList(products: Product[], filterLowStock = false) {
  const pinia = createPinia()
  pinia.use(piniaPluginPersistedstate)
  return mount(ProductList, {
    props: { products, filterLowStock },
    global: { plugins: [pinia, router] },
  })
}

describe('ProductList', () => {
  it('renders a card for each product', () => {
    const w = mountList([makeProduct({ id: 'p1' }), makeProduct({ id: 'p2', nameAr: 'منتج 2' })])
    expect(w.findAll('[data-testid^="product-card-"]')).toHaveLength(2)
  })

  it('shows yellow low-stock indicator when stock <= threshold', () => {
    const w = mountList([makeProduct({ id: 'p1', currentStock: 2, lowStockThreshold: 5 })])
    expect(w.find('[data-testid="low-stock-badge-p1"]').exists()).toBe(true)
  })

  it('shows stock in red when negative', () => {
    const w = mountList([makeProduct({ id: 'p1', currentStock: -1 })])
    const stockEl = w.find('[data-testid="stock-p1"]')
    expect(stockEl.classes()).toContain('text-red-600')
  })

  it('filters by search query on Arabic name', async () => {
    const products = [
      makeProduct({ id: 'p1', nameAr: 'تفاحة' }),
      makeProduct({ id: 'p2', nameAr: 'برتقال' }),
    ]
    const w = mountList(products)
    await w.find('[data-testid="search"]').setValue('تفاح')
    expect(w.findAll('[data-testid^="product-card-"]')).toHaveLength(1)
  })

  it('filters by filterLowStock prop', () => {
    const products = [
      makeProduct({ id: 'p1', currentStock: 2, lowStockThreshold: 5 }),
      makeProduct({ id: 'p2', currentStock: 10, lowStockThreshold: 5 }),
    ]
    const w = mountList(products, true)
    expect(w.findAll('[data-testid^="product-card-"]')).toHaveLength(1)
  })

  it('emits edit event when product card is tapped', async () => {
    const w = mountList([makeProduct({ id: 'p1' })])
    await w.find('[data-testid="product-card-p1"]').trigger('click')
    expect(w.emitted('edit')).toBeTruthy()
    expect((w.emitted('edit') as string[][])[0][0]).toBe('p1')
  })
})
```

- [ ] **Step 2: Run to verify tests fail**

Run: `npx vitest run src/__tests__/features/ProductList.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ProductList**

Create `src/features/products/components/ProductList.vue`:

```vue
<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Product } from '@/features/pos/pos.types'

const props = defineProps<{
  products:       Product[]
  filterLowStock?: boolean
}>()

const emit = defineEmits<{
  (e: 'edit', id: string): void
  (e: 'delete', id: string): void
}>()

const search = ref('')

const displayed = computed(() => {
  let list = props.filterLowStock
    ? props.products.filter(p => p.currentStock <= p.lowStockThreshold)
    : props.products

  if (search.value.trim()) {
    const q = search.value.trim().toLowerCase()
    list = list.filter(p =>
      p.nameAr.toLowerCase().includes(q) ||
      (p.nameEn ?? '').toLowerCase().includes(q) ||
      (p.barcode ?? '').toLowerCase().includes(q)
    )
  }

  return list
})

function isLowStock(p: Product): boolean {
  return p.currentStock <= p.lowStockThreshold
}
</script>

<template>
  <div dir="rtl">
    <!-- Search bar -->
    <div class="mb-4">
      <input
        v-model="search"
        data-testid="search"
        type="text"
        placeholder="بحث..."
        class="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm
               dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>

    <!-- Empty state -->
    <div
      v-if="!displayed.length"
      class="flex flex-col items-center justify-center py-16 text-gray-400"
    >
      <span class="text-4xl mb-3">📦</span>
      <p class="text-sm">{{ search ? 'لا توجد نتائج' : 'لا توجد منتجات بعد' }}</p>
    </div>

    <!-- Product cards (phone layout) -->
    <div class="flex flex-col gap-3 sm:hidden">
      <div
        v-for="p in displayed"
        :key="p.id"
        :data-testid="`product-card-${p.id}`"
        class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-3 flex items-center gap-3 cursor-pointer active:scale-[0.98] transition-transform"
        :class="isLowStock(p) ? 'bg-yellow-50 dark:bg-yellow-900/10 border border-yellow-200 dark:border-yellow-700' : ''"
        @click="emit('edit', p.id)"
      >
        <!-- Photo thumbnail -->
        <div class="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
          <img v-if="p.photoUrl" :src="p.photoUrl" :alt="p.nameAr" class="w-full h-full object-cover" />
          <span v-else class="text-xl">📦</span>
        </div>

        <!-- Name + barcode -->
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold text-gray-900 dark:text-white truncate">{{ p.nameAr }}</p>
          <p class="text-xs text-gray-400 dark:text-gray-500">{{ p.barcode ?? '—' }}</p>
        </div>

        <!-- Price + stock -->
        <div class="text-left flex-shrink-0">
          <p class="text-sm font-semibold text-blue-600 dark:text-blue-400">${{ p.salePriceUsd }}</p>
          <p
            :data-testid="`stock-${p.id}`"
            class="text-xs font-medium"
            :class="p.currentStock < 0 ? 'text-red-600' : isLowStock(p) ? 'text-yellow-600' : 'text-gray-500'"
          >
            <span v-if="isLowStock(p)" :data-testid="`low-stock-badge-${p.id}`">⚠ </span>
            {{ p.currentStock }}
          </p>
        </div>
      </div>
    </div>

    <!-- Desktop table -->
    <div class="hidden sm:block overflow-x-auto">
      <table class="w-full text-sm text-right">
        <thead>
          <tr class="border-b border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
            <th class="py-3 px-2 font-medium">الاسم</th>
            <th class="py-3 px-2 font-medium">الباركود</th>
            <th class="py-3 px-2 font-medium">التكلفة</th>
            <th class="py-3 px-2 font-medium">البيع</th>
            <th class="py-3 px-2 font-medium">المخزون</th>
            <th class="py-3 px-2 font-medium">الحد</th>
            <th class="py-3 px-2"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="p in displayed"
            :key="p.id"
            :data-testid="`product-card-${p.id}`"
            class="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer"
            :class="isLowStock(p) ? 'bg-yellow-50 dark:bg-yellow-900/10' : ''"
            @click="emit('edit', p.id)"
          >
            <td class="py-3 px-2 font-medium text-gray-900 dark:text-white">
              <span v-if="isLowStock(p)" :data-testid="`low-stock-badge-${p.id}`" class="text-yellow-500 mr-1">⚠</span>
              {{ p.nameAr }}
            </td>
            <td class="py-3 px-2 text-gray-500">{{ p.barcode ?? '—' }}</td>
            <td class="py-3 px-2 text-gray-500">${{ p.costPriceUsd }}</td>
            <td class="py-3 px-2 text-blue-600 dark:text-blue-400">${{ p.salePriceUsd }}</td>
            <td
              :data-testid="`stock-${p.id}`"
              class="py-3 px-2 font-medium"
              :class="p.currentStock < 0 ? 'text-red-600' : isLowStock(p) ? 'text-yellow-600' : 'text-gray-700 dark:text-gray-300'"
            >{{ p.currentStock }}</td>
            <td class="py-3 px-2 text-gray-500">{{ p.lowStockThreshold }}</td>
            <td class="py-3 px-2">
              <button type="button" class="text-xs text-gray-400 hover:text-red-500 px-2 py-1"
                @click.stop="emit('delete', p.id)">حذف</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/features/ProductList.test.ts`
Expected: 6 passing

- [ ] **Step 5: Commit**

```bash
git add src/features/products/components/ProductList.vue src/__tests__/features/ProductList.test.ts
git commit -m "feat(products): add ProductList component with search, low-stock, and negative-stock states"
```

---

## Task 11: ProductsPage, AddProductPage, EditProductPage

**Files:**
- Create: `src/features/products/ProductsPage.vue`
- Create: `src/features/products/AddProductPage.vue`
- Create: `src/features/products/EditProductPage.vue`

- [ ] **Step 1: Create ProductsPage**

Create `src/features/products/ProductsPage.vue`:

```vue
<script setup lang="ts">
import { onMounted, computed, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import ProductList from './components/ProductList.vue'
import { useProducts } from './composables/useProducts'
import { useBarcodeScan } from '@/composables/useBarcodeScan'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppToast from '@/components/ui/AppToast.vue'

const router  = useRouter()
const route   = useRoute()
const { products, load, softDelete } = useProducts()
const scanner = useBarcodeScan()

const filterLowStock    = computed(() => route.query.filter === 'low-stock')
const deleteTarget      = ref<string | null>(null)
const toast             = ref<{ message: string; type: 'success' | 'error' } | null>(null)
const missedBarcode     = ref<string | null>(null)  // barcode scanned but no product found
const cameraOpen        = ref(false)
const videoRef          = ref<HTMLVideoElement | null>(null)
let stopCamera: (() => void) | null = null

onMounted(() => {
  load()
  scanner.onScan(handleBarcodeScan)
})

function handleBarcodeScan(code: string) {
  const match = products.value.find(p => p.barcode === code)
  if (match) {
    // Scroll to match — ProductList search handles this via prop
    missedBarcode.value = null
  } else {
    missedBarcode.value = code
  }
}

async function openCamera() {
  cameraOpen.value = true
  const result = await scanner.startCamera(videoRef.value!)
  stopCamera = result?.stop ?? null
}

function closeCamera() {
  stopCamera?.()
  cameraOpen.value = false
  stopCamera = null
}

async function handleDelete(id: string) {
  deleteTarget.value = id
}

async function confirmDelete() {
  if (!deleteTarget.value) return
  await softDelete(deleteTarget.value)
  deleteTarget.value = null
  toast.value = { message: 'تم حذف المنتج', type: 'success' }
}
</script>

<template>
  <div class="flex flex-col min-h-dvh" dir="rtl">
    <AppHeader
      title="المنتجات"
      :show-back="true"
      :show-back-office="false"
      @back="router.push('/back-office')"
    />

    <main class="flex-1 px-4 py-4 max-w-2xl mx-auto w-full">
      <!-- "Add with scanned barcode" CTA — appears when USB/camera scan has no match -->
      <div
        v-if="missedBarcode"
        class="mb-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl px-4 py-3 flex items-center justify-between"
      >
        <span class="text-sm text-blue-800 dark:text-blue-200">لم يُعثر على: {{ missedBarcode }}</span>
        <button
          type="button"
          class="text-sm font-semibold text-blue-600 dark:text-blue-400 underline"
          @click="router.push(`/products/add?barcode=${encodeURIComponent(missedBarcode!)}`)"
        >إضافة منتج جديد بهذا الباركود</button>
      </div>

      <ProductList
        :products="products"
        :filter-low-stock="filterLowStock"
        @edit="id => router.push(`/products/${id}/edit`)"
        @delete="handleDelete"
      />
    </main>

    <!-- FAB -->
    <button
      type="button"
      data-testid="add-fab"
      class="fixed bottom-6 start-6 w-14 h-14 rounded-full bg-blue-600 text-white text-2xl shadow-lg
             hover:bg-blue-700 active:scale-95 transition-all flex items-center justify-center z-20"
      aria-label="إضافة منتج"
      @click="router.push('/products/add')"
    >+</button>

    <!-- Camera overlay for barcode scan from product list -->
    <div v-if="cameraOpen" class="fixed inset-0 z-40 bg-black flex flex-col">
      <button type="button" class="absolute top-4 end-4 text-white text-xl z-50" @click="closeCamera">✕</button>
      <video ref="videoRef" class="w-full h-full object-cover" autoplay playsinline />
    </div>

    <AppDialog
      v-if="deleteTarget"
      title="حذف المنتج"
      message="حذف هذا المنتج؟ لن يظهر في القائمة بعد الآن، لكن سجلات البيع السابقة ستبقى."
      confirm-label="حذف"
      cancel-label="إلغاء"
      @confirm="confirmDelete"
      @cancel="deleteTarget = null"
    />

    <AppToast v-if="toast" :message="toast.message" :type="toast.type" @close="toast = null" />
  </div>
</template>
```

- [ ] **Step 2: Create AddProductPage**

Create `src/features/products/AddProductPage.vue`:

```vue
<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import ProductForm from './components/ProductForm.vue'
import AppToast from '@/components/ui/AppToast.vue'
import { ref, computed } from 'vue'

const router = useRouter()
const route  = useRoute()
const toast  = ref<{ message: string; type: 'success' } | null>(null)

// Pre-fill barcode if navigated from a failed barcode scan
const initialBarcode = computed(() => route.query.barcode as string | undefined)

function handleSaved() {
  toast.value = { message: 'تم حفظ المنتج', type: 'success' }
  setTimeout(() => router.push('/products'), 800)
}
</script>

<template>
  <div class="flex flex-col min-h-dvh" dir="rtl">
    <AppHeader
      title="إضافة منتج"
      :show-back="true"
      :show-back-office="false"
      @back="router.push('/products')"
    />
    <main class="flex-1 px-4 py-4 max-w-lg mx-auto w-full">
      <ProductForm mode="add" :initial-barcode="initialBarcode" @saved="handleSaved" @cancel="router.push('/products')" />
    </main>
    <AppToast v-if="toast" :message="toast.message" :type="toast.type" @close="toast = null" />
  </div>
</template>
```

- [ ] **Step 3: Create EditProductPage**

Create `src/features/products/EditProductPage.vue`:

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import ProductForm from './components/ProductForm.vue'
import AppToast from '@/components/ui/AppToast.vue'
import { useProducts } from './composables/useProducts'
import type { Product } from '@/features/pos/pos.types'

const router   = useRouter()
const route    = useRoute()
const { products, load } = useProducts()
const product  = ref<Product | undefined>(undefined)
const toast    = ref<{ message: string; type: 'success' } | null>(null)

onMounted(async () => {
  await load()
  product.value = products.value.find(p => p.id === route.params.id as string)
})

function handleSaved() {
  toast.value = { message: 'تم حفظ التغييرات', type: 'success' }
  setTimeout(() => router.push('/products'), 800)
}
</script>

<template>
  <div class="flex flex-col min-h-dvh" dir="rtl">
    <AppHeader
      title="تعديل المنتج"
      :show-back="true"
      :show-back-office="false"
      @back="router.push('/products')"
    />
    <main class="flex-1 px-4 py-4 max-w-lg mx-auto w-full">
      <div v-if="!product" class="flex justify-center py-20 text-gray-400">جارٍ التحميل...</div>
      <ProductForm v-else mode="edit" :product="product" @saved="handleSaved" @cancel="router.push('/products')" />
    </main>
    <AppToast v-if="toast" :message="toast.message" :type="toast.type" @close="toast = null" />
  </div>
</template>
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors, all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/features/products/ProductsPage.vue src/features/products/AddProductPage.vue src/features/products/EditProductPage.vue
git commit -m "feat(products): add ProductsPage, AddProductPage, EditProductPage"
```

---

## Task 12: Stock deduction on sale

**Files:**
- Modify: `src/features/payment/usePayment.ts`
- Modify: `src/__tests__/features/usePayment.test.ts`

- [ ] **Step 1: Write a failing test**

Open `src/__tests__/features/usePayment.test.ts`. Find the last test in the file and add after it:

```ts
  it('confirm deducts stock for each sale line', async () => {
    vi.mocked(db.execute)
      // First call: INSERT INTO sales
      .mockResolvedValueOnce({ rows: { _array: [] } } as any)
      // Second call: INSERT INTO sale_line_items for p1
      .mockResolvedValueOnce({ rows: { _array: [] } } as any)
      // Third call: SELECT current_stock for stock deduction
      .mockResolvedValueOnce({ rows: { _array: [{ current_stock: 10 }] } } as any)
      // Fourth call: UPDATE products current_stock
      .mockResolvedValueOnce({ rows: { _array: [] } } as any)
      // Fifth call: INSERT stock_adjustments
      .mockResolvedValueOnce({ rows: { _array: [] } } as any)

    const { selectMethod, confirm } = usePayment()
    selectMethod('card')
    await confirm()

    const calls = vi.mocked(db.execute).mock.calls.map(c => c[0] as string)
    expect(calls.some(sql => sql.includes('UPDATE products') && sql.includes('current_stock'))).toBe(true)
    expect(calls.some(sql => sql.includes('INSERT INTO stock_adjustments'))).toBe(true)
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/features/usePayment.test.ts --reporter=verbose`
Expected: the new test FAILS — UPDATE products and INSERT stock_adjustments are not called yet

- [ ] **Step 3: Add stock deduction to usePayment.ts**

In `src/features/payment/usePayment.ts`, after the `for (const line of saleStore.lines)` loop that inserts `sale_line_items`, add the following stock deduction block inside the same `try` block:

```ts
      // Deduct stock for each line item
      for (const line of saleStore.lines) {
        const stockResult = await db.execute(
          `SELECT current_stock FROM products WHERE id = ?`,
          [line.productId]
        )
        const currentStock: number =
          ((stockResult as any).rows._array[0] as any)?.current_stock ?? 0
        const newStock = currentStock - line.quantity

        await db.execute(
          `UPDATE products SET current_stock = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
          [newStock, now, line.productId]
        )
        await db.execute(
          `INSERT INTO stock_adjustments (id, product_id, old_value, new_value, reason, notes, created_at, device_id)
           VALUES (?, ?, ?, ?, 'sale', null, ?, ?)`,
          [uuidv4(), line.productId, currentStock, newStock, now, deviceStore.deviceId]
        )
      }
```

The `now` variable is already declared earlier in the function as:
```ts
const now = new Date().toISOString()
```

The `deviceStore` is already declared as `const deviceStore = useDeviceStore()`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/features/usePayment.test.ts`
Expected: all tests pass including the new one

- [ ] **Step 5: Commit**

```bash
git add src/features/payment/usePayment.ts src/__tests__/features/usePayment.test.ts
git commit -m "feat(stock): deduct current_stock and record stock_adjustment on sale confirm"
```

---

## Task 13: Wire low-stock card to home screen

**Files:**
- Modify: `src/pages/HomePage.vue`

- [ ] **Step 1: Update HomePage to show live low-stock card**

In `src/pages/HomePage.vue`:

Add import at the top of `<script setup>`:

```ts
import { useLowStockAlerts } from '@/features/products/composables/useLowStockAlerts'
```

Add inside the `<script setup>` body (after existing `const` declarations):

```ts
const { count: lowStockCount, top3: lowStockTop3, allClear, load: loadAlerts } = useLowStockAlerts()
```

In the `onMounted` handler, add `loadAlerts()` to the `Promise.all` call:

```ts
await Promise.all([loadRate(), loadDraft(), loadAlerts()])
```

In the template, add the low-stock card after the "today sales card" div and before the "no rate warning" div:

```html
<!-- Low-stock card -->
<RouterLink
  to="/products?filter=low-stock"
  class="block bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-5 mb-4 no-underline"
  data-testid="low-stock-card"
>
  <div class="flex items-center justify-between">
    <div>
      <p v-if="allClear" class="text-sm text-green-600 dark:text-green-400 font-medium">
        ✓ كل المنتجات متوفرة
      </p>
      <template v-else>
        <p class="text-sm text-yellow-600 dark:text-yellow-400 font-semibold mb-1">
          ⚠ مخزون منخفض ({{ lowStockCount }})
        </p>
        <p class="text-xs text-gray-500 dark:text-gray-400">
          {{ lowStockTop3.map(p => p.nameAr).join('، ') }}
        </p>
      </template>
    </div>
    <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-gray-400 rtl:rotate-180" fill="none"
      viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  </div>
</RouterLink>
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors, all tests pass

- [ ] **Step 3: Commit**

```bash
git add src/pages/HomePage.vue
git commit -m "feat(home): wire low-stock alerts card to useLowStockAlerts"
```

---

## Task 14: Full test run + smoke check

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: all tests pass, 0 failures

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Start dev server and smoke-test manually**

Run: `npm run dev`

Check in the browser:
- Home screen shows low-stock card (shows "كل المنتجات متوفرة" when no products, or a count when products are below threshold)
- Header shows grid icon → navigates to `/back-office`
- Back Office hub shows 2×2 tiles, Products tile is blue and tappable
- `/products` shows product list (empty state on first run)
- `/products/add` shows the add form; fill in Arabic name, cost, sale price, stock and save → success toast → redirected to list
- `/products/:id/edit` pre-fills fields; change stock → stock adjustment dialog appears
- Make a sale in POS → navigate to `/products` → confirm stock decreased

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -p   # stage only intentional changes
git commit -m "fix: smoke test corrections"
```
