# Epic 5 — Customer Credit Ledger: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow shop owners to sell on credit ("آجل"), track per-customer open invoices, and record partial or full payments against specific invoices.

**Architecture:** Three schema additions (new `customers` table, new `customer_payments` table, two columns on `sales`). New `src/features/customers/` folder with two composables, three components, and two pages. PaymentModal gains a fourth "آجل" tile that launches `CustomerPickerModal`; `usePayment.confirm()` accepts an optional `customerId`. Navigation wired via router, `BackOfficePage`, and `AppSidebar`.

**Tech Stack:** Vue 3 + TypeScript + Tailwind, PowerSync (`db.execute`, `db.getAll`, `db.getOptional`), Vitest + `@vue/test-utils`, `uuid`, existing `useExchangeRate` for SYP→USD conversion.

---

## File Map

**Create:**
- `src/features/customers/customer.types.ts`
- `src/features/customers/composables/useCustomers.ts`
- `src/features/customers/composables/useCustomerBalance.ts`
- `src/features/customers/components/CustomerForm.vue`
- `src/features/customers/components/RecordPaymentSheet.vue`
- `src/features/customers/components/CustomerPickerModal.vue`
- `src/features/customers/CustomersPage.vue`
- `src/features/customers/CustomerDetailPage.vue`
- `src/__tests__/features/useCustomers.test.ts`
- `src/__tests__/features/useCustomerBalance.test.ts`
- `src/__tests__/features/CustomerForm.test.ts`
- `src/__tests__/features/RecordPaymentSheet.test.ts`
- `src/__tests__/features/CustomerPickerModal.test.ts`

**Modify:**
- `src/data/powersync/schema.ts` — add `customers`, `customer_payments`; add `customer_id` + `is_credit` to `sales`
- `src/features/payment/payment.types.ts` — add `'credit'` to `PaymentMethod`; add `customerId?` to `CompletedSale`
- `src/features/payment/usePayment.ts` — `confirm(customerId?)` writes `customer_id` + `is_credit`
- `src/__tests__/features/usePayment.test.ts` — extend with credit sale assertion
- `src/features/payment/PaymentModal.vue` — add "آجل" tile + customer selection state
- `src/router/index.ts` — add `/customers` and `/customers/:id` routes
- `src/features/products/BackOfficePage.vue` — add "الزبائن" active tile
- `src/components/layout/AppSidebar.vue` — enable `customers` nav item

---

## Task 1: Schema — customers table, customer_payments table, sales columns

**Files:**
- Modify: `src/data/powersync/schema.ts`

- [ ] **Step 1: Update schema**

Replace the full contents of `src/data/powersync/schema.ts`:

```ts
import { column, Schema, Table } from '@powersync/web'

const products = new Table({
  shop_id:             column.text,
  name_ar:             column.text,
  name_en:             column.text,
  price_usd:           column.real,
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
  shop_id:    column.text,
  product_id: column.text,
  old_value:  column.integer,
  new_value:  column.integer,
  reason:     column.text,
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
  customer_id:              column.text,   // nullable — set for credit sales
  is_credit:                column.integer, // 0/1, default 0
})

const sale_line_items = new Table({
  sale_id:        column.text,
  shop_id:        column.text,
  product_id:     column.text,
  quantity:       column.integer,
  unit_price_usd: column.real,
  unit_cost_usd:  column.real,
  line_total_usd: column.real,
})

const exchange_rates = new Table({
  shop_id:   column.text,
  device_id: column.text,
  rate:      column.real,
  set_at:    column.text,
  set_by:    column.text,
})

const expenses = new Table({
  shop_id:      column.text,
  amount:       column.real,
  currency:     column.text,
  amount_usd:   column.real,
  category:     column.text,
  expense_date: column.text,
  notes:        column.text,
  photo_url:    column.text,
  paid_in_cash: column.integer,
  created_at:   column.text,
  sync_status:  column.text,
})

const customers = new Table({
  shop_id:    column.text,
  name:       column.text,
  phone:      column.text,
  mobile:     column.text,
  address:    column.text,
  deleted:    column.integer,
  created_at: column.text,
  sync_status: column.text,
})

const customer_payments = new Table({
  shop_id:                  column.text,
  customer_id:              column.text,
  sale_id:                  column.text,
  amount_usd:               column.real,
  currency:                 column.text,
  amount_raw:               column.real,
  exchange_rate_at_payment: column.real,
  notes:                    column.text,
  paid_at:                  column.text,
  created_at:               column.text,
  sync_status:              column.text,
})

export const AppSchema = new Schema({
  products,
  stock_adjustments,
  sales,
  sale_line_items,
  exchange_rates,
  expenses,
  customers,
  customer_payments,
})
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/data/powersync/schema.ts
git commit -m "feat(schema): add customers and customer_payments tables, add customer_id/is_credit to sales"
```

---

## Task 2: Customer types

**Files:**
- Create: `src/features/customers/customer.types.ts`

- [ ] **Step 1: Create types file**

```ts
export interface Customer {
  id:         string
  shopId:     string
  name:       string
  phone?:     string
  mobile?:    string
  address?:   string
  deleted:    boolean
  createdAt:  string
  syncStatus: string
}

export interface NewCustomer {
  name:     string
  phone?:   string
  mobile?:  string
  address?: string
}

export interface OpenInvoice {
  saleId:       string
  displayNumber: string
  saleDate:     string
  totalUsd:     number
  remainingUsd: number
  itemsSummary: string  // e.g. "Samsung A55، كابل HDMI"
}

export interface PaymentAllocation {
  saleId:                  string
  amountUsd:               number
  currency:                'USD' | 'SYP'
  amountRaw:               number
  exchangeRateAtPayment?:  number
}

export interface CustomerPayment {
  id:         string
  customerId: string
  saleId:     string
  amountUsd:  number
  currency:   'USD' | 'SYP'
  paidAt:     string
  createdAt:  string
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/features/customers/customer.types.ts
git commit -m "feat(customers): add customer types"
```

---

## Task 3: useCustomers composable

**Files:**
- Create: `src/features/customers/composables/useCustomers.ts`
- Create: `src/__tests__/features/useCustomers.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/features/useCustomers.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useCustomers } from '@/features/customers/composables/useCustomers'
import { db } from '@/data/powersync/db'

describe('useCustomers', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([])
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
  })

  it('load calls db.getAll filtering by shop_id and deleted', async () => {
    const { load } = useCustomers()
    await load()
    expect(db.getAll).toHaveBeenCalledWith(
      expect.stringContaining('deleted'),
      expect.any(Array)
    )
  })

  it('load maps rows to Customer objects', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([{
      id: 'c1', shop_id: 's1', name: 'أبو خالد', phone: '0991234567',
      mobile: null, address: null, deleted: 0,
      created_at: '2025-01-01T00:00:00Z', sync_status: 'synced',
    }])
    const { customers, load } = useCustomers()
    await load()
    expect(customers.value).toHaveLength(1)
    expect(customers.value[0].name).toBe('أبو خالد')
    expect(customers.value[0].deleted).toBe(false)
  })

  it('save calls INSERT INTO customers', async () => {
    const { save } = useCustomers()
    await save({ name: 'محل الأمل', phone: '0991111111' })
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO customers'),
      expect.any(Array)
    )
  })

  it('save returns the new customer id', async () => {
    const { save } = useCustomers()
    const id = await save({ name: 'محل الأمل' })
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  it('softDelete calls UPDATE SET deleted=1', async () => {
    const { softDelete } = useCustomers()
    await softDelete('c1')
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('deleted = 1'),
      expect.arrayContaining(['c1'])
    )
  })

  it('search returns customers matching name query', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { id: 'c1', shop_id: 's1', name: 'أبو خالد', phone: null, mobile: null, address: null, deleted: 0, created_at: '2025-01-01T00:00:00Z', sync_status: 'synced' },
    ])
    const { search } = useCustomers()
    const results = await search('خالد')
    expect(db.getAll).toHaveBeenCalledWith(
      expect.stringContaining('LIKE'),
      expect.arrayContaining(['%خالد%'])
    )
    expect(results).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to verify tests fail**

Run: `npx vitest run src/__tests__/features/useCustomers.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

Create `src/features/customers/composables/useCustomers.ts`:

```ts
import { ref } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import type { Customer, NewCustomer } from '@/features/customers/customer.types'

type CustomerRow = {
  id: string; shop_id: string; name: string; phone: string | null
  mobile: string | null; address: string | null; deleted: number
  created_at: string; sync_status: string
}

function rowToCustomer(r: CustomerRow): Customer {
  return {
    id: r.id, shopId: r.shop_id, name: r.name,
    phone:    r.phone    ?? undefined,
    mobile:   r.mobile   ?? undefined,
    address:  r.address  ?? undefined,
    deleted:  r.deleted === 1,
    createdAt: r.created_at, syncStatus: r.sync_status,
  }
}

export function useCustomers() {
  const customers = ref<Customer[]>([])

  async function load() {
    const device = useDeviceStore()
    const rows = await db.getAll<CustomerRow>(
      `SELECT * FROM customers WHERE shop_id = ? AND (deleted = 0 OR deleted IS NULL) ORDER BY name ASC`,
      [device.shopId]
    )
    customers.value = rows.map(rowToCustomer)
  }

  async function search(q: string): Promise<Customer[]> {
    const device = useDeviceStore()
    const rows = await db.getAll<CustomerRow>(
      `SELECT * FROM customers WHERE shop_id = ? AND (deleted = 0 OR deleted IS NULL) AND name LIKE ? ORDER BY name ASC`,
      [device.shopId, `%${q}%`]
    )
    return rows.map(rowToCustomer)
  }

  async function save(data: NewCustomer): Promise<string> {
    const device = useDeviceStore()
    const id = uuidv4()
    const now = new Date().toISOString()
    await db.execute(
      `INSERT INTO customers (id, shop_id, name, phone, mobile, address, deleted, created_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'pending')`,
      [id, device.shopId, data.name, data.phone ?? null, data.mobile ?? null, data.address ?? null, now]
    )
    return id
  }

  async function update(id: string, data: Partial<NewCustomer>): Promise<void> {
    const sets: string[] = []
    const vals: (string | null)[] = []
    if (data.name    !== undefined) { sets.push('name = ?');    vals.push(data.name) }
    if (data.phone   !== undefined) { sets.push('phone = ?');   vals.push(data.phone ?? null) }
    if (data.mobile  !== undefined) { sets.push('mobile = ?');  vals.push(data.mobile ?? null) }
    if (data.address !== undefined) { sets.push('address = ?'); vals.push(data.address ?? null) }
    if (!sets.length) return
    sets.push("sync_status = 'pending'")
    await db.execute(
      `UPDATE customers SET ${sets.join(', ')} WHERE id = ?`,
      [...vals, id]
    )
  }

  async function softDelete(id: string): Promise<void> {
    await db.execute(
      `UPDATE customers SET deleted = 1, sync_status = 'pending' WHERE id = ?`,
      [id]
    )
  }

  return { customers, load, search, save, update, softDelete }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/__tests__/features/useCustomers.test.ts`
Expected: 6 passing

- [ ] **Step 5: Commit**

```bash
git add src/features/customers/composables/useCustomers.ts src/__tests__/features/useCustomers.test.ts
git commit -m "feat(customers): add useCustomers composable with CRUD and search"
```

---

## Task 4: useCustomerBalance composable

**Files:**
- Create: `src/features/customers/composables/useCustomerBalance.ts`
- Create: `src/__tests__/features/useCustomerBalance.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/features/useCustomerBalance.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useCustomerBalance } from '@/features/customers/composables/useCustomerBalance'
import { db } from '@/data/powersync/db'

describe('useCustomerBalance', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getOptional).mockResolvedValue(null)
    vi.mocked(db.getAll).mockResolvedValue([])
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
  })

  it('balanceUsd defaults to 0', () => {
    const { balanceUsd } = useCustomerBalance('c1')
    expect(balanceUsd.value).toBe(0)
  })

  it('load queries balance using two subqueries', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({ balance_usd: 240 } as any)
    const { balanceUsd, load } = useCustomerBalance('c1')
    await load()
    expect(balanceUsd.value).toBe(240)
    expect(db.getOptional).toHaveBeenCalledWith(
      expect.stringContaining('customer_payments'),
      expect.any(Array)
    )
  })

  it('openInvoices is empty when all invoices are paid', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({ balance_usd: 0 } as any)
    vi.mocked(db.getAll).mockResolvedValue([])
    const { openInvoices, load } = useCustomerBalance('c1')
    await load()
    expect(openInvoices.value).toHaveLength(0)
  })

  it('load maps open invoice rows correctly', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({ balance_usd: 160 } as any)
    vi.mocked(db.getAll)
      .mockResolvedValueOnce([{
        id: 's1', display_sale_number: '#231', created_at: '2025-06-02T10:00:00Z',
        total_usd: 220, remaining_usd: 160,
      }])
      .mockResolvedValueOnce([{ name_ar: 'Samsung A55' }, { name_ar: 'غطاء' }])
      .mockResolvedValueOnce([]) // payment history
    const { openInvoices, load } = useCustomerBalance('c1')
    await load()
    expect(openInvoices.value).toHaveLength(1)
    expect(openInvoices.value[0].remainingUsd).toBe(160)
    expect(openInvoices.value[0].itemsSummary).toContain('Samsung A55')
  })

  it('recordPayment inserts one customer_payment row per allocation', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ balance_usd: 0 } as any)
    vi.mocked(db.getAll).mockResolvedValue([])
    const { recordPayment } = useCustomerBalance('c1')
    await recordPayment([
      { saleId: 's1', amountUsd: 100, currency: 'USD', amountRaw: 100 },
      { saleId: 's2', amountUsd: 80,  currency: 'USD', amountRaw: 80  },
    ])
    expect(db.execute).toHaveBeenCalledTimes(2)
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO customer_payments'),
      expect.any(Array)
    )
  })

  it('recordPayment calls load after saving to refresh state', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ balance_usd: 0 } as any)
    vi.mocked(db.getAll).mockResolvedValue([])
    const { recordPayment } = useCustomerBalance('c1')
    await recordPayment([{ saleId: 's1', amountUsd: 50, currency: 'USD', amountRaw: 50 }])
    // getOptional called during the final load() after save
    expect(db.getOptional).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify tests fail**

Run: `npx vitest run src/__tests__/features/useCustomerBalance.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

Create `src/features/customers/composables/useCustomerBalance.ts`:

```ts
import { ref } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import type { OpenInvoice, PaymentAllocation, CustomerPayment } from '@/features/customers/customer.types'

type InvoiceRow = {
  id: string; display_sale_number: string; created_at: string
  total_usd: number; remaining_usd: number
}

type PaymentRow = {
  id: string; customer_id: string; sale_id: string; amount_usd: number
  currency: string; paid_at: string; created_at: string
}

export function useCustomerBalance(customerId: string) {
  const balanceUsd   = ref(0)
  const openInvoices = ref<OpenInvoice[]>([])
  const payments     = ref<CustomerPayment[]>([])

  async function load() {
    const device = useDeviceStore()
    const shopId = device.shopId

    const balRow = await db.getOptional<{ balance_usd: number }>(
      `SELECT
        (SELECT COALESCE(SUM(total_usd), 0)  FROM sales            WHERE customer_id = ? AND is_credit = 1 AND shop_id = ?)
        -
        (SELECT COALESCE(SUM(amount_usd), 0) FROM customer_payments WHERE customer_id = ?                   AND shop_id = ?)
        AS balance_usd`,
      [customerId, shopId, customerId, shopId]
    )
    balanceUsd.value = balRow?.balance_usd ?? 0

    const invoiceRows = await db.getAll<InvoiceRow>(
      `SELECT s.id, s.display_sale_number, s.created_at, s.total_usd,
         s.total_usd - COALESCE(SUM(cp.amount_usd), 0) AS remaining_usd
       FROM sales s
       LEFT JOIN customer_payments cp ON cp.sale_id = s.id
       WHERE s.customer_id = ? AND s.is_credit = 1 AND s.shop_id = ?
       GROUP BY s.id
       HAVING remaining_usd > 0.001
       ORDER BY s.created_at DESC`,
      [customerId, shopId]
    )

    const invoicesWithSummary: OpenInvoice[] = await Promise.all(
      invoiceRows.map(async row => {
        const itemRows = await db.getAll<{ name_ar: string }>(
          `SELECT p.name_ar FROM sale_line_items sli
           JOIN products p ON p.id = sli.product_id
           WHERE sli.sale_id = ? LIMIT 2`,
          [row.id]
        )
        return {
          saleId:        row.id,
          displayNumber: row.display_sale_number,
          saleDate:      row.created_at,
          totalUsd:      row.total_usd,
          remainingUsd:  row.remaining_usd,
          itemsSummary:  itemRows.map(r => r.name_ar).join('، '),
        }
      })
    )
    openInvoices.value = invoicesWithSummary

    const paymentRows = await db.getAll<PaymentRow>(
      `SELECT * FROM customer_payments WHERE customer_id = ? AND shop_id = ? ORDER BY created_at DESC`,
      [customerId, shopId]
    )
    payments.value = paymentRows.map(r => ({
      id:         r.id,
      customerId: r.customer_id,
      saleId:     r.sale_id,
      amountUsd:  r.amount_usd,
      currency:   r.currency as 'USD' | 'SYP',
      paidAt:     r.paid_at,
      createdAt:  r.created_at,
    }))
  }

  async function recordPayment(allocations: PaymentAllocation[]): Promise<void> {
    const device = useDeviceStore()
    const now    = new Date().toISOString()
    for (const alloc of allocations) {
      await db.execute(
        `INSERT INTO customer_payments
           (id, shop_id, customer_id, sale_id, amount_usd, currency, amount_raw,
            exchange_rate_at_payment, notes, paid_at, created_at, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, null, ?, ?, 'pending')`,
        [
          uuidv4(), device.shopId, customerId, alloc.saleId,
          alloc.amountUsd, alloc.currency, alloc.amountRaw,
          alloc.exchangeRateAtPayment ?? null,
          now.slice(0, 10), now,
        ]
      )
    }
    await load()
  }

  return { balanceUsd, openInvoices, payments, load, recordPayment }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/__tests__/features/useCustomerBalance.test.ts`
Expected: 6 passing

- [ ] **Step 5: Commit**

```bash
git add src/features/customers/composables/useCustomerBalance.ts src/__tests__/features/useCustomerBalance.test.ts
git commit -m "feat(customers): add useCustomerBalance composable"
```

---

## Task 5: CustomerForm component

**Files:**
- Create: `src/features/customers/components/CustomerForm.vue`
- Create: `src/__tests__/features/CustomerForm.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/features/CustomerForm.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import CustomerForm from '@/features/customers/components/CustomerForm.vue'
import { db } from '@/data/powersync/db'

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/:p(.*)', component: { template: '<div/>' } }],
})

function mountForm(props = {}) {
  const pinia = createPinia()
  pinia.use(piniaPluginPersistedstate)
  return mount(CustomerForm, {
    props,
    global: { plugins: [pinia, router] },
  })
}

describe('CustomerForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
    vi.mocked(db.getAll).mockResolvedValue([])
  })

  it('shows name required error when saving with empty name', async () => {
    const w = mountForm()
    await w.find('[data-testid="save-btn"]').trigger('click')
    expect(w.find('[data-testid="error-name"]').exists()).toBe(true)
  })

  it('emits saved after valid form submission', async () => {
    const w = mountForm()
    await w.find('[data-testid="name-input"]').setValue('أبو خالد')
    await w.find('[data-testid="save-btn"]').trigger('click')
    await new Promise(r => setTimeout(r, 10))
    expect(w.emitted('saved')).toBeTruthy()
  })

  it('emits cancel when cancel button clicked', async () => {
    const w = mountForm()
    await w.find('[data-testid="cancel-btn"]').trigger('click')
    expect(w.emitted('cancel')).toBeTruthy()
  })

  it('pre-fills fields when initial prop is provided', async () => {
    const initial = { id: 'c1', shopId: 's1', name: 'أبو خالد', phone: '099',
                      mobile: '098', address: 'المزة', deleted: false,
                      createdAt: '', syncStatus: '' }
    const w = mountForm({ initial })
    expect((w.find('[data-testid="name-input"]').element as HTMLInputElement).value).toBe('أبو خالد')
    expect((w.find('[data-testid="phone-input"]').element as HTMLInputElement).value).toBe('099')
  })

  it('calls UPDATE when initial prop is provided (edit mode)', async () => {
    const initial = { id: 'c1', shopId: 's1', name: 'أبو خالد', phone: '',
                      mobile: '', address: '', deleted: false, createdAt: '', syncStatus: '' }
    const w = mountForm({ initial })
    await w.find('[data-testid="name-input"]').setValue('أبو محمد')
    await w.find('[data-testid="save-btn"]').trigger('click')
    await new Promise(r => setTimeout(r, 10))
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE customers'),
      expect.any(Array)
    )
  })
})
```

- [ ] **Step 2: Run to verify tests fail**

Run: `npx vitest run src/__tests__/features/CustomerForm.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

Create `src/features/customers/components/CustomerForm.vue`:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useCustomers } from '@/features/customers/composables/useCustomers'
import type { Customer, NewCustomer } from '@/features/customers/customer.types'

const props = defineProps<{ initial?: Customer }>()
const emit  = defineEmits<{ (e: 'saved', id: string): void; (e: 'cancel'): void }>()

const { save, update } = useCustomers()

const name    = ref(props.initial?.name    ?? '')
const phone   = ref(props.initial?.phone   ?? '')
const mobile  = ref(props.initial?.mobile  ?? '')
const address = ref(props.initial?.address ?? '')
const saving  = ref(false)
const errors  = ref<Record<string, string>>({})

function validate(): boolean {
  const e: Record<string, string> = {}
  if (!name.value.trim()) e['name'] = 'الاسم مطلوب'
  errors.value = e
  return Object.keys(e).length === 0
}

async function handleSave() {
  if (!validate()) return
  saving.value = true
  try {
    const data: NewCustomer = {
      name:    name.value.trim(),
      phone:   phone.value.trim()   || undefined,
      mobile:  mobile.value.trim()  || undefined,
      address: address.value.trim() || undefined,
    }
    if (props.initial) {
      await update(props.initial.id, data)
      emit('saved', props.initial.id)
    } else {
      const id = await save(data)
      emit('saved', id)
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-4" dir="rtl">
    <!-- Name -->
    <div>
      <label class="block text-sm text-text-muted mb-1">الاسم *</label>
      <input
        v-model="name"
        data-testid="name-input"
        type="text"
        placeholder="اسم الزبون أو المحل"
        class="w-full border border-border-glass rounded-xl px-4 py-3 bg-surface-raised text-text-primary
               focus:outline-none focus:ring-2 focus:ring-gold-primary/40 text-sm"
        :class="errors['name'] ? 'border-red-500' : ''"
        @input="delete errors['name']"
      />
      <p v-if="errors['name']" data-testid="error-name" class="text-xs text-red-500 mt-1">{{ errors['name'] }}</p>
    </div>

    <!-- Phone -->
    <div>
      <label class="block text-sm text-text-muted mb-1">الهاتف</label>
      <input
        v-model="phone"
        data-testid="phone-input"
        type="tel"
        placeholder="09XXXXXXXX"
        class="w-full border border-border-glass rounded-xl px-4 py-3 bg-surface-raised text-text-primary
               focus:outline-none focus:ring-2 focus:ring-gold-primary/40 text-sm"
      />
    </div>

    <!-- Mobile -->
    <div>
      <label class="block text-sm text-text-muted mb-1">الجوال</label>
      <input
        v-model="mobile"
        data-testid="mobile-input"
        type="tel"
        placeholder="09XXXXXXXX"
        class="w-full border border-border-glass rounded-xl px-4 py-3 bg-surface-raised text-text-primary
               focus:outline-none focus:ring-2 focus:ring-gold-primary/40 text-sm"
      />
    </div>

    <!-- Address -->
    <div>
      <label class="block text-sm text-text-muted mb-1">العنوان</label>
      <input
        v-model="address"
        data-testid="address-input"
        type="text"
        placeholder="الحي أو المنطقة"
        class="w-full border border-border-glass rounded-xl px-4 py-3 bg-surface-raised text-text-primary
               focus:outline-none focus:ring-2 focus:ring-gold-primary/40 text-sm"
      />
    </div>

    <!-- Buttons -->
    <div class="flex gap-2 pt-2">
      <button
        type="button"
        data-testid="save-btn"
        :disabled="saving"
        class="flex-1 h-11 rounded-xl text-sm font-semibold text-bg-void disabled:opacity-50 transition-colors"
        style="background: linear-gradient(135deg, var(--color-gold-primary), var(--color-gold-to))"
        @click="handleSave"
      >{{ saving ? '...' : (initial ? 'حفظ التغييرات' : 'إضافة زبون') }}</button>

      <button
        type="button"
        data-testid="cancel-btn"
        class="h-11 px-5 rounded-xl text-sm text-text-muted border border-border-glass"
        @click="emit('cancel')"
      >إلغاء</button>
    </div>
  </div>
</template>
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/__tests__/features/CustomerForm.test.ts`
Expected: 5 passing

- [ ] **Step 5: Commit**

```bash
git add src/features/customers/components/CustomerForm.vue src/__tests__/features/CustomerForm.test.ts
git commit -m "feat(customers): add CustomerForm component"
```

---

## Task 6: RecordPaymentSheet component

**Files:**
- Create: `src/features/customers/components/RecordPaymentSheet.vue`
- Create: `src/__tests__/features/RecordPaymentSheet.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/features/RecordPaymentSheet.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/features/exchange-rate', () => ({
  useExchangeRate: () => ({ currentRate: { value: 14500 } }),
}))

import RecordPaymentSheet from '@/features/customers/components/RecordPaymentSheet.vue'
import type { OpenInvoice } from '@/features/customers/customer.types'
import { db } from '@/data/powersync/db'

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/:p(.*)', component: { template: '<div/>' } }],
})

const invoice1: OpenInvoice = {
  saleId: 's1', displayNumber: '#231', saleDate: '2025-06-02T00:00:00Z',
  totalUsd: 220, remainingUsd: 160, itemsSummary: 'Samsung A55',
}
const invoice2: OpenInvoice = {
  saleId: 's2', displayNumber: '#218', saleDate: '2025-05-28T00:00:00Z',
  totalUsd: 80, remainingUsd: 80, itemsSummary: 'كابل HDMI',
}

function mountSheet(props = {}) {
  const pinia = createPinia()
  pinia.use(piniaPluginPersistedstate)
  return mount(RecordPaymentSheet, {
    props: { customerId: 'c1', customerName: 'أبو خالد', openInvoices: [invoice1, invoice2], ...props },
    global: { plugins: [pinia, router] },
  })
}

describe('RecordPaymentSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
    vi.mocked(db.getOptional).mockResolvedValue({ balance_usd: 0 } as any)
    vi.mocked(db.getAll).mockResolvedValue([])
  })

  it('renders all open invoices', () => {
    const w = mountSheet()
    expect(w.find('[data-testid="invoice-s1"]').exists()).toBe(true)
    expect(w.find('[data-testid="invoice-s2"]').exists()).toBe(true)
  })

  it('confirm button is disabled when no invoices are selected', () => {
    const w = mountSheet()
    expect(w.find('[data-testid="confirm-btn"]').attributes('disabled')).toBeDefined()
  })

  it('selecting an invoice enables the confirm button', async () => {
    const w = mountSheet()
    await w.find('[data-testid="checkbox-s1"]').trigger('click')
    expect(w.find('[data-testid="confirm-btn"]').attributes('disabled')).toBeUndefined()
  })

  it('amount input defaults to remaining on invoice', async () => {
    const w = mountSheet()
    await w.find('[data-testid="checkbox-s1"]').trigger('click')
    const input = w.find('[data-testid="amount-s1"]').element as HTMLInputElement
    expect(parseFloat(input.value)).toBe(160)
  })

  it('emits saved after confirming selected invoices', async () => {
    const w = mountSheet()
    await w.find('[data-testid="checkbox-s1"]').trigger('click')
    await w.find('[data-testid="confirm-btn"]').trigger('click')
    await new Promise(r => setTimeout(r, 20))
    expect(w.emitted('saved')).toBeTruthy()
  })

  it('emits cancel when cancel button clicked', async () => {
    const w = mountSheet()
    await w.find('[data-testid="cancel-btn"]').trigger('click')
    expect(w.emitted('cancel')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify tests fail**

Run: `npx vitest run src/__tests__/features/RecordPaymentSheet.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

Create `src/features/customers/components/RecordPaymentSheet.vue`:

```vue
<script setup lang="ts">
import { ref, computed } from 'vue'
import { useExchangeRate } from '@/features/exchange-rate'
import { useCustomerBalance } from '@/features/customers/composables/useCustomerBalance'
import type { OpenInvoice, PaymentAllocation } from '@/features/customers/customer.types'

const props = defineProps<{
  customerId:   string
  customerName: string
  openInvoices: OpenInvoice[]
}>()

const emit = defineEmits<{ (e: 'saved'): void; (e: 'cancel'): void }>()

const { currentRate }  = useExchangeRate()
const { recordPayment } = useCustomerBalance(props.customerId)

const currency = ref<'USD' | 'SYP'>('USD')
const selected = ref<Set<string>>(new Set())
const amounts  = ref<Record<string, number>>(
  Object.fromEntries(props.openInvoices.map(inv => [inv.saleId, inv.remainingUsd]))
)
const saving = ref(false)

function toggleInvoice(saleId: string) {
  if (selected.value.has(saleId)) selected.value.delete(saleId)
  else                            selected.value.add(saleId)
}

const totalUsd = computed(() => {
  let total = 0
  for (const saleId of selected.value) {
    const raw = amounts.value[saleId] ?? 0
    total += currency.value === 'USD' ? raw : (currentRate.value ? raw / currentRate.value : raw)
  }
  return total
})

const hasSelection = computed(() => selected.value.size > 0)

async function handleConfirm() {
  if (!hasSelection.value) return
  saving.value = true
  try {
    const allocations: PaymentAllocation[] = []
    for (const saleId of selected.value) {
      const raw = amounts.value[saleId] ?? 0
      const amountUsd = currency.value === 'USD'
        ? raw
        : (currentRate.value ? raw / currentRate.value : raw)
      allocations.push({
        saleId,
        amountUsd,
        currency:               currency.value,
        amountRaw:              raw,
        exchangeRateAtPayment:  currentRate.value ?? undefined,
      })
    }
    await recordPayment(allocations)
    emit('saved')
  } finally {
    saving.value = false
  }
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('ar-SY', { month: 'short', day: 'numeric' }).format(new Date(iso))
}
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex items-end justify-center"
      style="background: rgb(0 0 0 / 0.6)"
      @click.self="emit('cancel')"
    >
      <div class="bg-bg-void border-t border-border-glass rounded-t-2xl w-full max-w-lg p-5 shadow-xl" dir="rtl">
        <div class="w-9 h-1 bg-text-muted/30 rounded-full mx-auto mb-4"></div>
        <h2 class="text-base font-semibold text-text-primary mb-1">تسجيل دفعة</h2>
        <p class="text-sm text-text-muted mb-4">{{ customerName }}</p>

        <!-- Currency toggle -->
        <div class="flex bg-surface-raised rounded-xl p-1 gap-1 mb-4 w-fit">
          <button
            type="button"
            class="px-4 py-1.5 text-sm font-semibold rounded-lg transition-colors"
            :class="currency === 'USD' ? 'bg-bg-void text-text-primary shadow-sm' : 'text-text-muted'"
            @click="currency = 'USD'"
          >USD</button>
          <button
            type="button"
            class="px-4 py-1.5 text-sm font-semibold rounded-lg transition-colors"
            :class="currency === 'SYP' ? 'bg-bg-void text-text-primary shadow-sm' : 'text-text-muted'"
            @click="currency = 'SYP'"
          >SYP</button>
        </div>

        <!-- Invoice list -->
        <div class="flex flex-col gap-2 mb-4 max-h-52 overflow-y-auto">
          <div
            v-for="inv in openInvoices"
            :key="inv.saleId"
            :data-testid="`invoice-${inv.saleId}`"
            class="flex items-center gap-3 p-3 rounded-xl border transition-colors cursor-pointer"
            :class="selected.has(inv.saleId)
              ? 'border-gold-primary bg-surface-raised'
              : 'border-border-glass'"
            @click="toggleInvoice(inv.saleId)"
          >
            <button
              type="button"
              :data-testid="`checkbox-${inv.saleId}`"
              class="w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors"
              :class="selected.has(inv.saleId) ? 'bg-gold-primary border-gold-primary text-bg-void' : 'border-border-glass'"
              @click.stop="toggleInvoice(inv.saleId)"
            >
              <svg v-if="selected.has(inv.saleId)" class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </button>

            <div class="flex-1 min-w-0">
              <div class="flex justify-between items-center">
                <span class="text-xs font-semibold text-text-primary">{{ inv.displayNumber }}</span>
                <span class="text-xs text-text-muted">{{ formatDate(inv.saleDate) }}</span>
              </div>
              <p class="text-xs text-text-muted truncate">{{ inv.itemsSummary }}</p>
            </div>

            <div class="shrink-0">
              <input
                v-if="selected.has(inv.saleId)"
                :data-testid="`amount-${inv.saleId}`"
                type="number"
                min="0.01"
                :max="inv.remainingUsd"
                step="0.01"
                :value="amounts[inv.saleId]"
                class="w-20 text-center text-sm font-semibold bg-surface-glass border border-gold-primary/40
                       rounded-lg px-2 py-1 text-text-primary focus:outline-none"
                @click.stop
                @input="amounts[inv.saleId] = parseFloat(($event.target as HTMLInputElement).value) || 0"
              />
              <span v-else class="text-xs font-semibold text-amber-400">${{ inv.remainingUsd.toFixed(2) }}</span>
            </div>
          </div>
        </div>

        <!-- Total -->
        <div class="flex justify-between items-center py-3 border-t border-border-glass mb-4">
          <span class="text-sm font-semibold text-text-primary">إجمالي الدفعة</span>
          <span class="text-base font-bold text-green-400">${{ totalUsd.toFixed(2) }}</span>
        </div>

        <!-- Buttons -->
        <div class="flex gap-2">
          <button
            type="button"
            data-testid="confirm-btn"
            :disabled="!hasSelection || saving"
            class="flex-1 h-11 rounded-xl text-sm font-semibold text-bg-void disabled:opacity-40 transition-colors"
            style="background: linear-gradient(135deg, var(--color-gold-primary), var(--color-gold-to))"
            @click="handleConfirm"
          >{{ saving ? '...' : 'تأكيد الدفعة' }}</button>

          <button
            type="button"
            data-testid="cancel-btn"
            class="h-11 px-5 rounded-xl text-sm text-text-muted border border-border-glass"
            @click="emit('cancel')"
          >إلغاء</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/__tests__/features/RecordPaymentSheet.test.ts`
Expected: 6 passing

- [ ] **Step 5: Commit**

```bash
git add src/features/customers/components/RecordPaymentSheet.vue src/__tests__/features/RecordPaymentSheet.test.ts
git commit -m "feat(customers): add RecordPaymentSheet component"
```

---

## Task 7: CustomerPickerModal component

**Files:**
- Create: `src/features/customers/components/CustomerPickerModal.vue`
- Create: `src/__tests__/features/CustomerPickerModal.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/features/CustomerPickerModal.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import CustomerPickerModal from '@/features/customers/components/CustomerPickerModal.vue'
import { db } from '@/data/powersync/db'

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/:p(.*)', component: { template: '<div/>' } }],
})

function mountPicker(props = {}) {
  const pinia = createPinia()
  pinia.use(piniaPluginPersistedstate)
  return mount(CustomerPickerModal, {
    props,
    global: { plugins: [pinia, router] },
  })
}

describe('CustomerPickerModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([])
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
  })

  it('shows search input on mount', () => {
    const w = mountPicker()
    expect(w.find('[data-testid="search-input"]').exists()).toBe(true)
  })

  it('shows customer rows from loaded list', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { id: 'c1', shop_id: 's1', name: 'أبو خالد', phone: null, mobile: null, address: null, deleted: 0, created_at: '', sync_status: '' },
    ])
    const w = mountPicker()
    await new Promise(r => setTimeout(r, 10))
    expect(w.find('[data-testid="customer-c1"]').exists()).toBe(true)
  })

  it('emits select with customer when row is tapped', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { id: 'c1', shop_id: 's1', name: 'أبو خالد', phone: null, mobile: null, address: null, deleted: 0, created_at: '', sync_status: '' },
    ])
    const w = mountPicker()
    await new Promise(r => setTimeout(r, 10))
    await w.find('[data-testid="customer-c1"]').trigger('click')
    expect(w.emitted('select')).toBeTruthy()
    expect(w.emitted('select')![0][0]).toMatchObject({ id: 'c1', name: 'أبو خالد' })
  })

  it('shows add-new form when "إضافة زبون جديد" is tapped', async () => {
    const w = mountPicker()
    await w.find('[data-testid="add-new-btn"]').trigger('click')
    expect(w.find('[data-testid="quick-add-form"]').exists()).toBe(true)
  })

  it('emits cancel when backdrop is clicked', async () => {
    const w = mountPicker()
    await w.find('[data-testid="backdrop"]').trigger('click')
    expect(w.emitted('cancel')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify tests fail**

Run: `npx vitest run src/__tests__/features/CustomerPickerModal.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

Create `src/features/customers/components/CustomerPickerModal.vue`:

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useCustomers } from '@/features/customers/composables/useCustomers'
import type { Customer } from '@/features/customers/customer.types'

const emit = defineEmits<{
  (e: 'select', customer: Customer): void
  (e: 'cancel'): void
}>()

const { customers, load, search, save } = useCustomers()
const query      = ref('')
const showAddNew = ref(false)
const newName    = ref('')
const saving     = ref(false)
const results    = ref<Customer[]>([])

onMounted(async () => {
  await load()
  results.value = customers.value
})

async function handleSearch(q: string) {
  query.value = q
  if (q.trim()) {
    results.value = await search(q.trim())
  } else {
    results.value = customers.value
  }
}

async function handleQuickAdd() {
  if (!newName.value.trim()) return
  saving.value = true
  try {
    const id = await save({ name: newName.value.trim() })
    await load()
    const created = customers.value.find(c => c.id === id)
    if (created) emit('select', created)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex items-end justify-center"
      style="background: rgb(0 0 0 / 0.6)"
      data-testid="backdrop"
      @click.self="emit('cancel')"
    >
      <div class="bg-bg-void border-t border-border-glass rounded-t-2xl w-full max-w-lg p-5 shadow-xl max-h-[80dvh] flex flex-col" dir="rtl">
        <div class="w-9 h-1 bg-text-muted/30 rounded-full mx-auto mb-4 flex-shrink-0"></div>
        <h2 class="text-base font-semibold text-text-primary mb-3 flex-shrink-0">اختر الزبون</h2>

        <!-- Search -->
        <input
          :value="query"
          data-testid="search-input"
          type="text"
          placeholder="ابحث باسم الزبون..."
          class="w-full border border-border-glass rounded-xl px-4 py-3 bg-surface-raised text-text-primary
                 focus:outline-none focus:ring-2 focus:ring-gold-primary/40 text-sm mb-3 flex-shrink-0"
          @input="handleSearch(($event.target as HTMLInputElement).value)"
        />

        <!-- Results -->
        <div class="flex-1 overflow-y-auto flex flex-col gap-1 mb-3">
          <button
            v-for="c in results"
            :key="c.id"
            type="button"
            :data-testid="`customer-${c.id}`"
            class="w-full flex items-center justify-between px-4 py-3 rounded-xl hover:bg-surface-raised transition-colors text-right"
            @click="emit('select', c)"
          >
            <span class="text-sm font-medium text-text-primary">{{ c.name }}</span>
            <span v-if="c.phone" class="text-xs text-text-muted">{{ c.phone }}</span>
          </button>

          <div v-if="results.length === 0" class="text-center py-6 text-text-muted text-sm">
            لا توجد نتائج
          </div>
        </div>

        <!-- Add new -->
        <div class="flex-shrink-0 border-t border-border-glass pt-3">
          <div v-if="!showAddNew">
            <button
              type="button"
              data-testid="add-new-btn"
              class="w-full text-sm text-gold-primary font-medium py-2"
              @click="showAddNew = true"
            >+ إضافة زبون جديد</button>
          </div>

          <div v-else data-testid="quick-add-form" class="flex gap-2">
            <input
              v-model="newName"
              data-testid="quick-add-name"
              type="text"
              placeholder="اسم الزبون"
              class="flex-1 border border-border-glass rounded-xl px-3 py-2 bg-surface-raised text-text-primary
                     focus:outline-none focus:ring-2 focus:ring-gold-primary/40 text-sm"
              @keydown.enter="handleQuickAdd"
            />
            <button
              type="button"
              data-testid="quick-add-save"
              :disabled="saving || !newName.trim()"
              class="h-10 px-4 rounded-xl text-sm font-semibold text-bg-void disabled:opacity-40"
              style="background: linear-gradient(135deg, var(--color-gold-primary), var(--color-gold-to))"
              @click="handleQuickAdd"
            >{{ saving ? '...' : 'إضافة' }}</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/__tests__/features/CustomerPickerModal.test.ts`
Expected: 5 passing

- [ ] **Step 5: Commit**

```bash
git add src/features/customers/components/CustomerPickerModal.vue src/__tests__/features/CustomerPickerModal.test.ts
git commit -m "feat(customers): add CustomerPickerModal component"
```

---

## Task 8: CustomersPage and CustomerDetailPage

**Files:**
- Create: `src/features/customers/CustomersPage.vue`
- Create: `src/features/customers/CustomerDetailPage.vue`

- [ ] **Step 1: Create CustomersPage**

Create `src/features/customers/CustomersPage.vue`:

```vue
<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppToast from '@/components/ui/AppToast.vue'
import CustomerForm from './components/CustomerForm.vue'
import { useCustomers } from './composables/useCustomers'

const router = useRouter()
const { customers, load } = useCustomers()
const showAddForm = ref(false)
const toast = ref<{ message: string; type: 'success' | 'error' } | null>(null)

onMounted(load)

const totalBalance = computed(() => {
  // Balance shown on CustomerDetailPage — this page shows count only
  return customers.value.length
})

async function handleSaved() {
  showAddForm.value = false
  toast.value = { message: 'تم إضافة الزبون', type: 'success' }
  await load()
}
</script>

<template>
  <div class="flex flex-col min-h-dvh bg-bg-void" dir="rtl">
    <AppHeader title="الزبائن" />

    <main class="flex-1 px-4 py-4 max-w-2xl mx-auto w-full pb-20">
      <p class="text-xs text-text-muted mb-4 px-1">{{ customers.length }} زبون</p>

      <div class="flex flex-col gap-2">
        <button
          v-for="c in customers"
          :key="c.id"
          type="button"
          :data-testid="`customer-row-${c.id}`"
          class="w-full glass-sm p-4 flex items-center justify-between rounded-2xl text-right hover:bg-surface-raised transition-colors active:scale-[0.99]"
          @click="router.push(`/customers/${c.id}`)"
        >
          <div>
            <p class="text-sm font-semibold text-text-primary">{{ c.name }}</p>
            <p v-if="c.phone" class="text-xs text-text-muted mt-0.5">{{ c.phone }}</p>
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-text-muted rtl:rotate-180 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div v-if="customers.length === 0" class="text-center py-16 text-text-muted text-sm">
          لا يوجد زبائن بعد — أضف أول زبون
        </div>
      </div>
    </main>

    <!-- FAB -->
    <button
      type="button"
      data-testid="add-customer-fab"
      class="lg:hidden fixed bottom-20 start-6 w-14 h-14 rounded-full text-bg-void text-2xl shadow-lg
             active:scale-95 transition-all flex items-center justify-center z-20"
      style="background: linear-gradient(135deg, var(--color-gold-primary), var(--color-gold-to)); box-shadow: 0 0 24px var(--color-gold-subtle)"
      aria-label="إضافة زبون"
      @click="showAddForm = true"
    >+</button>

    <!-- Desktop add button -->
    <div class="hidden lg:block fixed bottom-8 start-8">
      <button
        type="button"
        class="btn-gold px-6 h-11 text-sm"
        @click="showAddForm = true"
      >+ إضافة زبون</button>
    </div>
  </div>

  <!-- Add customer sheet -->
  <Teleport v-if="showAddForm" to="body">
    <div
      class="fixed inset-0 z-50 flex items-end justify-center"
      style="background: rgb(0 0 0 / 0.6)"
      @click.self="showAddForm = false"
    >
      <div class="bg-bg-void border-t border-border-glass rounded-t-2xl w-full max-w-lg p-6 shadow-xl" dir="rtl">
        <div class="w-9 h-1 bg-text-muted/30 rounded-full mx-auto mb-5"></div>
        <h2 class="text-base font-semibold text-text-primary mb-4">إضافة زبون جديد</h2>
        <CustomerForm @saved="handleSaved" @cancel="showAddForm = false" />
      </div>
    </div>
  </Teleport>

  <AppToast v-if="toast" :message="toast.message" :type="toast.type" @dismiss="toast = null" />
</template>
```

- [ ] **Step 2: Create CustomerDetailPage**

Create `src/features/customers/CustomerDetailPage.vue`:

```vue
<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppToast from '@/components/ui/AppToast.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import CustomerForm from './components/CustomerForm.vue'
import RecordPaymentSheet from './components/RecordPaymentSheet.vue'
import { useCustomers } from './composables/useCustomers'
import { useCustomerBalance } from './composables/useCustomerBalance'
import type { Customer } from './customer.types'

const router = useRouter()
const route  = useRoute()
const customerId = route.params.id as string

const { customers, load: loadCustomers, softDelete } = useCustomers()
const { balanceUsd, openInvoices, payments, load: loadBalance } = useCustomerBalance(customerId)

const customer   = ref<Customer | undefined>(undefined)
const showPayment = ref(false)
const showEdit   = ref(false)
const showDelete = ref(false)
const toast      = ref<{ message: string; type: 'success' | 'error' } | null>(null)

onMounted(async () => {
  await Promise.all([loadCustomers(), loadBalance()])
  customer.value = customers.value.find(c => c.id === customerId)
})

const isSettled = computed(() => balanceUsd.value <= 0.001)

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('ar-SY', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso))
}

async function handlePaymentSaved() {
  showPayment.value = false
  toast.value = { message: 'تم تسجيل الدفعة', type: 'success' }
  await loadBalance()
}

async function handleEditSaved() {
  showEdit.value = false
  toast.value = { message: 'تم حفظ التغييرات', type: 'success' }
  await loadCustomers()
  customer.value = customers.value.find(c => c.id === customerId)
}

async function handleDelete() {
  await softDelete(customerId)
  router.push('/customers')
}
</script>

<template>
  <div class="flex flex-col min-h-dvh bg-bg-void" dir="rtl">
    <AppHeader
      :title="customer?.name ?? '...'"
      :show-back="true"
      @back="router.back()"
    />

    <main v-if="customer" class="flex-1 px-4 py-4 max-w-lg mx-auto w-full pb-6">

      <!-- Profile -->
      <div class="glass-sm p-4 rounded-2xl mb-4">
        <div class="flex items-start justify-between mb-3">
          <div>
            <h2 class="text-base font-bold text-text-primary">{{ customer.name }}</h2>
            <p v-if="customer.phone"  class="text-xs text-text-muted mt-0.5">📱 {{ customer.phone }}</p>
            <p v-if="customer.mobile" class="text-xs text-text-muted mt-0.5">📱 {{ customer.mobile }}</p>
            <p v-if="customer.address" class="text-xs text-text-muted mt-0.5">🏠 {{ customer.address }}</p>
          </div>
          <button
            type="button"
            class="text-xs text-text-muted underline"
            @click="showEdit = true"
          >تعديل</button>
        </div>

        <!-- Balance -->
        <div class="text-center py-4 border-t border-border-glass">
          <p v-if="isSettled" class="text-lg font-bold text-green-400">مسوّى ✓</p>
          <template v-else>
            <p class="text-3xl font-bold text-amber-400">${{ balanceUsd.toFixed(2) }}</p>
            <p class="text-xs text-text-muted mt-1">إجمالي المديونية</p>
          </template>
        </div>

        <!-- Pay button -->
        <button
          type="button"
          data-testid="record-payment-btn"
          :disabled="isSettled"
          class="w-full h-11 rounded-xl text-sm font-semibold text-bg-void mt-3 disabled:opacity-30 transition-colors"
          style="background: linear-gradient(135deg, var(--color-gold-primary), var(--color-gold-to))"
          @click="showPayment = true"
        >تسجيل دفعة</button>
      </div>

      <!-- Open invoices -->
      <div v-if="openInvoices.length > 0" class="mb-4">
        <p class="text-xs font-semibold text-text-muted uppercase tracking-widest mb-2 px-1">فواتير مفتوحة</p>
        <div class="flex flex-col gap-2">
          <div
            v-for="inv in openInvoices"
            :key="inv.saleId"
            :data-testid="`open-invoice-${inv.saleId}`"
            class="glass-sm p-3 rounded-xl flex items-center justify-between"
            style="border-color: rgba(245,158,11,0.25)"
          >
            <div>
              <p class="text-sm font-semibold text-text-primary">{{ inv.displayNumber }}</p>
              <p class="text-xs text-text-muted">{{ formatDate(inv.saleDate) }}</p>
              <p class="text-xs text-text-muted truncate max-w-[180px]">{{ inv.itemsSummary }}</p>
            </div>
            <div class="text-left">
              <p class="text-sm font-bold text-amber-400">${{ inv.remainingUsd.toFixed(2) }}</p>
              <p class="text-xs text-text-muted">من ${{ inv.totalUsd.toFixed(2) }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Payment history -->
      <div v-if="payments.length > 0" class="mb-6">
        <p class="text-xs font-semibold text-text-muted uppercase tracking-widest mb-2 px-1">سجل الدفعات</p>
        <div class="flex flex-col gap-1">
          <div
            v-for="p in payments"
            :key="p.id"
            class="flex justify-between items-center px-3 py-2 rounded-lg glass-sm text-xs"
          >
            <span class="text-text-muted">{{ formatDate(p.paidAt) }}</span>
            <span class="font-semibold text-green-400">+${{ p.amountUsd.toFixed(2) }}</span>
          </div>
        </div>
      </div>

      <!-- Danger zone -->
      <button
        type="button"
        class="text-xs text-red-500 underline mt-2"
        @click="showDelete = true"
      >حذف الزبون</button>

    </main>

    <div v-else class="flex-1 flex items-center justify-center text-text-muted text-sm">جارٍ التحميل...</div>
  </div>

  <RecordPaymentSheet
    v-if="showPayment && customer"
    :customer-id="customerId"
    :customer-name="customer.name"
    :open-invoices="openInvoices"
    @saved="handlePaymentSaved"
    @cancel="showPayment = false"
  />

  <Teleport v-if="showEdit && customer" to="body">
    <div
      class="fixed inset-0 z-50 flex items-end justify-center"
      style="background: rgb(0 0 0 / 0.6)"
      @click.self="showEdit = false"
    >
      <div class="bg-bg-void border-t border-border-glass rounded-t-2xl w-full max-w-lg p-6 shadow-xl" dir="rtl">
        <div class="w-9 h-1 bg-text-muted/30 rounded-full mx-auto mb-5"></div>
        <h2 class="text-base font-semibold text-text-primary mb-4">تعديل بيانات الزبون</h2>
        <CustomerForm :initial="customer" @saved="handleEditSaved" @cancel="showEdit = false" />
      </div>
    </div>
  </Teleport>

  <AppDialog
    v-if="showDelete"
    title="حذف الزبون"
    message="سيتم حذف الزبون ولن يظهر في القائمة. سجلات الديون والمبيعات ستبقى."
    confirm-label="حذف"
    cancel-label="إلغاء"
    :danger="true"
    @confirm="handleDelete"
    @cancel="showDelete = false"
  />

  <AppToast v-if="toast" :message="toast.message" :type="toast.type" @dismiss="toast = null" />
</template>
```

- [ ] **Step 3: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/features/customers/CustomersPage.vue src/features/customers/CustomerDetailPage.vue
git commit -m "feat(customers): add CustomersPage and CustomerDetailPage"
```

---

## Task 9: Extend payment types and usePayment

**Files:**
- Modify: `src/features/payment/payment.types.ts`
- Modify: `src/features/payment/usePayment.ts`
- Modify: `src/__tests__/features/usePayment.test.ts`

- [ ] **Step 1: Update payment.types.ts**

In `src/features/payment/payment.types.ts`, make these two changes:

1. Add `'credit'` to `PaymentMethod`:
```ts
export type PaymentMethod = 'cash_usd' | 'cash_syp' | 'card' | 'credit'
```

2. Add `customerId?` to `CompletedSale`:
```ts
export interface CompletedSale {
  saleId:                  string
  displaySaleNumber:       string
  totalUsd:                number
  totalSyp:                number
  exchangeRateAtSale:      number
  paymentMethod:           PaymentMethod
  amountReceived?:         number
  amountReceivedCurrency?: 'USD' | 'SYP'
  changeDue?:              number
  createdAt:               string
  lines:                   SaleLine[]
  customerId?:             string
}
```

- [ ] **Step 2: Update usePayment.ts — confirm() accepts customerId**

In `src/features/payment/usePayment.ts`, change `confirm()` signature and the INSERT into sales:

Change line 57:
```ts
async function confirm(): Promise<CompletedSale> {
```
to:
```ts
async function confirm(customerId?: string): Promise<CompletedSale> {
```

In the `sale` object construction (around line 66), add:
```ts
customerId,
```

In the INSERT into `sales` (around line 86), replace the entire `await db.execute(...)` call with:
```ts
await db.execute(
  `INSERT INTO sales (id, shop_id, device_id, device_sequence, display_sale_number,
    created_at, total_usd, total_syp, exchange_rate_at_sale, payment_method,
    amount_received, amount_received_currency, change_due, customer_id, is_credit)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [
    saleId, deviceStore.shopId, deviceStore.deviceId,
    saleStore.deviceSequence, displayNum, now,
    totalUsd.value, totalSyp.value, sale.exchangeRateAtSale,
    method.value, sale.amountReceived ?? null,
    sale.amountReceivedCurrency ?? null, sale.changeDue ?? null,
    customerId ?? null, customerId ? 1 : 0,
  ]
)
```

- [ ] **Step 3: Add failing test**

Open `src/__tests__/features/usePayment.test.ts` and add this test at the end of the describe block (keep all existing tests):

```ts
it('confirm writes customer_id and is_credit=1 for credit sales', async () => {
  vi.mocked(db.getOptional)
    .mockResolvedValueOnce({ cost_price_usd: 5 } as any)
    .mockResolvedValueOnce({ current_stock: 10 } as any)
  vi.mocked(db.execute)
    .mockResolvedValueOnce({ rows: { _array: [] } } as any) // INSERT sales
    .mockResolvedValueOnce({ rows: { _array: [] } } as any) // INSERT sale_line_items
    .mockResolvedValueOnce({ rows: { _array: [] } } as any) // UPDATE products
    .mockResolvedValueOnce({ rows: { _array: [] } } as any) // INSERT stock_adjustments

  const { selectMethod, confirm } = usePayment()
  selectMethod('credit')
  await confirm('customer-abc')

  const salesInsert = vi.mocked(db.execute).mock.calls.find(c =>
    (c[0] as string).includes('INSERT INTO sales') &&
    (c[0] as string).includes('customer_id')
  )
  expect(salesInsert).toBeDefined()
  expect(salesInsert![1]).toContain('customer-abc')
  expect(salesInsert![1]).toContain(1) // is_credit = 1
})
```

- [ ] **Step 4: Run to verify new test fails**

Run: `npx vitest run src/__tests__/features/usePayment.test.ts --reporter=verbose`
Expected: the new test FAILS (is_credit column not in INSERT yet)

- [ ] **Step 5: Run all payment tests after implementation**

Run: `npx vitest run src/__tests__/features/usePayment.test.ts`
Expected: all tests pass (11+)

- [ ] **Step 6: Commit**

```bash
git add src/features/payment/payment.types.ts src/features/payment/usePayment.ts src/__tests__/features/usePayment.test.ts
git commit -m "feat(payment): add credit payment method, write customer_id and is_credit to sales"
```

---

## Task 10: PaymentModal — add آجل option

**Files:**
- Modify: `src/features/payment/PaymentModal.vue`

- [ ] **Step 1: Update PaymentModal**

Replace `src/features/payment/PaymentModal.vue` with this updated version that adds the "آجل" tile, a `selectedCustomer` ref, and a `credit-confirm` state:

```vue
<script setup lang="ts">
import { ref, computed } from 'vue'
import NumericKeypad from '@/components/ui/NumericKeypad.vue'
import CustomerPickerModal from '@/features/customers/components/CustomerPickerModal.vue'
import { usePayment } from './usePayment'
import type { CompletedSale } from './payment.types'
import type { Customer } from '@/features/customers/customer.types'

const emit = defineEmits<{
  (e: 'confirmed', sale: CompletedSale): void
  (e: 'close'):                          void
}>()

const { state, method, amountReceived, totalUsd, totalSyp, changeDue, error,
        selectMethod, back, cancel, confirm } = usePayment()

const amountStr        = ref('')
const selectedCustomer = ref<Customer | null>(null)
const showPicker       = ref(false)

const displayAmount = computed(() => {
  if (!amountStr.value) return null
  return parseFloat(amountStr.value)
})

const amountSufficient = computed(() => {
  const amount = displayAmount.value
  if (amount === null || isNaN(amount)) return false
  if (method.value === 'cash_usd') return amount >= totalUsd.value
  if (method.value === 'cash_syp') return amount >= totalSyp.value
  return false
})

function handleDigit(d: string) {
  if (d === '.' && amountStr.value.includes('.')) return
  amountStr.value += d
  amountReceived.value = displayAmount.value
}

function handleDelete() {
  amountStr.value = amountStr.value.slice(0, -1)
  amountReceived.value = displayAmount.value
}

function handleSelectCredit() {
  selectMethod('credit')
  showPicker.value = true
}

function handleCustomerSelected(customer: Customer) {
  selectedCustomer.value = customer
  showPicker.value = false
  // state stays at 'method-selection' — user sees credit-confirm panel inline
}

async function handleConfirm() {
  if (method.value !== 'card' && method.value !== 'credit' && !amountSufficient.value) return
  try {
    const sale = await confirm(selectedCustomer.value?.id)
    emit('confirmed', sale)
  } catch {
    // error is set in usePayment
  }
}

function handleCancel() {
  cancel()
  emit('close')
}
</script>

<template>
  <!-- Backdrop -->
  <div class="fixed inset-0 z-40 bg-black/50" @click="state === 'method-selection' && handleCancel()" />

  <!-- Sheet -->
  <div class="fixed bottom-0 left-0 right-0 sm:inset-0 sm:flex sm:items-center sm:justify-center z-50">
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="payment-modal-title"
      class="bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[90dvh] overflow-y-auto"
    >

      <!-- ── Method selection ── -->
      <div v-if="state === 'method-selection'" class="p-6">
        <div class="flex justify-start mb-4">
          <button type="button" class="text-sm text-blue-600 dark:text-blue-400" @click="handleCancel">
            إلغاء
          </button>
        </div>

        <h2 id="payment-modal-title" class="text-lg font-bold text-gray-900 dark:text-white mb-4 text-center">
          إجمالي البيع
        </h2>

        <div class="mb-6 text-center">
          <p class="text-3xl font-bold text-gray-900 dark:text-white">${{ totalUsd.toFixed(2) }}</p>
          <p class="text-sm text-gray-400 mt-1">{{ totalSyp.toLocaleString() }} ل.س</p>
        </div>

        <div class="grid grid-cols-2 gap-3 mb-3">
          <button
            v-for="m in [
              { key: 'cash_usd', label: 'نقدي دولار' },
              { key: 'cash_syp', label: 'نقدي ليرة' },
              { key: 'card',     label: 'بطاقة' },
            ]"
            :key="m.key"
            type="button"
            class="py-4 rounded-xl border-2 border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 hover:border-blue-500 hover:text-blue-600 active:scale-95 transition-all"
            @click="selectMethod(m.key as any)"
          >{{ m.label }}</button>

          <!-- Credit tile -->
          <button
            type="button"
            data-testid="credit-method-btn"
            class="py-4 rounded-xl border-2 text-sm font-medium active:scale-95 transition-all"
            :class="selectedCustomer
              ? 'border-amber-400 text-amber-600 bg-amber-50 dark:bg-amber-900/20'
              : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:border-amber-400 hover:text-amber-600'"
            @click="handleSelectCredit"
          >📋 آجل</button>
        </div>

        <!-- Selected customer chip -->
        <div
          v-if="selectedCustomer && method === 'credit'"
          class="mb-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 flex items-center justify-between"
          dir="rtl"
        >
          <div>
            <p class="text-sm font-semibold text-amber-800 dark:text-amber-200">{{ selectedCustomer.name }}</p>
            <p v-if="selectedCustomer.phone" class="text-xs text-amber-600 dark:text-amber-400">{{ selectedCustomer.phone }}</p>
          </div>
          <button
            type="button"
            class="text-xs text-amber-600 underline"
            @click="showPicker = true"
          >تغيير</button>
        </div>

        <!-- Confirm credit button -->
        <button
          v-if="method === 'credit' && selectedCustomer"
          type="button"
          data-testid="confirm-credit-btn"
          class="w-full h-12 rounded-xl bg-amber-500 text-white font-semibold active:scale-95 transition-all"
          @click="handleConfirm"
        >تأكيد البيع الآجل</button>

        <p v-if="error" class="mt-4 text-red-600 text-sm text-center">{{ error }}</p>
      </div>

      <!-- ── Amount entry (cash) ── -->
      <div v-else-if="state === 'amount-entry'" class="p-6">
        <div class="flex justify-start mb-4">
          <button type="button" class="text-sm text-gray-500 dark:text-gray-400" @click="back">
            رجوع
          </button>
        </div>

        <h2 id="payment-modal-title" class="text-lg font-bold text-gray-900 dark:text-white mb-4 text-center">
          المبلغ المستلم
        </h2>

        <div class="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 mb-2 text-center">
          <p class="text-sm text-gray-500 mb-1">
            {{ method === 'cash_syp' ? 'المجموع بالليرة' : 'المجموع بالدولار' }}
          </p>
          <p class="text-2xl font-bold text-gray-900 dark:text-white">
            {{ method === 'cash_syp' ? `${totalSyp.toLocaleString()} ل.س` : `$${totalUsd.toFixed(2)}` }}
          </p>
        </div>

        <div class="bg-white dark:bg-gray-900 rounded-xl border-2 border-blue-500 p-4 mb-2 text-center">
          <p class="text-3xl font-mono font-bold text-gray-900 dark:text-white">
            {{ amountStr || '0' }}
          </p>
          <p v-if="changeDue !== null && changeDue > 0" class="text-sm text-green-600 dark:text-green-400 mt-1">
            الباقي: {{ method === 'cash_syp' ? `${changeDue.toLocaleString()} ل.س` : `$${changeDue.toFixed(2)}` }}
          </p>
        </div>

        <p
          v-if="amountStr && !amountSufficient"
          class="text-red-600 dark:text-red-400 text-sm text-center mb-2"
        >
          المبلغ غير كافٍ
        </p>

        <NumericKeypad
          :confirm-disabled="!amountSufficient"
          @digit="handleDigit"
          @delete="handleDelete"
          @confirm="handleConfirm"
        />
        <p v-if="error" class="text-red-600 text-sm text-center mt-2">{{ error }}</p>
      </div>

      <!-- ── Card confirm ── -->
      <div v-else-if="state === 'card-confirm'" class="p-6">
        <div class="flex justify-start mb-4">
          <button type="button" class="text-sm text-gray-500 dark:text-gray-400" @click="back">
            رجوع
          </button>
        </div>

        <h2 id="payment-modal-title" class="text-lg font-bold text-gray-900 dark:text-white mb-4 text-center">
          إجمالي البيع
        </h2>

        <div class="mb-6 text-center">
          <p class="text-3xl font-bold text-gray-900 dark:text-white">${{ totalUsd.toFixed(2) }}</p>
          <p class="text-sm text-gray-400 mt-1">{{ totalSyp.toLocaleString() }} ل.س</p>
        </div>

        <div class="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 mb-6 text-center">
          <p class="text-blue-700 dark:text-blue-300 font-medium">💳 بطاقة</p>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">سيتم تسجيل الدفع بالبطاقة</p>
        </div>

        <button
          type="button"
          class="w-full h-12 rounded-xl bg-blue-600 text-white font-semibold active:scale-95 transition-all"
          @click="handleConfirm"
        >
          تأكيد
        </button>
      </div>

      <!-- ── Confirming (spinner) ── -->
      <div v-else-if="state === 'confirming'" class="p-6 flex flex-col items-center gap-4">
        <div class="w-10 h-10 rounded-full border-4 border-blue-600 border-t-transparent animate-spin" />
        <p class="text-gray-600 dark:text-gray-300">جارٍ التأكيد...</p>
      </div>

    </div>
  </div>

  <!-- Customer picker -->
  <CustomerPickerModal
    v-if="showPicker"
    @select="handleCustomerSelected"
    @cancel="showPicker = false"
  />
</template>
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/features/payment/PaymentModal.vue
git commit -m "feat(payment): add آجل credit option with CustomerPickerModal to PaymentModal"
```

---

## Task 11: Router + navigation wiring

**Files:**
- Modify: `src/router/index.ts`
- Modify: `src/features/products/BackOfficePage.vue`
- Modify: `src/components/layout/AppSidebar.vue`

- [ ] **Step 1: Add routes to router**

In `src/router/index.ts`, add these two routes before the catch-all:

```ts
{ path: '/customers',     component: () => import('@/features/customers/CustomersPage.vue') },
{ path: '/customers/:id', component: () => import('@/features/customers/CustomerDetailPage.vue') },
```

Full file after change:

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
    { path: '/expenses',          component: () => import('@/features/expenses/ExpenseListPage.vue') },
    { path: '/customers',         component: () => import('@/features/customers/CustomersPage.vue') },
    { path: '/customers/:id',     component: () => import('@/features/customers/CustomerDetailPage.vue') },
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

- [ ] **Step 2: Add Customers tile to BackOfficePage**

In `src/features/products/BackOfficePage.vue`, find the `modules` array and add a customers entry:

```ts
const modules = [
  { key: 'products',  label: 'المنتجات',  description: 'إدارة المخزون والأسعار', route: '/products',  active: true  },
  { key: 'customers', label: 'الزبائن',   description: 'الديون والمدفوعات',       route: '/customers', active: true  },
  { key: 'reports',   label: 'التقارير',  description: 'الأرباح والمبيعات',       route: null,         active: false },
  { key: 'expenses',  label: 'المصاريف', description: 'تتبع مصاريف المحل',       route: null,         active: false },
  { key: 'shifts',    label: 'الكاشيرات', description: 'الورديات والصلاحيات',     route: null,         active: false },
]
```

Also add a customers icon SVG inside the active modules loop — after the existing products SVG, add:

```vue
<svg v-if="mod.key === 'customers'" xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-gold-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
  <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
</svg>
```

- [ ] **Step 3: Enable customers in AppSidebar**

In `src/components/layout/AppSidebar.vue`, find the `mainNav` array and change the `customers` entry from `enabled: false` to `enabled: true` and set its `href`:

```ts
{ key: 'customers', label: 'العملاء',   href: '/customers', enabled: true  },
```

- [ ] **Step 4: Add /customers to AppBottomNav Manage tab**

In `src/components/layout/AppBottomNav.vue`, find the `isActive` function and update the `'manage'` case to include `/customers`:

```ts
case 'manage':  return (
  route.path.startsWith('/back-office') ||
  route.path.startsWith('/products') ||
  route.path.startsWith('/settings') ||
  route.path.startsWith('/customers')
)
```

- [ ] **Step 5: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/router/index.ts src/features/products/BackOfficePage.vue src/components/layout/AppSidebar.vue src/components/layout/AppBottomNav.vue
git commit -m "feat(customers): wire routes, BackOfficePage tile, sidebar entry, bottom nav active state"
```

---

## Task 12: Full verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: all tests pass, 0 failures

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Start dev server and smoke-test**

Run: `npm run dev`

**Mobile (390×844):**
- Navigate to Manage tab → "الزبائن" tile → `/customers` list
- Tap "+" FAB → CustomerForm opens → add a customer → toast confirms → list updates
- Tap customer row → CustomerDetailPage with zero balance and no open invoices
- Go to POS → add items → tap payment method → tap "آجل" tile → CustomerPickerModal slides up
- Search/select the customer created above → customer chip shown → tap "تأكيد البيع الآجل"
- Return to CustomerDetailPage → open invoice appears with correct amount
- Tap "تسجيل دفعة" → RecordPaymentSheet opens → check invoice → enter partial amount → confirm
- Balance updates, payment appears in history

**Desktop (1280×800):**
- Sidebar shows "العملاء" as enabled link → navigates to `/customers`

- [ ] **Step 4: Commit any smoke-test fixes**

```bash
git add -p
git commit -m "fix: smoke-test corrections"
```
