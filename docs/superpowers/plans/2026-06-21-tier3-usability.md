# Tier 3 — Usability Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Round off the daily-use rough edges so the brother's shop *feels* finished — search that works in real Arabic, reliable reprints, correct customer/expense/receiving behaviour.

**Architecture:** Independent targeted fixes across `products`/`pos`/`suppliers`/`customers`/`expenses`/`returns`/`sale-history`. Disjoint from Tier 1 (dashboard/payment/photo) and Tier 2 (audit/staff/permissions).

**Tech Stack:** Vue 3, Pinia, PowerSync (local SQLite), Supabase, Vitest, TypeScript.

## Global Constraints
- Offline-first must hold for all of these (they're all local-DB operations).
- USD `numeric(10,2)`; SYP integer; rate integer.
- Plain-language Arabic for user-facing strings.
- Migration numbering continues from `020` (Tier 2): new files start at `021`.

## Parallel-safety
Do NOT edit Tier-1 files (`useDashboardMetrics.ts`, `useSalesChart.ts`, `useCashDrawer.ts`, `usePayment.ts`, `ProductPhotoUpload.vue`) or Tier-2 files (`audit/`, `staff/`, `router/permissions.ts`, migrations 018-020). Tier 3 owns `products` search, `pos` search/confirmation, `sale-history`, `suppliers` receiving, `customers`, `expenses`, `returns`, `composables/useBarcodeScan.ts`, and migrations 021+.

---

### Task 1 (WAFI-018): Diacritic-insensitive Arabic search

**Files:**
- Create: `src/shared/text/arabic.ts` (shared normalizer — confirm the repo's shared-util location and match it)
- Modify: `src/features/products/components/ProductList.vue:62`, `src/features/pos/ProductGrid.vue:38`, `src/features/suppliers/composables/useSuppliers.ts:63`, customer search in `useCustomers`/`CustomerPickerModal`, `ReceivingProductPicker.vue:37`
- Test: `src/shared/text/__tests__/arabic.test.ts`

**Problem:** search is raw substring/`LIKE`; a query without harakat won't match stored text with harakat, and alef/yaa/taa-marbuta variants don't fold. Syrian owners type without diacritics.

**Interfaces:** Produces `normalizeArabic(s: string): string` used on BOTH the stored value and the query before comparison.

- [ ] **Step 1: Write the failing test** — `arabic.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { normalizeArabic } from '@/shared/text/arabic'

describe('normalizeArabic', () => {
  it('strips harakat', () => expect(normalizeArabic('سَمَّاعة')).toBe(normalizeArabic('سماعة')))
  it('folds alef variants', () => expect(normalizeArabic('أحمد')).toBe(normalizeArabic('احمد')))
  it('folds yaa and taa-marbuta', () => {
    expect(normalizeArabic('قهوه')).toBe(normalizeArabic('قهوة'))
    expect(normalizeArabic('علي')).toBe(normalizeArabic('على'))
  })
})
```

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run src/shared/text/__tests__/arabic.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement the normalizer** — `src/shared/text/arabic.ts`:

```ts
/** Fold Arabic text for search: strip tashkeel/tatweel, unify alef/yaa/taa-marbuta. */
export function normalizeArabic(s: string): string {
  return (s ?? '')
    .replace(/[ً-ْٰ]/g, '') // harakat (tashkeel)
    .replace(/ـ/g, '')                // tatweel
    .replace(/[آأإ]/g, 'ا') // آ أ إ → ا
    .replace(/ى/g, 'ي')          // ى → ي
    .replace(/ة/g, 'ه')          // ة → ه
    .toLowerCase()
    .trim()
}
```

- [ ] **Step 4: Run it, verify it passes.**
- [ ] **Step 5: Apply at the call sites** — for in-memory filters (ProductList, ReceivingProductPicker, customer picker) compare `normalizeArabic(item.name).includes(normalizeArabic(query))`. For SQL `LIKE` paths (ProductGrid, useSuppliers), either filter in JS after fetch, or store a normalized shadow column — JS filter is simplest for a small catalog. Add a per-surface test where practical.
- [ ] **Step 6: Commit** — `git commit -m "feat(search): diacritic-insensitive Arabic search (WAFI-018)"`

---

### Task 2 (WAFI-030): Confirmation screen survives refresh

**Files:**
- Modify: `src/features/pos/SaleConfirmationScreen.vue:16,27` (reads `history.state` only)
- Test: component test

**Problem:** the screen reads the sale from `history.state`; a reload/app-kill on `/pos/confirmation` yields `undefined` → renders `—` and reprint silently no-ops. The sale IS in the DB.

**Interfaces:** Produces a fallback that loads the sale (+ its line items and payments) by id from the local DB when `history.state.sale` is absent.

- [ ] **Step 1: Write the failing test** — mount the screen with empty `history.state` and a sale id (route param/query); assert it loads and renders the sale from the DB and that reprint works.
- [ ] **Step 2: Run it, verify it fails.**
- [ ] **Step 3: Fix** — pass the sale id in the route (param or query) at confirm-time navigation; on mount, if `history.state.sale` is missing, query the sale by id from `db` and build the view model. Keep the existing fast path when state is present.
- [ ] **Step 4: Run it, verify it passes.**
- [ ] **Step 5: Commit** — `git commit -m "fix(pos): load confirmation/reprint by id after refresh (WAFI-030)"`

---

### Task 3 (WAFI-031): Reprint matches the original

**Files:**
- Modify: `src/features/sale-history/composables/useSaleHistory.ts:96-126` (`reprint`)
- Test: its `__tests__`

**Problem:** `reprint` builds `ReceiptData` with no split-payment breakdown and uses `device.shopId` (a UUID) as the shop name; fully-returned sales reprint as if sold.

**Interfaces:** Produces a reprint that loads real receipt settings (shop name etc.) + the sale's `sale_payments` rows (split breakdown) and marks fully-returned sales.

- [ ] **Step 1: Write the failing test** — a split-payment sale; assert reprint's `ReceiptData` carries the split entries and the real shop name (from `receipt_settings`), not the shop UUID; a fully-returned sale is marked.
- [ ] **Step 2: Run it, verify it fails.**
- [ ] **Step 3: Fix** — in `reprint`, load `receipt_settings` for the shop name/header/footer and the sale's `sale_payments`; include split entries; flag returned sales (reuse the `hasReturn`/`isFullyReturned` already computed in `loadHistory`).
- [ ] **Step 4: Run it, verify it passes.**
- [ ] **Step 5: Commit** — `git commit -m "fix(history): reprint matches original receipt (WAFI-031)"`

---

### Task 4 (WAFI-032): Barcode listener leak + input handling

**Files:**
- Modify: `src/composables/useBarcodeScan.ts:53,63` and every consumer (`POSSaleScreen.vue`, `ProductForm.vue`, anywhere `useBarcodeScan()` is constructed)
- Test: `src/__tests__/composables/useBarcodeScan.test.ts`

**Problem:** the global `keydown` listener is added at construction but `destroy()` is never called on unmount → listeners accumulate and double-fire after navigating in/out; scanned input isn't trimmed; Tab-terminated scanners aren't handled.

**Interfaces:** Produces leak-free lifecycle (one listener per active instance) and trimmed/normalized scan handling.

- [ ] **Step 1: Write the failing test** — mount+unmount a consumer (or call the composable's setup/teardown) twice; assert only one active `keydown` listener / a single `onScan` fire per scan (no double-fire). Assert a trailing-whitespace or Tab-terminated scan is captured and trimmed.
- [ ] **Step 2: Run it, verify it fails.**
- [ ] **Step 3: Fix** — call `scanner.destroy()` in `onUnmounted` in every consumer; trim scanned input on commit; accept Tab as a terminator alongside Enter; don't leak the first char into a focused input.
- [ ] **Step 4: Run it, verify it passes.**
- [ ] **Step 5: Commit** — `git commit -m "fix(scan): destroy listener on unmount; trim + Tab-terminate (WAFI-032)"`

---

### Task 5 (WAFI-025): Recurring/duplicated SYP expenses re-cost at the right rate

**Files:**
- Modify: `src/features/expenses/composables/useExpenses.ts:110-129` (recurring materialization), `:155-163` (`duplicateLastMonth`)
- Test: expenses tests

**Problem:** `duplicateLastMonth` copies the old `amount_usd` verbatim; recurring expansion books every future month at creation-time rate. As the SYP/USD rate drifts, the USD figure (and profit) is wrong.

**Interfaces:** Produces recomputed `amount_usd` for SYP expenses at the appropriate rate for the target date; the recurring meta tag is not copied into a plain duplicate.

- [ ] **Step 1: Write the failing test** — duplicate an SYP expense after the rate moves; assert the new row's `amount_usd` reflects the new rate (not the stale copied value); assert the recurring meta tag isn't carried into a plain duplicate.
- [ ] **Step 2: Run it, verify it fails.**
- [ ] **Step 3: Fix** — for SYP expenses, recompute `amount_usd = amount / rate` using the rate appropriate to the occurrence/duplication date; strip the `__wafi_recurring__` marker from plain duplicates.
- [ ] **Step 4: Run it, verify it passes.**
- [ ] **Step 5: Commit** — `git commit -m "fix(expenses): re-cost SYP recurring/duplicates at current rate (WAFI-025)"`

---

### Task 6 (WAFI-026 + WAFI-027): Customer credit balance + store-credit

**Files:**
- Modify: `src/features/customers/composables/useCustomerBalance.ts`, `src/features/customers/CustomerDetailPage.vue:35`
- Modify: `src/features/returns/composables/useReturnSheet.ts` (store_credit handling)
- Possibly create: `supabase/migrations/021_*.sql` if a credit balance needs storage (see decision)
- Test: customer balance + returns tests

**Problem:** (026) a negative balance (shop owes the customer) displays as "settled"; no plain-language "you have credit" surface. (027) a `store_credit` refund on a **cash** sale creates no ledger entry — the customer's credit is lost.

**Decision (PO) — where store credit lives:** simplest is to treat a customer's balance as a single signed figure where store-credit and overpayment push it negative (shop owes customer), shown in plain Arabic ("لك رصيد: …"). A `store_credit` refund then records against the customer so the balance reflects it. If the current balance formula can't represent credit without a sale to offset (cash-sale case), add a minimal credit entry (a row the balance query subtracts). Pick the representation, document it, keep it offline-safe.

- [ ] **Step 1: Write the failing tests** — (026) a customer whose payments+returns exceed credit sales shows a positive *credit* balance, not "settled"; (027) a cash sale returned as `store_credit` leaves the customer with store credit equal to the refund.
- [ ] **Step 2: Run, verify they fail.**
- [ ] **Step 3: Implement** — surface negative/credit balance in `CustomerDetailPage` with plain-language Arabic; make `useCustomerBalance` represent credit; make `store_credit` refunds (incl. on cash sales) record so the balance reflects the credit. Add migration 021 only if a storage change is needed.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(customers): show customer credit balance; store_credit creates credit (WAFI-026/027)"`

---

### Task 7 (WAFI-021 + WAFI-022): Receiving guards + void

**Files:**
- Modify: `src/features/suppliers/composables/useReceivingSheet.ts:28,101-104`, `src/features/suppliers/components/ReceivingProductPicker.vue:53-66`
- Modify: `src/features/suppliers/composables/useReceivings.ts` (add a void/reverse path)
- Possibly: `supabase/migrations/022_*.sql` if a void needs a status/flag
- Test: receiving tests

**Problem:** (021) `updateCost` with `unitCostUsd <= 0` wipes a product's standing cost; no void/edit path for a mis-keyed receiving. (022) quick-add creates zero-cost/zero-price products and matches by `nameAr` (wrong product on duplicate names).

**Interfaces:** Produces a guard blocking/ confirming zero-cost `updateCost`, a void-receiving path (reverses stock + cost), and quick-add validation + id-based matching.

- [ ] **Step 1: Write failing tests** — (021a) receiving at cost 0 with `updateCost` does not zero standing cost; (021b) voiding a receiving restores prior stock; (022) quick-add rejects/flags zero price/cost and matches the created product by id.
- [ ] **Step 2: Run, verify they fail.**
- [ ] **Step 3: Implement** — guard `updateCost` when `unitCostUsd <= 0`; add a void path in `useReceivings` that reverses stock and cost atomically (`stock = stock - ?`); validate quick-add price/cost (or flag needs-pricing) and match by id not name.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(receiving): zero-cost guard, void path, quick-add validation (WAFI-021/022)"`

---

## Self-Review
- WAFI-018 → T1 · WAFI-030 → T2 · WAFI-031 → T3 · WAFI-032 → T4 · WAFI-025 → T5 · WAFI-026/027 → T6 · WAFI-021/022 → T7 ✓
- Files disjoint from Tier 1 and Tier 2 — safe to run in parallel.
- Migration numbers start at 021 (after Tier 2's 020); only T6/T7 *might* need one.
- Embedded decisions: T6 (where store credit lives) — pick before coding.
- Reads-before-edit: confirm the shared-util location (T1), `useBarcodeScan` consumers (T4), the balance formula (T6), and the receiving SQL (T7); match existing signatures.
- Tasks are independent — can be split across more than one dev, or cherry-picked by customer impact (T1 search and T2/T3 reprint are the most visible day-one).
