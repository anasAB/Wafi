# Returns & Refunds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let cashiers initiate partial item returns from Sale History, adjust inventory, and record a flexible refund method — all via a bottom sheet.

**Architecture:** Three new PowerSync tables (`returns`, `return_line_items`, `return_reasons`) are added to the schema. A `useReturnSheet(saleId)` composable owns all state and DB side-effects. `ReturnSheet.vue` is a bottom sheet component wired into `SaleHistoryScreen.vue`. `ReturnReasonsScreen.vue` lets the owner manage predefined reason chips from Settings.

**Tech Stack:** Vue 3 + TypeScript, PowerSync SQLite (`db.execute`, `db.getAll`), Pinia (`useDeviceStore`), `uuid` (already installed), existing `AppToast` + `AppDialog` UI components.

---

## Codebase Patterns to Know

- **DB reads:** `db.getAll<RowType>(sql, params)` returns a typed array directly.
- **DB writes:** `db.execute(sql, params)` — result is `{ rows: { _array: [] } }`.
- **Shop ID:** `const { shopId, deviceId } = useDeviceStore()` — call inside async functions, not at composable init.
- **UUID:** `import { v4 as uuidv4 } from 'uuid'`
- **Test mock:** `vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))` — then `vi.mocked(db.execute).mockResolvedValue(...)` or `vi.mocked(db.getAll).mockResolvedValue([...])`.
- **`db.execute` mock default:** returns `{ rows: { _array: [] } }`.
- **`db.getAll` mock default:** returns `[]`.
- **`sale_line_items` does NOT have `unit_price_syp`** — compute SYP price as `unit_price_usd × exchange_rate_at_return`.
- **Exchange rate:** query `SELECT rate FROM exchange_rates WHERE shop_id = ? ORDER BY set_at DESC LIMIT 1` — default to `1` if no result.
- **`sync_status`:** always `'pending'` on new inserts — PowerSync picks it up for upload.

---

## File Map

| Action | Path |
|---|---|
| **Create** | `src/features/returns/returns.types.ts` |
| **Create** | `src/features/returns/composables/useReturnReasons.ts` |
| **Create** | `src/features/returns/composables/useReturnSheet.ts` |
| **Create** | `src/features/returns/components/ReturnLineItem.vue` |
| **Create** | `src/features/returns/components/ReturnSheet.vue` |
| **Create** | `src/features/returns/index.ts` |
| **Create** | `src/features/settings/screens/ReturnReasonsScreen.vue` |
| **Create** | `src/__tests__/features/useReturnReasons.test.ts` |
| **Create** | `src/__tests__/features/useReturnSheet.test.ts` |
| **Modify** | `src/data/powersync/schema.ts` |
| **Modify** | `src/features/sale-history/sale-history.types.ts` |
| **Modify** | `src/features/sale-history/useSaleHistory.ts` |
| **Modify** | `src/features/sale-history/SaleHistoryScreen.vue` |
| **Modify** | `src/pages/SettingsPage.vue` |
| **Modify** | `src/router/index.ts` |

---

## Tasks

---

### Task 1: Schema — add returns, return_line_items, return_reasons

**Files:**
- Modify: `src/data/powersync/schema.ts`

- [ ] **Step 1: Add the three new tables**

Open `src/data/powersync/schema.ts`. After the `cashier_shifts` table definition (around line 150) and before the `export const AppSchema` line, add:

```ts
const returns = new Table({
  shop_id:                column.text,
  original_sale_id:       column.text,
  created_at:             column.text,
  refund_method:          column.text,   // 'cash_usd' | 'cash_syp' | 'store_credit' | 'transfer'
  refund_amount_usd:      column.real,
  refund_amount_syp:      column.real,
  exchange_rate_at_return: column.real,
  reason:                 column.text,   // nullable snapshot of reason label
  notes:                  column.text,   // nullable free text
  shift_id:               column.text,   // nullable FK → cashier_shifts.id
  sync_status:            column.text,
})

const return_line_items = new Table({
  return_id:      column.text,
  shop_id:        column.text,
  product_id:     column.text,
  qty_returned:   column.integer,
  unit_price_usd: column.real,
  unit_price_syp: column.real,
  restock:        column.integer,  // 0 | 1
})

const return_reasons = new Table({
  shop_id:    column.text,
  label:      column.text,
  sort_order: column.integer,
  is_active:  column.integer,  // 0 | 1
})
```

- [ ] **Step 2: Register the tables in AppSchema**

In the `export const AppSchema = new Schema({...})` block, add the three new tables:

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
  returns,
  return_line_items,
  return_reasons,
})
```

- [ ] **Step 3: Verify the app still compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/data/powersync/schema.ts
git commit -m "feat(returns): add returns, return_line_items, return_reasons to schema"
```

---

### Task 2: returns.types.ts

**Files:**
- Create: `src/features/returns/returns.types.ts`

- [ ] **Step 1: Create the types file**

```ts
export type RefundMethod = 'cash_usd' | 'cash_syp' | 'store_credit' | 'transfer'

export interface ReturnLine {
  productId:          string
  productName:        string
  originalQty:        number   // qty from original sale_line_items
  alreadyReturnedQty: number   // qty already returned in prior returns on this sale
  unitPriceUsd:       number   // snapshot from sale_line_items
  selected:           boolean
  qtyToReturn:        number   // 1 .. (originalQty - alreadyReturnedQty)
  restock:            boolean  // add back to stock on confirm
}

export interface ReturnReason {
  id:        string
  label:     string
  sortOrder: number
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/returns/returns.types.ts
git commit -m "feat(returns): add returns.types.ts"
```

---

### Task 3: useReturnReasons (TDD)

**Files:**
- Create: `src/__tests__/features/useReturnReasons.test.ts`
- Create: `src/features/returns/composables/useReturnReasons.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/features/useReturnReasons.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useReturnReasons } from '@/features/returns/composables/useReturnReasons'
import { db } from '@/data/powersync/db'

describe('useReturnReasons', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('queries only active reasons for the shop ordered by sort_order', async () => {
    vi.mocked(db.getAll).mockResolvedValue([])
    const { loadReasons } = useReturnReasons()
    await loadReasons()
    expect(db.getAll).toHaveBeenCalledWith(
      expect.stringContaining('is_active'),
      expect.arrayContaining(['00000000-0000-0000-0000-000000000001']),
    )
    expect(db.getAll).toHaveBeenCalledWith(
      expect.stringContaining('sort_order'),
      expect.any(Array),
    )
  })

  it('maps db rows to ReturnReason objects', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { id: 'r1', label: 'عيب في المنتج', sort_order: 0 },
      { id: 'r2', label: 'خطأ في البيع',  sort_order: 1 },
    ])
    const { reasons, loadReasons } = useReturnReasons()
    await loadReasons()
    expect(reasons.value).toHaveLength(2)
    expect(reasons.value[0]).toEqual({ id: 'r1', label: 'عيب في المنتج', sortOrder: 0 })
    expect(reasons.value[1]).toEqual({ id: 'r2', label: 'خطأ في البيع',  sortOrder: 1 })
  })

  it('returns empty array when no reasons configured', async () => {
    vi.mocked(db.getAll).mockResolvedValue([])
    const { reasons, loadReasons } = useReturnReasons()
    await loadReasons()
    expect(reasons.value).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/features/useReturnReasons.test.ts`
Expected: FAIL — "Cannot find module '@/features/returns/composables/useReturnReasons'"

- [ ] **Step 3: Implement useReturnReasons**

Create `src/features/returns/composables/useReturnReasons.ts`:

```ts
import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import type { ReturnReason } from '../returns.types'

export function useReturnReasons() {
  const reasons = ref<ReturnReason[]>([])

  async function loadReasons(): Promise<void> {
    const { shopId } = useDeviceStore()
    const rows = await db.getAll<{ id: string; label: string; sort_order: number }>(
      `SELECT id, label, sort_order
       FROM return_reasons
       WHERE shop_id = ? AND is_active = 1
       ORDER BY sort_order ASC`,
      [shopId],
    )
    reasons.value = rows.map(r => ({
      id:        r.id,
      label:     r.label,
      sortOrder: r.sort_order,
    }))
  }

  return { reasons, loadReasons }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/features/useReturnReasons.test.ts`
Expected: 3/3 PASS

- [ ] **Step 5: Commit**

```bash
git add src/__tests__/features/useReturnReasons.test.ts src/features/returns/composables/useReturnReasons.ts
git commit -m "feat(returns): add useReturnReasons composable with tests"
```

---

### Task 4: useReturnSheet — load() + computed state (TDD)

**Files:**
- Create: `src/__tests__/features/useReturnSheet.test.ts`
- Create: `src/features/returns/composables/useReturnSheet.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/features/useReturnSheet.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useReturnSheet } from '@/features/returns/composables/useReturnSheet'
import { db } from '@/data/powersync/db'

const SALE_ID = 'sale-abc'

// db.execute is used for sale lookup; db.getAll for line items and prior returns
function mockSale(customerId: string | null = null) {
  vi.mocked(db.execute).mockResolvedValueOnce({
    rows: {
      _array: [{ id: SALE_ID, display_sale_number: '#001', customer_id: customerId }],
    },
  } as any)
}

function mockLineItems() {
  vi.mocked(db.getAll).mockResolvedValueOnce([
    { product_id: 'p1', product_name: 'iPhone',  quantity: 2, unit_price_usd: 500 },
    { product_id: 'p2', product_name: 'Charger', quantity: 1, unit_price_usd: 25  },
  ] as any)
}

function mockPriorReturns(rows: { product_id: string; already_returned: number }[] = []) {
  vi.mocked(db.getAll).mockResolvedValueOnce(rows as any)
}

describe('useReturnSheet — load()', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('fetches sale, line items, and prior returns on load()', async () => {
    mockSale()
    mockLineItems()
    mockPriorReturns()
    const { load } = useReturnSheet(SALE_ID)
    await load()
    // 1st execute = sale lookup, 2 getAll = line items + prior returns
    expect(db.execute).toHaveBeenCalledWith(expect.stringContaining('FROM sales'), [SALE_ID])
    expect(db.getAll).toHaveBeenCalledWith(expect.stringContaining('sale_line_items'), expect.any(Array))
    expect(db.getAll).toHaveBeenCalledWith(expect.stringContaining('return_line_items'), expect.any(Array))
  })

  it('maps line items to ReturnLine objects with defaults', async () => {
    mockSale()
    mockLineItems()
    mockPriorReturns()
    const { load, lines } = useReturnSheet(SALE_ID)
    await load()
    expect(lines.value).toHaveLength(2)
    expect(lines.value[0]).toMatchObject({
      productId: 'p1', productName: 'iPhone',
      originalQty: 2, alreadyReturnedQty: 0,
      unitPriceUsd: 500,
      selected: false, qtyToReturn: 1, restock: true,
    })
  })

  it('subtracts already-returned qty from available qty', async () => {
    mockSale()
    mockLineItems()
    mockPriorReturns([{ product_id: 'p1', already_returned: 1 }])
    const { load, lines } = useReturnSheet(SALE_ID)
    await load()
    expect(lines.value[0].alreadyReturnedQty).toBe(1)
  })

  it('sets hasCustomer true when sale has customer_id', async () => {
    mockSale('cust-1')
    mockLineItems()
    mockPriorReturns()
    const { load, hasCustomer } = useReturnSheet(SALE_ID)
    await load()
    expect(hasCustomer.value).toBe(true)
  })

  it('sets hasCustomer false when sale has no customer_id', async () => {
    mockSale(null)
    mockLineItems()
    mockPriorReturns()
    const { load, hasCustomer } = useReturnSheet(SALE_ID)
    await load()
    expect(hasCustomer.value).toBe(false)
  })
})

describe('useReturnSheet — computed state', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  async function loadSheet() {
    mockSale('cust-1')
    mockLineItems()
    mockPriorReturns()
    const sheet = useReturnSheet(SALE_ID)
    await sheet.load()
    return sheet
  }

  it('refundTotalUsd is 0 when no items selected', async () => {
    const { refundTotalUsd } = await loadSheet()
    expect(refundTotalUsd.value).toBe(0)
  })

  it('refundTotalUsd sums selected lines (qty × unitPriceUsd)', async () => {
    const { lines, refundTotalUsd } = await loadSheet()
    lines.value[0].selected = true
    lines.value[0].qtyToReturn = 2
    expect(refundTotalUsd.value).toBe(1000)  // 2 × 500
  })

  it('canConfirm is false when no items selected', async () => {
    const { canConfirm, refundMethod } = await loadSheet()
    refundMethod.value = 'cash_usd'
    expect(canConfirm.value).toBe(false)
  })

  it('canConfirm is false when no refund method selected', async () => {
    const { lines, canConfirm } = await loadSheet()
    lines.value[0].selected = true
    expect(canConfirm.value).toBe(false)
  })

  it('canConfirm is true when at least one item selected and method set', async () => {
    const { lines, refundMethod, canConfirm } = await loadSheet()
    lines.value[0].selected = true
    refundMethod.value = 'cash_usd'
    expect(canConfirm.value).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/features/useReturnSheet.test.ts`
Expected: FAIL — "Cannot find module '@/features/returns/composables/useReturnSheet'"

- [ ] **Step 3: Implement useReturnSheet with load() and computed state**

Create `src/features/returns/composables/useReturnSheet.ts`:

```ts
import { ref, computed } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { v4 as uuidv4 } from 'uuid'
import type { ReturnLine, RefundMethod } from '../returns.types'

export function useReturnSheet(saleId: string) {
  const lines        = ref<ReturnLine[]>([])
  const refundMethod = ref<RefundMethod | null>(null)
  const reason       = ref('')
  const notes        = ref('')
  const hasCustomer  = ref(false)
  const customerId   = ref<string | null>(null)

  const refundTotalUsd = computed(() =>
    lines.value
      .filter(l => l.selected)
      .reduce((sum, l) => sum + l.qtyToReturn * l.unitPriceUsd, 0),
  )

  const canConfirm = computed(() =>
    lines.value.some(l => l.selected) && refundMethod.value !== null,
  )

  async function load(): Promise<void> {
    // 1. Fetch sale header
    const saleResult = await db.execute(
      `SELECT id, display_sale_number, customer_id FROM sales WHERE id = ?`,
      [saleId],
    )
    const sale = (saleResult as any).rows._array[0]
    if (!sale) throw new Error('Sale not found')
    customerId.value  = sale.customer_id ?? null
    hasCustomer.value = !!sale.customer_id

    // 2. Fetch original line items
    type LineRow = { product_id: string; product_name: string; quantity: number; unit_price_usd: number }
    const lineRows = await db.getAll<LineRow>(
      `SELECT sli.product_id, p.name_ar AS product_name, sli.quantity, sli.unit_price_usd
       FROM sale_line_items sli
       JOIN products p ON p.id = sli.product_id
       WHERE sli.sale_id = ?`,
      [saleId],
    )

    // 3. Fetch already-returned qty per product for this sale
    type ReturnedRow = { product_id: string; already_returned: number }
    const returnedRows = await db.getAll<ReturnedRow>(
      `SELECT rli.product_id, SUM(rli.qty_returned) AS already_returned
       FROM return_line_items rli
       JOIN returns r ON r.id = rli.return_id
       WHERE r.original_sale_id = ?
       GROUP BY rli.product_id`,
      [saleId],
    )
    const returnedMap = new Map(returnedRows.map(r => [r.product_id, r.already_returned]))

    lines.value = lineRows.map(row => ({
      productId:          row.product_id,
      productName:        row.product_name,
      originalQty:        row.quantity,
      alreadyReturnedQty: returnedMap.get(row.product_id) ?? 0,
      unitPriceUsd:       row.unit_price_usd,
      selected:           false,
      qtyToReturn:        1,
      restock:            true,
    }))
  }

  async function confirm(): Promise<void> {
    const { shopId, deviceId } = useDeviceStore()

    // Get current exchange rate
    const rateResult = await db.execute(
      `SELECT rate FROM exchange_rates WHERE shop_id = ? ORDER BY set_at DESC LIMIT 1`,
      [shopId],
    )
    const exchangeRate: number = (rateResult as any).rows._array[0]?.rate ?? 1

    const selectedLines = lines.value.filter(l => l.selected)
    const refundAmountUsd = selectedLines.reduce((sum, l) => sum + l.qtyToReturn * l.unitPriceUsd, 0)
    const refundAmountSyp = refundAmountUsd * exchangeRate

    // Insert returns row
    const returnId  = uuidv4()
    const now       = new Date().toISOString()
    await db.execute(
      `INSERT INTO returns (id, shop_id, original_sale_id, created_at, refund_method, refund_amount_usd, refund_amount_syp, exchange_rate_at_return, reason, notes, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [returnId, shopId, saleId, now, refundMethod.value!, refundAmountUsd, refundAmountSyp, exchangeRate, reason.value || null, notes.value || null],
    )

    // Insert return_line_items
    for (const line of selectedLines) {
      await db.execute(
        `INSERT INTO return_line_items (id, return_id, shop_id, product_id, qty_returned, unit_price_usd, unit_price_syp, restock)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuidv4(), returnId, shopId, line.productId, line.qtyToReturn, line.unitPriceUsd, line.unitPriceUsd * exchangeRate, line.restock ? 1 : 0],
      )
    }

    // Restock + stock_adjustments
    for (const line of selectedLines.filter(l => l.restock)) {
      const stockResult = await db.execute(
        `SELECT current_stock FROM products WHERE id = ?`,
        [line.productId],
      )
      const oldStock: number = (stockResult as any).rows._array[0]?.current_stock ?? 0
      const newStock          = oldStock + line.qtyToReturn
      await db.execute(
        `UPDATE products SET current_stock = ? WHERE id = ?`,
        [newStock, line.productId],
      )
      await db.execute(
        `INSERT INTO stock_adjustments (id, shop_id, product_id, old_value, new_value, reason, created_at, device_id)
         VALUES (?, ?, ?, ?, ?, 'return', ?, ?)`,
        [uuidv4(), shopId, line.productId, oldStock, newStock, now, deviceId],
      )
    }

    // Store credit
    if (refundMethod.value === 'store_credit' && customerId.value) {
      await db.execute(
        `INSERT INTO customer_payments (id, shop_id, customer_id, sale_id, amount_usd, currency, amount_raw, exchange_rate_at_payment, notes, paid_at, created_at, sync_status)
         VALUES (?, ?, ?, ?, ?, 'USD', ?, ?, 'مرتجع', ?, ?, 'pending')`,
        [uuidv4(), shopId, customerId.value, saleId, -refundAmountUsd, -refundAmountUsd, exchangeRate, now, now],
      )
    }
  }

  return { lines, refundMethod, reason, notes, hasCustomer, refundTotalUsd, canConfirm, load, confirm }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/features/useReturnSheet.test.ts`
Expected: 10 tests PASS (5 load + 5 computed)

- [ ] **Step 5: Commit**

```bash
git add src/__tests__/features/useReturnSheet.test.ts src/features/returns/composables/useReturnSheet.ts
git commit -m "feat(returns): add useReturnSheet load() and computed state with tests"
```

---

### Task 5: useReturnSheet — confirm() tests

**Files:**
- Modify: `src/__tests__/features/useReturnSheet.test.ts`

- [ ] **Step 1: Add confirm() tests to the existing test file**

Open `src/__tests__/features/useReturnSheet.test.ts` and append this `describe` block at the end (after the closing brace of the last describe):

```ts
describe('useReturnSheet — confirm()', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  async function loadSheet(customerId: string | null = 'cust-1') {
    // call order: execute(sale), getAll(lineItems), getAll(priorReturns)
    vi.mocked(db.execute).mockResolvedValueOnce({
      rows: { _array: [{ id: SALE_ID, display_sale_number: '#001', customer_id: customerId }] },
    } as any)
    vi.mocked(db.getAll)
      .mockResolvedValueOnce([{ product_id: 'p1', product_name: 'iPhone', quantity: 2, unit_price_usd: 500 }] as any)
      .mockResolvedValueOnce([] as any)  // no prior returns
    const sheet = useReturnSheet(SALE_ID)
    await sheet.load()
    sheet.lines.value[0].selected   = true
    sheet.lines.value[0].qtyToReturn = 1
    sheet.lines.value[0].restock    = true
    sheet.refundMethod.value        = 'cash_usd'
    // After load(), reset execute mock for confirm() calls
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [{ rate: 12500 }] } } as any)
    return sheet
  }

  it('inserts a returns row with correct fields', async () => {
    const { confirm } = await loadSheet()
    await confirm()
    const insertCall = (vi.mocked(db.execute).mock.calls as any[])
      .find(([sql]) => sql.includes('INSERT INTO returns'))
    expect(insertCall).toBeDefined()
    expect(insertCall[1][2]).toBe(SALE_ID)          // original_sale_id
    expect(insertCall[1][4]).toBe('cash_usd')        // refund_method
    expect(insertCall[1][5]).toBe(500)               // refund_amount_usd (1 × 500)
  })

  it('inserts return_line_items for each selected line', async () => {
    const { confirm } = await loadSheet()
    await confirm()
    const insertCall = (vi.mocked(db.execute).mock.calls as any[])
      .find(([sql]) => sql.includes('INSERT INTO return_line_items'))
    expect(insertCall).toBeDefined()
    expect(insertCall[1][3]).toBe('p1')   // product_id
    expect(insertCall[1][4]).toBe(1)      // qty_returned
    expect(insertCall[1][7]).toBe(1)      // restock = 1
  })

  it('updates product stock and inserts stock_adjustment when restock=true', async () => {
    // loadSheet sets restock=true. db.execute mock returns { rate:12500 } for all calls,
    // so SELECT current_stock returns undefined → oldStock=0, newStock=1
    const sheet = await loadSheet(null)
    await sheet.confirm()
    const updateCall = (vi.mocked(db.execute).mock.calls as any[])
      .find(([sql]: [string]) => sql.includes('UPDATE products'))
    expect(updateCall).toBeDefined()
    expect(updateCall[1][1]).toBe('p1')  // product_id
    const adjCall = (vi.mocked(db.execute).mock.calls as any[])
      .find(([sql]: [string]) => sql.includes('INSERT INTO stock_adjustments'))
    expect(adjCall).toBeDefined()
  })

  it('does NOT update stock when restock=false', async () => {
    const sheet = await loadSheet(null)
    sheet.lines.value[0].restock = false  // override the default restock=true
    await sheet.confirm()
    const updateCall = (vi.mocked(db.execute).mock.calls as any[])
      .find(([sql]: [string]) => sql.includes('UPDATE products'))
    expect(updateCall).toBeUndefined()
  })

  it('inserts negative customer_payments row for store_credit', async () => {
    const sheet = await loadSheet('cust-1')
    sheet.refundMethod.value = 'store_credit'  // override cash_usd default
    await sheet.confirm()
    const cpCall = (vi.mocked(db.execute).mock.calls as any[])
      .find(([sql]: [string]) => sql.includes('INSERT INTO customer_payments'))
    expect(cpCall).toBeDefined()
    expect(cpCall[1][4]).toBe(-500)     // amount_usd is negative
    expect(cpCall[1][3]).toBe(SALE_ID)  // sale_id
  })

  it('does NOT insert customer_payments for cash_usd method', async () => {
    const sheet = await loadSheet('cust-1')  // has customer but method is cash_usd
    await sheet.confirm()
    const cpCall = (vi.mocked(db.execute).mock.calls as any[])
      .find(([sql]: [string]) => sql.includes('INSERT INTO customer_payments'))
    expect(cpCall).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/features/useReturnSheet.test.ts`
Expected: all tests PASS (the confirm() tests call through to the already-implemented `confirm()` function)

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/features/useReturnSheet.test.ts
git commit -m "test(returns): add confirm() tests for useReturnSheet"
```

---

### Task 6: ReturnLineItem.vue + ReturnSheet.vue

**Files:**
- Create: `src/features/returns/components/ReturnLineItem.vue`
- Create: `src/features/returns/components/ReturnSheet.vue`

- [ ] **Step 1: Create ReturnLineItem.vue**

Create `src/features/returns/components/ReturnLineItem.vue`:

```vue
<script setup lang="ts">
import type { ReturnLine } from '../returns.types'

const props = defineProps<{ line: ReturnLine }>()
const emit  = defineEmits<{
  (e: 'update:line', val: ReturnLine): void
}>()

const maxQty = props.line.originalQty - props.line.alreadyReturnedQty

function toggle() {
  emit('update:line', { ...props.line, selected: !props.line.selected })
}

function setQty(delta: number) {
  const next = Math.min(Math.max(1, props.line.qtyToReturn + delta), maxQty)
  emit('update:line', { ...props.line, qtyToReturn: next })
}

function toggleRestock() {
  emit('update:line', { ...props.line, restock: !props.line.restock })
}
</script>

<template>
  <div class="rli-row" :class="{ 'rli-row--selected': line.selected }">
    <input
      type="checkbox"
      class="rli-check"
      :checked="line.selected"
      :disabled="maxQty === 0"
      @change="toggle"
    />
    <div class="rli-info">
      <div class="rli-name">{{ line.productName }}</div>
      <div class="rli-sub">
        تم بيع {{ line.originalQty }} × ${{ line.unitPriceUsd.toFixed(2) }}
        <span v-if="line.alreadyReturnedQty > 0" class="rli-returned">
          (تم إرجاع {{ line.alreadyReturnedQty }})
        </span>
      </div>
    </div>

    <template v-if="line.selected">
      <div class="rli-qty">
        <button type="button" class="rli-qty-btn" :disabled="line.qtyToReturn <= 1" @click="setQty(-1)">−</button>
        <span class="rli-qty-val">{{ line.qtyToReturn }}</span>
        <button type="button" class="rli-qty-btn" :disabled="line.qtyToReturn >= maxQty" @click="setQty(1)">+</button>
      </div>
      <div class="rli-restock">
        <span class="rli-restock-label">مخزون</span>
        <button
          type="button"
          class="rli-toggle"
          :class="{ 'rli-toggle--on': line.restock }"
          @click="toggleRestock"
        >
          <span class="rli-toggle-dot" />
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.rli-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
  opacity: 0.55;
  transition: opacity 0.15s, background 0.15s;
}
.rli-row--selected { opacity: 1; background: rgba(26, 86, 219, 0.07); }
.rli-check { width: 18px; height: 18px; accent-color: #1A56DB; flex-shrink: 0; cursor: pointer; }
.rli-info { flex: 1; }
.rli-name { font-size: 14px; font-weight: 600; color: #E8EDF5; }
.rli-sub  { font-size: 12px; color: #637285; margin-top: 2px; }
.rli-returned { color: #F59E0B; }
.rli-qty { display: flex; align-items: center; gap: 6px; }
.rli-qty-btn {
  width: 28px; height: 28px; border-radius: 6px;
  background: #1e3a5f; color: #E8EDF5; border: none; font-size: 16px; cursor: pointer;
}
.rli-qty-btn:disabled { opacity: 0.35; cursor: default; }
.rli-qty-val { color: #E8EDF5; font-size: 15px; font-weight: 700; min-width: 20px; text-align: center; }
.rli-restock { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.rli-restock-label { font-size: 10px; color: #637285; }
.rli-toggle {
  width: 36px; height: 20px; border-radius: 10px; border: none; cursor: pointer;
  display: flex; align-items: center; padding: 2px;
  background: #334155; transition: background 0.2s;
}
.rli-toggle--on { background: #1A56DB; }
.rli-toggle-dot {
  width: 16px; height: 16px; border-radius: 8px; background: white;
  transition: transform 0.2s; transform: translateX(0);
}
.rli-toggle--on .rli-toggle-dot { transform: translateX(16px); }
</style>
```

- [ ] **Step 2: Create ReturnSheet.vue**

Create `src/features/returns/components/ReturnSheet.vue`:

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import AppToast from '@/components/ui/AppToast.vue'
import ReturnLineItem from './ReturnLineItem.vue'
import { useReturnSheet } from '../composables/useReturnSheet'
import { useReturnReasons } from '../composables/useReturnReasons'
import type { RefundMethod, ReturnLine } from '../returns.types'

const props = defineProps<{ saleId: string; saleNumber: string }>()
const emit  = defineEmits<{ (e: 'close'): void; (e: 'confirmed'): void }>()

const { lines, refundMethod, reason, notes, hasCustomer, refundTotalUsd, canConfirm, load, confirm } =
  useReturnSheet(props.saleId)
const { reasons, loadReasons } = useReturnReasons()

const loading        = ref(false)
const toast          = ref<string | null>(null)
const toastType      = ref<'info' | 'error'>('info')
const confirmed      = ref(false)
const selectedReason = ref('')

onMounted(async () => {
  loading.value = true
  await Promise.all([load(), loadReasons()])
  loading.value = false
})

function updateLine(index: number, updated: ReturnLine) {
  lines.value[index] = updated
}

function selectReason(label: string) {
  selectedReason.value = selectedReason.value === label ? '' : label
  reason.value         = selectedReason.value
}

const REFUND_METHODS: { value: RefundMethod; label: string }[] = [
  { value: 'cash_usd',      label: 'نقد $'        },
  { value: 'cash_syp',      label: 'نقد ل.س'      },
  { value: 'store_credit',  label: 'رصيد حساب'   },
  { value: 'transfer',      label: 'حوالة'         },
]

async function handleConfirm() {
  if (!canConfirm.value) return
  loading.value = true
  try {
    await confirm()
    confirmed.value = true
    toastType.value = 'info'
    toast.value     = 'تم تسجيل المرتجع'
    emit('confirmed')
  } catch (e) {
    toastType.value = 'error'
    toast.value     = e instanceof Error ? e.message : 'حدث خطأ'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="sheet-backdrop" @click.self="emit('close')">
    <div class="sheet" dir="rtl">
      <!-- Handle -->
      <div class="sheet-handle-wrap"><div class="sheet-handle" /></div>

      <!-- Header -->
      <div class="sheet-header">
        <span class="sheet-title">مرتجع — فاتورة {{ saleNumber }}</span>
        <span class="sheet-sub">اختر المنتجات والكميات المراد إرجاعها</span>
      </div>

      <!-- Spinner while loading -->
      <div v-if="loading && lines.length === 0" class="sheet-spinner-wrap">
        <div class="spinner" />
      </div>

      <template v-else>
        <!-- Scrollable item list + reason -->
        <div class="sheet-scroll">
          <ReturnLineItem
            v-for="(line, i) in lines"
            :key="line.productId"
            :line="line"
            @update:line="updateLine(i, $event)"
          />

          <!-- Reason area -->
          <div class="sheet-reason">
            <div class="sheet-reason-label">السبب (اختياري)</div>
            <div v-if="reasons.length > 0" class="reason-chips">
              <button
                v-for="r in reasons"
                :key="r.id"
                type="button"
                class="reason-chip"
                :class="{ 'reason-chip--active': selectedReason === r.label }"
                @click="selectReason(r.label)"
              >
                {{ r.label }}
              </button>
            </div>
            <input
              v-model="notes"
              class="reason-input"
              placeholder="ملاحظة حرة..."
            />
          </div>
        </div>

        <!-- Fixed footer -->
        <div class="sheet-footer">
          <div class="refund-total-row">
            <span class="refund-total-label">إجمالي الاسترداد</span>
            <span class="refund-total-value" dir="ltr">${{ refundTotalUsd.toFixed(2) }}</span>
          </div>

          <div class="method-label">طريقة الاسترداد</div>
          <div class="method-buttons">
            <button
              v-for="m in REFUND_METHODS"
              :key="m.value"
              type="button"
              class="method-btn"
              :class="{ 'method-btn--active': refundMethod === m.value }"
              :disabled="m.value === 'store_credit' && !hasCustomer"
              @click="refundMethod = m.value"
            >
              {{ m.label }}
            </button>
          </div>

          <!-- Post-confirm: print option -->
          <div v-if="confirmed" class="post-confirm">
            <button type="button" class="btn-print" @click="emit('close')">
              طباعة إيصال المرتجع
            </button>
          </div>

          <button
            v-else
            type="button"
            class="btn-confirm"
            :disabled="!canConfirm || loading"
            @click="handleConfirm"
          >
            <span v-if="loading" class="spinner-sm" />
            <span v-else>تأكيد الإرجاع</span>
          </button>
        </div>
      </template>
    </div>
  </div>

  <AppToast v-if="toast" :message="toast" :type="toastType" @dismiss="toast = null" />
</template>

<style scoped>
.sheet-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.55);
  display: flex; align-items: flex-end; z-index: 50;
}
.sheet {
  width: 100%; max-height: 90dvh; display: flex; flex-direction: column;
  background: #0D1828;
  border-top: 1px solid rgba(26,86,219,0.28);
  border-radius: 1.25rem 1.25rem 0 0;
  box-shadow: 0 -4px 32px rgba(26,86,219,0.18);
}
.sheet-handle-wrap { display: flex; justify-content: center; padding: 10px 0 4px; }
.sheet-handle { width: 40px; height: 4px; border-radius: 2px; background: #374151; }
.sheet-header {
  padding: 12px 16px 8px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  display: flex; flex-direction: column; gap: 2px;
}
.sheet-title { font-size: 16px; font-weight: 700; color: #E8EDF5; }
.sheet-sub   { font-size: 12px; color: #637285; }
.sheet-scroll { flex: 1; overflow-y: auto; }
.sheet-spinner-wrap { flex: 1; display: flex; justify-content: center; align-items: center; padding: 40px; }
.spinner {
  width: 32px; height: 32px; border-radius: 50%;
  border: 2px solid rgba(26,86,219,0.3); border-top-color: #1A56DB;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.spinner-sm {
  display: inline-block; width: 18px; height: 18px; border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.3); border-top-color: white;
  animation: spin 0.8s linear infinite;
}
.sheet-reason { padding: 10px 16px; }
.sheet-reason-label { font-size: 12px; color: #637285; margin-bottom: 6px; }
.reason-chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
.reason-chip {
  padding: 4px 10px; border-radius: 20px; font-size: 12px; cursor: pointer;
  background: rgba(26,86,219,0.12); border: 1px solid rgba(26,86,219,0.22); color: #94A3B8;
  transition: background 0.15s, color 0.15s;
}
.reason-chip--active { background: #1A56DB; color: white; border-color: #1A56DB; }
.reason-input {
  width: 100%; background: rgba(26,86,219,0.08);
  border: 1px solid rgba(26,86,219,0.18); border-radius: 8px;
  padding: 8px 10px; color: #E8EDF5; font-size: 13px; font-family: inherit; box-sizing: border-box;
}
.reason-input::placeholder { color: #3D4F6B; }
.sheet-footer {
  border-top: 1px solid rgba(255,255,255,0.06);
  padding: 12px 16px; background: #0D1828;
}
.refund-total-row { display: flex; justify-content: space-between; margin-bottom: 10px; }
.refund-total-label { font-size: 14px; color: #637285; }
.refund-total-value { font-size: 16px; font-weight: 700; color: #E8EDF5; }
.method-label { font-size: 12px; color: #637285; margin-bottom: 6px; }
.method-buttons { display: flex; gap: 6px; margin-bottom: 12px; }
.method-btn {
  flex: 1; padding: 7px 4px; border-radius: 8px; font-size: 12px; cursor: pointer;
  background: rgba(26,86,219,0.10); border: 1px solid rgba(26,86,219,0.18); color: #637285;
  transition: background 0.15s, color 0.15s; font-family: inherit;
}
.method-btn--active { background: #1A56DB; color: white; border-color: #1A56DB; }
.method-btn:disabled { opacity: 0.3; cursor: default; }
.btn-confirm {
  width: 100%; padding: 13px; border-radius: 10px;
  background: linear-gradient(135deg, #1A56DB, #1e40af);
  color: white; font-size: 15px; font-weight: 700; border: none; cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  font-family: inherit;
}
.btn-confirm:disabled { opacity: 0.4; cursor: default; }
.btn-print {
  width: 100%; padding: 13px; border-radius: 10px;
  background: transparent; border: 1px solid rgba(26,86,219,0.4);
  color: #60A5FA; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit;
}
.post-confirm { display: flex; flex-direction: column; gap: 8px; }
</style>
```

- [ ] **Step 3: Commit**

```bash
git add src/features/returns/components/ReturnLineItem.vue src/features/returns/components/ReturnSheet.vue
git commit -m "feat(returns): add ReturnLineItem and ReturnSheet components"
```

---

### Task 7: SaleHistoryScreen integration

**Files:**
- Modify: `src/features/sale-history/sale-history.types.ts`
- Modify: `src/features/sale-history/useSaleHistory.ts`
- Modify: `src/features/sale-history/SaleHistoryScreen.vue`

- [ ] **Step 1: Add hasReturn to SaleRecord**

Open `src/features/sale-history/sale-history.types.ts` and add `hasReturn: boolean` to the `SaleRecord` interface:

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
  hasReturn:           boolean
}
```

- [ ] **Step 2: Populate hasReturn in useSaleHistory**

Open `src/features/sale-history/useSaleHistory.ts`. In `loadHistory`, after the `Promise.all([result, crudResult])` call, add a third query to find all sale IDs that have returns. Replace the existing `const [result, crudResult] = await Promise.all([...])` block with:

```ts
const [result, crudResult, returnsResult] = await Promise.all([
  db.execute(query, params),
  db.execute(
    `SELECT DISTINCT json_extract(data, '$.id') as sale_id FROM ps_crud WHERE "table" = 'sales'`
  ).catch(() => ({ rows: { _array: [] } })),
  db.execute(
    `SELECT DISTINCT original_sale_id FROM returns WHERE shop_id = ?`,
    [device.shopId]
  ).catch(() => ({ rows: { _array: [] } })),
])
const pendingIds  = new Set<string>(
  ((crudResult as any).rows._array as any[]).map((r: any) => r.sale_id).filter(Boolean)
)
const returnedIds = new Set<string>(
  ((returnsResult as any).rows._array as any[]).map((r: any) => r.original_sale_id).filter(Boolean)
)
```

Then in the `.map(r => ({...}))`, add:

```ts
hasReturn: returnedIds.has(r.id),
```

- [ ] **Step 3: Add "إرجاع" button and ReturnSheet to SaleHistoryScreen**

Open `src/features/sale-history/SaleHistoryScreen.vue`.

**3a.** Add imports at the top of `<script setup>`:

```ts
import { ref } from 'vue'
import ReturnSheet from '@/features/returns/components/ReturnSheet.vue'
```

(Note: `ref` is already imported — add only `ReturnSheet` to the existing import.)

**3b.** Add reactive state for the open return sheet (after the existing `const toast = ref<string | null>(null)` line):

```ts
const returnSaleId     = ref<string | null>(null)
const returnSaleNumber = ref('')

function openReturn(sale: { id: string; displaySaleNumber: string }) {
  returnSaleId.value     = sale.id
  returnSaleNumber.value = sale.displaySaleNumber
}

function onReturnConfirmed() {
  loadHistory(isPeriodDrillDown.value ? getDateRange(period.value) : undefined)
}
```

**3c.** In the desktop table, replace the single `<td>` with the reprint button with two buttons:

```html
<td class="td">
  <div style="display:flex;gap:6px;align-items:center;">
    <span v-if="sale.hasReturn" class="badge-return">مرتجع</span>
    <button type="button" class="btn-reprint" @click="handleReprint(sale.id)">
      إعادة طباعة
    </button>
    <button type="button" class="btn-reprint" @click="openReturn(sale)">
      إرجاع
    </button>
  </div>
</td>
```

**3d.** In the mobile card body, add an "إرجاع" button next to the reprint button and a "مرتجع" badge:

```html
<div v-if="expandedId === sale.id" class="sale-card-body">
  <div class="sale-extra-row">
    <span>بالليرة: {{ sale.totalSyp.toLocaleString() }} ل.س</span>
    <span>السعر: {{ sale.exchangeRateAtSale.toLocaleString() }}</span>
  </div>
  <div v-if="sale.hasReturn" class="badge-return" style="width:fit-content;">مرتجع</div>
  <button
    type="button"
    class="btn-reprint-full"
    @click="handleReprint(sale.id)"
  >إعادة طباعة</button>
  <button
    type="button"
    class="btn-reprint-full"
    @click="openReturn(sale)"
  >إرجاع</button>
</div>
```

**3e.** At the bottom of the `<template>`, before the closing `</template>`, add the `ReturnSheet` teleport:

```html
<Teleport to="body">
  <ReturnSheet
    v-if="returnSaleId"
    :sale-id="returnSaleId"
    :sale-number="returnSaleNumber"
    @close="returnSaleId = null"
    @confirmed="onReturnConfirmed"
  />
</Teleport>
```

**3f.** Add the `.badge-return` CSS class inside the `<style scoped>` block (near `.badge-warning`):

```css
.badge-return {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 700;
  background: rgba(16, 185, 129, 0.12);
  border: 1px solid rgba(16, 185, 129, 0.28);
  color: #10B981;
}
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run src/__tests__/features/`
Expected: all export and return tests pass; pre-existing LandingPage/ProductList/ProfitSheet failures unchanged

- [ ] **Step 5: Commit**

```bash
git add src/features/sale-history/sale-history.types.ts src/features/sale-history/useSaleHistory.ts src/features/sale-history/SaleHistoryScreen.vue
git commit -m "feat(returns): wire ReturnSheet into SaleHistoryScreen with hasReturn badge"
```

---

### Task 8: ReturnReasonsScreen + Settings + Router

**Files:**
- Create: `src/features/settings/screens/ReturnReasonsScreen.vue`
- Modify: `src/pages/SettingsPage.vue`
- Modify: `src/router/index.ts`

- [ ] **Step 1: Create ReturnReasonsScreen.vue**

Create `src/features/settings/screens/ReturnReasonsScreen.vue`:

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { v4 as uuidv4 } from 'uuid'
import AppToast from '@/components/ui/AppToast.vue'

interface ReasonRow { id: string; label: string; sort_order: number; is_active: number }

const reasons   = ref<ReasonRow[]>([])
const newLabel  = ref('')
const toast     = ref<string | null>(null)
const toastType = ref<'info' | 'error'>('info')

async function load() {
  const { shopId } = useDeviceStore()
  const rows = await db.getAll<ReasonRow>(
    `SELECT id, label, sort_order, is_active FROM return_reasons WHERE shop_id = ? ORDER BY sort_order ASC`,
    [shopId],
  )
  reasons.value = rows
}

async function addReason() {
  const label = newLabel.value.trim()
  if (!label) return
  const { shopId } = useDeviceStore()
  const maxOrder  = reasons.value.reduce((m, r) => Math.max(m, r.sort_order), -1)
  await db.execute(
    `INSERT INTO return_reasons (id, shop_id, label, sort_order, is_active) VALUES (?, ?, ?, ?, 1)`,
    [uuidv4(), shopId, label, maxOrder + 1],
  )
  newLabel.value = ''
  await load()
  toastType.value = 'info'
  toast.value     = 'تمت الإضافة'
}

async function toggleActive(reason: ReasonRow) {
  await db.execute(
    `UPDATE return_reasons SET is_active = ? WHERE id = ?`,
    [reason.is_active === 1 ? 0 : 1, reason.id],
  )
  await load()
}

async function deleteReason(id: string) {
  await db.execute(`DELETE FROM return_reasons WHERE id = ?`, [id])
  await load()
}

onMounted(load)
</script>

<template>
  <div class="rr-page" dir="rtl">
    <div class="rr-header">
      <h2 class="rr-title">أسباب الإرجاع</h2>
      <p class="rr-sub">تظهر هذه الأسباب كخيارات سريعة عند تسجيل مرتجع</p>
    </div>

    <div class="rr-add-row">
      <input
        v-model="newLabel"
        class="rr-input"
        placeholder="سبب جديد..."
        @keydown.enter="addReason"
      />
      <button type="button" class="rr-add-btn" :disabled="!newLabel.trim()" @click="addReason">
        إضافة
      </button>
    </div>

    <div v-if="reasons.length === 0" class="rr-empty">لا توجد أسباب مضافة بعد</div>

    <div v-else class="rr-list">
      <div v-for="r in reasons" :key="r.id" class="rr-row">
        <span class="rr-label" :class="{ 'rr-label--inactive': r.is_active === 0 }">{{ r.label }}</span>
        <div class="rr-actions">
          <button type="button" class="rr-toggle-btn" @click="toggleActive(r)">
            {{ r.is_active === 1 ? 'إيقاف' : 'تفعيل' }}
          </button>
          <button type="button" class="rr-delete-btn" @click="deleteReason(r.id)">حذف</button>
        </div>
      </div>
    </div>
  </div>

  <AppToast v-if="toast" :message="toast" :type="toastType" @dismiss="toast = null" />
</template>

<style scoped>
.rr-page   { padding: 20px 16px; font-family: 'Tajawal', system-ui, sans-serif; color: #E8EDF5; }
.rr-header { margin-bottom: 16px; }
.rr-title  { font-size: 16px; font-weight: 700; margin: 0 0 4px; }
.rr-sub    { font-size: 13px; color: #637285; margin: 0; }
.rr-add-row { display: flex; gap: 8px; margin-bottom: 16px; }
.rr-input {
  flex: 1; background: rgba(26,86,219,0.08); border: 1px solid rgba(26,86,219,0.22);
  border-radius: 8px; padding: 9px 12px; color: #E8EDF5; font-size: 14px; font-family: inherit;
}
.rr-input::placeholder { color: #3D4F6B; }
.rr-add-btn {
  padding: 9px 16px; border-radius: 8px; background: #1A56DB; color: white;
  border: none; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit;
}
.rr-add-btn:disabled { opacity: 0.4; cursor: default; }
.rr-empty  { font-size: 14px; color: #637285; text-align: center; padding: 32px 0; }
.rr-list   { display: flex; flex-direction: column; gap: 0; }
.rr-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.06);
}
.rr-row:last-child { border-bottom: none; }
.rr-label  { font-size: 14px; font-weight: 500; }
.rr-label--inactive { opacity: 0.4; text-decoration: line-through; }
.rr-actions { display: flex; gap: 8px; }
.rr-toggle-btn, .rr-delete-btn {
  font-size: 12px; padding: 5px 10px; border-radius: 6px; cursor: pointer;
  background: transparent; border: 1px solid rgba(255,255,255,0.12); color: #637285;
  font-family: inherit; transition: border-color 0.15s, color 0.15s;
}
.rr-toggle-btn:hover { border-color: #1A56DB; color: #60A5FA; }
.rr-delete-btn:hover { border-color: #EF4444; color: #EF4444; }
</style>
```

- [ ] **Step 2: Add Return Reasons to SettingsPage (mobile + desktop)**

Open `src/pages/SettingsPage.vue`.

**2a.** In the mobile section, add a new nav row inside the settings card, **after the Staff row** and **before the Sign out row**:

```html
<!-- Return reasons -->
<button
  type="button"
  class="nav-row"
  @click="router.push('/settings/return-reasons')"
>
  <div class="nav-row-start">
    <span class="nav-icon-wrap">
      <svg class="nav-icon" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
      </svg>
    </span>
    <span class="nav-title">أسباب الإرجاع</span>
  </div>
  <svg class="nav-arrow" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
    <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
  </svg>
</button>
```

**2b.** In the desktop nav sidebar, add a new `RouterLink` after the Staff link:

```html
<RouterLink
  to="/settings/return-reasons"
  class="desktop-nav-link"
  :class="route.path === '/settings/return-reasons' ? 'desktop-nav-link--active' : ''"
  style="border-bottom: 1px solid rgba(26,86,219,0.14)"
>
  <div class="nav-row-start">
    <svg class="nav-icon-sm" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
    </svg>
    <span>أسباب الإرجاع</span>
  </div>
  <span v-if="route.path === '/settings/return-reasons'" class="active-dot" />
</RouterLink>
```

- [ ] **Step 3: Add route to router**

Open `src/router/index.ts`. In the `children` array under `/settings`, add:

```ts
{ path: 'return-reasons', component: () => import('@/features/settings/screens/ReturnReasonsScreen.vue') },
```

So the settings children array becomes:

```ts
children: [
  { path: 'personal',       component: () => import('@/features/settings/screens/PersonalPreferencesScreen.vue') },
  { path: 'receipt',        component: () => import('@/features/receipt/ReceiptSettingsScreen.vue') },
  { path: 'staff',          component: () => import('@/features/staff/components/StaffList.vue') },
  { path: 'return-reasons', component: () => import('@/features/settings/screens/ReturnReasonsScreen.vue') },
],
```

- [ ] **Step 4: Commit**

```bash
git add src/features/settings/screens/ReturnReasonsScreen.vue src/pages/SettingsPage.vue src/router/index.ts
git commit -m "feat(returns): add ReturnReasonsScreen and wire into Settings nav"
```

---

### Task 9: index.ts + final test run

**Files:**
- Create: `src/features/returns/index.ts`

- [ ] **Step 1: Create index.ts**

Create `src/features/returns/index.ts`:

```ts
export { default as ReturnSheet } from './components/ReturnSheet.vue'
export { default as ReturnLineItem } from './components/ReturnLineItem.vue'
export { useReturnSheet } from './composables/useReturnSheet'
export { useReturnReasons } from './composables/useReturnReasons'
export * from './returns.types'
```

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run src/__tests__/features/`
Expected: all return and export tests PASS; same pre-existing failures as before (LandingPage, ProductList, ProfitSheet) unchanged

- [ ] **Step 3: TypeScript check**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 4: Commit**

```bash
git add src/features/returns/index.ts
git commit -m "feat(returns): add returns feature index and complete returns & refunds feature"
```
