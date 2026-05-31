# Epic 2 — Manage Products & Track Stock: Design Spec

**Date:** 2026-05-31  
**Epic:** EPIC-02  
**Scope:** Ship-first wave (Stories 2.1, 2.2, 2.4, 2.5, 2.6)  
**Deferred:** Story 2.3 (Excel import wizard), Story 2.7 (offline edge cases)

---

## Scope

This spec covers the ship-first subset of Epic 2:

| Story | Title |
|---|---|
| 2.1 | Add a product manually |
| 2.2 | Scan a barcode to find or add a product |
| 2.4 | Stock deducts automatically when sales are rung |
| 2.5 | See low-stock alerts on the home screen |
| 2.6 | Edit a product (including manual stock adjustment) |

Stories 2.3 (Excel import) and 2.7 (offline browsing edge cases) are deferred to a follow-up wave. PowerSync already handles the offline reads; Story 2.7 is mostly edge case hardening.

---

## Architecture

### Approach

Feature-first: a new `src/features/products/` folder owns all product management UI and logic. The Back Office gets its own hub page at `/back-office`. The existing PowerSync schema is extended in-place.

### Folder structure

```
src/
  features/
    products/
      composables/
        useProducts.ts            # all DB reads/writes for products
        useStockAdjustment.ts     # dialog UI state: visibility, reason, notes capture
        useLowStockAlerts.ts      # reactive low-stock query
      components/
        ProductList.vue           # desktop table + mobile card list
        ProductForm.vue           # add/edit form (mode prop: 'add' | 'edit')
        StockAdjustmentDialog.vue # reason modal triggered on stock edit
        ProductPhotoUpload.vue    # camera/upload + WebP compression to 200KB
      BackOfficePage.vue          # hub: 2×2 nav launcher tiles
      ProductsPage.vue            # wraps ProductList + search bar + FAB
      AddProductPage.vue          # thin wrapper — ProductForm in add mode
      EditProductPage.vue         # thin wrapper — ProductForm in edit mode
```

`ProductForm` is a single component that takes `mode: 'add' | 'edit'` and `product?: Product`. Both pages share one form implementation.

`useStockAdjustment` owns dialog UI state (open/close, selected reason, notes text). When the user confirms, it calls `useProducts().adjustStock()` which does the actual DB write. The two composables have distinct responsibilities: one is UI state, one is data.

---

## Data Layer

### Schema changes (`src/data/powersync/schema.ts`)

**`products` table — add 8 columns:**

| Column | Type | Notes |
|---|---|---|
| `cost_price_usd` | real | Required, ≥ 0 |
| `category` | text | Optional, free text |
| `current_stock` | integer | Required, may be negative |
| `low_stock_threshold` | integer | Optional, default 5 |
| `created_at` | text | ISO timestamp, set on insert |
| `updated_at` | text | ISO timestamp, set on every write |
| `deleted` | integer | 0/1 soft-delete flag, default 0 |
| `sync_status` | text | pending / syncing / synced / error |

**New `stock_adjustments` table:**

| Column | Type | Notes |
|---|---|---|
| `id` | text | UUID, generated locally |
| `product_id` | text | FK → products |
| `old_value` | integer | Stock before adjustment |
| `new_value` | integer | Stock after adjustment |
| `reason` | text | stocktake / damaged / lost / other / sale |
| `notes` | text | Required when reason = other |
| `created_at` | text | ISO timestamp |
| `device_id` | text | Which device made the change |

`reason = 'sale'` is an internal-only value written by the sale confirmation flow — it is never shown in the UI dialog.

### `useProducts` composable

```ts
// Exposed API
products: Ref<Product[]>                         // filtered: deleted = 0
lowStockProducts: Ref<Product[]>                 // current_stock <= low_stock_threshold
getById(id: string): Product | undefined
save(product: Partial<Product>): Promise<void>   // insert or update; sets updated_at, sync_status
softDelete(id: string): Promise<void>            // sets deleted = 1
adjustStock(
  productId: string,
  newValue: number,
  reason: AdjustmentReason,
  notes?: string
): Promise<void>                                 // writes product + stock_adjustments atomically
```

### Stock deduction on sale (Story 2.4)

The existing `useSaleDraft` composable's confirm-sale function gets one new step after recording the sale: it loops over `saleLines` and calls `useProducts().adjustStock(productId, newStock, 'sale')` for each line item. No UI change — this runs silently on sale confirm.

---

## Navigation & Routing

### New routes

```
/back-office          → BackOfficePage.vue
/products             → ProductsPage.vue
/products/add         → AddProductPage.vue
/products/:id/edit    → EditProductPage.vue
```

### Entry points

- **App header** gets a grid icon (⊞) alongside the existing gear icon. Tapping it navigates to `/back-office`. Present on all screens including POS.
- **Back Office hub** → Products tile → `/products`
- **Products list FAB** → `/products/add`
- **"Add new product with this barcode"** (after failed scan) → `/products/add?barcode=<value>` (pre-fills barcode field)
- **Product card tap** → `/products/:id/edit`

### Low-stock alert navigation

The home screen low-stock card (currently mock data) gets wired to `useLowStockAlerts()`. Tapping it navigates to `/products?filter=low-stock` — a query param that activates the low-stock filter on the products list. Not a separate route.

### Back-navigation

Navigating back from add/edit shows an unsaved-changes confirmation dialog if the form is dirty: "تجاهل التغييرات؟" Yes/No.

---

## Screens

### Back Office Hub (`BackOfficePage.vue`)

2×2 grid of module tiles. Only Products is active (blue). Reports, Expenses, Shifts are greyed with "قريباً" label. Phone and desktop use the same layout — tiles are large enough to tap comfortably.

### Products List (`ProductsPage.vue` + `ProductList.vue`)

**Phone layout:** Card list. Each card: thumbnail (left), Arabic name + barcode (centre), price + stock (right). Low-stock cards have yellow background + `⚠` icon. Negative stock shown in red. Search bar at top with camera icon for barcode scan. Blue FAB at bottom-start for Add.

**Barcode scanning on products list:** USB scanner (keyboard emulation) types directly into the focused search bar — the existing `useBarcodeScan` composable handles this. Camera scan opens via the camera icon in the search bar. If the scanned barcode matches a product, it is shown in results. If no match, a "إضافة منتج جديد بهذا الباركود" button appears below the empty state, navigating to `/products/add?barcode=<value>`.

**Desktop layout:** Full-page table. Columns: photo, Arabic name, barcode, cost USD, sale USD, stock, threshold, actions (edit/delete). Above table: search, category filter dropdown, sort dropdown, Add button.

**States:** Default (populated), Empty (illustration + two CTAs), Search active (real-time filter), Low-stock filter active (yellow-highlighted rows only), Loading (skeleton rows).

### Add/Edit Product Form (`ProductForm.vue`)

Single-column scrollable form, four sections:

1. **Basic info:** Arabic name (required), English name (optional), barcode (optional, with camera scan icon), category (optional)
2. **Pricing:** Cost USD (required), Sale USD (required), margin % shown as green helper text below
3. **Inventory:** Current stock (required), low-stock threshold (optional, default 5)
4. **Photo:** Camera or upload. Compressed to max 200KB WebP before saving. Stored as IndexedDB blob URL locally; replaced by cloud URL after sync.

Bottom: Save (primary), Save & Add Another (secondary), Cancel.

**Add mode:** All fields empty except threshold = 5.  
**Edit mode:** All fields pre-filled. Changing the stock field triggers `StockAdjustmentDialog`.

### Stock Adjustment Dialog (`StockAdjustmentDialog.vue`)

Triggered when the stock field changes on edit and the user taps Save. Modal shows: product name, old value → new value, four radio options (Stocktake / Damaged / Lost / Other). "Other" reveals a notes textarea (required). Confirm / Cancel buttons.

### Low-Stock Alert (home screen card)

Wired to `useLowStockAlerts()`. Shows count + top 3 product names when any product is at/below threshold. Yellow accent (not red). Taps to `/products?filter=low-stock`. When no products are low, shows "كل المنتجات متوفرة" with a check icon. Updates within 1 minute of a threshold crossing (real-time via PowerSync reactive query when online; on next visit when offline).

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Required field empty on save | Red border + "هذا الحقل مطلوب" below field. Clears on input. |
| Sale price < cost price | Yellow warning banner above Save (non-blocking). Requires Yes/No confirmation. |
| Duplicate barcode | Blocking toast: "هذا الباركود مستخدم على: [name]" with link to that product. |
| Photo too large to compress | Toast: "تعذّر ضغط الصورة — حاول بصورة أخرى". No crash. |
| Delete product in open sale | Blocked with dialog: "هذا المنتج في بيع مفتوح". |
| Stock goes negative after sale | Sale completes. Stock written as negative. Product card shows red stock count. No block — spec allows this. |
| Offline operation | All operations work locally via PowerSync. Existing SyncBadge covers pending state. |
| Barcode camera timeout (30s) | Toast: "لم نتمكن من قراءة الباركود — أدخل يدوياً". Camera stays active. |

---

## Testing

| Test file | What it covers |
|---|---|
| `useProducts.test.ts` | save, softDelete, adjustStock, lowStockProducts reactive query |
| `useStockAdjustment.test.ts` | adjustment record written alongside product update; reason = 'other' requires notes |
| `ProductForm.test.ts` | required field validation, sale < cost warning, duplicate barcode error |
| `ProductList.test.ts` | low-stock filter, negative stock display, search filtering |
| `useSale.test.ts` (extend) | stock decrements correctly after sale confirm for each line item |

---

## Out of Scope (this wave)

- Story 2.3 — Excel import wizard (3-step: upload → map columns → confirm)
- Story 2.7 — Offline browsing edge cases (PowerSync handles reads; edge case hardening deferred)
- Barcode label printing (v1.5)
- Composite items / bundles (v1.5)
- Multi-location stock (Warehouse module, v1.5)
- Product cost history (current cost only in this epic)
