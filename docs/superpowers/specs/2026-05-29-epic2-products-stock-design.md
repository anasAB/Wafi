# Epic 2 — Manage Products and Track Stock: Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Owner can add, edit, delete, and import products; stock deducts automatically on sale; low-stock alerts surface on the home screen.

**Source epic:** `epic_02_manage_products_track_stock.md`

**Depends on:** Epic 1 (sale confirmation flow, `usePayment.ts` `confirm()`, `useBarcodeScan` composable, PowerSync + Supabase infrastructure)

**Blocks:** Epic 3 (profit needs `unit_cost_usd` on sale line items, added here)

---

## Decisions Made

| Question | Decision |
|---|---|
| Spec scope | All 7 stories in one spec |
| Product photos | Local-only (Dexie IndexedDB Blob); no cloud upload in this epic |
| Products list layout | Both desktop (table) and phone (cards) — same component, responsive |
| Navigation structure | Back Office shell at `/backoffice` wraps Products and future management sections |
| Excel parsing library | `xlsx@0.18.5` (pinned — Apache 2.0; v0.19+ switched to AGPL) |
| Search strategy | PowerSync SQLite LIKE queries + Arabic diacritic normalization; no extra search library |

---

## Architecture

### Module Structure

```
src/features/products/
├── product.types.ts          — Product, StockAdjustment, ImportRow interfaces
├── useProducts.ts            — load, search, filter, sort, delete
├── useProductForm.ts         — form state, validation, save, photo compression
├── useStockAdjust.ts         — stock adjustment dialog logic + DB write
├── useExcelImport.ts         — 3-step wizard state machine + chunked import
├── ProductsScreen.vue        — list: desktop table + phone cards (same component)
├── ProductFormScreen.vue     — add/edit form (both modes)
├── ImportWizardScreen.vue    — 3-step import wizard
├── LowStockScreen.vue        — filtered low-stock list
└── index.ts

src/pages/BackOfficePage.vue  — shell: sidebar nav (desktop) + bottom tabs (phone)
```

### Routes

```
/backoffice                         → redirect to /backoffice/products
/backoffice/products                → ProductsScreen
/backoffice/products/new            → ProductFormScreen (add mode)
/backoffice/products/:id/edit       → ProductFormScreen (edit mode)
/backoffice/products/import         → ImportWizardScreen
/backoffice/products/low-stock      → LowStockScreen
```

`BackOfficePage.vue` uses Vue Router's `<router-view>` with a persistent nav sidebar (desktop) or bottom tab bar (phone).

### Breaking Change: `price_usd` → `sale_price_usd`

The existing products table has `price_usd`. This epic renames it to `sale_price_usd` and adds `cost_price_usd`. **Migration tasks must update:**
- `src/data/powersync/schema.ts`
- `src/features/pos/pos.types.ts` (`priceUsd` → `salePriceUsd`)
- `src/features/pos/ProductGrid.vue` (query + display)
- `src/store/sale.store.ts` (`addLine()` reads price from product)
- Supabase SQL migration

---

## Data Layer

### Updated Products Table (PowerSync schema + Supabase migration)

Existing columns: `id`, `shop_id`, `name_ar`, `name_en`, `barcode`, `photo_url`, `is_active`

| Column | Type | Change | Notes |
|---|---|---|---|
| `price_usd` | real | **rename** → `sale_price_usd` | breaking change |
| `cost_price_usd` | real | **add** | required, ≥ 0 |
| `current_stock` | integer | **add** | can be negative |
| `low_stock_threshold` | integer | **add** | default 5 |
| `category` | text | **add** | free text |
| `deleted` | integer | **add** | soft-delete, default 0 |
| `reordered_at` | text | **add** | ISO timestamp; set on "mark as reordered"; cleared when stock > threshold |
| `updated_at` | text | **add** | ISO timestamp, updated on every save |

**Indexes (Supabase):**
```sql
CREATE INDEX idx_products_shop_active ON products (shop_id, deleted, is_active);
CREATE INDEX idx_products_barcode ON products (barcode) WHERE barcode IS NOT NULL;
```

### Updated `sale_line_items` Table

Add column:
```sql
ALTER TABLE sale_line_items ADD COLUMN unit_cost_usd real;
```

This captures the product's `cost_price_usd` at the moment the sale is confirmed. Required for Epic 3 profit calculations after prices change.

**`usePayment.ts` must also update PowerSync schema entry for `sale_line_items`** to include `unit_cost_usd`.

### New `stock_adjustments` Table

```sql
CREATE TABLE stock_adjustments (
  id          text PRIMARY KEY,
  product_id  text NOT NULL,
  shop_id     text NOT NULL,
  old_value   integer NOT NULL,
  new_value   integer NOT NULL,
  reason      text NOT NULL,  -- 'stocktake' | 'damaged' | 'lost' | 'other'
  notes       text,           -- required when reason = 'other'
  created_at  text NOT NULL,
  device_id   text NOT NULL
);
```

### Product Photo Storage (Dexie)

Add a `product_photos` table to the existing Dexie database (`src/data/dexie/draft.db.ts`):

```typescript
product_photos: '++id, productId'
// stores: { id, productId: string, blob: Blob, mimeType: string }
```

Photos are stored as Blob entries. Retrieved via `URL.createObjectURL(blob)`. Not synced to cloud in this epic.

### TypeScript Interfaces

```typescript
// product.types.ts

export interface Product {
  id:                string
  shopId:            string
  nameAr:            string
  nameEn?:           string
  barcode?:          string
  category?:         string
  costPriceUsd:      number
  salePriceUsd:      number
  currentStock:      number
  lowStockThreshold: number
  photoUrl?:         string   // local objectURL or future cloud URL
  isActive:          boolean
  deleted:           boolean
  reorderedAt?:      string
  updatedAt:         string
}

export interface StockAdjustment {
  id:        string
  productId: string
  shopId:    string
  oldValue:  number
  newValue:  number
  reason:    'stocktake' | 'damaged' | 'lost' | 'other'
  notes?:    string
  createdAt: string
  deviceId:  string
}

export interface ImportRow {
  rowIndex:     number
  nameAr?:      string
  nameEn?:      string
  barcode?:     string
  category?:    string
  costPriceUsd: number
  salePriceUsd: number
  currentStock: number
  lowStockThreshold: number
  errors:       string[]   // empty = valid row
}
```

---

## Back Office Shell

**`BackOfficePage.vue`** — persistent layout wrapper.

- **Desktop (md+):** Left sidebar, 56px wide collapsed / 200px wide expanded. Nav items: Products (icon: grid), future items (greyed out placeholders). Main content: `<router-view>` fills remaining space.
- **Phone:** Bottom tab bar (fixed). Tab items same as sidebar. Content scrolls above tabs.
- Both: `AppHeader` with shop name + back-to-home icon.

Nav item for this epic: **Products** → `/backoffice/products`.

Placeholder greyed items (no routes yet): Reports, Staff, Settings.

---

## Products List

### `useProducts.ts`

```typescript
const {
  products,       // Ref<Product[]>
  loading,        // Ref<boolean>
  search,         // Ref<string>  — debounced 200ms
  filterCategory, // Ref<string | null>
  categories,     // Ref<string[]>  — distinct categories from DB
  sortBy,         // Ref<'name' | 'stock' | 'price'>
  loadProducts,
  deleteProduct,  // soft-delete: sets deleted=1, updated_at
} = useProducts()
```

**Query:**
```sql
SELECT * FROM products
WHERE shop_id = ?
  AND deleted = 0
  AND is_active = 1
  AND (name_ar LIKE ? OR name_en LIKE ? OR barcode LIKE ?)
ORDER BY name_ar ASC
```

Search term is normalized before use: strip Arabic diacritics (tashkeel) via regex `/[ؐ-ًؚ-ٟ]/g`, wrap in `%…%`.

`loadProducts()` also fetches `SELECT DISTINCT category FROM products WHERE shop_id=? AND deleted=0` for the filter dropdown.

### `ProductsScreen.vue`

**Desktop layout (md+):**
- Toolbar: search bar (autofocus), category dropdown, sort dropdown, "إضافة منتج" button, "استيراد من Excel" button.
- Table columns: thumbnail (40×40 rounded), Arabic name, barcode, cost USD, sale USD, stock (red text if < 0; yellow if ≤ threshold), category, actions (edit pencil / delete trash).
- Row click → edit. Delete icon → `AppDialog` confirmation.

**Phone layout:**
- Sticky search bar with barcode camera icon (activates `useBarcodeScan` camera).
- Card list — thumbnail left, name + barcode right-top, stock + price right-bottom, yellow warning icon if stock ≤ threshold OR red if negative.
- FAB (bottom-start, `fixed`): "+" → navigate to `/backoffice/products/new`.
- Pull-to-refresh calls `loadProducts()`.

**States:**
- Loading: skeleton rows (desktop) / skeleton cards (phone).
- Empty (no products at all): centered illustration + "ابدأ بإضافة منتجاتك" + two buttons: Add / Import.
- Search + 0 results + search term looks like a barcode (≥4 chars, no spaces): show "إضافة منتج جديد بهذا الباركود" button → navigates to `/backoffice/products/new?barcode=<value>`.

**USB barcode scanner:** `useBarcodeScan` activated when search bar is focused. Burst populates search field; `e.preventDefault()` suppresses individual burst keystrokes (existing behavior from Epic 1).

---

## Add/Edit Product Form

### `useProductForm.ts`

Owns all form state. Initialized from route params: add mode (empty) vs edit mode (load product from PowerSync by id).

**Validation (on save attempt):**
- `nameAr`: required — red border + "هذا الحقل مطلوب"
- `costPriceUsd`: required, ≥ 0
- `salePriceUsd`: required, ≥ 0
- `barcode`: if provided, unique check: `SELECT id FROM products WHERE barcode=? AND id!=? AND deleted=0`. On conflict → "هذا الباركود مستخدم على منتج آخر: [name]" with view-product link.
- `salePriceUsd < costPriceUsd`: yellow warning banner — "سعر البيع أقل من سعر التكلفة — هل أنت متأكد؟" with Yes/No. Non-blocking (user can override).

**Save flow:**
```typescript
async function save(addAnother = false): Promise<void>
// 1. Validate. If errors → show, return.
// 2. If salePriceUsd < costPriceUsd and not yet confirmed → show warning dialog, return.
// 3. If edit mode and stock changed → show StockAdjustmentDialog, return (dialog calls saveWithAdjustment on confirm).
// 4. Upsert product row via db.execute(). Set updated_at = now().
// 5. If photo changed → save blob to Dexie product_photos.
// 6. Toast "تم حفظ المنتج".
// 7. If addAnother → reset form, focus nameAr. Else → router.push('/backoffice/products').
```

**Unsaved changes guard:** `onBeforeRouteLeave` — if any field differs from original values, show `AppDialog` "تجاهل التغييرات؟".

**Photo handling:**
- Camera capture via `<input type="file" accept="image/*" capture="environment">`.
- File upload via `<input type="file" accept="image/*">`.
- On file selected: compress via `canvas.toBlob(cb, 'image/webp', 0.8)`, resize to max 800×800 before compression. If result > 200KB, reduce quality to 0.6. If still > 200KB on very old device → reject with "لا يمكن ضغط الصورة — جرب صورة أصغر".

### `ProductFormScreen.vue`

**Form sections:**
1. Basic info: Arabic name, English name, barcode (+ camera icon), category
2. Pricing: Cost USD, Sale USD, margin % helper text (`((sale - cost) / cost * 100).toFixed(1)%`)
3. Inventory: Current stock, Low-stock threshold
4. Media: Photo preview (if set) + change/remove buttons; camera / upload triggers

**Bottom:** Save (primary), Save & Add Another (secondary), Cancel text link.

**Edit mode additions:**
- "آخر تعديل: [relative time]" at bottom using `updatedAt` formatted via `Intl.RelativeTimeFormat`.
- Delete button (destructive, below Cancel): `AppDialog` "حذف هذا المنتج؟ لن يظهر في القائمة بعد الآن، لكن سجلات البيع السابقة ستبقى." Blocks if product id is in any `saleStore.lines` entry — shows "هذا المنتج في بيع مفتوح حالياً" instead.

### `StockAdjustmentDialog`

Modal (reuses `AppDialog` pattern). Triggered when stock value changes in edit mode.

Fields:
- Reason radio: Stocktake (جرد) / Damaged (تالف) / Lost (مفقود) / Other (أخرى)
- Notes textarea: visible and required only when reason = Other.
- Shows: old value → new value ("من 10 إلى 7")

On confirm: writes `stock_adjustments` row + saves product with new stock value.

---

## Excel Import Wizard

### `useExcelImport.ts`

State machine: `upload` → `mapping` → `review` → `importing` → `done`

```typescript
const {
  step,           // Ref<'upload' | 'mapping' | 'review' | 'importing' | 'done'>
  fileHeaders,    // Ref<string[]>
  sampleRows,     // Ref<string[][]>   — first 5 rows
  mappings,       // Ref<Record<OurField, string | null>>  — our field → file column
  currencyMode,   // Ref<Record<string, 'usd' | 'syp'>>   — per price column
  preview,        // Ref<ImportRow[]>  — first 5 mapped rows
  validRows,      // Ref<ImportRow[]>
  errorRows,      // Ref<ImportRow[]>
  duplicateMode,  // Ref<'update' | 'skip'>
  inFileduplicateMode, // Ref<'first' | 'last' | 'skip'>
  progress,       // Ref<{ done: number; total: number }>
  importResult,   // Ref<{ imported: number; skipped: number } | null>
  loadFile,       // (file: File) => Promise<void>
  setMapping,
  proceedToReview,
  startImport,
  downloadErrorFile,
  reset,
} = useExcelImport()
```

**Auto-detection map** (checked case-insensitively, after stripping whitespace):

| Our field | Detected headers |
|---|---|
| nameAr | الاسم، اسم المنتج، الاسم العربي |
| nameEn | English name، name، product name، الاسم الانجليزي |
| barcode | الباركود، barcode، كود |
| costPriceUsd | التكلفة، سعر الشراء، cost، cost price |
| salePriceUsd | السعر، سعر البيع، price، selling price |
| currentStock | الكمية، المخزون، qty، quantity، stock |
| category | الفئة، category، نوع |
| lowStockThreshold | حد التنبيه، threshold، low stock |

**Currency detection:** for each price column, compute median of numeric values. If median > 5000 → suggest SYP conversion. Conversion: `value / exchangeRate` (read from exchange_rates table, latest for shop). Toggle shown per column.

**Chunked import:**
```typescript
const CHUNK = 500
for (let i = 0; i < validRows.length; i += CHUNK) {
  const chunk = validRows.slice(i, i + CHUNK)
  await db.execute('BEGIN')
  for (const row of chunk) { /* INSERT OR REPLACE INTO products ... */ }
  await db.execute('COMMIT')
  progress.value = { done: i + chunk.length, total: validRows.length }
  await nextTick()  // yield to UI for progress bar update
}
```

**Error file generation:**
```typescript
// Creates a new workbook with original columns + 'سبب الخطأ' column
// Returns as Blob, triggers download via <a download>
```

### `ImportWizardScreen.vue`

3-step progress bar at top (step dots + labels: رفع الملف / ربط الأعمدة / مراجعة واستيراد).

**Step 1 — Upload:**
- Drag-and-drop zone (large, dashed border). Click to open file picker.
- Accepted: `.xlsx`, `.xls`, `.csv`. Max 5MB.
- Error messages: format error / corrupt / too large.

**Step 2 — Map columns:**
- Two-column layout. Left: file columns with sample data. Right: our fields.
- Each our-field row: label (Arabic) + dropdown of file columns (+ "— لا يوجد —" option).
- Auto-detected: green badge "تم اكتشافه تلقائياً".
- Currency toggle per price column (USD / SYP).
- Preview table below: first 5 rows mapped.
- Continue button: disabled until required fields (nameAr, salePriceUsd, currentStock) are mapped.

**Step 3 — Review:**
- Summary card: valid count / error count.
- Duplicate handling (vs existing products): Update / Skip radio.
- In-file duplicate handling: Keep first / Keep last / Skip all radio (only shown if duplicates exist).
- Collapsible warnings list.
- Import button (large primary). During import: progress bar "150 / 247", estimated time.
- Done state: success message + "عرض المنتجات" + optional "تنزيل ملف الأخطاء".

---

## Stock Deduction on Sale

**Location:** `usePayment.ts` → `confirm()` function, after existing sale + line_items inserts.

```typescript
// After inserting sale lines:
for (const line of saleStore.lines) {
  await db.execute(
    `UPDATE products SET current_stock = current_stock - ?, updated_at = ? WHERE id = ?`,
    [line.quantity, now, line.productId]
  )
}
```

**`unit_cost_usd` on sale line items:**

When building the sale, `confirm()` must look up each product's `cost_price_usd` before inserting the line item:

```typescript
// For each line in saleStore.lines:
const [productRow] = await db.execute(
  `SELECT cost_price_usd FROM products WHERE id = ?`,
  [line.productId]
)
// Insert sale_line_items with unit_cost_usd: productRow?.cost_price_usd ?? 0
```

**Offline behavior:** Both the stock decrement and line item insert go through PowerSync's local SQLite; they are queued for sync automatically. Stock can go negative — no blocking.

**Negative stock:** Visible in Products list as red text on the stock value. No in-sale blocking or warning.

---

## Low-Stock Alerts

### `LowStockScreen.vue`

Uses `useProducts.ts` with a low-stock filter:

```sql
SELECT * FROM products
WHERE shop_id = ?
  AND deleted = 0
  AND current_stock <= low_stock_threshold
  AND (reordered_at IS NULL OR reordered_at < ?)   -- ? = now() - 7 days ISO string
ORDER BY (current_stock - low_stock_threshold) ASC  -- most critical first
```

Each row: name, current stock, threshold, "تم الطلب" button (sets `reordered_at = now()`), "تم طلبه منذ X أيام" badge if applicable.

**`reordered_at` cleared** when `current_stock > low_stock_threshold` — done inside `useProductForm.ts` save flow: if new stock > threshold, set `reordered_at = NULL`.

### Home Screen Card

Added to `HomePage.vue` `onMounted` alongside existing queries:

```sql
SELECT id, name_ar, current_stock, low_stock_threshold
FROM products
WHERE shop_id = ?
  AND deleted = 0
  AND current_stock <= low_stock_threshold
  AND (reordered_at IS NULL OR reordered_at < ?)
ORDER BY (current_stock - low_stock_threshold) ASC
LIMIT 20
```

- Result count > 0: yellow card "مخزون منخفض", count badge, top 3 names listed. Tap → `/backoffice/products/low-stock`.
- Result count = 0: yellow card with check icon "كل المنتجات متوفرة".
- Card accent: `yellow-400` (NOT red — red reserved for offline/error states per CLAUDE.md plain-language discipline).

---

## Offline (Story 2.7)

All reads and writes go through `db.execute()` (PowerSync local SQLite cache). No changes needed beyond the schema additions above.

- Product catalog available offline after first online visit (PowerSync syncs full table).
- New/edited products saved locally, queued for sync.
- Excel import inserts locally; PowerSync queues all new rows.
- Barcode search hits local cache — no server roundtrip.
- Search performance at 5,000 products: SQLite with indexes on `(shop_id, deleted, is_active)` and `barcode` handles LIKE queries well within 200ms on mid-range Android.
- Photo blobs (Dexie) are device-local and not synced — consistent with local-only photo decision.

**Conflict handling (two devices offline, edit same product):**
- Different fields (e.g., device A changes price, device B changes stock): PowerSync last-write-wins per field — both changes apply.
- Same field: last-write-wins by `updated_at` timestamp. Owner sees the result in the product list; Epic 5 audit log will surface the conflict history.

---

## Tests

### Unit Tests (`src/__tests__/features/`)

**`useProducts.test.ts`**
- Arabic diacritic normalization strips tashkeel before LIKE query
- Category filter adds AND clause
- Soft-deleted products excluded from results
- `deleteProduct` sets `deleted=1` not hard-delete

**`useProductForm.test.ts`**
- Required field validation blocks save and sets error state
- `salePriceUsd < costPriceUsd` sets warning flag (not error)
- Stock change in edit mode triggers adjustment dialog flag
- Unsaved changes detected when form differs from original
- Barcode uniqueness error set when duplicate found
- `save(true)` (add another) resets form after successful save

**`useStockAdjust.test.ts`**
- Writes `stock_adjustments` row with correct old/new values, reason, device_id
- `notes` required when reason = 'other', optional otherwise

**`useExcelImport.test.ts`**
- Auto-detects Arabic column headers (الاسم → nameAr, السعر → salePriceUsd, etc.)
- Auto-detects English column headers (name, price, qty, etc.)
- Currency detection: median > 5000 → SYP flag set
- Empty rows skipped (all cells blank)
- Duplicate barcodes within file detected and reported
- Chunked import produces correct ImportRow records from mapped columns
- Error file contains only failed rows with error reason column
- Missing required field mapping → proceedToReview returns validation error

**`stockDeduction.test.ts`** (extends existing `usePayment` tests)
- `confirm()` decrements `current_stock` by line quantity for each product
- `unit_cost_usd` on inserted sale_line_items matches product's `cost_price_usd` at confirm time
- Stock goes negative without error when quantity exceeds stock

---

## Migration Checklist

Tasks that touch existing code (must not be missed in the implementation plan):

1. `src/data/powersync/schema.ts` — add new columns to `products`; add `unit_cost_usd` to `sale_line_items`; add `stock_adjustments` table
2. `src/data/dexie/draft.db.ts` — add `product_photos` table
3. **Rename `price_usd` → `sale_price_usd`** in: schema.ts, pos.types.ts (Product interface), ProductGrid.vue (query + display), sale.store.ts (`addLine()`), usePayment.ts (confirm uses `salePriceUsd`)
4. `usePayment.ts` `confirm()` — add stock deduction loop + `unit_cost_usd` lookup
5. `HomePage.vue` — add low-stock card query + display
6. Supabase SQL migration file — all schema changes + indexes
