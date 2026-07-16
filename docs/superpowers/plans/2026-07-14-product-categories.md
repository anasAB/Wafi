# Product Categories & Subcategories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the free-text `products.category` string with a structured, owner-managed `categories`/`subcategories` model, migrate existing free-text values automatically, wire it into product filtering/sorting, the POS product picker, and add a "By category" breakdown to the Profit Report (Reporting Pack).

**Architecture:** Two new tables (`categories`, `subcategories`) plus two new nullable FK columns on `products` (`category_id`, `subcategory_id`). The old `category` text column is kept (not dropped) for safety during rollout but is no longer written to by new code. A one-time SQL backfill in the migration converts every shop's distinct existing free-text values into real category rows and re-points products; blanks go to a per-shop "غير مصنف" row. A new `useCategories` composable owns CRUD + deletion guards; `ProductList.vue`'s category dropdown is rewired from deriving-from-products to reading the real table.

**Tech Stack:** Vue 3 `<script setup lang="ts">`, Pinia, PowerSync, Vitest, PrimeVue (existing `ProductList.vue` conventions).

## Global Constraints

- Do not drop `products.category` (the free-text column) in this plan — keep it present but stop writing to it from any new/modified code path (spec: safety during rollout, no forced re-migration if something needs to roll back).
- Every distinct existing free-text `category` value, trimmed and compared case-insensitively, becomes exactly one `categories` row per shop; blank/null values are re-pointed to a per-shop **"غير مصنف"** row (spec: migration section).
- Deleting a category/subcategory with products still assigned is blocked with a count and reassignment path — no cascading deletes of products (spec: deletion rule).
- Category rename never changes historical report aggregation — reports must join on `category_id`, never on the name string (spec: edge case 2).
- New tables get RLS scoped by `shop_id = (select public.auth_shop_id())` and are added to the `powersync`/`powersync_publication` publications, mirroring migration 015/027.
- The Profit Report's "By category" view is gated the same way the rest of that screen already is (Reporting Pack) — do not add a new pack flag; reuse whatever gate `ReportsPage.vue` already has for the surrounding screen.
- All new Arabic UI strings hardcoded inline, matching `ProductList.vue`'s existing convention (that file does not use `vue-i18n`); `ReportsPage.vue` already uses `useI18n()` — match whichever convention the file being modified already uses, do not introduce a third pattern.

---

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/036_product_categories.sql` | New tables, product FK columns, backfill, RLS, publication |
| `src/data/powersync/schema.ts` (modify) | Add `categories`/`subcategories` tables; add `category_id`/`subcategory_id` to `products` |
| `src/features/categories/category.types.ts` | `Category`, `Subcategory` types |
| `src/features/categories/composables/useCategories.ts` | CRUD, deletion guards, nested category→subcategory list |
| `src/features/categories/components/CategoriesManagementScreen.vue` | Inline add/rename/delete screen |
| `src/features/categories/components/CategoryQuickAdd.vue` | Reusable quick-add modal (product form + POS) |
| `src/features/products/product.types.ts` (modify) | Add `categoryId`/`subcategoryId` to relevant types |
| `src/features/products/components/*Form*.vue` (modify) | Disable subcategory dropdown until a category is chosen (Task 6a) |
| `src/features/products/product.utils.ts` (modify) | Map new columns in `rowToProduct` |
| `src/features/products/composables/useProducts.ts` (modify) | `save()` writes `category_id`/`subcategory_id` |
| `src/features/products/components/ProductList.vue` (modify) | Category dropdown reads real categories, adds subcategory narrowing |
| `src/features/pos/components/ProductPickerCategoryChips.vue` | POS category chip filter |
| `src/features/dashboard/composables/useCategoryBreakdown.ts` | Revenue/COGS/profit grouped by category for a period |
| `src/features/dashboard/components/ReportsPage.vue` (modify) | New "By category" tab |
| `src/router/index.ts` (modify) | Register `/categories` |

---

### Task 1: Migration — categories, subcategories, product FKs, backfill

**Files:**
- Create: `supabase/migrations/036_product_categories.sql`

**Interfaces:**
- Produces: `public.categories(id, shop_id, name, created_at, sync_status)`, `public.subcategories(id, category_id, shop_id, name, created_at, sync_status)`, `products.category_id`, `products.subcategory_id`.

- [ ] **Step 1: Write the migration file**

```sql
-- Wafi POS — Product categories & subcategories (الفئات).
--
-- Replaces the free-text products.category string (kept, unused by new code)
-- with a structured, owner-managed category (+ optional subcategory) model.
-- Backfills existing distinct free-text values per shop, case-insensitively,
-- into real category rows; blanks go to a per-shop "غير مصنف" row.
-- See docs/superpowers/specs/2026-07-14-product-categories-design.md.

CREATE TABLE IF NOT EXISTS public.categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid NOT NULL,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sync_status text
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_shop_name_ci
  ON public.categories (shop_id, lower(name));

CREATE TABLE IF NOT EXISTS public.subcategories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  shop_id     uuid NOT NULL,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sync_status text
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subcategories_category_name_ci
  ON public.subcategories (category_id, lower(name));

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS category_id    uuid REFERENCES public.categories(id),
  ADD COLUMN IF NOT EXISTS subcategory_id uuid REFERENCES public.subcategories(id);

-- Backfill step 1: one category row per shop per distinct trimmed, lower-cased
-- existing free-text category value. DISTINCT ON picks a stable representative
-- casing (earliest-created product with that value) as the display name.
INSERT INTO public.categories (id, shop_id, name, created_at)
SELECT gen_random_uuid(), t.shop_id, t.name, now()
FROM (
  SELECT DISTINCT ON (shop_id, lower(trim(category))) shop_id, trim(category) AS name
  FROM public.products
  WHERE category IS NOT NULL AND trim(category) <> ''
  ORDER BY shop_id, lower(trim(category)), created_at
) t
ON CONFLICT DO NOTHING;

-- Backfill step 2: a per-shop "غير مصنف" row for any shop with at least one
-- product that has a blank/null category.
INSERT INTO public.categories (id, shop_id, name, created_at)
SELECT gen_random_uuid(), t.shop_id, 'غير مصنف', now()
FROM (
  SELECT DISTINCT shop_id FROM public.products
  WHERE category IS NULL OR trim(category) = ''
) t
ON CONFLICT DO NOTHING;

-- Backfill step 3: point every product with a non-blank category at its new
-- category_id, matched case-insensitively within the same shop.
UPDATE public.products p
SET category_id = c.id
FROM public.categories c
WHERE c.shop_id = p.shop_id
  AND p.category IS NOT NULL AND trim(p.category) <> ''
  AND lower(c.name) = lower(trim(p.category))
  AND p.category_id IS NULL;

-- Backfill step 4: point every remaining product (blank/null category) at its
-- shop's "غير مصنف" row.
UPDATE public.products p
SET category_id = c.id
FROM public.categories c
WHERE c.shop_id = p.shop_id
  AND c.name = 'غير مصنف'
  AND p.category_id IS NULL;

ALTER TABLE public.categories    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subcategories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS categories_select_all ON public.categories;
DROP POLICY IF EXISTS categories_insert_all ON public.categories;
DROP POLICY IF EXISTS categories_update_all ON public.categories;
DROP POLICY IF EXISTS categories_delete_all ON public.categories;
CREATE POLICY categories_select_all ON public.categories
  FOR SELECT TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()));
CREATE POLICY categories_insert_all ON public.categories
  FOR INSERT TO anon, authenticated
  WITH CHECK (shop_id = (select public.auth_shop_id()));
CREATE POLICY categories_update_all ON public.categories
  FOR UPDATE TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()))
  WITH CHECK (shop_id = (select public.auth_shop_id()));
CREATE POLICY categories_delete_all ON public.categories
  FOR DELETE TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()));

DROP POLICY IF EXISTS subcategories_select_all ON public.subcategories;
DROP POLICY IF EXISTS subcategories_insert_all ON public.subcategories;
DROP POLICY IF EXISTS subcategories_update_all ON public.subcategories;
DROP POLICY IF EXISTS subcategories_delete_all ON public.subcategories;
CREATE POLICY subcategories_select_all ON public.subcategories
  FOR SELECT TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()));
CREATE POLICY subcategories_insert_all ON public.subcategories
  FOR INSERT TO anon, authenticated
  WITH CHECK (shop_id = (select public.auth_shop_id()));
CREATE POLICY subcategories_update_all ON public.subcategories
  FOR UPDATE TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()))
  WITH CHECK (shop_id = (select public.auth_shop_id()));
CREATE POLICY subcategories_delete_all ON public.subcategories
  FOR DELETE TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()));

DO $$
DECLARE
  pub_name text;
  tbl text;
BEGIN
  FOREACH pub_name IN ARRAY ARRAY['powersync', 'powersync_publication']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = pub_name) THEN
      FOREACH tbl IN ARRAY ARRAY['categories', 'subcategories']
      LOOP
        IF NOT EXISTS (
          SELECT 1 FROM pg_publication_tables
          WHERE pubname = pub_name AND schemaname = 'public' AND tablename = tbl
        ) THEN
          EXECUTE format('ALTER PUBLICATION %I ADD TABLE public.%I', pub_name, tbl);
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/036_product_categories.sql
git commit -m "feat: add categories/subcategories tables, product FKs, and free-text backfill"
```

---

### Task 2: PowerSync local schema

**Files:**
- Modify: `src/data/powersync/schema.ts`

**Interfaces:**
- Produces: local tables `categories`, `subcategories`; `products` table gains `category_id`/`subcategory_id` columns.

- [ ] **Step 1: Add `category_id`/`subcategory_id` to the `products` table definition**

In `src/data/powersync/schema.ts`, modify the `products` table (currently lines 3-19) to add two columns after `category`:

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
  subcategory_id:       column.text,
  photo_url:           column.text,
  current_stock:       column.integer,
  low_stock_threshold: column.integer,
  is_active:           column.integer,
  deleted:             column.integer,
  sync_status:         column.text,
  created_at:          column.text,
  updated_at:          column.text,
})
```

- [ ] **Step 2: Add the two new tables**

Add above `export const AppSchema`:

```ts
const categories = new Table({
  shop_id:     column.text,
  name:        column.text,
  created_at:  column.text,
  sync_status: column.text,
})

const subcategories = new Table({
  category_id: column.text,
  shop_id:     column.text,
  name:        column.text,
  created_at:  column.text,
  sync_status: column.text,
})
```

- [ ] **Step 3: Register both tables in `AppSchema`**

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
  categories,
  subcategories,
})
```

- [ ] **Step 4: Commit**

```bash
git add src/data/powersync/schema.ts
git commit -m "feat: register categories/subcategories tables and product FK columns in PowerSync schema"
```

---

### Task 3: Types

**Files:**
- Create: `src/features/categories/category.types.ts`

**Interfaces:**
- Produces: `Category`, `Subcategory`, `CategoryWithSubcategories`, row types — consumed by Tasks 4-10.

- [ ] **Step 1: Write the types file**

```ts
export interface Category {
  id:        string
  shopId:    string
  name:      string
  createdAt: string
}

export interface Subcategory {
  id:         string
  categoryId: string
  shopId:     string
  name:       string
  createdAt:  string
}

export interface CategoryWithSubcategories extends Category {
  subcategories: Subcategory[]
}

export type CategoryRow = {
  id: string; shop_id: string; name: string; created_at: string
}

export type SubcategoryRow = {
  id: string; category_id: string; shop_id: string; name: string; created_at: string
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/categories/category.types.ts
git commit -m "feat: add category/subcategory types"
```

---

### Task 4: `useCategories` — load, create, rename

**Files:**
- Create: `src/features/categories/composables/useCategories.ts`
- Test: `src/__tests__/features/useCategories.test.ts`

**Interfaces:**
- Consumes: `db` from `@/data/powersync/db`; `useDeviceStore()`; `uuidv4` from `uuid`.
- Produces: `categoriesWithSubcategories: Ref<CategoryWithSubcategories[]>`, `load(): Promise<void>`, `createCategory(name: string): Promise<{ id: string | null; error: 'duplicate' | null }>`, `renameCategory(id: string, name: string): Promise<{ error: 'duplicate' | null }>`, `createSubcategory(categoryId: string, name: string): Promise<{ id: string | null; error: 'duplicate' | null }>`, `renameSubcategory(id: string, name: string): Promise<{ error: 'duplicate' | null }>`.
- Duplicate-name handling (spec: "Duplicate name handling"): before any insert/rename, check for an existing case-insensitive match (categories: shop-scoped; subcategories: scoped to their parent category) and short-circuit with `{ error: 'duplicate' }` instead of attempting the write — the caller shows "هذه الفئة موجودة بالفعل" and never sees a raw DB unique-violation.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { useCategories } from '@/features/categories/composables/useCategories'

describe('useCategories — load/create/rename', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('loads categories with nested subcategories', async () => {
    vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
      if (/FROM categories/.test(sql)) {
        return [{ id: 'c1', shop_id: 'shop1', name: 'هواتف', created_at: '2026-07-14T00:00:00Z' }] as any
      }
      if (/FROM subcategories/.test(sql)) {
        return [{ id: 's1', category_id: 'c1', shop_id: 'shop1', name: 'إكسسوارات', created_at: '2026-07-14T00:00:00Z' }] as any
      }
      return []
    })

    const { load, categoriesWithSubcategories } = useCategories()
    await load()

    expect(categoriesWithSubcategories.value).toHaveLength(1)
    expect(categoriesWithSubcategories.value[0].subcategories).toHaveLength(1)
    expect(categoriesWithSubcategories.value[0].subcategories[0].name).toBe('إكسسوارات')
  })

  it('createCategory inserts a row and returns its id when the name is not taken', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce(null)

    const { createCategory } = useCategories()
    const result = await createCategory('أجهزة منزلية')

    expect(result.error).toBeNull()
    expect(typeof result.id).toBe('string')
    const insertCall = vi.mocked(db.execute).mock.calls.find(([sql]) => /INSERT INTO categories/.test(sql))
    expect(insertCall![1]).toContain('أجهزة منزلية')
  })

  it('createCategory returns a duplicate error and does not insert when the name already exists (case-insensitive)', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({ id: 'c1' } as any)

    const { createCategory } = useCategories()
    const result = await createCategory('هواتف')

    expect(result).toEqual({ id: null, error: 'duplicate' })
    expect(vi.mocked(db.execute).mock.calls.some(([sql]) => /INSERT INTO categories/.test(sql))).toBe(false)
  })

  it('renameCategory updates the name when not taken by another category', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce(null)

    const { renameCategory } = useCategories()
    const result = await renameCategory('c1', 'هواتف ذكية')

    expect(result.error).toBeNull()
    const updateCall = vi.mocked(db.execute).mock.calls.find(([sql]) => /UPDATE categories/.test(sql))
    expect(updateCall![1]).toEqual(expect.arrayContaining(['هواتف ذكية', 'c1']))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/useCategories.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
import { ref } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import type {
  CategoryWithSubcategories, CategoryRow, SubcategoryRow,
} from '@/features/categories/category.types'

export function useCategories() {
  const categoriesWithSubcategories = ref<CategoryWithSubcategories[]>([])

  async function load(): Promise<void> {
    const device = useDeviceStore()
    const categoryRows = await db.getAll<CategoryRow>(
      `SELECT * FROM categories WHERE shop_id = ? ORDER BY name`, [device.shopId]
    )
    const subcategoryRows = await db.getAll<SubcategoryRow>(
      `SELECT * FROM subcategories WHERE shop_id = ? ORDER BY name`, [device.shopId]
    )

    categoriesWithSubcategories.value = categoryRows.map(c => ({
      id: c.id, shopId: c.shop_id, name: c.name, createdAt: c.created_at,
      subcategories: subcategoryRows
        .filter(s => s.category_id === c.id)
        .map(s => ({ id: s.id, categoryId: s.category_id, shopId: s.shop_id, name: s.name, createdAt: s.created_at })),
    }))
  }

  async function createCategory(name: string): Promise<{ id: string | null; error: 'duplicate' | null }> {
    const device = useDeviceStore()
    const trimmed = name.trim()
    const existing = await db.getOptional<{ id: string }>(
      `SELECT id FROM categories WHERE shop_id = ? AND lower(name) = lower(?)`,
      [device.shopId, trimmed]
    )
    if (existing) return { id: null, error: 'duplicate' }

    const id = uuidv4()
    await db.execute(
      `INSERT INTO categories (id, shop_id, name, created_at, sync_status) VALUES (?, ?, ?, ?, 'pending')`,
      [id, device.shopId, trimmed, new Date().toISOString()]
    )
    await load()
    return { id, error: null }
  }

  async function renameCategory(id: string, name: string): Promise<{ error: 'duplicate' | null }> {
    const device = useDeviceStore()
    const trimmed = name.trim()
    const existing = await db.getOptional<{ id: string }>(
      `SELECT id FROM categories WHERE shop_id = ? AND lower(name) = lower(?) AND id != ?`,
      [device.shopId, trimmed, id]
    )
    if (existing) return { error: 'duplicate' }

    await db.execute(
      `UPDATE categories SET name = ?, sync_status = 'pending' WHERE id = ?`,
      [trimmed, id]
    )
    await load()
    return { error: null }
  }

  async function createSubcategory(categoryId: string, name: string): Promise<{ id: string | null; error: 'duplicate' | null }> {
    const device = useDeviceStore()
    const trimmed = name.trim()
    const existing = await db.getOptional<{ id: string }>(
      `SELECT id FROM subcategories WHERE category_id = ? AND lower(name) = lower(?)`,
      [categoryId, trimmed]
    )
    if (existing) return { id: null, error: 'duplicate' }

    const id = uuidv4()
    await db.execute(
      `INSERT INTO subcategories (id, category_id, shop_id, name, created_at, sync_status) VALUES (?, ?, ?, ?, ?, 'pending')`,
      [id, categoryId, device.shopId, trimmed, new Date().toISOString()]
    )
    await load()
    return { id, error: null }
  }

  async function renameSubcategory(id: string, name: string): Promise<{ error: 'duplicate' | null }> {
    const trimmed = name.trim()
    const row = await db.getOptional<{ category_id: string }>(
      `SELECT category_id FROM subcategories WHERE id = ?`, [id]
    )
    if (!row) return { error: null }
    const existing = await db.getOptional<{ id: string }>(
      `SELECT id FROM subcategories WHERE category_id = ? AND lower(name) = lower(?) AND id != ?`,
      [row.category_id, trimmed, id]
    )
    if (existing) return { error: 'duplicate' }

    await db.execute(
      `UPDATE subcategories SET name = ?, sync_status = 'pending' WHERE id = ?`,
      [trimmed, id]
    )
    await load()
    return { error: null }
  }

  return {
    categoriesWithSubcategories, load,
    createCategory, renameCategory, createSubcategory, renameSubcategory,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/useCategories.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/categories/composables/useCategories.ts src/__tests__/features/useCategories.test.ts
git commit -m "feat: useCategories load/create/rename with case-insensitive duplicate-name guard"
```

---

### Task 5: `useCategories` — delete with in-use guard

**Files:**
- Modify: `src/features/categories/composables/useCategories.ts`
- Test: `src/__tests__/features/useCategories.test.ts`

**Interfaces:**
- Produces: `deleteCategory(id: string): Promise<{ deleted: boolean; productCount: number; blockedReason?: 'in_use' | 'fallback' }>`, `deleteSubcategory(id: string): Promise<{ deleted: boolean; productCount: number }>`.
- "غير مصنف" protection (spec: "'غير مصنف' is a protected fallback"): `deleteCategory` looks up the shop's fallback category **by name** (`lower(name) = lower('غير مصنف')`), not by a cached/hardcoded id, and refuses to delete it — returning `blockedReason: 'fallback'` — regardless of its current product count.

- [ ] **Step 1: Write the failing test**

```ts
  it('deleteCategory blocks deletion when products are still assigned, with a count', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ id: 'other-cat', name: 'هواتف' } as any) // fallback-name lookup: not this category
      .mockResolvedValueOnce({ count: 3 } as any)

    const { deleteCategory } = useCategories()
    const result = await deleteCategory('c1')

    expect(result).toEqual({ deleted: false, productCount: 3 })
    expect(vi.mocked(db.execute).mock.calls.some(([sql]) => /DELETE FROM categories/.test(sql))).toBe(false)
  })

  it('deleteCategory deletes when no products are assigned', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ id: 'other', name: 'غير مصنف' } as any) // fallback is a different row than c1
      .mockResolvedValueOnce({ count: 0 } as any)

    const { deleteCategory } = useCategories()
    const result = await deleteCategory('c1')

    expect(result).toEqual({ deleted: true, productCount: 0 })
    expect(vi.mocked(db.execute).mock.calls.some(([sql]) => /DELETE FROM categories/.test(sql))).toBe(true)
  })

  it('deleteCategory refuses to delete the "غير مصنف" fallback category even with zero products', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({ id: 'c1', name: 'غير مصنف' } as any)

    const { deleteCategory } = useCategories()
    const result = await deleteCategory('c1')

    expect(result).toEqual({ deleted: false, productCount: 0, blockedReason: 'fallback' })
    expect(vi.mocked(db.execute).mock.calls.some(([sql]) => /DELETE FROM categories/.test(sql))).toBe(false)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/useCategories.test.ts`
Expected: FAIL — `deleteCategory is not a function`

- [ ] **Step 3: Write the implementation**

Add to `useCategories.ts`, before the final `return`:

```ts
  async function deleteCategory(id: string): Promise<{ deleted: boolean; productCount: number; blockedReason?: 'in_use' | 'fallback' }> {
    const device = useDeviceStore()
    const fallback = await db.getOptional<{ id: string; name: string }>(
      `SELECT id, name FROM categories WHERE shop_id = ? AND lower(name) = lower('غير مصنف')`,
      [device.shopId]
    )
    if (fallback && fallback.id === id) {
      return { deleted: false, productCount: 0, blockedReason: 'fallback' }
    }

    const row = await db.getOptional<{ count: number }>(
      `SELECT COUNT(*) as count FROM products WHERE category_id = ? AND (deleted = 0 OR deleted IS NULL)`,
      [id]
    )
    const productCount = row?.count ?? 0
    if (productCount > 0) return { deleted: false, productCount, blockedReason: 'in_use' }

    await db.execute(`DELETE FROM categories WHERE id = ?`, [id])
    await load()
    return { deleted: true, productCount: 0 }
  }

  async function deleteSubcategory(id: string): Promise<{ deleted: boolean; productCount: number }> {
    const row = await db.getOptional<{ count: number }>(
      `SELECT COUNT(*) as count FROM products WHERE subcategory_id = ? AND (deleted = 0 OR deleted IS NULL)`,
      [id]
    )
    const productCount = row?.count ?? 0
    if (productCount > 0) return { deleted: false, productCount }

    await db.execute(`DELETE FROM subcategories WHERE id = ?`, [id])
    await load()
    return { deleted: true, productCount: 0 }
  }
```

Add `deleteCategory, deleteSubcategory` to the returned object.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/useCategories.test.ts`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/categories/composables/useCategories.ts src/__tests__/features/useCategories.test.ts
git commit -m "feat: block category deletion when in-use or when it is the protected غير مصنف fallback"
```

---

### Task 6: Wire `category_id`/`subcategory_id` into `useProducts` and product types

**Files:**
- Modify: `src/features/pos/pos.types.ts:9` (add fields near existing `category?: string`)
- Modify: `src/features/products/product.utils.ts`
- Modify: `src/features/products/composables/useProducts.ts`
- Test: `src/__tests__/features/useProducts.test.ts` (create if it doesn't already exist — check first with `Glob 'src/__tests__/features/useProducts*'`; if it exists, add to it instead of creating a duplicate)

**Interfaces:**
- Produces: `Product.categoryId?: string`, `Product.subcategoryId?: string`; `useProducts().save()` accepts and persists `categoryId`/`subcategoryId` (no longer writes the legacy `category` column).
- Dependency rule (spec: "subcategory-without-category"): `save()` clears `subcategoryId` to `undefined` whenever `categoryId` is not also provided — a defensive backstop in case a caller bypasses the product form's own guard (Task 6a below) that keeps the subcategory dropdown disabled until a category is chosen.

- [ ] **Step 1: Add fields to the `Product` type**

In `src/features/pos/pos.types.ts`, add after the existing `category?: string` line:

```ts
  categoryId?:        string
  subcategoryId?:     string
```

- [ ] **Step 2: Update `product.utils.ts`'s row mapping**

Modify the `ProductRow` type and `rowToProduct` function to include the new columns:

```ts
export type ProductRow = {
  // ...existing fields...
  category_id: string | null
  subcategory_id: string | null
}

export function rowToProduct(r: ProductRow): Product {
  return {
    // ...existing mapped fields...
    categoryId: r.category_id ?? undefined,
    subcategoryId: r.subcategory_id ?? undefined,
  }
}
```

(Apply this as a targeted edit alongside the existing fields already in that file — read the file first to match exact surrounding syntax before editing.)

- [ ] **Step 3: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { useProducts } from '@/features/products/composables/useProducts'

describe('useProducts — categoryId/subcategoryId', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('save() persists categoryId and subcategoryId on create', async () => {
    const { save } = useProducts()
    await save({
      shopId: 'shop1', nameAr: 'منتج جديد', salePriceUsd: 10, costPriceUsd: 5,
      currentStock: 4, lowStockThreshold: 2, isActive: true,
      categoryId: 'c1', subcategoryId: 's1',
    } as any)

    const insertCall = vi.mocked(db.execute).mock.calls.find(([sql]) => /INSERT INTO products/.test(sql))
    expect(insertCall![1]).toEqual(expect.arrayContaining(['c1', 's1']))
  })

  it('save() clears subcategoryId when no categoryId is provided (spec: subcategory-requires-category)', async () => {
    const { save } = useProducts()
    await save({
      shopId: 'shop1', nameAr: 'منتج جديد', salePriceUsd: 10, costPriceUsd: 5,
      currentStock: 4, lowStockThreshold: 2, isActive: true,
      subcategoryId: 's1',
    } as any)

    const insertCall = vi.mocked(db.execute).mock.calls.find(([sql]) => /INSERT INTO products/.test(sql))
    expect(insertCall![1]).not.toContain('s1')
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/useProducts.test.ts`
Expected: FAIL — `insertCall![1]` does not contain `'c1'`/`'s1'`

- [ ] **Step 5: Update `useProducts.ts`'s `save()`**

At the top of `save()`, before either branch, enforce the subcategory-requires-category dependency rule (spec: "subcategory-without-category" edge case) so a caller that bypasses the product form's own guard still can't persist an orphaned subcategory:

```ts
  async function save(
    data: Partial<Product> & {
      shopId: string; nameAr: string; salePriceUsd: number; costPriceUsd: number
      currentStock: number; lowStockThreshold: number; isActive: boolean
      categoryId?: string; subcategoryId?: string
    }
  ) {
    const effectiveSubcategoryId = data.categoryId ? data.subcategoryId : undefined
```

Modify the INSERT branch of `save()` (currently lines 79-95) to add the two new columns, using `effectiveSubcategoryId` instead of `data.subcategoryId`:

```ts
    } else {
      const id = uuidv4()
      await db.execute(
        `INSERT INTO products
         (id, shop_id, name_ar, name_en, barcode, category, category_id, subcategory_id,
          price_usd, cost_price_usd, current_stock, low_stock_threshold, photo_url,
          is_active, deleted, sync_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending', ?, ?)`,
        [id, data.shopId, data.nameAr, data.nameEn ?? null, normalizedBarcode || null,
         null, data.categoryId ?? null, effectiveSubcategoryId ?? null,
         data.salePriceUsd, data.costPriceUsd,
         currentStock, data.lowStockThreshold, data.photoUrl ?? null,
         data.isActive ? 1 : 0, now, now]
      )
      await load()
      await logProductCreated(id, data.nameAr)
      return id
    }
```

And the UPDATE branch (currently lines 60-78), also using `effectiveSubcategoryId`:

```ts
    if (data.id) {
      const old = await db.getOptional<{ price_usd: number }>(
        `SELECT price_usd FROM products WHERE id = ?`, [data.id]
      )
      await db.execute(
        `UPDATE products SET name_ar=?, name_en=?, barcode=?, category_id=?, subcategory_id=?,
         price_usd=?, cost_price_usd=?, current_stock=?, low_stock_threshold=?,
         photo_url=?, is_active=?, updated_at=?, sync_status='pending' WHERE id=?`,
        [data.nameAr, data.nameEn ?? null, normalizedBarcode || null,
         data.categoryId ?? null, effectiveSubcategoryId ?? null,
         data.salePriceUsd, data.costPriceUsd, currentStock, data.lowStockThreshold,
         data.photoUrl ?? null, data.isActive ? 1 : 0, now, data.id]
      )
      await load()
      if (old && old.price_usd !== data.salePriceUsd) {
        await logProductPriceChanged(data.id, data.nameAr, old.price_usd, data.salePriceUsd)
      } else {
        await logProductUpdated(data.id, data.nameAr)
      }
      return data.id
    }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/useProducts.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/features/pos/pos.types.ts src/features/products/product.utils.ts src/features/products/composables/useProducts.ts src/__tests__/features/useProducts.test.ts
git commit -m "feat: useProducts.save() persists category_id/subcategory_id, enforces subcategory-requires-category"
```

---

### Task 6a: Product form UI — disable subcategory until a category is chosen

**Files:**
- Modify: the product add/edit form component (same file located and read in Task 8's Step 5 below — locate now with `Glob 'src/features/products/components/*Form*.vue'` if not already open).

**Interfaces:**
- Produces: the subcategory `<select>`/dropdown in the product form is disabled (and its bound value cleared) whenever no category is selected, matching the spec's UI-layer half of the subcategory-requires-category rule (the `useProducts().save()` defensive backstop is Task 6's `effectiveSubcategoryId`).

- [ ] **Step 1: Read the product form component in full** to find its existing category field and local form-state pattern (`ref`/`reactive`).

- [ ] **Step 2: Add the guard**

Bind the subcategory control's `:disabled` to `!form.categoryId` (or the equivalent local state name found in Step 1), and add a `watch`/handler that clears `form.subcategoryId` to `undefined` whenever `form.categoryId` changes to a falsy value or to a category that isn't the subcategory's parent. Filter the subcategory options list to only the subcategories belonging to the currently selected category (via `useCategories().categoriesWithSubcategories`).

- [ ] **Step 3: Manual verification**

Run: `npm run dev`, open the product add form, confirm the subcategory field is disabled/empty until a category is picked, and that switching category clears any previously selected subcategory.

- [ ] **Step 4: Commit**

```bash
git add src/features/products/components/
git commit -m "feat: disable subcategory selection in the product form until a category is chosen"
```

---

### Task 7: Categories management screen

**Files:**
- Create: `src/features/categories/components/CategoriesManagementScreen.vue`
- Test: `src/__tests__/features/CategoriesManagementScreen.test.ts`

**Interfaces:**
- Consumes: `useCategories()` (Tasks 4-5).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import CategoriesManagementScreen from '@/features/categories/components/CategoriesManagementScreen.vue'

describe('CategoriesManagementScreen', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
      if (/FROM categories/.test(sql)) return [{ id: 'c1', shop_id: 'shop1', name: 'هواتف', created_at: '2026-07-14T00:00:00Z' }] as any
      if (/FROM subcategories/.test(sql)) return [] as any
      return []
    })
  })

  it('lists categories and creates a new one from the input', async () => {
    const wrapper = mount(CategoriesManagementScreen)
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.text()).toContain('هواتف')

    await wrapper.get('[data-testid="new-category-input"]').setValue('أجهزة منزلية')
    await wrapper.get('[data-testid="new-category-submit"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    const insertCall = vi.mocked(db.execute).mock.calls.find(([sql]) => /INSERT INTO categories/.test(sql))
    expect(insertCall![1]).toContain('أجهزة منزلية')
  })

  it('blocks delete and shows the product count and reassignment guidance when a category is in use', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ id: 'other', name: 'غير مصنف' } as any) // fallback lookup: not c1
      .mockResolvedValueOnce({ count: 4 } as any)
    const wrapper = mount(CategoriesManagementScreen)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.get('[data-testid="delete-category-c1"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.text()).toContain('4')
    expect(wrapper.text()).toContain('قائمة المنتجات')
  })

  it('blocks delete of the غير مصنف fallback category with a distinct message, even with zero products', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({ id: 'c1', name: 'غير مصنف' } as any)
    const wrapper = mount(CategoriesManagementScreen)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.get('[data-testid="delete-category-c1"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.get('[data-testid="blocked-message"]').text()).toContain('غير مصنف')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/CategoriesManagementScreen.test.ts`
Expected: FAIL — component file not found

- [ ] **Step 3: Write the component**

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useCategories } from '@/features/categories/composables/useCategories'

const { categoriesWithSubcategories, load, createCategory, renameCategory,
        createSubcategory, deleteCategory, deleteSubcategory } = useCategories()

const newCategoryName = ref('')
const newSubcategoryName = ref<Record<string, string>>({})
const blockedMessage = ref<string | null>(null)

onMounted(load)

async function addCategory() {
  const name = newCategoryName.value.trim()
  if (!name) return
  const result = await createCategory(name)
  if (result.error === 'duplicate') {
    blockedMessage.value = 'هذه الفئة موجودة بالفعل'
    return
  }
  newCategoryName.value = ''
}

async function addSubcategory(categoryId: string) {
  const name = (newSubcategoryName.value[categoryId] ?? '').trim()
  if (!name) return
  const result = await createSubcategory(categoryId, name)
  if (result.error === 'duplicate') {
    blockedMessage.value = 'هذه الفئة الفرعية موجودة بالفعل'
    return
  }
  newSubcategoryName.value[categoryId] = ''
}

async function removeCategory(id: string) {
  const result = await deleteCategory(id)
  if (result.deleted) {
    blockedMessage.value = null
  } else if (result.blockedReason === 'fallback') {
    // "غير مصنف" is the shop's protected fallback for uncategorized products (spec:
    // "غير مصنف" sanctity) — it can be renamed but never deleted while it serves that role.
    blockedMessage.value = 'لا يمكن حذف فئة "غير مصنف" لأنها الفئة الاحتياطية للمنتجات غير المصنفة.'
  } else {
    // No bulk-reassignment UI in v1 (spec: Category management — out of scope) — point
    // the owner at the Product List's own category filter instead of promising a path
    // that doesn't exist here.
    blockedMessage.value = `لا يمكن حذف هذه الفئة، ${result.productCount} منتج مرتبط بها. أعد تصنيف هذه المنتجات من قائمة المنتجات أولاً.`
  }
}

async function removeSubcategory(id: string) {
  const result = await deleteSubcategory(id)
  blockedMessage.value = result.deleted
    ? null
    : `لا يمكن حذف هذه الفئة الفرعية، ${result.productCount} منتج مرتبط بها.`
}
</script>

<template>
  <div dir="rtl" class="categories-screen">
    <h1>إدارة الفئات</h1>

    <p v-if="blockedMessage" data-testid="blocked-message">{{ blockedMessage }}</p>

    <div class="new-category-row">
      <input v-model="newCategoryName" data-testid="new-category-input" placeholder="اسم فئة جديدة" />
      <button data-testid="new-category-submit" @click="addCategory">إضافة</button>
    </div>

    <div v-for="cat in categoriesWithSubcategories" :key="cat.id" class="category-block">
      <div class="category-row">
        <input :value="cat.name" @change="renameCategory(cat.id, ($event.target as HTMLInputElement).value)" />
        <button :data-testid="`delete-category-${cat.id}`" @click="removeCategory(cat.id)">حذف</button>
      </div>

      <ul>
        <li v-for="sub in cat.subcategories" :key="sub.id">
          <input :value="sub.name" @change="renameSubcategory(sub.id, ($event.target as HTMLInputElement).value)" />
          <button :data-testid="`delete-subcategory-${sub.id}`" @click="removeSubcategory(sub.id)">حذف</button>
        </li>
      </ul>

      <div class="new-subcategory-row">
        <input v-model="newSubcategoryName[cat.id]" placeholder="فئة فرعية جديدة" />
        <button @click="addSubcategory(cat.id)">إضافة فئة فرعية</button>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/CategoriesManagementScreen.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/categories/components/CategoriesManagementScreen.vue src/__tests__/features/CategoriesManagementScreen.test.ts
git commit -m "feat: categories management screen with in-use/fallback delete guards and duplicate-name messaging"
```

---

### Task 8: Quick-add category from the product form

**Files:**
- Create: `src/features/categories/components/CategoryQuickAdd.vue`
- Test: `src/__tests__/features/CategoryQuickAdd.test.ts`
- Modify: the product add/edit form component — read it first (likely `src/features/products/components/ProductForm.vue` or similar; locate with `Glob 'src/features/products/components/*Form*.vue'`) to match its existing field/modal conventions before wiring this in.

**Interfaces:**
- Consumes: `useCategories()`.
- Produces: emits `(e: 'created', categoryId: string): void` so the parent form can select the newly created category immediately (mirrors Epic 4's customer quick-add "Save and use" pattern).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import CategoryQuickAdd from '@/features/categories/components/CategoryQuickAdd.vue'

describe('CategoryQuickAdd', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('creates a category and emits created with its id', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce(null)
    const wrapper = mount(CategoryQuickAdd)

    await wrapper.get('[data-testid="quick-add-category-input"]').setValue('إلكترونيات')
    await wrapper.get('[data-testid="quick-add-category-submit"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.emitted('created')).toBeTruthy()
    expect(typeof wrapper.emitted('created')![0][0]).toBe('string')
  })

  it('shows a duplicate-name error and does not emit created when the name already exists', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({ id: 'c1' } as any)
    const wrapper = mount(CategoryQuickAdd)

    await wrapper.get('[data-testid="quick-add-category-input"]').setValue('هواتف')
    await wrapper.get('[data-testid="quick-add-category-submit"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.emitted('created')).toBeFalsy()
    expect(wrapper.text()).toContain('موجودة بالفعل')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/CategoryQuickAdd.test.ts`
Expected: FAIL — component file not found

- [ ] **Step 3: Write the component**

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useCategories } from '@/features/categories/composables/useCategories'

const emit = defineEmits<{ (e: 'created', categoryId: string): void }>()

const { createCategory } = useCategories()
const name = ref('')
const errorMessage = ref<string | null>(null)

async function submit() {
  const trimmed = name.value.trim()
  if (!trimmed) return
  const result = await createCategory(trimmed)
  if (result.error === 'duplicate') {
    errorMessage.value = 'هذه الفئة موجودة بالفعل'
    return
  }
  errorMessage.value = null
  name.value = ''
  emit('created', result.id!)
}
</script>

<template>
  <div dir="rtl" class="category-quick-add">
    <input v-model="name" data-testid="quick-add-category-input" placeholder="اسم الفئة" />
    <button data-testid="quick-add-category-submit" @click="submit">حفظ واستخدام</button>
    <p v-if="errorMessage" data-testid="quick-add-category-error">{{ errorMessage }}</p>
  </div>
</template>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/CategoryQuickAdd.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into the product form**

Read the product add/edit form component in full, then add `<CategoryQuickAdd @created="onCategoryCreated" />` behind a "+ فئة جديدة" toggle button near the existing category field, where `onCategoryCreated(id: string)` sets the form's `categoryId` to the new id — mirror whatever local form-state pattern (`ref`/`reactive`) that file already uses.

- [ ] **Step 6: Commit**

```bash
git add src/features/categories/components/CategoryQuickAdd.vue src/__tests__/features/CategoryQuickAdd.test.ts src/features/products/components/
git commit -m "feat: quick-add category from the product form without losing in-progress form state"
```

---

### Task 9: `ProductList.vue` — real category/subcategory filter

**Files:**
- Modify: `src/features/products/components/ProductList.vue`
- Test: `src/__tests__/features/ProductList.test.ts` (create if none exists — check with Glob first; if one exists, extend it rather than duplicating)

**Interfaces:**
- Consumes: `useCategories().categoriesWithSubcategories`.
- Produces: `ProductList.vue` filters/sorts by `categoryId`/`subcategoryId` instead of deriving categories from the `products` prop's free-text strings.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import ProductList from '@/features/products/components/ProductList.vue'

describe('ProductList — category filter (real categories)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
      if (/FROM categories/.test(sql)) return [{ id: 'c1', shop_id: 'shop1', name: 'هواتف', created_at: '2026-07-14T00:00:00Z' }] as any
      if (/FROM subcategories/.test(sql)) return [] as any
      return []
    })
  })

  const products = [
    { id: 'p1', nameAr: 'هاتف A', barcode: '1', costPriceUsd: 5, salePriceUsd: 10, currentStock: 3, lowStockThreshold: 1, categoryId: 'c1' },
    { id: 'p2', nameAr: 'قلم',   barcode: '2', costPriceUsd: 1, salePriceUsd: 2,  currentStock: 20, lowStockThreshold: 5, categoryId: undefined },
  ] as any

  it('filters the product list to the selected category id', async () => {
    const wrapper = mount(ProductList, { props: { products } })
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.get('[data-testid="category-filter-btn"]').trigger('click')
    await wrapper.get('[data-testid="category-option-c1"]').trigger('click')

    expect(wrapper.text()).toContain('هاتف A')
    expect(wrapper.text()).not.toContain('قلم')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/ProductList.test.ts`
Expected: FAIL — `data-testid="category-filter-btn"` not found (current markup uses `search-filter-btn`) or filter has no effect (current logic filters on `p.category` string, not `categoryId`)

- [ ] **Step 3: Replace the category-derivation logic**

In `ProductList.vue`, replace the block currently at lines 25-39 (`// ── Category filter (#9) ──` through `selectedCategoryLabel`) with:

```ts
// ── Category filter (#9) — real categories table, not derived from products ──
import { useCategories } from '@/features/categories/composables/useCategories'
const { categoriesWithSubcategories, load: loadCategories } = useCategories()
onMounted(loadCategories)

const selectedCategoryId    = ref<string | null>(null)   // null = all categories
const selectedSubcategoryId = ref<string | null>(null)    // null = all subcategories in the selected category

const categoryOptions = computed(() => [
  { label: 'كل الفئات', value: null },
  ...categoriesWithSubcategories.value.map(c => ({ label: c.name, value: c.id })),
])
const selectedCategoryLabel = computed(() => {
  if (!selectedCategoryId.value) return 'كل الفئات'
  return categoriesWithSubcategories.value.find(c => c.id === selectedCategoryId.value)?.name ?? 'كل الفئات'
})
const subcategoryOptions = computed(() => {
  const cat = categoriesWithSubcategories.value.find(c => c.id === selectedCategoryId.value)
  if (!cat) return []
  return [{ label: 'كل الفئات الفرعية', value: null }, ...cat.subcategories.map(s => ({ label: s.name, value: s.id }))]
})
```

(`onMounted` is already imported at line 2; add the new `import { useCategories } ...` line near the top with the other imports rather than inline as shown here — this snippet groups them for clarity.)

- [ ] **Step 4: Update `displayed` to filter on ids**

Replace the category-filtering line inside `displayed` (currently `if (selectedCategory.value) { list = list.filter(p => (p.category ?? '').trim() === selectedCategory.value) }`) with:

```ts
  if (selectedCategoryId.value) {
    list = list.filter(p => p.categoryId === selectedCategoryId.value)
  }
  if (selectedSubcategoryId.value) {
    list = list.filter(p => p.subcategoryId === selectedSubcategoryId.value)
  }
```

- [ ] **Step 5: Update the template's category dropdown**

Replace `data-testid`-bearing markup at lines 191-224 to use `category-filter-btn` / `category-option-${option.value}` and drive off `categoryOptions`/`chooseCategory` operating on `selectedCategoryId` (rename the existing `chooseCategory(category)` function's parameter/body to set `selectedCategoryId.value = category; selectedSubcategoryId.value = null` — clearing subcategory whenever the category selection changes). Add a second, conditionally-rendered dropdown below it for `subcategoryOptions` when `subcategoryOptions.value.length > 1`, following the same markup pattern (button + `role="listbox"` menu) already used for the category dropdown.

- [ ] **Step 6: Update the `categories`-derivation `watch` that resets stale selections**

Replace the `watch(categories, ...)` block (currently lines 111-115) with:

```ts
watch(categoriesWithSubcategories, (next) => {
  if (selectedCategoryId.value && !next.some(c => c.id === selectedCategoryId.value)) {
    selectedCategoryId.value = null
    selectedSubcategoryId.value = null
  }
})
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/ProductList.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/features/products/components/ProductList.vue src/__tests__/features/ProductList.test.ts
git commit -m "feat: ProductList filters/sorts by real category/subcategory ids instead of derived free text"
```

---

### Task 10: POS category chip filter

**Files:**
- Create: `src/features/pos/components/ProductPickerCategoryChips.vue`
- Test: `src/__tests__/features/ProductPickerCategoryChips.test.ts`
- Modify: the POS product picker component — locate with `Glob 'src/features/pos/**/*.vue'` for the component rendering the sellable product grid/list (likely `SalePanel.vue` per the earlier grep hit) and wire the chip strip in above the product results, filtering the same way `ProductList.vue`'s category filter does.

**Interfaces:**
- Produces: emits `(e: 'select', categoryId: string | null, subcategoryId: string | null): void`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import ProductPickerCategoryChips from '@/features/pos/components/ProductPickerCategoryChips.vue'

describe('ProductPickerCategoryChips', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
      if (/FROM categories/.test(sql)) return [{ id: 'c1', shop_id: 'shop1', name: 'هواتف', created_at: '2026-07-14T00:00:00Z' }] as any
      if (/FROM subcategories/.test(sql)) return [{ id: 's1', category_id: 'c1', shop_id: 'shop1', name: 'إكسسوارات', created_at: '2026-07-14T00:00:00Z' }] as any
      return []
    })
  })

  it('emits select with the category id when a chip is tapped, and reveals its subcategory chips', async () => {
    const wrapper = mount(ProductPickerCategoryChips)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.get('[data-testid="category-chip-c1"]').trigger('click')

    expect(wrapper.emitted('select')![0]).toEqual(['c1', null])
    expect(wrapper.find('[data-testid="subcategory-chip-s1"]').exists()).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/ProductPickerCategoryChips.test.ts`
Expected: FAIL — component file not found

- [ ] **Step 3: Write the component**

```vue
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useCategories } from '@/features/categories/composables/useCategories'

const emit = defineEmits<{ (e: 'select', categoryId: string | null, subcategoryId: string | null): void }>()

const { categoriesWithSubcategories, load } = useCategories()
const activeCategoryId = ref<string | null>(null)

onMounted(load)

const activeSubcategories = computed(() =>
  categoriesWithSubcategories.value.find(c => c.id === activeCategoryId.value)?.subcategories ?? []
)

function chooseCategory(id: string | null) {
  activeCategoryId.value = id
  emit('select', id, null)
}

function chooseSubcategory(id: string | null) {
  emit('select', activeCategoryId.value, id)
}
</script>

<template>
  <div dir="rtl" class="category-chips">
    <button
      data-testid="category-chip-all"
      :class="{ active: activeCategoryId === null }"
      @click="chooseCategory(null)"
    >الكل</button>
    <button
      v-for="cat in categoriesWithSubcategories"
      :key="cat.id"
      :data-testid="`category-chip-${cat.id}`"
      :class="{ active: activeCategoryId === cat.id }"
      @click="chooseCategory(cat.id)"
    >{{ cat.name }}</button>

    <div v-if="activeSubcategories.length" class="subcategory-chips">
      <button
        v-for="sub in activeSubcategories"
        :key="sub.id"
        :data-testid="`subcategory-chip-${sub.id}`"
        @click="chooseSubcategory(sub.id)"
      >{{ sub.name }}</button>
    </div>
  </div>
</template>

<style scoped>
.category-chips { display: flex; gap: 8px; overflow-x: auto; }
.category-chips button.active { font-weight: 700; }
.subcategory-chips { display: flex; gap: 6px; overflow-x: auto; margin-top: 6px; }
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/ProductPickerCategoryChips.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into the POS product picker**

Read the POS product-picker component (e.g. `SalePanel.vue`) in full, then add `<ProductPickerCategoryChips @select="onCategorySelect" />` above the product results, where `onCategorySelect(categoryId, subcategoryId)` narrows the existing sellable-products list by `categoryId`/`subcategoryId` the same way `ProductList.vue`'s `displayed` computed does (Task 9, Step 4) — additive to, not replacing, existing barcode/name search.

- [ ] **Step 6: Commit**

```bash
git add src/features/pos/components/ProductPickerCategoryChips.vue src/__tests__/features/ProductPickerCategoryChips.test.ts src/features/pos/SalePanel.vue
git commit -m "feat: POS category chip filter with subcategory drill-down"
```

---

### Task 11: Profit Report "By category" view (Reporting Pack)

**Files:**
- Create: `src/features/dashboard/composables/useCategoryBreakdown.ts`
- Test: `src/__tests__/features/useCategoryBreakdown.test.ts`
- Modify: `src/features/dashboard/components/ReportsPage.vue`

**Interfaces:**
- Consumes: `db.getAll` from `@/data/powersync/db`; `useDeviceStore()`.
- Produces: `useCategoryBreakdown().load(start: string, end: string): Promise<void>`, `rows: Ref<{ categoryId: string; categoryName: string; revenueUsd: number; cogsUsd: number; profitUsd: number; hasMissingCost: boolean }[]>` sorted by `profitUsd` descending, `loadSubcategoryRows(categoryId: string, start: string, end: string): Promise<{...}[]>` for the drill-down.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { useCategoryBreakdown } from '@/features/dashboard/composables/useCategoryBreakdown'

describe('useCategoryBreakdown', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('groups revenue/COGS/profit by category, sorted by profit descending, including غير مصنف', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { category_id: 'c1', category_name: 'هواتف',   revenue_usd: 500, cogs_usd: 300, has_missing_cost: 0 },
      { category_id: 'c2', category_name: 'غير مصنف', revenue_usd: 100, cogs_usd: 90,  has_missing_cost: 1 },
    ] as any)

    const { load, rows } = useCategoryBreakdown()
    await load('2026-07-01', '2026-07-14')

    expect(rows.value).toHaveLength(2)
    expect(rows.value[0]).toMatchObject({ categoryName: 'هواتف', revenueUsd: 500, cogsUsd: 300, profitUsd: 200 })
    expect(rows.value[1]).toMatchObject({ categoryName: 'غير مصنف', profitUsd: 10, hasMissingCost: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/useCategoryBreakdown.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

export interface CategoryBreakdownRow {
  categoryId:       string
  categoryName:     string
  revenueUsd:       number
  cogsUsd:          number
  profitUsd:        number
  hasMissingCost:   boolean
}

type Row = {
  category_id: string; category_name: string
  revenue_usd: number; cogs_usd: number; has_missing_cost: number
}

export function useCategoryBreakdown() {
  const rows = ref<CategoryBreakdownRow[]>([])

  async function load(start: string, end: string): Promise<void> {
    const device = useDeviceStore()
    const result = await db.getAll<Row>(
      `SELECT c.id AS category_id, c.name AS category_name,
              COALESCE(SUM(sli.quantity * sli.unit_price_usd), 0) AS revenue_usd,
              COALESCE(SUM(sli.quantity * COALESCE(sli.unit_cost_usd, 0)), 0) AS cogs_usd,
              MAX(CASE WHEN p.cost_price_usd IS NULL OR p.cost_price_usd <= 0 THEN 1 ELSE 0 END) AS has_missing_cost
       FROM sale_line_items sli
       JOIN sales s ON s.id = sli.sale_id
       JOIN products p ON p.id = sli.product_id
       JOIN categories c ON c.id = p.category_id
       WHERE s.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY c.id, c.name
       ORDER BY (COALESCE(SUM(sli.quantity * sli.unit_price_usd), 0)
                 - COALESCE(SUM(sli.quantity * COALESCE(sli.unit_cost_usd, 0)), 0)) DESC`,
      [device.shopId, start, end]
    )

    rows.value = result.map(r => ({
      categoryId: r.category_id,
      categoryName: r.category_name,
      revenueUsd: r.revenue_usd,
      cogsUsd: r.cogs_usd,
      profitUsd: r.revenue_usd - r.cogs_usd,
      hasMissingCost: r.has_missing_cost === 1,
    }))
  }

  async function loadSubcategoryRows(categoryId: string, start: string, end: string): Promise<CategoryBreakdownRow[]> {
    const device = useDeviceStore()
    const result = await db.getAll<Row & { category_id: string }>(
      `SELECT sc.id AS category_id, sc.name AS category_name,
              COALESCE(SUM(sli.quantity * sli.unit_price_usd), 0) AS revenue_usd,
              COALESCE(SUM(sli.quantity * COALESCE(sli.unit_cost_usd, 0)), 0) AS cogs_usd,
              MAX(CASE WHEN p.cost_price_usd IS NULL OR p.cost_price_usd <= 0 THEN 1 ELSE 0 END) AS has_missing_cost
       FROM sale_line_items sli
       JOIN sales s ON s.id = sli.sale_id
       JOIN products p ON p.id = sli.product_id
       JOIN subcategories sc ON sc.id = p.subcategory_id
       WHERE s.shop_id = ? AND p.category_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY sc.id, sc.name
       ORDER BY (COALESCE(SUM(sli.quantity * sli.unit_price_usd), 0)
                 - COALESCE(SUM(sli.quantity * COALESCE(sli.unit_cost_usd, 0)), 0)) DESC`,
      [device.shopId, categoryId, start, end]
    )

    return result.map(r => ({
      categoryId: r.category_id,
      categoryName: r.category_name,
      revenueUsd: r.revenue_usd,
      cogsUsd: r.cogs_usd,
      profitUsd: r.revenue_usd - r.cogs_usd,
      hasMissingCost: r.has_missing_cost === 1,
    }))
  }

  return { rows, load, loadSubcategoryRows }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/useCategoryBreakdown.test.ts`
Expected: PASS

- [ ] **Step 5: Add the "By category" tab to `ReportsPage.vue`**

Read `src/features/dashboard/components/ReportsPage.vue` in full first. It already has `activeTab = ref<'profitability' | 'expenses'>('profitability')` (line ~35), and its existing missing-cost caveat is `<p v-if="metrics.profitIsEstimated.value" class="caveat">{{ t('reports.estimated') }}</p>`, using the `reports.estimated` i18n key (`src/i18n/ar.ts` / `en.ts`: "بعض المنتجات بلا تكلفة — الربح تقديري وقد يكون أقل" / "Some products have no cost — profit is estimated and may be lower"). Widen the tab union to include `'category'`, add a third tab button alongside the existing profitability/expenses tabs (matching that file's existing tab-button markup), and add a tab panel that:
- imports and calls `useCategoryBreakdown()`, loading it with the same `start`/`end` the page already computes for the active period (reuse `getReportRange`/`period`/`customStart`/`customEnd` already in scope in that file — do not add a second period selector);
- renders `rows.value` as a simple list (category name, revenue, COGS, profit), and for any row where `hasMissingCost` is true, renders the exact same `<p class="caveat">{{ t('reports.estimated') }}</p>` markup and i18n key already used by the profitability tab — not new wording, not a new class (spec DoD: same visual caveat styling as the main profitability tab);
- on tapping a row, calls `loadSubcategoryRows(categoryId, start, end)` and renders the result inline beneath that row (drill-down, not a route navigation) — this is unstyled functionally-complete markup; visual polish should follow this file's existing Tailwind/PrimeVue conventions once read.

- [ ] **Step 6: Commit**

```bash
git add src/features/dashboard/composables/useCategoryBreakdown.ts src/__tests__/features/useCategoryBreakdown.test.ts src/features/dashboard/components/ReportsPage.vue
git commit -m "feat: add By-category breakdown tab to the Profit Report with subcategory drill-down"
```

---

### Task 12: Router registration

**Files:**
- Modify: `src/router/index.ts`

**Interfaces:**
- Produces: route `/categories`.

- [ ] **Step 1: Add the route**

In `src/router/index.ts`, add after the `/products/:id/edit` route:

```ts
    { path: '/categories', component: () => import('@/features/categories/components/CategoriesManagementScreen.vue'), meta: { permission: 'can_manage_products' } },
```

- [ ] **Step 2: Add an entry point from the product list**

In `src/features/products/ProductsPage.vue` (read it first to match existing button style), add a link/button to `/categories` near the existing "Add product"/"Import from Excel" actions, e.g. `<router-link to="/categories">إدارة الفئات</router-link>`.

- [ ] **Step 3: Manual verification**

Run: `npm run dev`
Navigate to `/categories`, confirm existing free-text category values appear as real categories (post-migration) with a "غير مصنف" bucket present; create/rename/delete a category and subcategory; confirm the product list's category filter and the POS category chips reflect the same data; confirm the Profit Report's "By category" tab sums correctly for a period with test sales.

- [ ] **Step 4: Commit**

```bash
git add src/router/index.ts src/features/products/ProductsPage.vue
git commit -m "feat: register categories management route and add entry point from product list"
```

---

## Self-Review Notes

- **Spec coverage:** data model + migration + backfill (Task 1), management screen (Task 7), quick-add (Task 8), deletion guard incl. "غير مصنف" fallback protection (Task 5), subcategory-requires-category dependency at both the composable/UI layers (Task 6, Task 6a), case-insensitive duplicate-name guard on create/rename (Task 4), product list filter/sort (Task 9), POS chip filter with subcategory drill-down (Task 10), Profit Report "By category" view with subcategory drill-down, غير مصنف row, and the shared missing-cost caveat styling (Task 11), routing/entry points (Task 12). Not in this plan (per spec's explicit out-of-scope): automated category-merge tooling, bulk category-reassignment UI (documented as a v1 non-goal — the blocked-delete message points to the Product List filter instead), home-screen dashboard category breakdown, more than two nesting levels.
- **Review-driven hardening (post-spec-review addition):** four edge cases flagged in review are now covered — (1) the deletion-blocked message no longer promises an in-app "reassignment path" that doesn't exist; it names the Product List filter instead, and Option B (documented out-of-scope) was chosen over building a bulk-move dropdown to keep this plan's scope lean; (2) "غير مصنف" is looked up dynamically by name and `deleteCategory` refuses to delete it regardless of product count; (3) `createCategory`/`renameCategory`/`createSubcategory`/`renameSubcategory` all pre-check for a case-insensitive name collision and return a typed `{ error: 'duplicate' }` instead of letting a raw Postgres unique-violation reach the UI; (4) `subcategoryId` can never be persisted without a `categoryId` — enforced defensively in `useProducts().save()` (Task 6) and proactively in the product form UI (Task 6a).
- **Type consistency checked:** `Category`/`Subcategory`/`CategoryWithSubcategories` (Task 3) used identically across Tasks 4-11; `Product.categoryId`/`subcategoryId` (Task 6) match the column names (`category_id`/`subcategory_id`) used in Tasks 1-2's schema and every query in Tasks 9-11; the `{ id, error }`/`{ error }` return shapes introduced in Task 4 are threaded consistently through every caller in Tasks 7 and 8 (no caller still assumes the old bare-string/void return).
- **No placeholders:** every step contains complete, runnable code; the "read this file first, then wire in" steps (Task 6a Step 1, Task 8 Step 5, Task 10 Step 5, Task 11 Step 5, Task 12 Step 2) name the exact file, the exact prop/emit/state to add, and the exact existing pattern to mirror — they defer to files not yet read in this planning pass, not to vague follow-up work.
