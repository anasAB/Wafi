# Returns & Refunds — Design Spec

**Date:** 2026-06-05
**Feature:** Returns and refunds workflow for Wafi POS
**Scope:** v1 — partial item returns from sale history, flexible refund methods, optional restock per item

---

## Overview

A cashier can initiate a return on any past sale directly from the Sale History screen. A bottom sheet slides up showing the original line items. The cashier selects which items to return, sets quantities, decides per-item whether to restock, picks a refund method, optionally picks/writes a reason, and confirms. Inventory is updated immediately. A "مرتجع" badge appears on the original sale in history.

---

## Entry Point

**Sale History only.** Each sale row (desktop table + mobile card) gains an "إرجاع" button. Tapping it opens `ReturnSheet` with that sale's line items pre-loaded. No standalone return route — returns are always linked to an original sale.

---

## Return Sheet UI

Route: none (sheet overlay, no navigation).

### Zones

**1 — Header**
- Title: `مرتجع — فاتورة #NNN`
- Subtitle: "اختر المنتجات والكميات المراد إرجاعها"

**2 — Scrollable item list**
Each row per original line item:
- Checkbox (include / exclude this item from the return)
- Product name + "تم بيع N × $X.XX"
- Qty ± controls (visible + active only when checkbox checked; min 1, max = original qty sold)
- Restock toggle (أضف للمخزون): on/off per item; visible only when checkbox checked

**3 — Reason area** (inside scrollable zone, below items)
- Owner-defined reason chips (quick select, single select)
- Free-text notes input — placeholder "ملاحظة حرة..."
- Both optional; chips and text field are independent (selecting a chip doesn't clear the text)

**4 — Fixed footer**
- "إجمالي الاسترداد" row: computed sum of selected line totals (qty_returned × unit_price_usd)
- Refund method selector — four buttons: **نقد $** / **نقد ل.س** / **رصيد حساب** / **حوالة**
  - "رصيد حساب" (store credit) is disabled and greyed out if the original sale had no customer attached
- "تأكيد الإرجاع" primary button

### Post-Confirm
- Success `AppToast`: "تم تسجيل المرتجع"
- Print button appears: "طباعة إيصال المرتجع" — calls existing `usePrinter` composable with a return receipt payload (RETURN header, returned items, refund total, refund method)
- Original sale in history gains a "مرتجع" badge (partial or full)

### Validation
- At least one item must be selected before confirm is enabled
- Qty must be ≥ 1 and ≤ (original qty sold − already returned qty for that product on this sale). Multiple partial returns on the same sale are supported; `load()` sums existing `return_line_items` to compute remaining returnable qty per product.
- Refund method must be selected

---

## Refund Methods

| Value | Label | Behaviour on confirm |
|---|---|---|
| `cash_usd` | نقد $ | Record only — no ledger entry |
| `cash_syp` | نقد ل.س | Record only — no ledger entry |
| `store_credit` | رصيد حساب | Insert negative `customer_payments` row (reduces outstanding balance) |
| `transfer` | حوالة | Record only — no ledger entry |

`store_credit` requires `original_sale.customer_id IS NOT NULL`.

---

## Return Reasons

Owner-defined. Managed in a new Settings screen at `/settings/return-reasons`.

- Owner can create, edit, reorder, deactivate reasons (e.g. "عيب في المنتج", "خطأ في البيع", "تغيير رأي")
- Active reasons appear as chips in the Return Sheet
- Reason selection is optional — cashier may leave it blank
- Free-text notes field is independent of chip selection

---

## Data Model

### New tables

#### `returns`
```
id                    TEXT PRIMARY KEY
shop_id               TEXT NOT NULL
original_sale_id      TEXT NOT NULL   -- FK → sales.id
created_at            TEXT NOT NULL
refund_method         TEXT NOT NULL   -- 'cash_usd' | 'cash_syp' | 'store_credit' | 'transfer'
refund_amount_usd     REAL NOT NULL
refund_amount_syp     REAL NOT NULL
exchange_rate_at_return REAL NOT NULL -- rate at time of return (may differ from original sale)
reason                TEXT            -- selected reason label (snapshot, not FK)
notes                 TEXT
shift_id              TEXT            -- FK → cashier_shifts.id, nullable
sync_status           TEXT NOT NULL DEFAULT 'pending'
```

#### `return_line_items`
```
id                    TEXT PRIMARY KEY
return_id             TEXT NOT NULL   -- FK → returns.id
shop_id               TEXT NOT NULL
product_id            TEXT NOT NULL   -- FK → products.id
qty_returned          INTEGER NOT NULL
unit_price_usd        REAL NOT NULL   -- snapshot from original line item
unit_price_syp        REAL NOT NULL   -- snapshot from original line item
restock               INTEGER NOT NULL DEFAULT 1  -- 0 | 1
```

#### `return_reasons`
```
id                    TEXT PRIMARY KEY
shop_id               TEXT NOT NULL
label                 TEXT NOT NULL
sort_order            INTEGER NOT NULL DEFAULT 0
is_active             INTEGER NOT NULL DEFAULT 1
```

### Modified tables
- `products.current_stock` — incremented for each `return_line_items` row where `restock = 1`
- `stock_adjustments` — new row per restocked item: `reason = 'return'`
- `customer_payments` — new row for `store_credit` refund: `amount_usd` is negative

### Schema registration
All three new tables added to `src/data/powersync/schema.ts` using the existing `Column` + `Table` pattern.

---

## Side-Effects on Confirm

Executed in sequence via `db.execute()`:

1. Insert `returns` row
2. Insert `return_line_items` rows (one per selected item)
3. For each item where `restock = 1`:
   - `UPDATE products SET current_stock = current_stock + qty_returned WHERE id = ?`
   - INSERT `stock_adjustments` row with `reason = 'return'`, `old_value`, `new_value`
4. If `refund_method = 'store_credit'`:
   - INSERT `customer_payments` row with `amount_usd = -(refund_amount_usd)`, `sale_id = original_sale_id`

---

## Architecture

```
src/features/returns/
  returns.types.ts
  composables/
    useReturnSheet.ts       — sheet state + confirm() side-effects
    useReturnReasons.ts     — fetch active reasons for shop
  components/
    ReturnSheet.vue         — bottom sheet orchestrator
    ReturnLineItem.vue      — single item row (checkbox + qty + restock toggle)
  index.ts

src/features/settings/screens/
  ReturnReasonsScreen.vue   — owner CRUD for return_reasons table
```

### Modified files
- `src/data/powersync/schema.ts` — add 3 new tables
- `src/features/sale-history/SaleHistoryScreen.vue` — add "إرجاع" button + `ReturnSheet` binding
- `src/pages/SettingsPage.vue` — add Return Reasons tile + child route
- `src/router/index.ts` — add `/settings/return-reasons` child route

### `useReturnSheet.ts` interface
```ts
interface ReturnLine {
  productId: string
  productName: string
  originalQty: number
  unitPriceUsd: number
  selected: boolean
  qtyToReturn: number
  restock: boolean
}

function useReturnSheet(saleId: string) {
  const lines: Ref<ReturnLine[]>
  const refundMethod: Ref<'cash_usd' | 'cash_syp' | 'store_credit' | 'transfer' | null>
  const reason: Ref<string>
  const notes: Ref<string>
  const refundTotalUsd: ComputedRef<number>
  const canConfirm: ComputedRef<boolean>

  async function load(): Promise<void>       // fetch sale + line items
  async function confirm(): Promise<void>    // write all DB side-effects
}
```

---

## Settings: Return Reasons Screen

Route: `/settings/return-reasons` (child of `/settings`).

Simple list screen:
- Each active reason shown as a row with edit/delete actions
- "+" button to add new reason
- Drag handles for reorder (sort_order)
- Inline text input for label
- Toggle to activate/deactivate

---

## Testing

- `useReturnSheet.test.ts` — unit tests using existing `db` mock:
  - `load()` fetches correct sale + line items
  - `refundTotalUsd` computes correctly for partial selection
  - `canConfirm` false when no items selected or no method
  - `confirm()` inserts returns + return_line_items rows
  - `confirm()` increments stock for restock=1 items, skips restock=0
  - `confirm()` inserts negative customer_payments row for store_credit
  - `confirm()` does NOT insert customer_payments for cash methods

- `useReturnReasons.test.ts`:
  - Returns only active reasons for shop
  - Ordered by sort_order

---

## Out of Scope

- Return without original sale lookup (quick return)
- Exchange (return + new sale in one flow) — v1.5
- Return aging / return rate reports — v1.5
- Automated return policy enforcement (e.g. 30-day window) — v2
