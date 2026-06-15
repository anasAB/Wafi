# Epic 8 — Suppliers & Stock Receiving — Design Spec

> Status: approved (2026-06-15)
> Pack: Core ($12/month)
> Roadmap line: "Simplified supplier/stock-receiving (supplier name + photo of invoice)" — closes the inventory loop opened in Epic 2.
> Sacred Rules touched: Offline-first (1), Arabic + dual currency (2).

---

## Thesis

Epic 2 lets the owner add products and watch stock go *down* as sales are rung, but stock only goes *up* via the manual `StockAdjustmentDialog`. Epic 8 closes that loop: the owner records a delivery from a supplier — itemized, with a photo of the invoice as proof — and stock goes up automatically, with the option to refresh cost prices from what was actually paid. After this epic, the inventory number is trustworthy end-to-end.

## Litmus Test

> "If this were the only thing we shipped, would a Syrian retail shop owner pay $25/month for it?"

Itemized receiving that keeps stock and cost accurate (and therefore keeps Epic 3's profit numbers honest) is a yes on its own. The invoice photo gives the owner a searchable record of every delivery — the paper-shoebox replacement.

---

## Decisions locked during brainstorming

1. **Receiving is itemized and stock-increasing** — owner picks products + quantities; each line increases that product's `current_stock` (mirror of how a sale decrements it).
2. **Cost: capture per line + prompt to update** — the received unit cost is always stored on the line; if it differs from the product's standing `cost_price_usd`, a per-line toggle (default on) offers to update the product's cost. Updating cost affects only *future* COGS — past `sale_line_items.unit_cost_usd` are snapshotted and untouched (per Payment Accounting Invariants).
3. **Supplier record fields:** name (Arabic, required), phone, contact person, address, notes. Supplier is **required** on a receiving.
4. **Line entry: existing products + create-on-the-fly** — search/scan the catalog; if a barcode/name isn't found, an inline add-product form creates it and adds it to the receiving in one step (reuses the Epic 2.2 barcode→add flow).
5. **A receiving is immutable** once saved. Mistakes are corrected via the existing `StockAdjustmentDialog` and/or a new corrective receiving. No edit/void path exists.
6. **Permissions:** Owner + Manager can manage suppliers and record receivings. Cashier cannot.

---

## Data model (PowerSync `src/data/powersync/schema.ts`)

```ts
const suppliers = new Table({
  shop_id:        column.text,
  name:           column.text,    // Arabic, required
  phone:          column.text,    // optional
  contact_person: column.text,    // optional
  address:        column.text,    // optional
  notes:          column.text,    // optional
  deleted:        column.integer, // soft-delete, mirrors customers
  created_at:     column.text,
  sync_status:    column.text,
})

const stock_receivings = new Table({
  shop_id:                    column.text,
  supplier_id:                column.text,  // required, FK → suppliers.id
  received_at:                column.text,
  invoice_photo_url:          column.text,  // nullable — photo of invoice
  total_cost_usd:             column.real,  // sum of line costs, snapshot
  exchange_rate_at_receiving: column.real,
  notes:                      column.text,  // nullable
  staff_id:                   column.text,  // who recorded it
  sync_status:                column.text,
})

const stock_receiving_line_items = new Table({
  receiving_id:  column.text,    // FK → stock_receivings.id
  shop_id:       column.text,
  product_id:    column.text,    // FK → products.id
  qty_received:  column.integer,
  unit_cost_usd: column.real,    // cost paid on THIS delivery (snapshot)
  cost_updated:  column.integer, // 0/1 — did we update product.cost_price_usd?
  sync_status:   column.text,
})
```

All three tables registered in `AppSchema`.

## Core logic — `useReceivingSheet.confirm()`

Modeled on `useReturnSheet.confirm()`. New products created on-the-fly are inserted **before** the transaction (via existing `useProducts` create), so the receiving only references their ids.

In a single `writeTransaction`:
1. Insert one `stock_receivings` row + all `stock_receiving_line_items` rows.
2. For each line: `products.current_stock += qty_received`.
3. For each line whose cost toggle is on: set `products.cost_price_usd = unit_cost_usd` and mark the line `cost_updated = 1`. Past `sale_line_items.unit_cost_usd` are not touched.
4. Stamp `total_cost_usd` (sum of `qty_received * unit_cost_usd`) and `exchange_rate_at_receiving` from the current rate.

**After** the transaction commits (outside `writeTransaction`, matching the audit fix in commit `6c0d422`): log `receiving.created` to the audit log with supplier name, total, and line count.

**Currency:** costs entered in USD (matches `cost_price_usd`); totals displayed USD primary / SYP secondary using the current exchange rate.

---

## Feature structure — `src/features/suppliers/`

```
suppliers/
  supplier.types.ts
  receiving.types.ts
  SuppliersPage.vue          # supplier list
  SupplierDetailPage.vue     # supplier info + their receiving history
  ReceivingsPage.vue         # global receiving history
  components/
    SupplierForm.vue
    SupplierPickerModal.vue  # mirrors CustomerPickerModal
    ReceivingSheet.vue       # create flow (slide-up, like ReturnSheet)
    ReceivingLineItem.vue
    ReceivingDetail.vue      # read-only view of a saved (immutable) receiving
  composables/
    useSuppliers.ts          # CRUD, soft-delete, list with running purchase totals
    useReceivings.ts         # list/history + load one
    useReceivingSheet.ts     # draft, line management, cost-toggle state, confirm()
  __tests__/
    useReceivingSheet.test.ts
    useSuppliers.test.ts
```

The create-on-the-fly product path delegates to existing `useProducts`.

## UI & navigation

Owner task → Back Office–led, phone-capable (discipline #1). New nav entries follow the Products / Returns / Audit pattern.

- **`SuppliersPage`** — suppliers sorted by recent activity. Row: name, phone, total purchased, last delivery date. FAB "مورد جديد" (New supplier).
- **`SupplierDetailPage`** — editable supplier info + receiving history newest-first. Primary button "تسجيل استلام بضاعة" (Record a delivery).
- **`ReceivingsPage`** — "استلام البضائع" (Stock receiving) history across all suppliers; tap → read-only `ReceivingDetail`.
- **`ReceivingSheet`** (create flow):
  1. Pick supplier (required; inline "add new supplier").
  2. Add lines: search/scan product → if not found, inline add-product form (Epic 2 pattern) → enter qty + unit cost → per-line "تحديث سعر التكلفة؟ old → new" toggle (shown only when cost differs, default on).
  3. Attach invoice photo (WebP, ~200KB cap, same compression as `ProductPhotoUpload`).
  4. Running total (USD primary, SYP secondary) → "تأكيد الاستلام" (Confirm) → success.

Plain-language Arabic throughout. No icons-only actions.

## Cross-cutting concerns

- **Permissions:** Owner + Manager only, via the existing `canUserDo`-style check. Cashier has no access to suppliers/receiving nav or actions.
- **Offline:** Default. Supplier list cached; suppliers, receivings, and stock/cost updates queue and sync. Photo upload follows existing offline photo handling.
- **Audit:** `receiving.created`, `supplier.created`, `supplier.updated` logged, consistent with how product/customer events are logged.
- **Low-stock interplay:** A receiving that lifts stock above threshold naturally drops the item off Epic 2.5's low-stock card — the card recomputes, no extra work.
- **Error handling:** `confirm()` validates supplier chosen, at least one line, positive qty and non-negative cost before writing; on partial failure the `writeTransaction` rolls back atomically. Audit logging failure must not roll back the receiving (logged best-effort after commit).

## Testing

Following the `__tests__` convention (e.g. `cashReconciliation.test.ts`, `useReturnSheet` tests):
- `useReceivingSheet.confirm()` — stock increments correctly; cost updates only when toggle on; past sale costs untouched; total = sum of lines; create-on-the-fly product flows into the receiving.
- `useSuppliers` — CRUD, soft-delete, purchase totals.
- Offline queue behaviour; immutability (no edit/delete path).

---

## Out of scope (deferred)

- Purchase orders / ordering workflow.
- Supplier price comparison dashboard (v1.5 roadmap).
- Supplier payments / accounts-payable ledger (we track what was *received*, not what we *owe*).
- Multi-location receiving (Warehouse module, v1.5).
- Editing/voiding a receiving (immutable by decision).

## Definition of Done

- [ ] Owner records a 10-line delivery with invoice photo in under 2 minutes.
- [ ] Stock increments exactly across 50 receivings incl. 10 offline.
- [ ] Cost updates only where toggled; past sales' COGS unchanged.
- [ ] New product created mid-receiving lands in catalog + on the receiving.
- [ ] Receiving is immutable; correction path is `StockAdjustmentDialog`.
- [ ] Works fully offline; `receiving.created` appears in the audit log.
- [ ] Cashier cannot access suppliers or receiving.
