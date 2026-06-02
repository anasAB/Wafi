# Epic 5 — Customer Credit Ledger

> **Status:** Approved for implementation
> **Date:** 2026-06-02
> **Approach:** Partial payments per invoice, POS-integrated

---

## Goal

Allow shop owners to sell on credit ("آجل"), track what each customer owes per invoice, and record partial or full payments against specific open invoices. The balance per customer is always visible at a glance.

This is the single most-requested feature for Syrian retail shops. Most customers buy on credit and settle weekly or monthly.

---

## Out of Scope (this epic)

- **WhatsApp statement** — owner taps "إرسال كشف حساب" to send balance + open invoices via WhatsApp. _Architecture note: `customers.phone` and `customers.mobile` are captured now so this can be wired up without a schema migration. Trigger point: after `RecordPaymentSheet` confirms, surface a "Send via WhatsApp" secondary action._
- Credit limits per customer (v1.5)
- Manual debt entries not tied to a POS sale (v1 follow-up)
- Customer statements PDF export (v1)
- AR aging report (v1.5)

---

## User Stories

1. **Credit sale at POS** — Cashier taps "آجل" in payment modal, picks the customer (or creates one inline), confirms. Sale is recorded as an open invoice on the customer's account.
2. **View customer balance** — Owner opens Customers tab, sees each customer with their total outstanding balance and last activity date.
3. **View open invoices** — Owner taps a customer, sees list of open invoices with date, items summary, original amount, and remaining amount.
4. **Record payment** — Owner taps "تسجيل دفعة", selects one or more open invoices, enters amount to apply to each (partial or full), confirms. Balance updates immediately.
5. **Settled customers** — Customers with zero balance show "مسوّى ✓" and sink to the bottom of the list.

---

## Schema

### New table: `customers`

```ts
const customers = new Table({
  shop_id:    column.text,
  name:       column.text,       // required
  phone:      column.text,       // optional — for WhatsApp (v1)
  mobile:     column.text,       // optional — secondary phone
  address:    column.text,       // optional
  deleted:    column.integer,    // 0/1 soft-delete flag
  created_at: column.text,
  sync_status: column.text,
})
```

### New table: `customer_payments`

Each row is one payment allocation: a specific amount applied to a specific invoice (sale).

```ts
const customer_payments = new Table({
  shop_id:               column.text,
  customer_id:           column.text,
  sale_id:               column.text,   // the invoice being paid
  amount_usd:            column.real,   // USD equivalent (canonical)
  currency:              column.text,   // USD or SYP (as entered by owner)
  amount_raw:            column.real,   // raw amount in entered currency
  exchange_rate_at_payment: column.real,
  notes:                 column.text,
  paid_at:               column.text,   // YYYY-MM-DD
  created_at:            column.text,
  sync_status:           column.text,
})
```

### Modified table: `sales`

Add two columns:

```ts
customer_id: column.text,    // nullable — set when payment_method = 'credit'
is_credit:   column.integer, // 0 or 1, default 0
```

### Balance calculation

```sql
-- Customer total balance (what they owe) — two subqueries avoid row multiplication
SELECT
  (SELECT COALESCE(SUM(total_usd), 0)  FROM sales            WHERE customer_id = ? AND is_credit = 1 AND shop_id = ?)
  -
  (SELECT COALESCE(SUM(amount_usd), 0) FROM customer_payments WHERE customer_id = ?                   AND shop_id = ?)
  AS balance_usd

-- Remaining on a specific invoice
SELECT
  s.total_usd - COALESCE(SUM(cp.amount_usd), 0) AS remaining_usd
FROM sales s
LEFT JOIN customer_payments cp ON cp.sale_id = s.id
WHERE s.id = ?
```

---

## Feature Structure

```
src/features/customers/
  customer.types.ts
  composables/
    useCustomers.ts          — load all, search, save, soft-delete
    useCustomerBalance.ts    — balance + open invoices for one customer
  components/
    CustomerPickerModal.vue  — search + inline quick-add, used in POS
    CustomerForm.vue         — add/edit customer (name, phone, mobile, address)
    RecordPaymentSheet.vue   — bottom sheet: select invoices + enter amounts
  CustomersPage.vue          — /customers list
  CustomerDetailPage.vue     — /customers/:id
```

---

## Screens

### `/customers` — Customer List

- Header: "الزبائن", no back button (root management page)
- Summary line: count of customers + total outstanding balance across all
- List sorted: customers with balance first (descending by balance), settled last
- Each row: name, last activity date, balance (amber if owed, green "مسوّى ✓" if zero)
- FAB (+) opens `CustomerForm` for adding a new customer
- Tap row → `CustomerDetailPage`

### `/customers/:id` — Customer Detail

- Back button → `/customers`
- Header: customer name
- Profile section: phone, mobile, address (tappable phone opens dialer)
- Big balance figure in amber (or green "مسوّى" if zero)
- "فواتير مفتوحة" section: list of open invoices sorted newest first
  - Each invoice: display sale number, date, product summary (first 2 items), original total, remaining amount
  - Fully-paid invoices hidden by default (toggle to show)
- "تسجيل دفعة" primary button (disabled if balance is 0)
- Payment history accordion (collapsed by default): list of all past payments

### POS — PaymentModal change

- Add "📋 آجل" tile alongside existing cash/SYP/card options
- When selected: `CustomerPickerModal` slides up
  - Search field (by name)
  - Results list: name + current balance
  - "إضافة زبون جديد" inline quick-add (name + phone only — full edit later)
  - Confirm selection
- Selected customer shown as chip below the tile; tap to change
- Confirm button proceeds normally; `usePayment` writes `customer_id` + `is_credit=1`

### RecordPaymentSheet — bottom sheet

- Title: "تسجيل دفعة — {customer name}"
- Currency toggle (USD / SYP) at the top — applies to all amount inputs; SYP amounts converted to USD at current exchange rate on save
- List of open invoices with checkboxes + amount inputs
  - Checkbox toggles invoice into/out of this payment
  - Amount input defaults to remaining balance on that invoice (editable for partial)
  - Amount cannot exceed remaining on that invoice (validated in USD equivalent)
- Running total at bottom: "إجمالي الدفعة: $X" (always shown in USD)
- Confirm button: inserts one `customer_payment` row per selected invoice
- Cancel closes without saving

---

## POS Integration: `usePayment` changes

```ts
// usePayment.ts confirm() signature change
async function confirm(customerId?: string): Promise<void>

// Inside confirm(), after INSERT sales:
if (customerId) {
  // customer_id and is_credit already written in the INSERT
  // No additional action needed — open invoice exists by virtue of the sale
}
```

The credit sale is an "open invoice" purely by virtue of `is_credit = 1` on the sales row. No separate invoice table needed.

---

## Composables

### `useCustomers`

```ts
export function useCustomers() {
  const customers = ref<Customer[]>([])
  async function load(): Promise<void>          // load all for shop
  async function search(q: string): Promise<Customer[]>  // for picker
  async function save(data: NewCustomer): Promise<string> // returns id
  async function update(id: string, data: Partial<NewCustomer>): Promise<void>
  async function softDelete(id: string): Promise<void>
  return { customers, load, search, save, update, softDelete }
}
```

### `useCustomerBalance`

```ts
export function useCustomerBalance(customerId: string) {
  const balanceUsd    = ref(0)
  const openInvoices  = ref<OpenInvoice[]>([])
  const payments      = ref<CustomerPayment[]>([])
  async function load(): Promise<void>
  async function recordPayment(allocations: PaymentAllocation[]): Promise<void>
  return { balanceUsd, openInvoices, payments, load, recordPayment }
}

interface OpenInvoice {
  saleId:        string
  displayNumber: string
  saleDate:      string
  totalUsd:      number
  remainingUsd:  number
  itemsSummary:  string   // e.g. "Samsung A55، كابل HDMI"
}

interface PaymentAllocation {
  saleId:    string
  amountUsd: number
  currency:  'USD' | 'SYP'
  amountRaw: number
}
```

---

## Navigation

- `CustomersPage` and `CustomerDetailPage` are reachable from the **Manage tab**
- `BackOfficePage` gets a new active tile: "الزبائن" → `/customers`
- `AppSidebar` gets a new enabled entry: `customers` → `/customers`
- `AppBottomNav` already marks the Manage tab active for `/customers*` paths ✓

---

## Tests

Each composable gets a Vitest unit test file following the existing pattern (`vi.mock('@/data/powersync/db', ...)`):

- `useCustomers.test.ts` — load, search, save, softDelete
- `useCustomerBalance.test.ts` — balance calculation, open invoices, recordPayment
- `CustomerForm.test.ts` — validation (name required), save emits
- `RecordPaymentSheet.test.ts` — amount validation (cannot exceed remaining), total calculation, confirm emits
- `CustomerPickerModal.test.ts` — search filters, select emits, quick-add flow

---

## WhatsApp Statement Stub (deferred)

After `RecordPaymentSheet` confirms a payment, the architecture supports a future "Send via WhatsApp" secondary action:

```
const phone = customer.mobile || customer.phone
const message = buildWhatsAppStatement(customer, openInvoices, payments)
window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`)
```

`customers.phone` and `customers.mobile` are captured in this epic so no schema migration is needed when this is wired up in v1.
