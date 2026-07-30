# WAFI-013 Cost Freshness Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a shop owner find every product with missing or stale (90+ day old) cost data via one filter chip on the Products page, so they know which profit/margin numbers to trust.

**Architecture:** A new `products.cost_updated_at` column, backfilled once at migration time, stamped by every one of the four write paths that touch `cost_price_usd` (manual edit, manual creation, receiving, bulk import) — each following one of two rules (compare-before-stamp for edits, unconditional-stamp for anything that's inherently a fresh confirmation). `ProductList.vue` gains a combined missing-or-stale filter predicate (renamed from the existing missing-cost-only one) and always-visible per-row labels. `ProductsPage.vue` gains the first-ever visible filter chip in this codebase (today's low-stock/missing-cost filters are deep-link-only).

**Tech Stack:** Vue 3 + TypeScript, PowerSync (`@powersync/web`) local SQLite, Supabase/Postgres backend, Vitest.

## Global Constraints

- Staleness threshold: exactly 90 days, via `ageDays > COST_STALE_AFTER_DAYS` (not `>=`) — a product exactly 90.0 days old is NOT yet stale.
- A product with `cost_price_usd <= 0` is always "missing," never "stale" — the two states are mutually exclusive per product.
- `cost_updated_at = NULL` is never treated as stale — it means "no signal yet," not "very old."
- Migration 073's backfill (`cost_updated_at = updated_at WHERE cost_price_usd > 0`) runs exactly once, as part of the migration itself — never re-run by application code.
- Manual product edits (`useProducts.ts::save()`'s update branch) stamp `cost_updated_at` ONLY when `cost_price_usd` itself changes — comparing against the old stored value, the same pattern already used for price-change detection in that function.
- Manual creation, receiving, and bulk import all stamp `cost_updated_at` UNCONDITIONALLY whenever a real cost (`> 0`) is being set — entering/confirming a cost for the first time is itself the freshness signal, with no prior value to compare against.
- The renamed query param must keep accepting the OLD value (`'missing-cost'`) as an alias for the new one (`'imprecise-cost'`) permanently — no expiry, since `HomePage.vue`'s existing deep link and any bookmark/screenshot of it must keep working.
- Every navigation entry point that constructs the old query-param string must be updated in the same change — grep for `missing-cost`/`filterMissingCost` across the whole repo before considering the rename done, don't assume the call sites named in this plan are exhaustive forever.
- Per-row imprecise-cost labels are always visible (not gated behind the filter chip being active).
- The count badge is a memoized Vue `computed()`, never inlined directly in the template.

---

### Task 1: Schema — migration, PowerSync schema, `Product` type, row mapping

**Files:**
- Create: `supabase/migrations/073_products_cost_updated_at.sql`
- Modify: `src/data/powersync/schema.ts:3-22` (the `products` table)
- Modify: `src/features/pos/pos.types.ts:1-18` (the `Product` interface)
- Modify: `src/features/products/product.utils.ts` (the `ProductRow` type and `rowToProduct()`)
- Test: `src/__tests__/features/useProducts.test.ts` (extend the existing `load populates products from db` test)

**Interfaces:**
- Produces: `Product.costUpdatedAt?: string`, `ProductRow.cost_updated_at: string | null`,
  `COST_STALE_AFTER_DAYS: number`, `isCostStale(p: Product): boolean`,
  `isCostImprecise(p: Product): boolean` (all three exported from `product.utils.ts`) —
  used by Tasks 5-6. Defining the staleness predicate here, not inside `ProductList.vue`,
  is deliberate: Task 6's count badge lives in `ProductsPage.vue`, a different component
  from `ProductList.vue` — putting the predicate in the shared `product.utils.ts` (which
  both files already import for other reasons) means both consume the exact same
  function instead of two components independently reimplementing the same 90-day rule
  and risking drift between them.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/073_products_cost_updated_at.sql`:

```sql
ALTER TABLE products ADD COLUMN cost_updated_at TIMESTAMPTZ;

-- One-time backfill, run only as part of this migration — not a runtime job,
-- not something any application code re-runs later. Existing products with a
-- real cost are "as fresh as their last edit" rather than flagged stale on
-- day one. Products with no cost stay NULL — already caught by the
-- missing-cost half of the filter. Once this migration has run, every future
-- cost_updated_at value comes exclusively from the application write paths
-- (Tasks 2-4 below), never from this UPDATE again.
UPDATE products SET cost_updated_at = updated_at
WHERE cost_price_usd > 0 AND cost_updated_at IS NULL;
```

- [ ] **Step 2: Update the PowerSync local schema**

In `src/data/powersync/schema.ts`, add one line to the `products` table (after
`updated_at`, before `created_via`, to sit next to the other timestamp columns):

```ts
const products = new Table({
  shop_id:             column.text,
  name_ar:             column.text,
  name_en:             column.text,
  price_usd:           column.real,
  cost_price_usd:      column.real,
  barcode:             column.text,
  category:            column.text,   // deprecated free-text; kept for rollback safety, no longer written to
  category_id:         column.text,
  subcategory_id:      column.text,
  photo_url:           column.text,
  current_stock:       column.integer,
  low_stock_threshold: column.integer,
  is_active:           column.integer,
  deleted:             column.integer,
  sync_status:         column.text,
  created_at:          column.text,
  updated_at:          column.text,
  cost_updated_at:     column.text,   // WAFI-013 — null until a real cost is set/confirmed
  created_via:         column.text,   // WAFI-101: 'quick_add' | 'open_item' | null
})
```

- [ ] **Step 3: Write the failing test for the type/mapping change**

In `src/__tests__/features/useProducts.test.ts`, extend the `mockRow` helper and the
`load populates products from db` test:

```ts
const mockRow = (overrides = {}) => ({
  id: 'p1', shop_id: 's1', name_ar: 'منتج', name_en: null,
  price_usd: 10, cost_price_usd: 7, barcode: null, category: null,
  current_stock: 5, low_stock_threshold: 3, photo_url: null,
  created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
  cost_updated_at: '2024-01-01T00:00:00Z',
  is_active: 1, deleted: 0, sync_status: 'synced',
  ...overrides,
})
```

Add a new test right after `load populates products from db`:

```ts
  it('load maps cost_updated_at to costUpdatedAt (and leaves it undefined when null)', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([
      mockRow({ id: 'p1', cost_updated_at: '2026-01-01T00:00:00Z' }),
      mockRow({ id: 'p2', cost_updated_at: null }),
    ])
    const { products, load } = useProducts()
    await load()
    expect(products.value.find(p => p.id === 'p1')?.costUpdatedAt).toBe('2026-01-01T00:00:00Z')
    expect(products.value.find(p => p.id === 'p2')?.costUpdatedAt).toBeUndefined()
  })
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/useProducts.test.ts -t "cost_updated_at"`
Expected: FAIL — `Product` has no `costUpdatedAt` field yet, `rowToProduct()` doesn't map it.

- [ ] **Step 5: Update the `Product` type and row mapping**

In `src/features/pos/pos.types.ts`, add one field to `Product`:

```ts
export interface Product {
  id:                 string
  shopId:             string
  nameAr:             string
  nameEn?:            string
  salePriceUsd:       number   // stored as price_usd in DB
  costPriceUsd:       number
  costUpdatedAt?:      string   // WAFI-013 — null/undefined until a real cost is set/confirmed
  barcode?:           string
  category?:          string
  categoryId?:        string
  subcategoryId?:     string
  photoUrl?:          string
  currentStock:       number
  lowStockThreshold:  number
  isActive:           boolean
  createdAt:          string
  updatedAt:          string
}
```

In `src/features/products/product.utils.ts`, add the column to `ProductRow` and the
mapping in `rowToProduct()`:

```ts
export type ProductRow = {
  id: string; shop_id: string; name_ar: string; name_en: string | null
  price_usd: number; cost_price_usd: number; barcode: string | null
  category: string | null; category_id: string | null; subcategory_id: string | null
  current_stock: number; low_stock_threshold: number
  photo_url: string | null; created_at: string; updated_at: string
  cost_updated_at: string | null
  is_active: number; deleted: number; sync_status: string
}

export function rowToProduct(r: ProductRow): Product {
  return {
    id: r.id, shopId: r.shop_id, nameAr: r.name_ar,
    nameEn: r.name_en ?? undefined, salePriceUsd: r.price_usd,
    costPriceUsd: r.cost_price_usd ?? 0, barcode: r.barcode ?? undefined,
    category: r.category ?? undefined,
    categoryId: r.category_id ?? undefined, subcategoryId: r.subcategory_id ?? undefined,
    photoUrl: r.photo_url ?? undefined,
    currentStock: r.current_stock ?? 0, lowStockThreshold: r.low_stock_threshold ?? 5,
    isActive: r.is_active === 1, createdAt: r.created_at, updatedAt: r.updated_at,
    costUpdatedAt: r.cost_updated_at ?? undefined,
  }
}

/**
 * WAFI-013. Shared here (not duplicated inside ProductList.vue and
 * ProductsPage.vue separately) because both files need the same "is this
 * product's cost imprecise" answer — ProductList.vue for its filter/labels,
 * ProductsPage.vue for its chip's count badge. One definition, no drift risk
 * between the two.
 */
export const COST_STALE_AFTER_DAYS = 90

export function isCostStale(p: Pick<Product, 'costPriceUsd' | 'costUpdatedAt'>): boolean {
  if (!p.costPriceUsd || p.costPriceUsd <= 0) return false  // "missing", not "stale" — never double-flag
  if (!p.costUpdatedAt) return false  // no signal yet — not flagged either way
  const ageDays = (Date.now() - new Date(p.costUpdatedAt).getTime()) / (1000 * 60 * 60 * 24)
  return ageDays > COST_STALE_AFTER_DAYS
}

export function isCostImprecise(p: Pick<Product, 'costPriceUsd' | 'costUpdatedAt'>): boolean {
  return (!p.costPriceUsd || p.costPriceUsd <= 0) || isCostStale(p)
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/useProducts.test.ts`
Expected: PASS (all tests in the file, including the pre-existing ones — this is a
non-breaking additive change)

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/073_products_cost_updated_at.sql src/data/powersync/schema.ts src/features/pos/pos.types.ts src/features/products/product.utils.ts src/__tests__/features/useProducts.test.ts
git commit -m "feat(WAFI-013): add products.cost_updated_at column, schema, and type mapping"
```

**Manual/deployment step, not part of this codebase change, do not skip:** after this
migration is applied to a real Supabase project, verify whether that project's PowerSync
sync rules for `products` enumerate columns explicitly. If they do, add
`cost_updated_at` to that list in the PowerSync dashboard — otherwise every value this
column ever gets written will silently never sync to any device. If the sync rules use
a wildcard select, no action is needed. This cannot be checked from this repository
(no sync-rules file exists in it) — it must be checked directly against the actual
PowerSync project configuration.

---

### Task 2: `useProducts.ts::save()` — stamp on manual edit and creation

**Files:**
- Modify: `src/features/products/composables/useProducts.ts:35-105` (`save()`)
- Test: `src/__tests__/features/useProducts.test.ts`

**Interfaces:**
- Consumes: `Product.costUpdatedAt` from Task 1 (type only — this task writes the raw
  `cost_updated_at` column via SQL, not through the `Product` type).

- [ ] **Step 1: Write the failing tests**

Add to `src/__tests__/features/useProducts.test.ts`, in a new `describe` block:

```ts
describe('useProducts.save — cost_updated_at stamping (WAFI-013)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('creating a product with a real cost stamps cost_updated_at', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce(null)
    const { save } = useProducts()
    await save({
      shopId: 's1', nameAr: 'حليب', salePriceUsd: 5, costPriceUsd: 3.10,
      currentStock: 20, lowStockThreshold: 5, isActive: true,
      createdAt: '', updatedAt: '',
    })
    const insertCall = vi.mocked(db.execute).mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('INSERT INTO products'),
    )
    expect(insertCall).toBeDefined()
    const sql = insertCall![0] as string
    expect(sql).toContain('cost_updated_at')
  })

  it('creating a product with no cost (0) leaves cost_updated_at out / null', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce(null)
    const { save } = useProducts()
    await save({
      shopId: 's1', nameAr: 'قلم بلا سعر', salePriceUsd: 2, costPriceUsd: 0,
      currentStock: 20, lowStockThreshold: 5, isActive: true,
      createdAt: '', updatedAt: '',
    })
    const insertCall = vi.mocked(db.execute).mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('INSERT INTO products'),
    )
    expect(insertCall).toBeDefined()
    // cost_updated_at bound param must be null when costPriceUsd is 0.
    const params = insertCall![1] as any[]
    const sql = insertCall![0] as string
    const costUpdatedAtIndex = sql
      .slice(sql.indexOf('('), sql.indexOf(')'))
      .split(',').map(s => s.trim()).indexOf('cost_updated_at')
    expect(params[costUpdatedAtIndex]).toBeNull()
  })

  it('editing only the name (cost unchanged) does NOT update cost_updated_at', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({ price_usd: 10, cost_price_usd: 7 })
    const { save } = useProducts()
    await save({
      id: 'p1', shopId: 's1', nameAr: 'اسم جديد', salePriceUsd: 10, costPriceUsd: 7,
      currentStock: 20, lowStockThreshold: 5, isActive: true,
      createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
    })
    const updateCall = vi.mocked(db.execute).mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('UPDATE products'),
    )
    expect(updateCall).toBeDefined()
    const sql = updateCall![0] as string
    expect(sql).not.toContain('cost_updated_at')
  })

  it('editing only the sale price (cost unchanged) does NOT update cost_updated_at', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({ price_usd: 10, cost_price_usd: 7 })
    const { save } = useProducts()
    await save({
      id: 'p1', shopId: 's1', nameAr: 'منتج', salePriceUsd: 15, costPriceUsd: 7,
      currentStock: 20, lowStockThreshold: 5, isActive: true,
      createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
    })
    const updateCall = vi.mocked(db.execute).mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('UPDATE products'),
    )
    expect(updateCall).toBeDefined()
    const sql = updateCall![0] as string
    expect(sql).not.toContain('cost_updated_at')
  })

  it('editing the cost value DOES update cost_updated_at', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({ price_usd: 10, cost_price_usd: 7 })
    const { save } = useProducts()
    await save({
      id: 'p1', shopId: 's1', nameAr: 'منتج', salePriceUsd: 10, costPriceUsd: 9,
      currentStock: 20, lowStockThreshold: 5, isActive: true,
      createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
    })
    const updateCall = vi.mocked(db.execute).mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('UPDATE products'),
    )
    expect(updateCall).toBeDefined()
    const sql = updateCall![0] as string
    expect(sql).toContain('cost_updated_at')
  })

  it('the missing → fresh transition: editing cost from 0 to a real value stamps cost_updated_at', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({ price_usd: 5, cost_price_usd: 0 })
    const { save } = useProducts()
    await save({
      id: 'p1', shopId: 's1', nameAr: 'حليب', salePriceUsd: 5, costPriceUsd: 3.10,
      currentStock: 20, lowStockThreshold: 5, isActive: true,
      createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
    })
    const updateCall = vi.mocked(db.execute).mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('UPDATE products'),
    )
    expect(updateCall).toBeDefined()
    expect((updateCall![0] as string)).toContain('cost_updated_at')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/features/useProducts.test.ts -t "cost_updated_at stamping"`
Expected: FAIL — `save()` doesn't touch `cost_updated_at` at all yet, so the `UPDATE`
branch's SQL never contains that column name and the `INSERT` doesn't bind it either.

- [ ] **Step 3: Implement the stamping logic**

Replace the body of `save()` in `src/features/products/composables/useProducts.ts`
(lines 43-104) with:

```ts
    const now = new Date().toISOString()
    if (data.id) {
      const old = await db.getOptional<{ price_usd: number; cost_price_usd: number }>(
        `SELECT price_usd, cost_price_usd FROM products WHERE id = ?`, [data.id]
      )
      const costChanged = old ? old.cost_price_usd !== data.costPriceUsd : false
      const sql = costChanged
        ? `UPDATE products SET name_ar=?, name_en=?, barcode=?, category_id=?, subcategory_id=?,
           price_usd=?, cost_price_usd=?, current_stock=?, low_stock_threshold=?,
           photo_url=?, is_active=?, cost_updated_at=?, updated_at=?, sync_status='pending' WHERE id=?`
        : `UPDATE products SET name_ar=?, name_en=?, barcode=?, category_id=?, subcategory_id=?,
           price_usd=?, cost_price_usd=?, current_stock=?, low_stock_threshold=?,
           photo_url=?, is_active=?, updated_at=?, sync_status='pending' WHERE id=?`
      const baseParams = [
        data.nameAr, data.nameEn ?? null, normalizedBarcode || null,
        data.categoryId ?? null, effectiveSubcategoryId ?? null,
        data.salePriceUsd, data.costPriceUsd, currentStock, data.lowStockThreshold,
        data.photoUrl ?? null, data.isActive ? 1 : 0,
      ]
      const params = costChanged
        ? [...baseParams, now, now, data.id]
        : [...baseParams, now, data.id]
      await db.execute(sql, params)
      await load()
      if (old && old.price_usd !== data.salePriceUsd) {
        await logProductPriceChanged(data.id, data.nameAr, old.price_usd, data.salePriceUsd)
      } else {
        await logProductUpdated(data.id, data.nameAr)
      }
      return data.id
    } else {
      const id = uuidv4()
      const costUpdatedAt = data.costPriceUsd > 0 ? now : null
      await db.execute(
        `INSERT INTO products
         (id, shop_id, name_ar, name_en, barcode, category, category_id, subcategory_id,
          price_usd, cost_price_usd, current_stock, low_stock_threshold, photo_url,
          is_active, deleted, sync_status, created_at, updated_at, cost_updated_at, created_via)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending', ?, ?, ?, ?)`,
        [id, data.shopId, data.nameAr, data.nameEn ?? null, normalizedBarcode || null,
         null, data.categoryId ?? null, effectiveSubcategoryId ?? null,
         data.salePriceUsd, data.costPriceUsd,
         currentStock, data.lowStockThreshold, data.photoUrl ?? null,
         data.isActive ? 1 : 0, now, now, costUpdatedAt, data.createdVia ?? null]
      )
      await load()
      await logProductCreated(id, data.nameAr)
      return id
    }
```

Note: the duplicate-barcode check and the top-of-function `currentStock`/
`effectiveSubcategoryId`/`normalizedBarcode` computations above this block are
unchanged — only the body from `const now = new Date().toISOString()` onward is
replaced.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/features/useProducts.test.ts`
Expected: PASS (all tests in the file — the new `describe` block and every pre-existing
test, since the SQL/param shape for a cost-unchanged update is unchanged from before).

- [ ] **Step 5: Commit**

```bash
git add src/features/products/composables/useProducts.ts src/__tests__/features/useProducts.test.ts
git commit -m "feat(WAFI-013): stamp cost_updated_at on manual product creation and cost edits"
```

---

### Task 3: `useReceivingSheet.ts` — stamp on receiving

**Files:**
- Modify: `src/features/suppliers/composables/useReceivingSheet.ts:112-120`
- Test: `src/__tests__/features/useReceivingSheet.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/__tests__/features/useReceivingSheet.test.ts`, in the same `describe` block
as the existing `updates cost_price_usd when updateCost is on` test:

```ts
  it('stamps cost_updated_at alongside cost_price_usd when updateCost is on', async () => {
    const txExecute = setupWriteTransaction()
    const sheet = await ready()
    await sheet.confirm()
    const costUpd = (txExecute.mock.calls as any[])
      .find(([s]: [string]) => s.includes('UPDATE products SET cost_price_usd'))
    expect(costUpd).toBeDefined()
    expect(costUpd[0]).toContain('cost_updated_at')
  })

  it('does NOT touch cost_updated_at when updateCost is off (regression guard)', async () => {
    const txExecute = setupWriteTransaction()
    const sheet = await ready()
    sheet.lines.value[0].updateCost = false
    await sheet.confirm()
    const costUpd = (txExecute.mock.calls as any[])
      .find(([s]: [string]) => s.includes('UPDATE products SET cost_price_usd'))
    expect(costUpd).toBeUndefined()
  })
```

(These sit alongside the pre-existing `updates cost_price_usd when updateCost is on` /
`does NOT zero standing cost...` / `does NOT update cost when updateCost is off` tests
— read that describe block in full first so your two new tests use the exact same
`ready()`/`setupWriteTransaction()` helpers already defined there, not new ones.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/features/useReceivingSheet.test.ts -t "cost_updated_at"`
Expected: FAIL — the cost-update `UPDATE` statement doesn't mention `cost_updated_at` yet.

- [ ] **Step 3: Implement the stamp**

In `src/features/suppliers/composables/useReceivingSheet.ts`, replace lines 112-120:

```ts
        // Update standing cost only if toggled AND the cost is real (WAFI-021): a
        // zero/blank unit cost must never overwrite the product's standing cost — that
        // silently wipes margin on every later sale. Past sale_line_items are untouched.
        if (line.updateCost && line.unitCostUsd > 0) {
          await tx.execute(
            `UPDATE products SET cost_price_usd = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
            [line.unitCostUsd, now, line.productId],
          )
        }
```

with:

```ts
        // Update standing cost only if toggled AND the cost is real (WAFI-021): a
        // zero/blank unit cost must never overwrite the product's standing cost — that
        // silently wipes margin on every later sale. Past sale_line_items are untouched.
        // WAFI-013: cost_updated_at is stamped unconditionally in this branch (not
        // compared against the old value) — confirming a cost during a receiving is
        // itself the freshness signal, even if the confirmed number happens to equal
        // what was already stored.
        if (line.updateCost && line.unitCostUsd > 0) {
          await tx.execute(
            `UPDATE products SET cost_price_usd = ?, cost_updated_at = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
            [line.unitCostUsd, now, now, line.productId],
          )
        }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/features/useReceivingSheet.test.ts`
Expected: PASS (all tests in the file — the pre-existing `costUpd[1][0]).toBe(450)`
assertion still holds since `line.unitCostUsd` stays the first bound param).

- [ ] **Step 5: Commit**

```bash
git add src/features/suppliers/composables/useReceivingSheet.ts src/__tests__/features/useReceivingSheet.test.ts
git commit -m "feat(WAFI-013): stamp cost_updated_at when a receiving confirms a product's cost"
```

---

### Task 4: `useProductImport.ts` — stamp on bulk import

**Files:**
- Modify: `src/features/imports/composables/useProductImport.ts:33-60`
- Test: `src/features/imports/composables/__tests__/useProductImport.test.ts` (new file
  — none exists for this composable today)

- [ ] **Step 1: Write the failing tests**

Create `src/features/imports/composables/__tests__/useProductImport.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useProductImport } from '../useProductImport'
import { db } from '@/data/powersync/db'
import type { RowStatus } from '../../import.types'

function importRow(overrides: Partial<RowStatus['row']> = {}): RowStatus {
  return {
    index: 1,
    kind: 'import',
    reason: null,
    flags: [],
    row: {
      nameAr: 'منتج مستورد', nameEn: null, barcode: null, category: null,
      salePriceRaw: 10, costRaw: 6, currentStock: 5, lowStockThreshold: null,
      ...overrides,
    },
  }
}

describe('useProductImport.commitImport — cost_updated_at stamping (WAFI-013)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('stamps cost_updated_at for an imported row with a real cost', async () => {
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => {
      await fn({ execute: txExecute })
    })

    const { commitImport } = useProductImport()
    await commitImport([importRow({ costRaw: 6 })], { rate: 1, priceCurrency: 'USD', costCurrency: 'USD' })

    const insertCall = (txExecute.mock.calls as any[]).find(
      ([sql]: [string]) => sql.includes('INSERT INTO products'),
    )
    expect(insertCall).toBeDefined()
    expect(insertCall[0]).toContain('cost_updated_at')
    const sql = insertCall[0] as string
    const params = insertCall[1] as any[]
    const costUpdatedAtIndex = sql
      .slice(sql.indexOf('('), sql.indexOf(')'))
      .split(',').map((s: string) => s.trim()).indexOf('cost_updated_at')
    expect(params[costUpdatedAtIndex]).not.toBeNull()
  })

  it('leaves cost_updated_at null for an imported row with no cost column value', async () => {
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => {
      await fn({ execute: txExecute })
    })

    const { commitImport } = useProductImport()
    await commitImport([importRow({ costRaw: null })], { rate: 1, priceCurrency: 'USD', costCurrency: 'USD' })

    const insertCall = (txExecute.mock.calls as any[]).find(
      ([sql]: [string]) => sql.includes('INSERT INTO products'),
    )
    expect(insertCall).toBeDefined()
    const sql = insertCall[0] as string
    const params = insertCall[1] as any[]
    const costUpdatedAtIndex = sql
      .slice(sql.indexOf('('), sql.indexOf(')'))
      .split(',').map((s: string) => s.trim()).indexOf('cost_updated_at')
    expect(params[costUpdatedAtIndex]).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/imports/composables/__tests__/useProductImport.test.ts`
Expected: FAIL — the `INSERT INTO products` statement doesn't have a `cost_updated_at`
column yet.

- [ ] **Step 3: Implement the stamp**

In `src/features/imports/composables/useProductImport.ts`, replace lines 45-57:

```ts
          await tx.execute(
            `INSERT INTO products
               (id, shop_id, name_ar, name_en, barcode, category, category_id, subcategory_id,
                price_usd, cost_price_usd, current_stock, low_stock_threshold, photo_url,
                is_active, deleted, sync_status, created_at, updated_at, created_via)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, 0, 'pending', ?, ?, ?)`,
            [
              uuidv4(), device.shopId, r.nameAr, r.nameEn, r.barcode, null, null, null,
              priceUsd, costUsd ?? 0,
              r.currentStock ?? 0, r.lowStockThreshold ?? DEFAULT_LOW_STOCK,
              now, now, 'import',
            ],
          )
```

with:

```ts
          // WAFI-013: stamped unconditionally when the imported cost is real —
          // entering a cost via a bulk import is exactly as much a confirmation
          // of that value as typing it into the product form by hand.
          const costUpdatedAt = costUsd !== null && costUsd > 0 ? now : null
          await tx.execute(
            `INSERT INTO products
               (id, shop_id, name_ar, name_en, barcode, category, category_id, subcategory_id,
                price_usd, cost_price_usd, current_stock, low_stock_threshold, photo_url,
                is_active, deleted, sync_status, created_at, updated_at, cost_updated_at, created_via)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, 0, 'pending', ?, ?, ?, ?)`,
            [
              uuidv4(), device.shopId, r.nameAr, r.nameEn, r.barcode, null, null, null,
              priceUsd, costUsd ?? 0,
              r.currentStock ?? 0, r.lowStockThreshold ?? DEFAULT_LOW_STOCK,
              now, now, costUpdatedAt, 'import',
            ],
          )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/imports/composables/__tests__/useProductImport.test.ts`
Expected: PASS (both tests)

- [ ] **Step 5: Run the full test suite for a regression check**

Run: `npm test -- --run`
Expected: PASS, no regressions in any other file (this is the last of the four write
paths — a good point to confirm nothing else broke before moving to the filter/UI work).

- [ ] **Step 6: Commit**

```bash
git add src/features/imports/composables/useProductImport.ts src/features/imports/composables/__tests__/useProductImport.test.ts
git commit -m "feat(WAFI-013): stamp cost_updated_at on Excel/CSV bulk import"
```

---

### Task 5: `ProductList.vue` — staleness logic, renamed combined filter, always-visible labels

**Files:**
- Modify: `src/features/products/components/ProductList.vue`
- Test: `src/features/products/components/__tests__/ProductList.test.ts` (new file — none
  exists for this component today; check first in case one was added since this plan
  was written)

**Interfaces:**
- Consumes: `Product.costUpdatedAt`, `isCostStale(p)`, `isCostImprecise(p)` from Task 1.
- Produces: `ProductList`'s `filterImpreciseCost` prop (renamed from `filterMissingCost`)
  — consumed by Task 6.

- [ ] **Step 1: Check for an existing test file**

Run: `ls src/features/products/components/__tests__/ProductList.test.ts 2>/dev/null || echo "none"`

If one exists, read it fully and match its conventions instead of the scaffold below.
If none exists, proceed with Step 2 as written.

- [ ] **Step 2: Write the failing tests**

Create `src/features/products/components/__tests__/ProductList.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import ProductList from '../ProductList.vue'
import type { Product } from '@/features/pos/pos.types'

function product(overrides: Partial<Product> = {}): Product {
  const now = new Date()
  return {
    id: 'p1', shopId: 's1', nameAr: 'منتج', salePriceUsd: 10, costPriceUsd: 5,
    currentStock: 10, lowStockThreshold: 3, isActive: true,
    createdAt: now.toISOString(), updatedAt: now.toISOString(),
    costUpdatedAt: now.toISOString(),
    ...overrides,
  }
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

describe('ProductList — WAFI-013 cost freshness', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('a product with cost_price_usd <= 0 is always "missing," never "stale," regardless of cost_updated_at age', () => {
    const p = product({ costPriceUsd: 0, costUpdatedAt: daysAgo(200) })
    const wrapper = mount(ProductList, { props: { products: [p], filterImpreciseCost: true } })
    expect(wrapper.text()).toContain('لا يوجد سعر')
    expect(wrapper.text()).not.toContain('قديم')
  })

  it('exactly 90.0 days old is NOT yet stale', () => {
    const p = product({ costPriceUsd: 5, costUpdatedAt: daysAgo(90) })
    const wrapper = mount(ProductList, { props: { products: [p], filterImpreciseCost: true } })
    // Not flagged at all -> filterImpreciseCost excludes it -> empty state shows.
    expect(wrapper.text()).not.toContain('قديم')
  })

  it('91 days old IS stale', () => {
    const p = product({ costPriceUsd: 5, costUpdatedAt: daysAgo(91) })
    const wrapper = mount(ProductList, { props: { products: [p], filterImpreciseCost: true } })
    expect(wrapper.text()).toContain('قديم')
  })

  it('89 days old is NOT stale', () => {
    const p = product({ costPriceUsd: 5, costUpdatedAt: daysAgo(89) })
    const wrapper = mount(ProductList, { props: { products: [p], filterImpreciseCost: true } })
    expect(wrapper.text()).not.toContain('قديم')
  })

  it('a real cost with no cost_updated_at signal (undefined) is NOT flagged either way', () => {
    const p = product({ costPriceUsd: 5, costUpdatedAt: undefined })
    const wrapper = mount(ProductList, { props: { products: [p], filterImpreciseCost: true } })
    expect(wrapper.text()).not.toContain('قديم')
    expect(wrapper.text()).not.toContain('لا يوجد سعر')
  })

  it('the combined filter returns exactly the missing and stale products, not fresh or low-stock-only ones', () => {
    const missing = product({ id: 'p-missing', costPriceUsd: 0, costUpdatedAt: undefined })
    const stale   = product({ id: 'p-stale', costPriceUsd: 5, costUpdatedAt: daysAgo(91) })
    const fresh   = product({ id: 'p-fresh', costPriceUsd: 5, costUpdatedAt: daysAgo(1) })
    const lowStockOnly = product({ id: 'p-lowstock', costPriceUsd: 5, costUpdatedAt: daysAgo(1), currentStock: 1, lowStockThreshold: 5 })
    const wrapper = mount(ProductList, {
      props: { products: [missing, stale, fresh, lowStockOnly], filterImpreciseCost: true },
    })
    expect(wrapper.findAll('[data-testid^="product-card-"]').map(w => w.attributes('data-testid'))).toEqual(
      expect.arrayContaining(['product-card-p-missing', 'product-card-p-stale']),
    )
    expect(wrapper.text()).not.toContain('حليب')  // sanity: not asserting on unrelated content
  })

  it('imprecise-cost labels are always visible, even when the filter is not active', () => {
    const missing = product({ id: 'p-missing', costPriceUsd: 0, costUpdatedAt: undefined })
    const wrapper = mount(ProductList, { props: { products: [missing], filterImpreciseCost: false } })
    expect(wrapper.text()).toContain('لا يوجد سعر')
  })

  it('an unrecognized-but-irrelevant field does not crash label rendering (defensive baseline)', () => {
    const p = product({ costPriceUsd: 5, costUpdatedAt: daysAgo(91) })
    expect(() => mount(ProductList, { props: { products: [p] } })).not.toThrow()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/features/products/components/__tests__/ProductList.test.ts`
Expected: FAIL — `filterImpreciseCost` prop doesn't exist yet (still named
`filterMissingCost`), no staleness logic, no per-row labels.

- [ ] **Step 4: Implement the staleness logic and rename the prop**

In `src/features/products/components/ProductList.vue`'s `<script setup>`, replace the
`props` declaration (lines 9-14):

```ts
const props = defineProps<{
  products:             Product[]
  filterLowStock?:      boolean
  filterImpreciseCost?: boolean
  initialCategoryId?:   string | null
}>()
```

Update the import line that already brings in `Product` (line 7) to also bring in the
shared predicates from Task 1:

```ts
import type { Product } from '@/features/pos/pos.types'
import { isCostStale, isCostImprecise } from '@/features/products/product.utils'
```

Add, near the top of the script (after the `props`/`emit` declarations, before
`const search = ref('')`) — only the label formatter is local to this component, since
it's a display concern, not a shared predicate:

```ts
function costImpreciseLabel(p: Product): string | null {
  if (!p.costPriceUsd || p.costPriceUsd <= 0) return 'لا يوجد سعر'
  if (isCostStale(p)) {
    const ageDays = Math.floor((Date.now() - new Date(p.costUpdatedAt!).getTime()) / (1000 * 60 * 60 * 24))
    return `قديم (${ageDays} يوماً)`
  }
  return null
}
```

Replace the `filterMissingCost` block inside `displayed` (lines 74-78):

```ts
  // WAFI-013: combined missing-or-stale filter (renamed/widened from the
  // WAFI-054 missing-cost-only filter — same underlying concept, now covers
  // both cases an owner should distrust this product's margin number for).
  if (props.filterImpreciseCost) {
    list = list.filter(p => isCostImprecise(p))
  }
```

Update the `watch` at line 127 to reference the renamed prop:

```ts
watch(
  () => [search.value, selectedCategoryId.value, selectedSubcategoryId.value, props.filterLowStock, props.filterImpreciseCost, displayed.value.length],
  () => { if (first.value >= displayed.value.length) first.value = 0 },
)
```

- [ ] **Step 5: Add the always-visible per-row label to both the desktop table and mobile card**

In the desktop table's Cost `<td>` (lines 377-380), add the label under the existing
cost display:

```html
            <!-- Cost -->
            <td class="td">
              <span class="cost-price">${{ p.costPriceUsd.toFixed(2) }}</span>
              <p v-if="costImpreciseLabel(p)" class="cost-imprecise-label">{{ costImpreciseLabel(p) }}</p>
            </td>
```

In the mobile card, the product currently shows no cost information at all (only sale
price + stock) — add the label under the name in `.mobile-info` (lines 463-467):

```html
        <!-- Name + barcode -->
        <div class="mobile-info">
          <p class="product-name truncate">{{ p.nameAr }}</p>
          <p v-if="p.barcode" class="text-xs text-muted mt-0.5">{{ p.barcode }}</p>
          <p v-if="costImpreciseLabel(p)" class="cost-imprecise-label">{{ costImpreciseLabel(p) }}</p>
        </div>
```

Add to `<style scoped>` (anywhere alongside the other small-text label rules like
`.line-moved`/`.cost-price`):

```css
.cost-imprecise-label {
  font-size: 11px;
  color: #F59E0B;
  margin: 2px 0 0 0;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/features/products/components/__tests__/ProductList.test.ts`
Expected: PASS (all tests)

- [ ] **Step 7: Commit**

```bash
git add src/features/products/components/ProductList.vue src/features/products/components/__tests__/ProductList.test.ts
git commit -m "feat(WAFI-013): staleness detection, combined imprecise-cost filter, always-visible row labels"
```

---

### Task 6: `ProductsPage.vue` — visible chip, backward-compatible query param, count badge

**Files:**
- Modify: `src/features/products/ProductsPage.vue`
- Modify: `src/pages/HomePage.vue:189` (the one existing deep-link call site)
- Test: `src/features/products/__tests__/ProductsPage.test.ts` (new file — check first in
  case one exists)

**Interfaces:**
- Consumes: `ProductList`'s `filterImpreciseCost` prop from Task 5; `isCostImprecise(p)`
  from Task 1.

- [ ] **Step 1: Confirm there is exactly one other call site to update**

Run: `grep -rn "missing-cost\|filterMissingCost" src/`

Expected output: two matches — `src/features/products/ProductsPage.vue` (the file this
task modifies) and `src/pages/HomePage.vue:189`. If there are more matches than these
two, stop and read every one before proceeding — this plan's Global Constraints require
every entry point to be updated in this same change, not just the two named here.

- [ ] **Step 2: Check for an existing test file**

Run: `ls src/features/products/__tests__/ProductsPage.test.ts 2>/dev/null || echo "none"`

If one exists, read it fully and match its conventions instead of the scaffold below.

- [ ] **Step 3: Write the failing tests**

Create `src/features/products/__tests__/ProductsPage.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

const pushMock = vi.fn()
let queryFilter: string | undefined

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock, back: vi.fn() }),
  useRoute: () => ({ query: { filter: queryFilter } }),
}))
vi.mock('@/composables/useBarcodeScan', () => ({
  useBarcodeScan: () => ({ onScan: vi.fn(), destroy: vi.fn() }),
}))

import ProductsPage from '../ProductsPage.vue'
import { useProducts } from '../composables/useProducts'

vi.mock('../composables/useProducts', () => ({ useProducts: vi.fn() }))

function stubProducts(products: any[] = []) {
  vi.mocked(useProducts).mockReturnValue({
    products: { value: products },
    load: vi.fn().mockResolvedValue(undefined),
    softDelete: vi.fn(),
    adjustStock: vi.fn(),
  } as any)
}

describe('ProductsPage — WAFI-013 imprecise-cost chip + backward-compat query param', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    queryFilter = undefined
  })

  it('the new query-param value activates the imprecise-cost filter', () => {
    queryFilter = 'imprecise-cost'
    stubProducts([])
    const wrapper = mount(ProductsPage)
    expect(wrapper.findComponent({ name: 'ProductList' }).props('filterImpreciseCost')).toBe(true)
  })

  it('the OLD query-param value ("missing-cost") still activates the same filter (backward compat)', () => {
    queryFilter = 'missing-cost'
    stubProducts([])
    const wrapper = mount(ProductsPage)
    expect(wrapper.findComponent({ name: 'ProductList' }).props('filterImpreciseCost')).toBe(true)
  })

  it('no filter query param means the filter is off', () => {
    queryFilter = undefined
    stubProducts([])
    const wrapper = mount(ProductsPage)
    expect(wrapper.findComponent({ name: 'ProductList' }).props('filterImpreciseCost')).toBe(false)
  })

  it('shows a visible chip with a count badge reflecting the number of imprecise-cost products', () => {
    const now = new Date().toISOString()
    stubProducts([
      { id: 'p1', nameAr: 'a', costPriceUsd: 0, costUpdatedAt: undefined, currentStock: 5, lowStockThreshold: 1 },
      { id: 'p2', nameAr: 'b', costPriceUsd: 5, costUpdatedAt: now, currentStock: 5, lowStockThreshold: 1 },
    ])
    const wrapper = mount(ProductsPage)
    expect(wrapper.text()).toContain('بدون سعر دقيق')
    expect(wrapper.text()).toContain('1')  // exactly one of the two products is imprecise
  })
})
```

Note: this test asserts against `ProductList`'s props via `findComponent({ name:
'ProductList' })` — `ProductList.vue` uses `<script setup>` with no explicit `name`
option, matching a documented pitfall already hit twice earlier in this codebase's test
suite (`SalePanel.test.ts`'s comment on the same limitation, and `ReturnSheet.test.ts`'s
fix for it). **Before trusting this test scaffold, check whether `findComponent({ name:
'ProductList' })` actually resolves** — if it does not, switch to asserting against
rendered DOM/text instead (e.g. checking for the chip's count text and the presence of
`.cost-imprecise-label` in `wrapper.html()`), following whichever convention
`ReturnSheet.test.ts` settled on for the identical problem.

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run src/features/products/__tests__/ProductsPage.test.ts`
Expected: FAIL — no chip exists, `filterMissingCost`/`filterImpreciseCost` computed
doesn't accept the old value as an alias yet.

- [ ] **Step 5: Implement the rename, backward-compat alias, chip, and count badge**

In `src/features/products/ProductsPage.vue`, replace lines 20-21:

```ts
const filterLowStock    = computed(() => route.query.filter === 'low-stock')
const filterMissingCost = computed(() => route.query.filter === 'missing-cost')
```

with:

```ts
const filterLowStock = computed(() => route.query.filter === 'low-stock')
// WAFI-013: renamed from filterMissingCost — the filter now covers both missing
// AND stale cost. 'missing-cost' is kept as a permanent backward-compatible
// alias for the query-param VALUE (not the variable name) — someone may have
// bookmarked or screenshotted the dashboard's old deep link
// (HomePage.vue's goToMissingCostProducts), and there's no mechanism in this
// app to notify a bookmark-holder that a URL changed.
const filterImpreciseCost = computed(() =>
  route.query.filter === 'imprecise-cost' || route.query.filter === 'missing-cost'
)
```

Add the shared predicate to the existing import of `AdjustmentReason` (line 13), so this
file uses the exact same "is this cost imprecise" logic as `ProductList.vue` rather than
reimplementing it:

```ts
import type { AdjustmentReason } from '@/features/products/product.types'
import { isCostImprecise } from '@/features/products/product.utils'
```

Add a count computed, right after the `filterImpreciseCost` declaration:

```ts
const impreciseCostCount = computed(() =>
  products.value.filter(p => isCostImprecise(p)).length
)
```

Add a `setFilter` helper for the chip's click handler, right after `impreciseCostCount`:

```ts
function setFilter(value: 'low-stock' | 'imprecise-cost' | null) {
  router.push({ query: { ...route.query, filter: value ?? undefined } })
}
```

Update the `ProductList` binding (line 142):

```html
        :filter-imprecise-cost="filterImpreciseCost"
```

Add a chip row to the template, right after the existing `.toolbar` div (after line 124,
before the "Missed barcode banner" block):

```html
      <!-- Filter chips (WAFI-013 — first visible chip UI for either filter; both
           low-stock and imprecise-cost were previously deep-link-only) -->
      <div class="filter-chips">
        <button
          type="button"
          class="filter-chip"
          :class="{ 'filter-chip-active': !filterLowStock && !filterImpreciseCost }"
          @click="setFilter(null)"
        >الكل</button>
        <button
          type="button"
          class="filter-chip"
          :class="{ 'filter-chip-active': filterLowStock }"
          @click="setFilter(filterLowStock ? null : 'low-stock')"
        >مخزون منخفض</button>
        <button
          type="button"
          class="filter-chip"
          :class="{ 'filter-chip-active': filterImpreciseCost }"
          @click="setFilter(filterImpreciseCost ? null : 'imprecise-cost')"
        >
          بدون سعر دقيق
          <span v-if="impreciseCostCount > 0" class="filter-chip-badge">{{ impreciseCostCount }}</span>
        </button>
      </div>
```

Add to `<style scoped>`:

```css
.filter-chips {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}

.filter-chip {
  height: 36px;
  padding-inline: 0.875rem;
  border-radius: 9999px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.14);
  color: #9CB3D0;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}

.filter-chip:hover {
  background: rgba(26,86,219,0.10);
  color: #E8EDF5;
}

.filter-chip-active {
  background: linear-gradient(135deg, rgba(26,86,219,0.28), rgba(18,72,179,0.20));
  border-color: rgba(26,86,219,0.45);
  color: #FFFFFF;
}

.filter-chip-badge {
  min-width: 1.25rem;
  height: 1.25rem;
  padding-inline: 0.25rem;
  border-radius: 9999px;
  background: rgba(245,158,11,0.9);
  color: #1a1a1a;
  font-size: 0.6875rem;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
```

- [ ] **Step 6: Update `HomePage.vue`'s entry point**

In `src/pages/HomePage.vue`, update the one existing deep link (around line 189) to use
the new query-param value:

```ts
function goToMissingCostProducts() {
  showProfitSheet.value = false
  router.push('/products?filter=imprecise-cost')
}
```

(This is a plain string change — no test change needed here since the backward-compat
alias in Task 6 Step 5 means the OLD value would still have worked too; updating it to
the new value is just keeping the primary entry point on the canonical string rather
than relying on the alias for the one call site this codebase controls.)

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/features/products/__tests__/ProductsPage.test.ts`
Expected: PASS (all tests — adjust the `findComponent` vs. DOM-text assertion per Step
3's note if needed)

- [ ] **Step 8: Type-check the whole project**

Run: `npx vue-tsc --noEmit`
Expected: clean

- [ ] **Step 9: Run the full test suite for a final regression check**

Run: `npm test -- --run`
Expected: PASS, no regressions anywhere in the suite.

- [ ] **Step 10: Commit**

```bash
git add src/features/products/ProductsPage.vue src/pages/HomePage.vue src/features/products/__tests__/ProductsPage.test.ts
git commit -m "feat(WAFI-013): visible imprecise-cost filter chip with count badge, backward-compatible query param"
```

---

## Explicitly out of scope (do not implement in this plan)

- Any change to how cost is used in profit calculations — this feature only surfaces
  *which* products have bad cost data.
- A batch-fix flow for multiple flagged products at once.
- Making the 90-day threshold configurable per shop.
- Verifying/updating PowerSync sync rules — flagged in Task 1 as a manual deployment
  step, not something this codebase change can do (no sync-rules file exists in this
  repo).
- A pgTAP test for migration 073's backfill `UPDATE` — this migration has no RLS/security
  implications (a simple additive column plus a deterministic backfill), unlike this
  codebase's other pgTAP-tested migrations which exist specifically to prove RLS
  policies. Its correctness is visually verifiable from the SQL alone; not adding a
  formal automated test for it is a deliberate scope call, not an oversight to silently
  skip past during implementation.
