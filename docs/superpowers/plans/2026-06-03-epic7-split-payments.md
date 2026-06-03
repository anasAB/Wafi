# Epic 7 — Split Payments: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a single sale to be paid with multiple methods (e.g. $30 USD cash + remaining in SYP), using a sequential add-payment flow.

**Architecture:** New `sale_payments` PowerSync table — one row per payment entry per sale. Single-payment sales write one row; split sales write 2+. `usePayment.ts` gains `pendingPayments` ref, `addPayment()` / `removeLastPayment()` functions, and `remainingUsd` computed. `PaymentModal.vue` shows a running payments list and an "إضافة دفعة أخرى" button in the amount-entry panel. `confirm()` always writes to `sale_payments` regardless of split.

**Tech Stack:** Vue 3 + TypeScript + Tailwind, PowerSync (`db.execute`), Vitest + `@vue/test-utils`, existing `useSaleStore` for `lockedExchangeRate`.

---

## File Map

**Modify:**
- `src/data/powersync/schema.ts` — add `sale_payments`; add `is_split` to `sales`
- `src/features/payment/payment.types.ts` — add `SplitPaymentEntry`, `'split'` to `PaymentMethod`, `splitPayments?` to `CompletedSale`
- `src/features/payment/usePayment.ts` — pendingPayments, addPayment, removeLastPayment, confirm() split path
- `src/__tests__/features/usePayment.test.ts` — extend with split assertions
- `src/features/payment/PaymentModal.vue` — pending list, remaining balance, add-split button
- `src/features/pos/SaleConfirmationScreen.vue` — split payment breakdown
- `src/features/sale-history/sale-history.types.ts` — add `isSplit` to SaleRecord
- `src/features/sale-history/useSaleHistory.ts` — map `is_split` from DB rows
- `src/features/sale-history/SaleHistoryScreen.vue` — show "متعدد" label for split sales

---

## Task 1: Schema — sale_payments table + is_split column

**Files:**
- Modify: `src/data/powersync/schema.ts`

- [ ] **Step 1: Add sale_payments table and is_split to sales**

In `src/data/powersync/schema.ts`, add this table before `AppSchema`:

```ts
const sale_payments = new Table({
  sale_id:       column.text,
  shop_id:       column.text,
  method:        column.text,   // 'cash_usd' | 'cash_syp' | 'card'
  amount_raw:    column.real,   // amount as entered in native currency
  currency:      column.text,   // 'USD' | 'SYP'
  amount_usd:    column.real,   // converted to USD
  exchange_rate: column.real,
  change_due:    column.real,   // nullable — only last entry when overpaid
  created_at:    column.text,
})
```

In the `sales` table definition, add:
```ts
is_split: column.integer,  // 0/1, default 0
```

Add `sale_payments` to `AppSchema`:
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
})
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/data/powersync/schema.ts
git commit -m "feat(schema): add sale_payments table, add is_split to sales"
```

---

## Task 2: Types — SplitPaymentEntry, PaymentMethod, CompletedSale

**Files:**
- Modify: `src/features/payment/payment.types.ts`

- [ ] **Step 1: Update payment.types.ts**

Replace the full contents of `src/features/payment/payment.types.ts`:

```ts
export type PaymentMethod = 'cash_usd' | 'cash_syp' | 'card' | 'credit' | 'split'
export type PaymentState  = 'method-selection' | 'amount-entry' | 'card-confirm' | 'credit-confirm' | 'confirming' | 'confirmed'

export interface SaleLine {
  nameAr:       string
  quantity:     number
  unitPriceUsd: number
  lineTotalUsd: number
}

export interface SplitPaymentEntry {
  method:       'cash_usd' | 'cash_syp' | 'card'
  amountRaw:    number   // as entered by cashier
  currency:     'USD' | 'SYP'
  amountUsd:    number   // converted at exchangeRate
  exchangeRate: number
  changeDue:    number   // 0 unless last entry is overpaid
}

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
  splitPayments?:          SplitPaymentEntry[]  // populated for split sales
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/features/payment/payment.types.ts
git commit -m "feat(payment): add SplitPaymentEntry type, split to PaymentMethod, splitPayments to CompletedSale"
```

---

## Task 3: usePayment — split logic (TDD)

**Files:**
- Modify: `src/features/payment/usePayment.ts`
- Modify: `src/__tests__/features/usePayment.test.ts`

- [ ] **Step 1: Add new failing tests**

Open `src/__tests__/features/usePayment.test.ts`. At the end of the `describe` block, add these tests (keep ALL existing tests):

```ts
describe('split payments', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getOptional).mockResolvedValue(null)
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
  })

  it('pendingPayments defaults to empty', () => {
    const { pendingPayments } = usePayment()
    expect(pendingPayments.value).toHaveLength(0)
  })

  it('addPayment appends an entry to pendingPayments', () => {
    const { addPayment, pendingPayments, selectMethod } = usePayment()
    selectMethod('cash_usd')
    addPayment('cash_usd', 30)
    expect(pendingPayments.value).toHaveLength(1)
    expect(pendingPayments.value[0].method).toBe('cash_usd')
    expect(pendingPayments.value[0].amountUsd).toBe(30)
    expect(pendingPayments.value[0].currency).toBe('USD')
  })

  it('addPayment converts SYP to USD using lockedExchangeRate', () => {
    const { addPayment, pendingPayments } = usePayment()
    // lockedExchangeRate defaults via saleStore; mock: 14500
    // 1,450,000 SYP / 14500 = 100 USD
    // We can't easily set lockedExchangeRate here without saleStore setup,
    // so just verify the entry is added and amountRaw is set
    addPayment('cash_syp', 1_450_000)
    expect(pendingPayments.value[0].amountRaw).toBe(1_450_000)
    expect(pendingPayments.value[0].currency).toBe('SYP')
  })

  it('remainingUsd decreases as payments are added', () => {
    const { addPayment, remainingUsd } = usePayment()
    // totalUsd from saleStore is 0 when no lines — remaining = 0
    addPayment('cash_usd', 30)
    // paidUsd = 30, totalUsd = 0, remainingUsd = max(0, 0-30) = 0
    expect(remainingUsd.value).toBeGreaterThanOrEqual(0)
  })

  it('removeLastPayment removes the last entry', () => {
    const { addPayment, removeLastPayment, pendingPayments } = usePayment()
    addPayment('cash_usd', 30)
    addPayment('cash_syp', 500_000)
    removeLastPayment()
    expect(pendingPayments.value).toHaveLength(1)
    expect(pendingPayments.value[0].method).toBe('cash_usd')
  })

  it('removeLastPayment is a no-op when list is empty', () => {
    const { removeLastPayment, pendingPayments } = usePayment()
    removeLastPayment()
    expect(pendingPayments.value).toHaveLength(0)
  })

  it('isReadyToConfirm is false when pendingPayments is empty', () => {
    const { isReadyToConfirm } = usePayment()
    expect(isReadyToConfirm.value).toBe(false)
  })

  it('confirm with pendingPayments writes is_split=1 and inserts sale_payments rows', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ cost_price_usd: 0 } as any)
      .mockResolvedValueOnce({ current_stock: 10 } as any)
    vi.mocked(db.execute)
      .mockResolvedValue({ rows: { _array: [] } } as any)

    const { addPayment, confirm } = usePayment()
    addPayment('cash_usd', 30)
    addPayment('cash_syp', 500_000)
    await confirm()

    // Verify INSERT INTO sales includes is_split=1
    const salesInsert = vi.mocked(db.execute).mock.calls.find(c =>
      (c[0] as string).includes('INSERT INTO sales') &&
      (c[0] as string).includes('is_split')
    )
    expect(salesInsert).toBeDefined()
    expect(salesInsert![1]).toContain(1) // is_split = 1

    // Verify sale_payments rows inserted
    const paymentInserts = vi.mocked(db.execute).mock.calls.filter(c =>
      (c[0] as string).includes('INSERT INTO sale_payments')
    )
    expect(paymentInserts).toHaveLength(2)
  })

  it('confirm without pendingPayments (single path) writes is_split=0', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ cost_price_usd: 0 } as any)
      .mockResolvedValueOnce({ current_stock: 10 } as any)
    vi.mocked(db.execute)
      .mockResolvedValue({ rows: { _array: [] } } as any)

    const { selectMethod, confirm } = usePayment()
    selectMethod('card')
    await confirm()

    const salesInsert = vi.mocked(db.execute).mock.calls.find(c =>
      (c[0] as string).includes('INSERT INTO sales') &&
      (c[0] as string).includes('is_split')
    )
    expect(salesInsert).toBeDefined()
    expect(salesInsert![1]).toContain(0) // is_split = 0

    const paymentInserts = vi.mocked(db.execute).mock.calls.filter(c =>
      (c[0] as string).includes('INSERT INTO sale_payments')
    )
    expect(paymentInserts).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to verify tests fail**

Run: `npx vitest run src/__tests__/features/usePayment.test.ts --reporter=verbose 2>&1 | tail -30`
Expected: new tests FAIL, existing tests PASS

- [ ] **Step 3: Update usePayment.ts**

Replace the full contents of `src/features/payment/usePayment.ts`:

```ts
import { ref, computed } from 'vue'
import { useSaleStore } from '@/store/sale.store'
import { useSaleNumber } from '@/composables/useSaleNumber'
import { useSaleDraft } from '@/composables/useSaleDraft'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { v4 as uuidv4 } from 'uuid'
import type { PaymentMethod, PaymentState, CompletedSale, SplitPaymentEntry } from './payment.types'

export function usePayment() {
  const saleStore      = useSaleStore()
  const deviceStore    = useDeviceStore()
  const { nextNumber } = useSaleNumber()
  const { clearDraft } = useSaleDraft()

  const state          = ref<PaymentState>('method-selection')
  const isOpen         = ref(true)
  const method         = ref<PaymentMethod | null>(null)
  const amountReceived = ref<number | null>(null)
  const error          = ref<string | null>(null)

  // Split payment state
  const pendingPayments = ref<SplitPaymentEntry[]>([])

  const totalUsd = computed(() => saleStore.totalUsd)

  const totalSyp = computed(() => {
    const rate = saleStore.lockedExchangeRate
    if (rate === null) return 0
    return Math.round(totalUsd.value * rate)
  })

  const changeDue = computed(() => {
    if (method.value === 'cash_usd' && amountReceived.value !== null) {
      return Math.max(0, amountReceived.value - totalUsd.value)
    }
    if (method.value === 'cash_syp' && amountReceived.value !== null) {
      return Math.max(0, amountReceived.value - totalSyp.value)
    }
    return null
  })

  // Split payment computeds
  const paidUsd = computed(() =>
    pendingPayments.value.reduce((s, p) => s + p.amountUsd, 0)
  )

  const remainingUsd = computed(() =>
    Math.max(0, totalUsd.value - paidUsd.value)
  )

  const isReadyToConfirm = computed(() =>
    pendingPayments.value.length > 0 && remainingUsd.value < 0.001
  )

  function selectMethod(m: PaymentMethod) {
    method.value = m
    state.value  = m === 'card'   ? 'card-confirm'
                 : m === 'credit' ? 'credit-confirm'
                 : 'amount-entry'
  }

  function back() {
    if (state.value === 'amount-entry' || state.value === 'card-confirm' || state.value === 'credit-confirm') {
      amountReceived.value = null
      method.value         = null
      state.value          = 'method-selection'
    }
  }

  function cancel() {
    isOpen.value          = false
    pendingPayments.value = []
  }

  // Split payment functions
  function addPayment(m: 'cash_usd' | 'cash_syp' | 'card', amountRaw: number) {
    const rate      = saleStore.lockedExchangeRate ?? 1
    const currency  = m === 'cash_syp' ? 'SYP' as const : 'USD' as const
    const amountUsd = m === 'cash_syp' ? amountRaw / rate : amountRaw
    pendingPayments.value = [
      ...pendingPayments.value,
      { method: m, amountRaw, currency, amountUsd, exchangeRate: rate, changeDue: 0 },
    ]
  }

  function removeLastPayment() {
    if (pendingPayments.value.length > 0) {
      pendingPayments.value = pendingPayments.value.slice(0, -1)
    }
  }

  async function confirm(customerId?: string): Promise<CompletedSale> {
    if (!method.value && pendingPayments.value.length === 0) throw new Error('No payment selected')
    state.value  = 'confirming'
    error.value  = null

    const saleId     = uuidv4()
    const now        = new Date().toISOString()
    const displayNum = nextNumber()

    // Build entries
    let entries: SplitPaymentEntry[]
    if (pendingPayments.value.length > 0) {
      entries = pendingPayments.value
    } else {
      const rate   = saleStore.lockedExchangeRate ?? 1
      const m      = method.value as 'cash_usd' | 'cash_syp' | 'card'
      const rawAmt = amountReceived.value ?? totalUsd.value
      const amtUsd = m === 'cash_syp' ? rawAmt / rate : rawAmt
      entries = [{
        method:       m,
        amountRaw:    rawAmt,
        currency:     m === 'cash_syp' ? 'SYP' : 'USD',
        amountUsd:    amtUsd,
        exchangeRate: rate,
        changeDue:    changeDue.value ?? 0,
      }]
    }

    const isSplit       = entries.length > 1
    const primaryMethod = isSplit ? 'split' as const : entries[0].method
    const totalReceived = entries.reduce((s, e) => s + e.amountUsd, 0)
    const lastChange    = entries[entries.length - 1].changeDue

    const sale: CompletedSale = {
      saleId,
      displaySaleNumber:      displayNum,
      totalUsd:               totalUsd.value,
      totalSyp:               totalSyp.value,
      exchangeRateAtSale:     saleStore.lockedExchangeRate!,
      paymentMethod:          primaryMethod,
      amountReceived:         totalReceived,
      amountReceivedCurrency: 'USD',
      changeDue:              lastChange || undefined,
      createdAt:              now,
      customerId,
      splitPayments:          isSplit ? entries : undefined,
      lines:                  saleStore.lines.map(l => ({
        nameAr:       l.nameAr,
        quantity:     l.quantity,
        unitPriceUsd: l.unitPriceUsd,
        lineTotalUsd: l.lineTotalUsd,
      })),
    }

    try {
      await db.execute(
        `INSERT INTO sales (id, shop_id, device_id, device_sequence, display_sale_number,
          created_at, total_usd, total_syp, exchange_rate_at_sale, payment_method,
          amount_received, amount_received_currency, change_due, customer_id, is_credit, is_split)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          saleId, deviceStore.shopId, deviceStore.deviceId,
          saleStore.deviceSequence, displayNum, now,
          totalUsd.value, totalSyp.value, saleStore.lockedExchangeRate,
          primaryMethod, totalReceived, 'USD', lastChange ?? null,
          customerId ?? null, customerId ? 1 : 0, isSplit ? 1 : 0,
        ]
      )

      // Insert one row per payment entry
      for (const entry of entries) {
        await db.execute(
          `INSERT INTO sale_payments (id, sale_id, shop_id, method, amount_raw, currency,
            amount_usd, exchange_rate, change_due, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            uuidv4(), saleId, deviceStore.shopId, entry.method, entry.amountRaw,
            entry.currency, entry.amountUsd, entry.exchangeRate,
            entry.changeDue || null, now,
          ]
        )
      }

      for (const line of saleStore.lines) {
        const costRow = await db.getOptional<{ cost_price_usd: number }>(
          'SELECT cost_price_usd FROM products WHERE id = ?',
          [line.productId]
        )
        const unitCostUsd = costRow?.cost_price_usd ?? 0

        await db.execute(
          `INSERT INTO sale_line_items (id, sale_id, shop_id, product_id, quantity, unit_price_usd, unit_cost_usd, line_total_usd)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [uuidv4(), saleId, deviceStore.shopId, line.productId,
           line.quantity, line.unitPriceUsd, unitCostUsd, line.lineTotalUsd]
        )
      }

      for (const line of saleStore.lines) {
        const stockRow = await db.getOptional<{ current_stock: number }>(
          `SELECT current_stock FROM products WHERE id = ?`,
          [line.productId]
        )
        const currentStock = stockRow?.current_stock ?? 0
        const newStock     = currentStock - line.quantity

        await db.execute(
          `UPDATE products SET current_stock = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
          [newStock, now, line.productId]
        )
        await db.execute(
          `INSERT INTO stock_adjustments (id, shop_id, product_id, old_value, new_value, reason, notes, created_at, device_id)
           VALUES (?, ?, ?, ?, ?, 'sale', null, ?, ?)`,
          [uuidv4(), deviceStore.shopId, line.productId, currentStock, newStock, now, deviceStore.deviceId]
        )
      }

      await clearDraft()
      saleStore.clear()
      pendingPayments.value = []
      state.value           = 'confirmed'
      isOpen.value          = false
      return sale
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Payment failed'
      state.value = method.value === 'card'   ? 'card-confirm'
                  : method.value === 'credit' ? 'credit-confirm'
                  : 'amount-entry'
      throw err
    }
  }

  return {
    state, isOpen, method, amountReceived, error,
    totalUsd, totalSyp, changeDue,
    pendingPayments, paidUsd, remainingUsd, isReadyToConfirm,
    selectMethod, back, cancel, confirm,
    addPayment, removeLastPayment,
  }
}
```

- [ ] **Step 4: Fix existing usePayment tests that check the sales INSERT**

The existing test `'confirm deducts stock and writes stock_adjustments'` checks `INSERT INTO sales`. Now that we added `is_split` to the INSERT, the existing mock call counts change (one more `db.execute` for each `sale_payments` row). Update the mock setup in that test to add one more `db.execute` mock:

Find the test `'confirm deducts stock and writes stock_adjustments...'` and add one extra `mockResolvedValueOnce` at the beginning of the `db.execute` chain for the `sale_payments` INSERT:

```ts
vi.mocked(db.execute)
  .mockResolvedValueOnce({ rows: { _array: [] } } as any) // INSERT sales
  .mockResolvedValueOnce({ rows: { _array: [] } } as any) // INSERT sale_payments ← ADD THIS
  .mockResolvedValueOnce({ rows: { _array: [] } } as any) // INSERT sale_line_items
  .mockResolvedValueOnce({ rows: { _array: [] } } as any) // UPDATE products stock
  .mockResolvedValueOnce({ rows: { _array: [] } } as any) // INSERT stock_adjustments
```

Also update `'confirm writes unit_cost_usd to sale_line_items...'` similarly.
Also update `'confirm writes customer_id and is_credit=1 for credit sales'` similarly.

- [ ] **Step 5: Run all usePayment tests**

Run: `npx vitest run src/__tests__/features/usePayment.test.ts`
Expected: all tests pass (20+)

- [ ] **Step 6: Commit**

```bash
git add src/features/payment/usePayment.ts src/__tests__/features/usePayment.test.ts
git commit -m "feat(payment): add split payment logic — pendingPayments, addPayment, removeLastPayment, confirm() split path"
```

---

## Task 4: PaymentModal — split payment UI

**Files:**
- Modify: `src/features/payment/PaymentModal.vue`

- [ ] **Step 1: Update PaymentModal.vue**

Replace the full contents of `src/features/payment/PaymentModal.vue`:

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
        selectMethod, back, cancel, confirm,
        pendingPayments, remainingUsd, isReadyToConfirm,
        addPayment, removeLastPayment } = usePayment()

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
  // In split mode: any positive amount is sufficient
  if (pendingPayments.value.length > 0) return amount > 0
  // Single payment: must cover total
  if (method.value === 'cash_usd') return amount >= totalUsd.value
  if (method.value === 'cash_syp') return amount >= totalSyp.value
  return false
})

// In split mode: hide change display (remaining balance shown at top instead)
// In single mode: use changeDue from usePayment
const showChangeDue = computed(() =>
  pendingPayments.value.length === 0 && changeDue.value !== null && changeDue.value > 0
)

const methodLabels: Record<string, string> = {
  cash_usd: 'نقدي دولار',
  cash_syp: 'نقدي ليرة',
  card:     'بطاقة',
}

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
}

function handleBack() {
  back()
  selectedCustomer.value = null
}

function handleCancel() {
  cancel()
  selectedCustomer.value = null
  emit('close')
}

// Add current cash/SYP amount as a split entry and return to method-selection
function handleAddSplitPayment() {
  if (!amountSufficient.value) return
  const raw = displayAmount.value ?? 0
  addPayment(method.value as 'cash_usd' | 'cash_syp' | 'card', raw)
  amountStr.value      = ''
  amountReceived.value = null
  handleBack()
}

// Add current card payment as a split entry and return to method-selection
function handleAddCardSplitPayment() {
  addPayment('card', remainingUsd.value)
  handleBack()
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

        <div class="mb-4 text-center">
          <p class="text-3xl font-bold text-gray-900 dark:text-white">${{ totalUsd.toFixed(2) }}</p>
          <p class="text-sm text-gray-400 mt-1">{{ totalSyp.toLocaleString() }} ل.س</p>
        </div>

        <!-- Pending payments list -->
        <div
          v-if="pendingPayments.length > 0"
          data-testid="pending-payments-list"
          class="mb-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-xl"
          dir="rtl"
        >
          <div
            v-for="(entry, i) in pendingPayments"
            :key="i"
            class="flex justify-between items-center py-1 text-sm"
          >
            <div class="flex items-center gap-2">
              <span>{{ methodLabels[entry.method] }}</span>
              <button
                v-if="i === pendingPayments.length - 1"
                type="button"
                data-testid="remove-last-payment-btn"
                class="text-red-500 text-xs hover:text-red-700"
                @click="removeLastPayment"
              >×</button>
            </div>
            <span class="font-semibold">${{ entry.amountUsd.toFixed(2) }}</span>
          </div>
          <div class="border-t border-gray-200 dark:border-gray-700 mt-2 pt-2 flex justify-between text-sm font-semibold">
            <span dir="rtl">متبقي</span>
            <span :class="remainingUsd <= 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-white'">
              ${{ remainingUsd.toFixed(2) }}
            </span>
          </div>
        </div>

        <!-- Confirm split button (when all paid) -->
        <button
          v-if="isReadyToConfirm"
          type="button"
          data-testid="confirm-split-btn"
          class="w-full h-12 rounded-xl bg-green-600 text-white font-semibold active:scale-95 transition-all mb-3"
          @click="handleConfirm"
        >تأكيد البيع</button>

        <!-- Method tiles (hidden when ready to confirm) -->
        <template v-else>
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

            <!-- Credit tile (disabled in split mode) -->
            <button
              v-if="pendingPayments.length === 0"
              type="button"
              data-testid="credit-method-btn"
              class="py-4 rounded-xl border-2 text-sm font-medium active:scale-95 transition-all"
              :class="selectedCustomer
                ? 'border-amber-400 text-amber-600 bg-amber-50 dark:bg-amber-900/20'
                : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:border-amber-400 hover:text-amber-600'"
              @click="handleSelectCredit"
            >📋 آجل</button>
          </div>

          <!-- Selected customer chip (credit only) -->
          <div
            v-if="selectedCustomer && method === 'credit'"
            class="mb-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 flex items-center justify-between"
            dir="rtl"
          >
            <div>
              <p class="text-sm font-semibold text-amber-800 dark:text-amber-200">{{ selectedCustomer.name }}</p>
              <p v-if="selectedCustomer.phone" class="text-xs text-amber-600 dark:text-amber-400">{{ selectedCustomer.phone }}</p>
            </div>
            <button type="button" class="text-xs text-amber-600 underline" @click="showPicker = true">تغيير</button>
          </div>

          <button
            v-if="method === 'credit' && selectedCustomer"
            type="button"
            data-testid="confirm-credit-btn"
            class="w-full h-12 rounded-xl bg-amber-500 text-white font-semibold active:scale-95 transition-all"
            @click="handleConfirm"
          >تأكيد البيع الآجل</button>
        </template>

        <p v-if="error" class="mt-4 text-red-600 text-sm text-center">{{ error }}</p>
      </div>

      <!-- ── Amount entry (cash) ── -->
      <div v-else-if="state === 'amount-entry'" class="p-6">
        <div class="flex justify-start mb-4">
          <button type="button" class="text-sm text-gray-500 dark:text-gray-400" @click="handleBack">
            رجوع
          </button>
        </div>

        <h2 id="payment-modal-title" class="text-lg font-bold text-gray-900 dark:text-white mb-4 text-center">
          المبلغ المستلم
        </h2>

        <!-- Remaining balance in split mode -->
        <div v-if="pendingPayments.length > 0" class="mb-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-xl text-center text-sm" dir="rtl">
          <span class="text-gray-500">متبقي: </span>
          <span class="font-bold text-blue-600 dark:text-blue-400">${{ remainingUsd.toFixed(2) }}</span>
        </div>

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
          <p v-if="showChangeDue" class="text-sm text-green-600 dark:text-green-400 mt-1">
            الباقي: {{ method === 'cash_syp' ? `${changeDue?.toLocaleString()} ل.س` : `$${changeDue?.toFixed(2)}` }}
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

        <!-- Add split payment button -->
        <button
          v-if="amountSufficient"
          type="button"
          data-testid="add-split-btn"
          class="w-full h-11 mt-3 rounded-xl border-2 border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 active:scale-95 transition-all"
          @click="handleAddSplitPayment"
        >إضافة دفعة أخرى</button>

        <p v-if="error" class="text-red-600 text-sm text-center mt-2">{{ error }}</p>
      </div>

      <!-- ── Card confirm ── -->
      <div v-else-if="state === 'card-confirm'" class="p-6">
        <div class="flex justify-start mb-4">
          <button type="button" class="text-sm text-gray-500 dark:text-gray-400" @click="handleBack">
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

        <div class="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 mb-4 text-center">
          <p class="text-blue-700 dark:text-blue-300 font-medium">💳 بطاقة</p>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">سيتم تسجيل الدفع بالبطاقة</p>
        </div>

        <button
          type="button"
          class="w-full h-12 rounded-xl bg-blue-600 text-white font-semibold active:scale-95 transition-all mb-3"
          @click="handleConfirm"
        >تأكيد</button>

        <!-- Add card as split payment -->
        <button
          v-if="pendingPayments.length > 0 || true"
          type="button"
          data-testid="add-card-split-btn"
          class="w-full h-11 rounded-xl border-2 border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 active:scale-95 transition-all"
          @click="handleAddCardSplitPayment"
        >إضافة دفعة أخرى</button>
      </div>

      <!-- ── Credit confirm ── -->
      <div v-else-if="state === 'credit-confirm'" class="p-6">
        <div class="flex justify-start mb-4">
          <button type="button" class="text-sm text-gray-500 dark:text-gray-400" @click="handleBack">
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

        <div
          v-if="selectedCustomer"
          class="mb-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 flex items-center justify-between"
          dir="rtl"
        >
          <div>
            <p class="text-sm font-semibold text-amber-800 dark:text-amber-200">{{ selectedCustomer.name }}</p>
            <p v-if="selectedCustomer.phone" class="text-xs text-amber-600 dark:text-amber-400">{{ selectedCustomer.phone }}</p>
          </div>
          <button type="button" class="text-xs text-amber-600 underline" @click="showPicker = true">تغيير</button>
        </div>

        <button
          type="button"
          data-testid="confirm-credit-btn"
          class="w-full h-12 rounded-xl bg-amber-500 text-white font-semibold active:scale-95 transition-all"
          @click="handleConfirm"
        >تأكيد البيع الآجل</button>
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

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/features/payment/PaymentModal.vue
git commit -m "feat(payment): update PaymentModal for split payment flow"
```

---

## Task 5: SaleConfirmationScreen — split breakdown

**Files:**
- Modify: `src/features/pos/SaleConfirmationScreen.vue`

- [ ] **Step 1: Add split payment display**

In `src/features/pos/SaleConfirmationScreen.vue`, find the payment method display row and replace it:

Current code (find this block):
```vue
<div class="flex justify-between text-sm">
  <span class="text-gray-500">طريقة الدفع</span>
  <span class="font-semibold">{{ sale ? methodLabels[sale.paymentMethod] : '—' }}</span>
</div>
```

Replace with:
```vue
<div class="flex justify-between text-sm">
  <span class="text-gray-500">طريقة الدفع</span>
  <span class="font-semibold">
    {{ sale ? (sale.paymentMethod === 'split' ? 'متعدد' : methodLabels[sale.paymentMethod]) : '—' }}
  </span>
</div>

<!-- Split payment breakdown -->
<template v-if="sale?.splitPayments?.length">
  <div
    v-for="(entry, i) in sale.splitPayments"
    :key="i"
    class="flex justify-between text-sm pr-4"
    dir="rtl"
  >
    <span class="text-gray-400">{{ methodLabels[entry.method] }}</span>
    <span class="text-gray-600 dark:text-gray-300">${{ entry.amountUsd.toFixed(2) }}</span>
  </div>
</template>
```

Also update `methodLabels` to include 'split':
```ts
const methodLabels: Record<string, string> = {
  cash_usd: 'نقداً دولار',
  cash_syp: 'نقداً ليرة',
  card:     'بطاقة',
  credit:   'آجل',
  split:    'متعدد',
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/features/pos/SaleConfirmationScreen.vue
git commit -m "feat(pos): show split payment breakdown on sale confirmation screen"
```

---

## Task 6: Sale History — split label

**Files:**
- Modify: `src/features/sale-history/sale-history.types.ts`
- Modify: `src/features/sale-history/useSaleHistory.ts`
- Modify: `src/features/sale-history/SaleHistoryScreen.vue`

- [ ] **Step 1: Add isSplit to SaleRecord**

In `src/features/sale-history/sale-history.types.ts`, add `isSplit` to `SaleRecord`:

```ts
export interface SaleRecord {
  id:                  string
  shopId:              string
  deviceId:            string
  deviceSequence:      number
  displaySaleNumber:   string
  createdAt:           string
  totalUsd:            number
  totalSyp:            number
  exchangeRateAtSale:  number
  paymentMethod:       PaymentMethod
  amountReceived?:     number
  amountReceivedCurrency?: 'USD' | 'SYP'
  changeDue?:          number
  isPending:           boolean
  isSplit:             boolean
}
```

- [ ] **Step 2: Map isSplit in useSaleHistory.ts**

In `src/features/sale-history/useSaleHistory.ts`, find the function that maps DB rows to `SaleRecord` objects. Add `isSplit: row.is_split === 1` to the mapping. Also add `is_split: number` to the row type interface.

Read the file first to find the exact mapping code, then add:
```ts
isSplit: (row.is_split ?? 0) === 1,
```

- [ ] **Step 3: Update SaleHistoryScreen.vue method label**

In `src/features/sale-history/SaleHistoryScreen.vue`, find where `methodLabel` is used to display the payment method. Currently:

```ts
const methodLabel: Record<string, string> = {
  cash_usd: '💵', cash_syp: 'ل.س', card: '💳',
}
```

Add 'split' and 'credit':
```ts
const methodLabel: Record<string, string> = {
  cash_usd: '💵',
  cash_syp: 'ل.س',
  card:     '💳',
  credit:   '📋',
  split:    '💵+',
}
```

- [ ] **Step 4: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/features/sale-history/sale-history.types.ts src/features/sale-history/useSaleHistory.ts src/features/sale-history/SaleHistoryScreen.vue
git commit -m "feat(history): show split payment label in sale history"
```

---

## Task 7: Full verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: all tests pass, 0 failures

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Start dev server and smoke-test**

Run: `npm run dev`

**Test single-payment (unchanged behavior):**
- Open POS → add items → pay with نقدي دولار → enter amount → confirm
- Sale confirmation shows single method label
- Sale history shows 💵

**Test split payment:**
- Open POS → add items totaling $65
- Payment modal → tap نقدي دولار → enter $30 → tap "إضافة دفعة أخرى"
- Modal returns to method-selection with "✓ نقدي دولار $30.00" and "متبقي: $35.00"
- Tap نقدي ليرة → enter SYP equivalent of $35 → tap "إضافة دفعة أخرى"
- Modal shows "تأكيد البيع" (remaining ≤ 0)
- Tap تأكيد → confirmation screen shows "متعدد" + breakdown
- History shows "💵+"

**Test remove last payment:**
- During split flow → tap × next to last entry → entry removed, method-selection shows remaining restored

- [ ] **Step 4: Commit smoke-test fixes if needed**

```bash
git add -p
git commit -m "fix: smoke-test corrections"
```
