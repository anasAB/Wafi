# Epic 3 — Business Health Home Screen: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the home screen with a live business dashboard showing revenue, expenses, and profit by period, with expense logging and best-sellers — all working offline.

**Architecture:** Two new feature folders (`src/features/dashboard/` and `src/features/expenses/`) feed a fully-rewritten `HomePage.vue`. A `periodUtils.ts` utility handles date range computation. A module-level singleton `usePeriodToggle` shares the selected period across all composables. `HomePage` watches the period and calls `load()` on each composable when it changes.

**Tech Stack:** Vue 3 + TypeScript + Tailwind, PowerSync (`db.execute`, `db.getAll`, `db.getOptional`), Vitest + `@vue/test-utils`, `uuid`, existing `useExchangeRate` for SYP conversion.

---

## File Map

**Create:**
- `src/features/dashboard/composables/periodUtils.ts` — `Period` type + `getDateRange()`
- `src/features/dashboard/composables/usePeriodToggle.ts` — module-level singleton period ref
- `src/features/dashboard/composables/useDashboardMetrics.ts` — revenue/COGS/expenses/profit queries
- `src/features/dashboard/composables/useBestSellers.ts` — top-5 product query
- `src/features/dashboard/components/MetricCard.vue` — reusable metric card (label, USD, SYP, accent)
- `src/features/dashboard/components/PeriodToggle.vue` — اليوم | الأسبوع | الشهر segmented control
- `src/features/dashboard/components/BestSellersCard.vue` — ranked top-5 list
- `src/features/dashboard/components/StalenessBar.vue` — offline staleness banner
- `src/features/expenses/expense.types.ts` — `Expense`, `NewExpense`, `ExpenseCategory` types
- `src/features/expenses/composables/useExpenses.ts` — INSERT + load + delete
- `src/features/expenses/components/ExpenseCategoryChips.vue` — chip selector
- `src/features/expenses/components/ExpenseForm.vue` — modal slide-up form
- `src/__tests__/features/usePeriodToggle.test.ts`
- `src/__tests__/features/useDashboardMetrics.test.ts`
- `src/__tests__/features/useBestSellers.test.ts`
- `src/__tests__/features/useExpenses.test.ts`
- `src/__tests__/features/MetricCard.test.ts`
- `src/__tests__/features/ExpenseForm.test.ts`

**Modify:**
- `src/data/powersync/schema.ts` — add `expenses` table; add `unit_cost_usd` to `sale_line_items`
- `src/features/payment/usePayment.ts` — look up cost price and write `unit_cost_usd` on sale confirm
- `src/__tests__/features/usePayment.test.ts` — extend with `unit_cost_usd` assertion
- `src/pages/HomePage.vue` — full rewrite using all new components

---

## Task 1: Schema — add `expenses` table and `unit_cost_usd` to `sale_line_items`

**Files:**
- Modify: `src/data/powersync/schema.ts`

- [ ] **Step 1: Update schema**

Replace `src/data/powersync/schema.ts` with:

```ts
import { column, Schema, Table } from '@powersync/web'

const products = new Table({
  shop_id:             column.text,
  name_ar:             column.text,
  name_en:             column.text,
  price_usd:           column.real,   // sale price — kept for POS backward compat
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
})

const sale_line_items = new Table({
  sale_id:        column.text,
  shop_id:        column.text,
  product_id:     column.text,
  quantity:       column.integer,
  unit_price_usd: column.real,
  unit_cost_usd:  column.real,   // cost price at time of sale — for COGS calculation
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
  amount:       column.real,   // raw entered amount
  currency:     column.text,   // USD or SYP
  amount_usd:   column.real,   // converted at exchange rate on save
  category:     column.text,
  expense_date: column.text,   // YYYY-MM-DD — backdatable up to 30 days
  notes:        column.text,
  photo_url:    column.text,
  paid_in_cash: column.integer, // 0/1, default 1
  created_at:   column.text,
  sync_status:  column.text,
})

export const AppSchema = new Schema({
  products,
  stock_adjustments,
  sales,
  sale_line_items,
  exchange_rates,
  expenses,
})
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/data/powersync/schema.ts
git commit -m "feat(schema): add expenses table, add unit_cost_usd to sale_line_items"
```

---

## Task 2: Expense types

**Files:**
- Create: `src/features/expenses/expense.types.ts`

- [ ] **Step 1: Create types file**

Create `src/features/expenses/expense.types.ts`:

```ts
export type ExpenseCategory =
  | 'إيجار'
  | 'كهرباء'
  | 'رواتب'
  | 'بضاعة'
  | 'صيانة'
  | 'أخرى'
  | string  // custom categories

export interface Expense {
  id:          string
  shopId:      string
  amount:      number
  currency:    'USD' | 'SYP'
  amountUsd:   number
  category:    string
  expenseDate: string   // YYYY-MM-DD
  notes?:      string
  photoUrl?:   string
  paidInCash:  boolean
  createdAt:   string
  syncStatus:  string
}

export interface NewExpense {
  amount:      number
  currency:    'USD' | 'SYP'
  amountUsd:   number
  category:    string
  expenseDate: string
  notes?:      string
  photoUrl?:   string
  paidInCash:  boolean
}

export const PREDEFINED_CATEGORIES: ExpenseCategory[] = [
  'إيجار', 'كهرباء', 'رواتب', 'بضاعة', 'صيانة', 'أخرى',
]
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/features/expenses/expense.types.ts
git commit -m "feat(expenses): add expense types"
```

---

## Task 3: Period utilities

**Files:**
- Create: `src/features/dashboard/composables/periodUtils.ts`

- [ ] **Step 1: Create utility**

Create `src/features/dashboard/composables/periodUtils.ts`:

```ts
export type Period = 'today' | 'week' | 'month'

function toDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function getDateRange(period: Period): { start: string; end: string } {
  const now = new Date()
  const today = toDateStr(now)

  if (period === 'today') {
    return { start: today, end: today }
  }

  if (period === 'week') {
    const d = new Date(now)
    // ISO week starts Monday. JS getDay(): 0=Sun, 1=Mon, ..., 6=Sat
    const day = d.getDay()
    const daysBack = day === 0 ? 6 : day - 1
    d.setDate(d.getDate() - daysBack)
    return { start: toDateStr(d), end: today }
  }

  // month: 1st of current month to today
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  return { start: toDateStr(start), end: today }
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/features/dashboard/composables/periodUtils.ts
git commit -m "feat(dashboard): add period date range utility"
```

---

## Task 4: usePeriodToggle composable

**Files:**
- Create: `src/features/dashboard/composables/usePeriodToggle.ts`
- Create: `src/__tests__/features/usePeriodToggle.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/features/usePeriodToggle.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { usePeriodToggle } from '@/features/dashboard/composables/usePeriodToggle'

describe('usePeriodToggle', () => {
  beforeEach(() => {
    // Reset singleton between tests
    const { setPeriod } = usePeriodToggle()
    setPeriod('today')
  })

  it('defaults to today', () => {
    const { period } = usePeriodToggle()
    expect(period.value).toBe('today')
  })

  it('setPeriod changes the value', () => {
    const { period, setPeriod } = usePeriodToggle()
    setPeriod('week')
    expect(period.value).toBe('week')
  })

  it('is a singleton — two instances share state', () => {
    const a = usePeriodToggle()
    const b = usePeriodToggle()
    a.setPeriod('month')
    expect(b.period.value).toBe('month')
  })
})
```

- [ ] **Step 2: Run to verify tests fail**

Run: `npx vitest run src/__tests__/features/usePeriodToggle.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

Create `src/features/dashboard/composables/usePeriodToggle.ts`:

```ts
import { ref } from 'vue'
import type { Period } from './periodUtils'

// Module-level singleton — all consumers share the same ref instance
const period = ref<Period>('today')

export function usePeriodToggle() {
  function setPeriod(p: Period) {
    period.value = p
  }

  return { period, setPeriod }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/__tests__/features/usePeriodToggle.test.ts`
Expected: 3 passing

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/composables/usePeriodToggle.ts src/__tests__/features/usePeriodToggle.test.ts
git commit -m "feat(dashboard): add usePeriodToggle singleton composable"
```

---

## Task 5: useExpenses composable

**Files:**
- Create: `src/features/expenses/composables/useExpenses.ts`
- Create: `src/__tests__/features/useExpenses.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/features/useExpenses.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useExpenses } from '@/features/expenses/composables/useExpenses'
import { db } from '@/data/powersync/db'

describe('useExpenses', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([])
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
  })

  it('load calls db.getAll with date range and shop filter', async () => {
    const { load } = useExpenses()
    await load('2025-05-01', '2025-05-31')
    expect(db.getAll).toHaveBeenCalledWith(
      expect.stringContaining('expense_date BETWEEN'),
      expect.arrayContaining(['2025-05-01', '2025-05-31'])
    )
  })

  it('load maps rows to Expense objects', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([{
      id: 'e1', shop_id: 's1', amount: 80, currency: 'USD', amount_usd: 80,
      category: 'إيجار', expense_date: '2025-05-01', notes: null, photo_url: null,
      paid_in_cash: 1, created_at: '2025-05-01T10:00:00Z', sync_status: 'pending',
    }])
    const { expenses, load } = useExpenses()
    await load('2025-05-01', '2025-05-31')
    expect(expenses.value).toHaveLength(1)
    expect(expenses.value[0].amountUsd).toBe(80)
    expect(expenses.value[0].paidInCash).toBe(true)
  })

  it('save calls INSERT INTO expenses', async () => {
    const { save } = useExpenses()
    await save({
      amount: 80, currency: 'USD', amountUsd: 80,
      category: 'إيجار', expenseDate: '2025-05-01', paidInCash: true,
    })
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO expenses'),
      expect.any(Array)
    )
  })

  it('save converts SYP to USD using rate', async () => {
    const { save } = useExpenses()
    // 1,450,000 SYP at rate 14500 = 100 USD
    await save({
      amount: 1_450_000, currency: 'SYP', amountUsd: 100,
      category: 'كهرباء', expenseDate: '2025-05-01', paidInCash: true,
    })
    const call = vi.mocked(db.execute).mock.calls[0]
    // amount_usd (index 4 in INSERT values) should be 100
    expect(call[1]).toContain(100)
    expect(call[1]).toContain('SYP')
  })

  it('softDelete removes the expense', async () => {
    const { softDelete } = useExpenses()
    await softDelete('e1')
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM expenses'),
      expect.arrayContaining(['e1'])
    )
  })
})
```

- [ ] **Step 2: Run to verify tests fail**

Run: `npx vitest run src/__tests__/features/useExpenses.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

Create `src/features/expenses/composables/useExpenses.ts`:

```ts
import { ref } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import type { Expense, NewExpense } from '@/features/expenses/expense.types'

type ExpenseRow = {
  id: string; shop_id: string; amount: number; currency: string; amount_usd: number
  category: string; expense_date: string; notes: string | null; photo_url: string | null
  paid_in_cash: number; created_at: string; sync_status: string
}

function rowToExpense(r: ExpenseRow): Expense {
  return {
    id: r.id, shopId: r.shop_id, amount: r.amount,
    currency: r.currency as 'USD' | 'SYP', amountUsd: r.amount_usd,
    category: r.category, expenseDate: r.expense_date,
    notes: r.notes ?? undefined, photoUrl: r.photo_url ?? undefined,
    paidInCash: r.paid_in_cash === 1, createdAt: r.created_at, syncStatus: r.sync_status,
  }
}

export function useExpenses() {
  const expenses = ref<Expense[]>([])

  async function load(startDate: string, endDate: string) {
    const device = useDeviceStore()
    const rows = await db.getAll<ExpenseRow>(
      `SELECT * FROM expenses WHERE shop_id = ? AND expense_date BETWEEN ? AND ?
       ORDER BY expense_date DESC, created_at DESC`,
      [device.shopId, startDate, endDate]
    )
    expenses.value = rows.map(rowToExpense)
  }

  async function save(data: NewExpense) {
    const device = useDeviceStore()
    const id = uuidv4()
    const now = new Date().toISOString()
    await db.execute(
      `INSERT INTO expenses (id, shop_id, amount, currency, amount_usd, category, expense_date,
        notes, photo_url, paid_in_cash, created_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [id, device.shopId, data.amount, data.currency, data.amountUsd,
       data.category, data.expenseDate, data.notes ?? null,
       data.photoUrl ?? null, data.paidInCash ? 1 : 0, now]
    )
  }

  async function softDelete(id: string) {
    await db.execute(`DELETE FROM expenses WHERE id = ?`, [id])
  }

  return { expenses, load, save, softDelete }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/__tests__/features/useExpenses.test.ts`
Expected: 5 passing

- [ ] **Step 5: Commit**

```bash
git add src/features/expenses/composables/useExpenses.ts src/__tests__/features/useExpenses.test.ts
git commit -m "feat(expenses): add useExpenses composable with CRUD"
```

---

## Task 6: useDashboardMetrics composable

**Files:**
- Create: `src/features/dashboard/composables/useDashboardMetrics.ts`
- Create: `src/__tests__/features/useDashboardMetrics.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/features/useDashboardMetrics.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useDashboardMetrics } from '@/features/dashboard/composables/useDashboardMetrics'
import { db } from '@/data/powersync/db'

describe('useDashboardMetrics', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getOptional).mockResolvedValue(null)
  })

  it('revenue defaults to 0', async () => {
    const { revenueUsd, load } = useDashboardMetrics()
    await load('today')
    expect(revenueUsd.value).toBe(0)
  })

  it('load queries revenue from sales with date range', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ total: 450 } as any) // revenue
      .mockResolvedValueOnce({ cogs: 210 } as any)  // cogs
      .mockResolvedValueOnce({ total: 80 } as any)   // expenses
      .mockResolvedValueOnce({ count: 2 } as any)    // missingCost
    const { revenueUsd, load } = useDashboardMetrics()
    await load('today')
    expect(revenueUsd.value).toBe(450)
    expect(db.getOptional).toHaveBeenCalledWith(
      expect.stringContaining('SUM(total_usd)'),
      expect.any(Array)
    )
  })

  it('profitUsd is revenue - cogs - expenses (computed)', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ total: 450 } as any)
      .mockResolvedValueOnce({ cogs: 210 } as any)
      .mockResolvedValueOnce({ total: 80 } as any)
      .mockResolvedValueOnce({ count: 0 } as any)
    const { profitUsd, load } = useDashboardMetrics()
    await load('today')
    expect(profitUsd.value).toBeCloseTo(160, 5) // 450 - 210 - 80
  })

  it('profitUsd is negative when expenses exceed revenue', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ total: 50 } as any)
      .mockResolvedValueOnce({ cogs: 0 } as any)
      .mockResolvedValueOnce({ total: 100 } as any)
      .mockResolvedValueOnce({ count: 0 } as any)
    const { profitUsd, load } = useDashboardMetrics()
    await load('today')
    expect(profitUsd.value).toBe(-50)
  })

  it('missingCostCount reflects products with missing cost price', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ total: 0 } as any)
      .mockResolvedValueOnce({ cogs: 0 } as any)
      .mockResolvedValueOnce({ total: 0 } as any)
      .mockResolvedValueOnce({ count: 5 } as any)
    const { missingCostCount, load } = useDashboardMetrics()
    await load('today')
    expect(missingCostCount.value).toBe(5)
  })
})
```

- [ ] **Step 2: Run to verify tests fail**

Run: `npx vitest run src/__tests__/features/useDashboardMetrics.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

Create `src/features/dashboard/composables/useDashboardMetrics.ts`:

```ts
import { ref, computed } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { getDateRange } from './periodUtils'
import type { Period } from './periodUtils'

export function useDashboardMetrics() {
  const revenueUsd      = ref(0)
  const cogsUsd         = ref(0)
  const expensesUsd     = ref(0)
  const missingCostCount = ref(0)

  const profitUsd = computed(() => revenueUsd.value - cogsUsd.value - expensesUsd.value)

  async function load(period: Period) {
    const device = useDeviceStore()
    const { start, end } = getDateRange(period)

    const revRow = await db.getOptional<{ total: number }>(
      `SELECT COALESCE(SUM(total_usd), 0) as total
       FROM sales WHERE shop_id = ? AND DATE(created_at, 'localtime') BETWEEN ? AND ?`,
      [device.shopId, start, end]
    )
    revenueUsd.value = revRow?.total ?? 0

    const cogsRow = await db.getOptional<{ cogs: number }>(
      `SELECT COALESCE(SUM(sli.quantity * COALESCE(sli.unit_cost_usd, 0)), 0) as cogs
       FROM sale_line_items sli
       JOIN sales s ON sli.sale_id = s.id
       WHERE s.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?`,
      [device.shopId, start, end]
    )
    cogsUsd.value = cogsRow?.cogs ?? 0

    const expRow = await db.getOptional<{ total: number }>(
      `SELECT COALESCE(SUM(amount_usd), 0) as total
       FROM expenses WHERE shop_id = ? AND expense_date BETWEEN ? AND ?`,
      [device.shopId, start, end]
    )
    expensesUsd.value = expRow?.total ?? 0

    const missingRow = await db.getOptional<{ count: number }>(
      `SELECT COUNT(*) as count FROM products
       WHERE shop_id = ? AND is_active = 1 AND (deleted = 0 OR deleted IS NULL)
         AND (cost_price_usd = 0 OR cost_price_usd IS NULL)`,
      [device.shopId]
    )
    missingCostCount.value = missingRow?.count ?? 0
  }

  return { revenueUsd, cogsUsd, expensesUsd, profitUsd, missingCostCount, load }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/__tests__/features/useDashboardMetrics.test.ts`
Expected: 5 passing

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/composables/useDashboardMetrics.ts src/__tests__/features/useDashboardMetrics.test.ts
git commit -m "feat(dashboard): add useDashboardMetrics composable"
```

---

## Task 7: useBestSellers composable

**Files:**
- Create: `src/features/dashboard/composables/useBestSellers.ts`
- Create: `src/__tests__/features/useBestSellers.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/features/useBestSellers.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useBestSellers } from '@/features/dashboard/composables/useBestSellers'
import { db } from '@/data/powersync/db'

describe('useBestSellers', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([])
  })

  it('items is empty by default', () => {
    const { items } = useBestSellers()
    expect(items.value).toHaveLength(0)
  })

  it('load queries sale_line_items joined to sales and products', async () => {
    const { load } = useBestSellers()
    await load('today')
    expect(db.getAll).toHaveBeenCalledWith(
      expect.stringContaining('sale_line_items'),
      expect.any(Array)
    )
  })

  it('load maps rows to BestSeller objects', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { name_ar: 'شاشة سامسونج', units_sold: 5, revenue_usd: 225 },
      { name_ar: 'كابل HDMI', units_sold: 12, revenue_usd: 48 },
    ])
    const { items, load } = useBestSellers()
    await load('today')
    expect(items.value).toHaveLength(2)
    expect(items.value[0].nameAr).toBe('شاشة سامسونج')
    expect(items.value[0].unitsSold).toBe(5)
    expect(items.value[1].revenueUsd).toBe(48)
  })

  it('load returns empty array when no sales in period', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([])
    const { items, load } = useBestSellers()
    await load('week')
    expect(items.value).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run to verify tests fail**

Run: `npx vitest run src/__tests__/features/useBestSellers.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

Create `src/features/dashboard/composables/useBestSellers.ts`:

```ts
import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { getDateRange } from './periodUtils'
import type { Period } from './periodUtils'

export interface BestSeller {
  nameAr:     string
  unitsSold:  number
  revenueUsd: number
}

export function useBestSellers() {
  const items = ref<BestSeller[]>([])

  async function load(period: Period) {
    const device = useDeviceStore()
    const { start, end } = getDateRange(period)

    const rows = await db.getAll<{ name_ar: string; units_sold: number; revenue_usd: number }>(
      `SELECT p.name_ar,
              SUM(sli.quantity)       AS units_sold,
              SUM(sli.line_total_usd) AS revenue_usd
       FROM sale_line_items sli
       JOIN sales s    ON sli.sale_id = s.id
       JOIN products p ON sli.product_id = p.id
       WHERE s.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY sli.product_id
       ORDER BY units_sold DESC, revenue_usd DESC, p.name_ar ASC
       LIMIT 5`,
      [device.shopId, start, end]
    )

    items.value = rows.map(r => ({
      nameAr:     r.name_ar,
      unitsSold:  r.units_sold,
      revenueUsd: r.revenue_usd,
    }))
  }

  return { items, load }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/__tests__/features/useBestSellers.test.ts`
Expected: 4 passing

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/composables/useBestSellers.ts src/__tests__/features/useBestSellers.test.ts
git commit -m "feat(dashboard): add useBestSellers composable"
```

---

## Task 8: Extend usePayment to write unit_cost_usd

**Files:**
- Modify: `src/features/payment/usePayment.ts`
- Modify: `src/__tests__/features/usePayment.test.ts`

- [ ] **Step 1: Add a failing test**

Open `src/__tests__/features/usePayment.test.ts`. Add this test at the end of the `describe` block (keeping all existing tests intact):

```ts
  it('confirm writes unit_cost_usd to sale_line_items from product cost', async () => {
    // Mock calls in order: INSERT sales, then per line:
    //   getOptional(cost price), INSERT sale_line_items,
    //   getOptional(current_stock), UPDATE products, INSERT stock_adjustments
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ cost_price_usd: 7 } as any)   // cost lookup for p1
      .mockResolvedValueOnce({ current_stock: 10 } as any)   // stock lookup for p1
    vi.mocked(db.execute)
      .mockResolvedValueOnce({ rows: { _array: [] } } as any) // INSERT sales
      .mockResolvedValueOnce({ rows: { _array: [] } } as any) // INSERT sale_line_items
      .mockResolvedValueOnce({ rows: { _array: [] } } as any) // UPDATE products stock
      .mockResolvedValueOnce({ rows: { _array: [] } } as any) // INSERT stock_adjustments

    const { selectMethod, confirm } = usePayment()
    selectMethod('card')
    await confirm()

    const lineInsertCall = vi.mocked(db.execute).mock.calls.find(c =>
      (c[0] as string).includes('INSERT INTO sale_line_items') &&
      (c[0] as string).includes('unit_cost_usd')
    )
    expect(lineInsertCall).toBeDefined()
    expect(lineInsertCall?.[1]).toContain(7) // unit_cost_usd = 7
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/features/usePayment.test.ts --reporter=verbose`
Expected: the new test FAILS

- [ ] **Step 3: Update usePayment.ts**

In `src/features/payment/usePayment.ts`, find the `sale_line_items` INSERT loop:

```ts
for (const line of saleStore.lines) {
  await db.execute(
    `INSERT INTO sale_line_items (id, sale_id, shop_id, product_id, quantity, unit_price_usd, line_total_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [uuidv4(), saleId, deviceStore.shopId, line.productId,
     line.quantity, line.unitPriceUsd, line.lineTotalUsd]
  )
}
```

Replace it with:

```ts
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
```

- [ ] **Step 4: Fix the existing stock-deduction test**

The existing test `'confirm deducts stock and writes stock_adjustments...'` currently mocks `db.getOptional` with `{ current_stock: 10 }` as the FIRST call. After adding the cost lookup, the order is now: cost lookup FIRST, then stock lookup. Update that test's `getOptional` mocks:

Find the test that includes `INSERT INTO stock_adjustments` assertion and update its mock setup to:

```ts
vi.mocked(db.getOptional)
  .mockResolvedValueOnce({ cost_price_usd: 0 } as any)    // cost lookup (new — before line items insert)
  .mockResolvedValueOnce({ current_stock: 10 } as any)    // stock lookup (existing — for deduction)
```

- [ ] **Step 5: Run all payment tests**

Run: `npx vitest run src/__tests__/features/usePayment.test.ts`
Expected: all tests pass (10 or more)

- [ ] **Step 6: Commit**

```bash
git add src/features/payment/usePayment.ts src/__tests__/features/usePayment.test.ts
git commit -m "feat(payment): write unit_cost_usd to sale_line_items for COGS accuracy"
```

---

## Task 9: MetricCard component

**Files:**
- Create: `src/features/dashboard/components/MetricCard.vue`
- Create: `src/__tests__/features/MetricCard.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/features/MetricCard.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import MetricCard from '@/features/dashboard/components/MetricCard.vue'

function mountCard(props = {}) {
  return mount(MetricCard, {
    props: { label: 'الربح', amountUsd: 0, syp: 0, accent: 'gray', ...props },
  })
}

describe('MetricCard', () => {
  it('renders the label', () => {
    const w = mountCard({ label: 'المال الداخل' })
    expect(w.text()).toContain('المال الداخل')
  })

  it('shows positive USD with + prefix and green class for positive accent', () => {
    const w = mountCard({ amountUsd: 214.5, accent: 'green' })
    expect(w.find('[data-testid="amount-usd"]').text()).toContain('+$214.50')
    expect(w.find('[data-testid="amount-usd"]').classes()).toContain('text-green-600')
  })

  it('shows negative USD with − prefix and red class for red accent', () => {
    const w = mountCard({ amountUsd: -32, accent: 'red' })
    expect(w.find('[data-testid="amount-usd"]').text()).toContain('−$32.00')
    expect(w.find('[data-testid="amount-usd"]').classes()).toContain('text-red-600')
  })

  it('shows $0.00 with gray class when amount is zero', () => {
    const w = mountCard({ amountUsd: 0, accent: 'gray' })
    expect(w.find('[data-testid="amount-usd"]').text()).toContain('$0.00')
    expect(w.find('[data-testid="amount-usd"]').classes()).toContain('text-gray-500')
  })

  it('shows SYP secondary value', () => {
    const w = mountCard({ syp: 3_103_000 })
    expect(w.find('[data-testid="amount-syp"]').text()).toContain('3,103,000')
  })

  it('shows warning badge when warningCount > 0', () => {
    const w = mountCard({ warningCount: 5 })
    expect(w.find('[data-testid="warning-badge"]').exists()).toBe(true)
    expect(w.find('[data-testid="warning-badge"]').text()).toContain('5')
  })

  it('hides warning badge when warningCount is 0 or undefined', () => {
    const w = mountCard({ warningCount: 0 })
    expect(w.find('[data-testid="warning-badge"]').exists()).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify tests fail**

Run: `npx vitest run src/__tests__/features/MetricCard.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement MetricCard**

Create `src/features/dashboard/components/MetricCard.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  label:        string
  amountUsd:    number
  syp:          number
  accent:       'blue' | 'orange' | 'green' | 'red' | 'gray'
  warningCount?: number
}>()

const emit = defineEmits<{ (e: 'warning-tap'): void }>()

const accentClass = computed(() => ({
  blue:   'text-blue-600 dark:text-blue-400',
  orange: 'text-orange-500 dark:text-orange-400',
  green:  'text-green-600 dark:text-green-400',
  red:    'text-red-600 dark:text-red-400',
  gray:   'text-gray-500 dark:text-gray-400',
}[props.accent]))

const formattedUsd = computed(() => {
  const abs = Math.abs(props.amountUsd).toFixed(2)
  if (props.amountUsd > 0)  return `+$${abs}`
  if (props.amountUsd < 0)  return `−$${abs}`
  return `$${abs}`
})

const formattedSyp = computed(() =>
  Math.round(props.syp).toLocaleString('ar-SY')
)

const showWarning = computed(() => (props.warningCount ?? 0) > 0)
</script>

<template>
  <div
    class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4 flex items-start justify-between"
    dir="rtl"
  >
    <div>
      <p class="text-xs text-gray-500 dark:text-gray-400 mb-1">{{ label }}</p>
      <p
        :data-testid="'amount-usd'"
        class="text-2xl font-bold"
        :class="accentClass"
      >{{ formattedUsd }}</p>
      <p
        data-testid="amount-syp"
        class="text-xs text-gray-400 dark:text-gray-500 mt-0.5"
      >{{ formattedSyp }} ل.س</p>
    </div>

    <button
      v-if="showWarning"
      type="button"
      data-testid="warning-badge"
      class="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700
             rounded-lg px-2 py-1 text-xs text-amber-700 dark:text-amber-300 shrink-0"
      @click="emit('warning-tap')"
    >⚠ {{ warningCount }}</button>
  </div>
</template>
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/__tests__/features/MetricCard.test.ts`
Expected: 7 passing

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/components/MetricCard.vue src/__tests__/features/MetricCard.test.ts
git commit -m "feat(dashboard): add MetricCard component"
```

---

## Task 10: PeriodToggle, BestSellersCard, StalenessBar components

**Files:**
- Create: `src/features/dashboard/components/PeriodToggle.vue`
- Create: `src/features/dashboard/components/BestSellersCard.vue`
- Create: `src/features/dashboard/components/StalenessBar.vue`

- [ ] **Step 1: Create PeriodToggle**

Create `src/features/dashboard/components/PeriodToggle.vue`:

```vue
<script setup lang="ts">
import { usePeriodToggle } from '@/features/dashboard/composables/usePeriodToggle'
import type { Period } from '@/features/dashboard/composables/periodUtils'

const { period, setPeriod } = usePeriodToggle()

const options: { value: Period; label: string }[] = [
  { value: 'today', label: 'اليوم' },
  { value: 'week',  label: 'الأسبوع' },
  { value: 'month', label: 'الشهر' },
]
</script>

<template>
  <div
    class="flex bg-gray-100 dark:bg-gray-800 rounded-xl p-1 gap-1"
    dir="rtl"
    role="tablist"
    aria-label="اختر الفترة الزمنية"
  >
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      :data-testid="`period-${opt.value}`"
      role="tab"
      :aria-selected="period.value === opt.value"
      class="flex-1 py-2 text-sm font-medium rounded-lg transition-colors"
      :class="period.value === opt.value
        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'"
      @click="setPeriod(opt.value)"
    >{{ opt.label }}</button>
  </div>
</template>
```

- [ ] **Step 2: Create BestSellersCard**

Create `src/features/dashboard/components/BestSellersCard.vue`:

```vue
<script setup lang="ts">
import { useRouter } from 'vue-router'
import type { BestSeller } from '@/features/dashboard/composables/useBestSellers'

defineProps<{ items: BestSeller[] }>()

const router = useRouter()
</script>

<template>
  <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4" dir="rtl">
    <p class="text-sm font-semibold text-gray-900 dark:text-white mb-3">الأكثر مبيعاً</p>

    <div
      v-if="!items.length"
      class="text-center py-6 text-gray-400 text-sm"
    >لا توجد مبيعات في هذه الفترة</div>

    <div v-else class="flex flex-col gap-3">
      <div
        v-for="(item, i) in items"
        :key="i"
        class="flex items-center gap-3 cursor-pointer"
        :data-testid="`best-seller-${i}`"
      >
        <div
          class="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0"
          :class="i === 0 ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'"
        >{{ i + 1 }}</div>

        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-gray-900 dark:text-white truncate">{{ item.nameAr }}</p>
        </div>

        <div class="text-left shrink-0">
          <p class="text-sm font-semibold text-blue-600 dark:text-blue-400">${{ item.revenueUsd.toFixed(0) }}</p>
          <p class="text-xs text-gray-400">{{ item.unitsSold }} قطعة</p>
        </div>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 3: Create StalenessBar**

Create `src/features/dashboard/components/StalenessBar.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  lastSyncedAt: string | null
  isOnline:     boolean
}>()

const minutesAgo = computed(() => {
  if (!props.lastSyncedAt) return null
  return Math.floor((Date.now() - new Date(props.lastSyncedAt).getTime()) / 60_000)
})

const show = computed(() =>
  !props.isOnline && minutesAgo.value !== null && minutesAgo.value > 30
)
</script>

<template>
  <div
    v-if="show"
    data-testid="staleness-bar"
    class="flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-gray-500 dark:text-gray-400
           bg-gray-100 dark:bg-gray-800 mb-2"
    dir="rtl"
  >
    <span class="w-2 h-2 rounded-full bg-red-500 shrink-0"></span>
    <span>آخر تحديث منذ {{ minutesAgo }} دقيقة</span>
    <span class="mr-auto opacity-60">بدون إنترنت</span>
  </div>
</template>
```

- [ ] **Step 4: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/components/
git commit -m "feat(dashboard): add PeriodToggle, BestSellersCard, StalenessBar components"
```

---

## Task 11: ExpenseCategoryChips component

**Files:**
- Create: `src/features/expenses/components/ExpenseCategoryChips.vue`

- [ ] **Step 1: Implement**

Create `src/features/expenses/components/ExpenseCategoryChips.vue`:

```vue
<script setup lang="ts">
import { ref, computed } from 'vue'
import { PREDEFINED_CATEGORIES } from '@/features/expenses/expense.types'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const STORAGE_KEY = 'wafi_custom_expense_cats'

function loadCustom(): string[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') }
  catch { return [] }
}

const customCategories = ref<string[]>(loadCustom())

const allCategories = computed(() => [
  ...PREDEFINED_CATEGORIES,
  ...customCategories.value.filter(c => !PREDEFINED_CATEGORIES.includes(c as any)),
])

const showCustomInput = computed(() => props.modelValue === 'أخرى')
const customText = ref('')

function select(cat: string) {
  emit('update:modelValue', cat)
}

function handleCustomInput(val: string) {
  customText.value = val
  emit('update:modelValue', val)
}

// Called by parent (ExpenseForm) after a successful save with a custom category
function persistCustom(category: string) {
  if (PREDEFINED_CATEGORIES.includes(category as any)) return
  if (!customCategories.value.includes(category)) {
    customCategories.value = [...customCategories.value, category]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(customCategories.value))
  }
}

defineExpose({ persistCustom })
</script>

<template>
  <div dir="rtl">
    <div class="flex flex-wrap gap-2">
      <button
        v-for="cat in allCategories"
        :key="cat"
        type="button"
        :data-testid="`chip-${cat}`"
        class="rounded-full px-3 py-1.5 text-sm font-medium transition-colors"
        :class="modelValue === cat
          ? 'bg-blue-600 text-white'
          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'"
        @click="select(cat)"
      >{{ cat }}</button>
    </div>

    <input
      v-if="showCustomInput"
      :value="customText"
      data-testid="custom-category-input"
      type="text"
      placeholder="اسم الفئة..."
      class="mt-2 w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2
             text-sm dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
      @input="handleCustomInput(($event.target as HTMLInputElement).value)"
    />
  </div>
</template>
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/features/expenses/components/ExpenseCategoryChips.vue
git commit -m "feat(expenses): add ExpenseCategoryChips component"
```

---

## Task 12: ExpenseForm component

**Files:**
- Create: `src/features/expenses/components/ExpenseForm.vue`
- Create: `src/__tests__/features/ExpenseForm.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/features/ExpenseForm.test.ts`:

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

import ExpenseForm from '@/features/expenses/components/ExpenseForm.vue'
import { db } from '@/data/powersync/db'

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/:p(.*)', component: { template: '<div/>' } }],
})

function mountForm(props = {}) {
  const pinia = createPinia()
  pinia.use(piniaPluginPersistedstate)
  return mount(ExpenseForm, {
    props,
    global: { plugins: [pinia, router] },
  })
}

describe('ExpenseForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
    vi.mocked(db.getAll).mockResolvedValue([])
  })

  it('shows amount required error when saving with empty amount', async () => {
    const w = mountForm()
    await w.find('[data-testid="save-btn"]').trigger('click')
    expect(w.find('[data-testid="error-amount"]').exists()).toBe(true)
  })

  it('shows category required error when saving with no category', async () => {
    const w = mountForm()
    await w.find('[data-testid="amount-input"]').setValue('50')
    await w.find('[data-testid="save-btn"]').trigger('click')
    expect(w.find('[data-testid="error-category"]').exists()).toBe(true)
  })

  it('shows SYP to USD conversion when SYP is selected', async () => {
    const w = mountForm()
    await w.find('[data-testid="currency-syp"]').trigger('click')
    await w.find('[data-testid="amount-input"]').setValue('1450000')
    // 1,450,000 / 14500 ≈ $100
    expect(w.find('[data-testid="usd-equivalent"]').text()).toContain('100')
  })

  it('emits saved after valid form submission', async () => {
    const w = mountForm()
    await w.find('[data-testid="amount-input"]').setValue('80')
    await w.find('[data-testid="chip-إيجار"]').trigger('click')
    await w.find('[data-testid="save-btn"]').trigger('click')
    await new Promise(r => setTimeout(r, 10))
    expect(w.emitted('saved')).toBeTruthy()
  })

  it('emits cancel when cancel button is clicked', async () => {
    const w = mountForm()
    await w.find('[data-testid="cancel-btn"]').trigger('click')
    expect(w.emitted('cancel')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify tests fail**

Run: `npx vitest run src/__tests__/features/ExpenseForm.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ExpenseForm**

Create `src/features/expenses/components/ExpenseForm.vue`:

```vue
<script setup lang="ts">
import { ref, computed } from 'vue'
import { useExchangeRate } from '@/features/exchange-rate'
import { useExpenses } from '@/features/expenses/composables/useExpenses'
import { useDeviceStore } from '@/store/device.store'
import ExpenseCategoryChips from './ExpenseCategoryChips.vue'
import type { NewExpense } from '@/features/expenses/expense.types'

const emit = defineEmits<{
  (e: 'saved'):  void
  (e: 'cancel'): void
}>()

const { currentRate } = useExchangeRate()
const { save }        = useExpenses()
const device          = useDeviceStore()

const amount      = ref<number | ''>('')
const currency    = ref<'USD' | 'SYP'>('USD')
const category    = ref('')
const expenseDate = ref(new Date().toISOString().slice(0, 10))
const notes       = ref('')
const saving      = ref(false)
const errors      = ref<Record<string, string>>({})

const chipsRef = ref<InstanceType<typeof ExpenseCategoryChips> | null>(null)

const usdEquivalent = computed(() => {
  if (currency.value !== 'SYP' || !currentRate.value || !amount.value) return null
  return (Number(amount.value) / currentRate.value).toFixed(2)
})

function validate(): boolean {
  const e: Record<string, string> = {}
  if (!amount.value || Number(amount.value) <= 0) e['amount']   = 'أدخل المبلغ'
  if (!category.value.trim())                     e['category'] = 'اختر فئة'
  errors.value = e
  return Object.keys(e).length === 0
}

async function handleSave(addAnother = false) {
  if (!validate()) return
  saving.value = true
  try {
    const amountNum = Number(amount.value)
    const amountUsd = currency.value === 'USD'
      ? amountNum
      : currentRate.value ? amountNum / currentRate.value : amountNum

    const data: NewExpense = {
      amount:      amountNum,
      currency:    currency.value,
      amountUsd,
      category:    category.value.trim(),
      expenseDate: expenseDate.value,
      notes:       notes.value.trim() || undefined,
      paidInCash:  true,
    }

    await save(data)
    chipsRef.value?.persistCustom(data.category)

    if (addAnother) {
      amount.value   = ''
      category.value = ''
      notes.value    = ''
      errors.value   = {}
    } else {
      emit('saved')
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
      dir="rtl"
      @click.self="emit('cancel')"
    >
      <div class="bg-white dark:bg-gray-900 rounded-t-2xl w-full max-w-lg p-6 shadow-xl">
        <!-- Handle bar -->
        <div class="w-9 h-1 bg-gray-200 dark:bg-gray-700 rounded-full mx-auto mb-5"></div>
        <h2 class="text-base font-semibold text-gray-900 dark:text-white mb-4">إضافة مصروف</h2>

        <!-- Amount -->
        <div class="mb-4">
          <div class="flex gap-2">
            <input
              v-model="amount"
              data-testid="amount-input"
              type="number"
              min="0"
              step="0.01"
              placeholder="0"
              class="flex-1 border rounded-xl px-4 py-3 text-xl font-bold dark:bg-gray-800 dark:text-white
                     focus:outline-none focus:ring-2 focus:ring-blue-500"
              :class="errors['amount'] ? 'border-red-500' : 'border-gray-200 dark:border-gray-600'"
              autofocus
              @input="delete errors['amount']"
            />
            <!-- Currency toggle -->
            <div class="flex bg-gray-100 dark:bg-gray-800 rounded-xl p-1 gap-1 shrink-0">
              <button
                type="button"
                data-testid="currency-usd"
                class="px-3 py-2 text-sm font-semibold rounded-lg transition-colors"
                :class="currency === 'USD' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-400'"
                @click="currency = 'USD'"
              >USD</button>
              <button
                type="button"
                data-testid="currency-syp"
                class="px-3 py-2 text-sm font-semibold rounded-lg transition-colors"
                :class="currency === 'SYP' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-400'"
                @click="currency = 'SYP'"
              >SYP</button>
            </div>
          </div>
          <p v-if="errors['amount']" data-testid="error-amount" class="text-xs text-red-500 mt-1">{{ errors['amount'] }}</p>
          <p v-if="usdEquivalent" data-testid="usd-equivalent" class="text-xs text-gray-400 mt-1">≈ ${{ usdEquivalent }}</p>
        </div>

        <!-- Category -->
        <div class="mb-4">
          <label class="block text-sm text-gray-600 dark:text-gray-400 mb-2">الفئة *</label>
          <ExpenseCategoryChips
            ref="chipsRef"
            v-model="category"
            @update:model-value="delete errors['category']"
          />
          <p v-if="errors['category']" data-testid="error-category" class="text-xs text-red-500 mt-1">{{ errors['category'] }}</p>
        </div>

        <!-- Date -->
        <div class="mb-4">
          <label class="block text-sm text-gray-600 dark:text-gray-400 mb-1">التاريخ</label>
          <input
            v-model="expenseDate"
            data-testid="expense-date"
            type="date"
            :max="new Date().toISOString().slice(0, 10)"
            class="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm
                   dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <!-- Notes -->
        <div class="mb-5">
          <label class="block text-sm text-gray-600 dark:text-gray-400 mb-1">ملاحظات</label>
          <textarea
            v-model="notes"
            data-testid="notes-input"
            rows="2"
            placeholder="اختياري..."
            class="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm
                   dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <!-- Buttons -->
        <div class="flex gap-2">
          <button
            type="button"
            data-testid="save-btn"
            :disabled="saving"
            class="flex-1 h-12 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700
                   disabled:opacity-50 transition-colors"
            @click="handleSave(false)"
          >{{ saving ? '...' : 'حفظ' }}</button>

          <button
            type="button"
            data-testid="save-another-btn"
            :disabled="saving"
            class="h-12 px-4 rounded-xl text-sm text-gray-600 dark:text-gray-300
                   border border-gray-200 dark:border-gray-600"
            @click="handleSave(true)"
          >إضافة أخرى</button>

          <button
            type="button"
            data-testid="cancel-btn"
            class="h-12 px-4 rounded-xl text-sm text-gray-500 dark:text-gray-400"
            @click="emit('cancel')"
          >إلغاء</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/__tests__/features/ExpenseForm.test.ts`
Expected: 5 passing

- [ ] **Step 5: Commit**

```bash
git add src/features/expenses/components/ExpenseForm.vue src/__tests__/features/ExpenseForm.test.ts
git commit -m "feat(expenses): add ExpenseForm modal component"
```

---

## Task 13: Rewrite HomePage.vue

**Files:**
- Modify: `src/pages/HomePage.vue`

- [ ] **Step 1: Rewrite the file**

Replace the entire contents of `src/pages/HomePage.vue` with:

```vue
<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader    from '@/components/ui/AppHeader.vue'
import AppDialog    from '@/components/ui/AppDialog.vue'
import AppToast     from '@/components/ui/AppToast.vue'
import { useExchangeRate }      from '@/features/exchange-rate'
import { useSaleDraft }         from '@/composables/useSaleDraft'
import { useLowStockAlerts }    from '@/features/products/composables/useLowStockAlerts'
import { usePeriodToggle }      from '@/features/dashboard/composables/usePeriodToggle'
import { useDashboardMetrics }  from '@/features/dashboard/composables/useDashboardMetrics'
import { useBestSellers }       from '@/features/dashboard/composables/useBestSellers'
import MetricCard               from '@/features/dashboard/components/MetricCard.vue'
import PeriodToggle             from '@/features/dashboard/components/PeriodToggle.vue'
import BestSellersCard          from '@/features/dashboard/components/BestSellersCard.vue'
import StalenessBar             from '@/features/dashboard/components/StalenessBar.vue'
import ExpenseForm              from '@/features/expenses/components/ExpenseForm.vue'
import { db }                   from '@/data/powersync/db'

const router  = useRouter()
const { currentRate, loadRate } = useExchangeRate()
const { hasDraft, loadDraft, restoreDraft, clearDraft } = useSaleDraft()
const { count: lowStockCount, top3: lowStockTop3, allClear, load: loadAlerts } = useLowStockAlerts()
const { period }           = usePeriodToggle()
const metrics              = useDashboardMetrics()
const sellers              = useBestSellers()

const showDraftDialog = ref(false)
const showExpenseForm = ref(false)
const toast           = ref<{ message: string; type: 'success' | 'error' } | null>(null)

// Staleness tracking
const lastSyncedAt = ref<string | null>(localStorage.getItem('wafi_last_synced'))
const isOnline     = ref(db.status.connected)

let syncTimer: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  try {
    await Promise.all([loadRate(), loadDraft(), loadAlerts()])
    if (hasDraft.value) showDraftDialog.value = true
    await Promise.all([metrics.load(period.value), sellers.load(period.value)])
  } catch { /* errors shown via toast */ }

  // Poll sync status every 60s; update lastSyncedAt when connection is restored
  syncTimer = setInterval(() => {
    const nowConnected = db.status.connected
    if (nowConnected && !isOnline.value) {
      const now = new Date().toISOString()
      localStorage.setItem('wafi_last_synced', now)
      lastSyncedAt.value = now
    }
    isOnline.value = nowConnected
  }, 60_000)

  // Mark initial sync time if connected at mount
  if (db.status.connected) {
    const now = new Date().toISOString()
    localStorage.setItem('wafi_last_synced', now)
    lastSyncedAt.value = now
    isOnline.value = true
  }
})

onUnmounted(() => {
  if (syncTimer) clearInterval(syncTimer)
})

// Reload metrics and sellers when period changes
watch(period, async (newPeriod) => {
  await Promise.all([metrics.load(newPeriod), sellers.load(newPeriod)])
})

async function handleRestoreDraft() {
  await restoreDraft()
  showDraftDialog.value = false
  router.push('/pos')
}

async function handleDiscardDraft() {
  await clearDraft()
  showDraftDialog.value = false
}

async function handleExpenseSaved() {
  showExpenseForm.value = false
  toast.value = { message: 'تم حفظ المصروف', type: 'success' }
  // Reload metrics to reflect new expense
  await metrics.load(period.value)
}

const canStartSale = computed(() => currentRate.value !== null)

const arabicDate = new Intl.DateTimeFormat('ar-SY', {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
}).format(new Date())

// SYP equivalents for metric cards (revenue × current exchange rate)
const revenueSyp  = computed(() => currentRate.value ? Math.round(metrics.revenueUsd.value * currentRate.value) : 0)
const expensesSyp = computed(() => currentRate.value ? Math.round(metrics.expensesUsd.value * currentRate.value) : 0)
const profitSyp   = computed(() => currentRate.value ? Math.round(metrics.profitUsd.value * currentRate.value) : 0)

const profitAccent = computed(() => {
  if (metrics.profitUsd.value > 0) return 'green'
  if (metrics.profitUsd.value < 0) return 'red'
  return 'gray'
})
</script>

<template>
  <div class="flex flex-col min-h-dvh bg-gray-50 dark:bg-gray-950">
    <AppHeader title="وافي" :show-exchange-rate="true" />

    <main class="flex-1 px-4 py-4 max-w-lg mx-auto w-full pb-24" dir="rtl">

      <!-- Greeting -->
      <p class="text-xs text-gray-400 dark:text-gray-500 mb-0.5">{{ arabicDate }}</p>
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-4">أهلاً 👋</h1>

      <!-- Staleness banner -->
      <StalenessBar :last-synced-at="lastSyncedAt" :is-online="isOnline" class="mb-2" />

      <!-- Period toggle -->
      <PeriodToggle class="mb-4" />

      <!-- No rate warning -->
      <div
        v-if="!currentRate"
        id="no-rate-warning"
        class="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700
               rounded-xl p-3 mb-4 text-sm text-yellow-800 dark:text-yellow-200"
      >حدد سعر صرف الدولار من الأعلى قبل البدء في البيع.</div>

      <!-- Three metric cards -->
      <div class="flex flex-col gap-3 mb-4">
        <MetricCard
          label="المال الداخل"
          :amount-usd="metrics.revenueUsd.value"
          :syp="revenueSyp"
          accent="blue"
          data-testid="card-revenue"
        />
        <MetricCard
          label="المصاريف"
          :amount-usd="metrics.expensesUsd.value"
          :syp="expensesSyp"
          accent="orange"
          data-testid="card-expenses"
        />
        <MetricCard
          label="الربح"
          :amount-usd="metrics.profitUsd.value"
          :syp="profitSyp"
          :accent="profitAccent"
          :warning-count="metrics.missingCostCount.value"
          data-testid="card-profit"
          @warning-tap="router.push('/products?filter=missing-cost')"
        />
      </div>

      <!-- Add expense inline button -->
      <button
        type="button"
        data-testid="add-expense-btn"
        class="w-full border-2 border-dashed border-green-300 dark:border-green-700 rounded-2xl py-3
               text-sm font-semibold text-green-700 dark:text-green-400 mb-4
               hover:bg-green-50 dark:hover:bg-green-900/10 transition-colors"
        @click="showExpenseForm = true"
      >+ إضافة مصروف</button>

      <!-- Best sellers -->
      <BestSellersCard :items="sellers.items.value" class="mb-4" />

      <!-- Low-stock card (from Epic 2) -->
      <RouterLink
        to="/products?filter=low-stock"
        class="block bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4 mb-4 no-underline"
        data-testid="low-stock-card"
      >
        <div class="flex items-center justify-between">
          <div>
            <p v-if="allClear" class="text-sm text-green-600 dark:text-green-400 font-medium">
              ✓ كل المنتجات متوفرة
            </p>
            <template v-else>
              <p class="text-sm text-yellow-600 dark:text-yellow-400 font-semibold mb-1">
                ⚠ مخزون منخفض ({{ lowStockCount }})
              </p>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                {{ lowStockTop3.map(p => p.nameAr).join('، ') }}
              </p>
            </template>
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-gray-400 rtl:rotate-180"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </div>
      </RouterLink>

    </main>

    <!-- Sticky bottom: New Sale button -->
    <div class="fixed bottom-0 inset-x-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 px-4 py-3 z-10">
      <button
        type="button"
        :disabled="!canStartSale"
        aria-describedby="no-rate-warning"
        class="w-full h-12 rounded-2xl text-base font-bold text-white bg-blue-600
               hover:bg-blue-700 active:scale-95 transition-all
               disabled:opacity-40 disabled:cursor-not-allowed"
        @click="router.push('/pos')"
      >بيع جديد</button>
    </div>
  </div>

  <!-- Draft recovery dialog (unchanged from Epic 1) -->
  <AppDialog
    v-if="showDraftDialog"
    title="بيع غير مكتمل"
    message="يوجد بيع لم يتم تأكيده. هل تريد المتابعة؟"
    confirm-label="متابعة"
    cancel-label="تجاهل"
    @confirm="handleRestoreDraft"
    @cancel="handleDiscardDraft"
  />

  <!-- Expense form modal -->
  <ExpenseForm
    v-if="showExpenseForm"
    @saved="handleExpenseSaved"
    @cancel="showExpenseForm = false"
  />

  <!-- Toast -->
  <AppToast v-if="toast" :message="toast.message" :type="toast.type" @dismiss="toast = null" />
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
git add src/pages/HomePage.vue
git commit -m "feat(home): rewrite home screen as business health dashboard"
```

---

## Task 14: Full verification

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: all tests pass, 0 failures

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Start dev server and smoke-test**

Run: `npm run dev`

Check in browser:
- Home screen shows period toggle, 3 metric cards, Add Expense button, Best Sellers card, Low-stock card, sticky New Sale button
- Tap "اليوم" / "الأسبوع" / "الشهر" — cards reload (may show 0 if no data for that period)
- Tap "Add expense" — modal slides up; fill in amount + category + tap Save; toast confirms; cards update
- Profit card shows green/red/gray depending on sign
- Warning badge appears on Profit card if any products have 0 cost price
- Tap warning badge — navigates to `/products?filter=missing-cost`
- New Sale button is sticky at bottom; tapping navigates to POS
- Ring a sale in POS → return to home → Revenue and Profit update

- [ ] **Step 4: Final commit if any smoke-test fixes needed**

```bash
git add -p
git commit -m "fix: smoke-test corrections"
```
