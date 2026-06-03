# Epic 7 — Split Payments

> **Status:** Approved for implementation
> **Date:** 2026-06-03
> **Approach:** sale_payments table, sequential add-payment flow, backward-compatible

---

## Goal

Allow a single sale to be paid with multiple methods — e.g., $30 USD cash + $35 equivalent in SYP cash. The cashier adds payments one at a time until the remaining balance reaches zero, then confirms. Single-payment sales are fully backward-compatible.

---

## Out of Scope (this epic)

- Credit (آجل) as one of the split methods — stays a standalone payment type
- Refunding individual split payment entries
- Split payments in the customer credit flow
- Partial payments (sale confirmed before balance is zero) — full balance must be covered

---

## Schema

### New table: `sale_payments`

One row per payment entry on a sale. Single-payment sales have exactly one row (inserted for every sale, not just splits).

```ts
const sale_payments = new Table({
  sale_id:       column.text,
  shop_id:       column.text,
  method:        column.text,   // 'cash_usd' | 'cash_syp' | 'card'
  amount_raw:    column.real,   // amount as entered in its native currency
  currency:      column.text,   // 'USD' | 'SYP'
  amount_usd:    column.real,   // converted to USD at exchange_rate
  exchange_rate: column.real,   // rate at time of this entry
  change_due:    column.real,   // nullable — only set on last entry if overpaid
  created_at:    column.text,
})
```

### Modified table: `sales`

Add two columns:

```ts
payment_method: 'split'        // set when is_split = 1; original method when is_split = 0
is_split:       column.integer // 0/1 default 0
```

For single-payment sales: `is_split = 0`, `payment_method` = method as before, `amount_received` / `change_due` unchanged.

For split sales: `is_split = 1`, `payment_method = 'split'`, `amount_received` = sum of all `sale_payments.amount_usd`, `change_due` = change on the last payment entry (or null).

---

## Types

### New: `SplitPaymentEntry` (in `src/features/payment/payment.types.ts`)

```ts
export interface SplitPaymentEntry {
  method:       'cash_usd' | 'cash_syp' | 'card'
  amountRaw:    number   // as entered by cashier
  currency:     'USD' | 'SYP'
  amountUsd:    number   // converted at exchangeRate
  exchangeRate: number
  changeDue:    number   // 0 unless last entry is overpaid
}
```

### Updated: `CompletedSale` (in `src/features/payment/payment.types.ts`)

Add:
```ts
splitPayments?: SplitPaymentEntry[]  // populated for split sales; undefined for single-payment
```

### Updated: `PaymentMethod`

Add `'split'` to the union:

```ts
export type PaymentMethod = 'cash_usd' | 'cash_syp' | 'card' | 'credit' | 'split'
```

`'split'` is never *selected* by the cashier — it is set automatically when `pendingPayments.length > 1` at confirm time. The confirmation screen and history both branch on `paymentMethod === 'split'` to render a breakdown.

---

## usePayment Changes

`src/features/payment/usePayment.ts` gains:

```ts
// New state
const pendingPayments  = ref<SplitPaymentEntry[]>([])

// Computed
const paidUsd      = computed(() => pendingPayments.value.reduce((s, p) => s + p.amountUsd, 0))
const remainingUsd = computed(() => Math.max(0, totalUsd.value - paidUsd.value))
const isReadyToConfirm = computed(() => paidUsd.value >= totalUsd.value - 0.001)

// New functions
function addPayment(entry: SplitPaymentEntry): void
function removeLastPayment(): void   // undo last entry
```

**`confirm()` changes:**

**All sales** now write one row to `sale_payments` per payment entry. This ensures `sale_payments` is the canonical record of how each sale was paid — even for single-payment sales.

When `pendingPayments.value.length === 0` (single-entry path — cashier used method tiles directly):
- One row inserted into `sale_payments` using the current `method`, `amountReceived`, `changeDue`
- `sales.is_split = 0`, `sales.payment_method` = method as before

When `pendingPayments.value.length > 0` (split path):
- `sales` INSERT: `payment_method = 'split'`, `is_split = 1`, `amount_received = paidUsd`, `change_due = last entry changeDue`
- For each entry in `pendingPayments`: INSERT into `sale_payments`
- `CompletedSale.splitPayments` populated from pendingPayments

**`selectMethod()` in split mode:**

When `pendingPayments.value.length > 0` and `remainingUsd > 0`, selecting a method transitions to `amount-entry` with the amount field pre-filled with the remaining balance in the selected method's currency.

**`back()` in split mode:**

When on `amount-entry` and `pendingPayments.length > 0`, back returns to `method-selection` (not removing any entries — entries are only removed via `removeLastPayment()`).

---

## PaymentModal UI Changes

### Method-selection panel additions

When `pendingPayments.length > 0`, show above the method tiles:

```
Payments list:
  ✓ نقدي دولار    $30.00      [×]   ← tap × to removeLastPayment (only last entry)
  ─────────────────────────
  متبقي: $35.00
```

The `[×]` (remove) button only appears on the last entry and calls `removeLastPayment()`.

When `remainingUsd ≤ 0`:
- Hide method tiles
- Show "تأكيد البيع" button (`data-testid="confirm-split-btn"`)

### Amount-entry panel

In split mode, the amount field is pre-filled with the remaining balance converted to the selected method's currency. The confirm key on the numpad calls `addPayment()` (not `confirm()`) — it adds the entry to the list and returns to `method-selection`.

A "تأكيد" button on the amount-entry screen also becomes "إضافة دفعة" in split mode.

### Change display

When the last payment overpays: show change only on `method-selection` panel (not mid-flow), next to the last payment entry.

---

## SaleConfirmationScreen Changes

`CompletedSale` now carries `splitPayments?`. The confirmation panel shows:

**Single payment (unchanged):**
```
طريقة الدفع    نقدي دولار
```

**Split payment:**
```
طريقة الدفع    متعدد
  نقدي دولار   $30.00
  نقدي ليرة    35,000 ل.س
```

---

## Sale History Changes

`SaleHistoryScreen` shows method emoji per sale. For `payment_method = 'split'`, show `"متعدد 💳"`. No breakdown needed in the list — detail is visible when the sale is expanded (future).

The `SaleRecord` type in `sale-history.types.ts` gains `isSplit: boolean` and `paymentMethod` already handles it since 'split' is a string.

---

## Feature Structure

```
No new feature folder — changes are entirely within existing files:
```

**Modified files:**
- `src/data/powersync/schema.ts` — add `sale_payments` table, add `is_split` to `sales`
- `src/features/payment/payment.types.ts` — add `SplitPaymentEntry`, update `CompletedSale`
- `src/features/payment/usePayment.ts` — pendingPayments, addPayment, removeLastPayment, confirm() split path
- `src/features/payment/PaymentModal.vue` — payments list, remaining balance, split confirm button
- `src/features/pos/SaleConfirmationScreen.vue` — split payment breakdown display
- `src/features/sale-history/SaleHistoryScreen.vue` — "متعدد" label for split sales

---

## Tests

- `usePayment.test.ts` — extend with: addPayment adds to pendingPayments, remainingUsd decrements correctly, removeLastPayment removes last, confirm() with 2 payments writes is_split=1 and 2 sale_payment rows, confirm() with 1 payment is backward-compatible
- `PaymentModal` — integration: selecting method in split mode shows remaining, confirm button appears when remaining ≤ 0
