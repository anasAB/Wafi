# Excel / CSV Exports — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated `/exports` page that lets the owner download Sales, Expenses, Products, or Customers data as `.xlsx` or `.csv` using SheetJS.

**Architecture:** Token-first — types and header constants defined first, then a pure `buildWorkbook` function (fully testable), then four DB fetch functions (TDD with the existing db mock), then the page component wired to the router and Back Office tile.

**Tech Stack:** Vue 3 + TypeScript, SheetJS (`xlsx` community edition), PowerSync SQLite (`db.getAll`), existing `usePeriodToggle` + `getDateRange` for default date range.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/features/exports/export.types.ts` | Create | Types + header constants |
| `src/features/exports/composables/useExportFile.ts` | Create | SheetJS workbook builder + download trigger |
| `src/features/exports/composables/useExportData.ts` | Create | Four DB fetch functions |
| `src/features/exports/ExportPage.vue` | Create | Page UI — dataset selector, date range, format, export button |
| `src/features/exports/index.ts` | Create | Public barrel |
| `src/__tests__/features/useExportFile.test.ts` | Create | Tests for `buildWorkbook` |
| `src/__tests__/features/useExportData.test.ts` | Create | Tests for all four fetch functions |
| `src/router/index.ts` | Modify | Add `/exports` route |
| `src/features/products/BackOfficePage.vue` | Modify | Add Exports tile to active modules |

---

## Task 1: Install xlsx + create types

**Files:**
- Create: `src/features/exports/export.types.ts`

- [ ] **Step 1: Install SheetJS**

```bash
npm install xlsx
```

Expected output: `added 1 package` (no peer dep warnings expected).

- [ ] **Step 2: Create `export.types.ts`**

Create `src/features/exports/export.types.ts` with the following content:

```ts
export type ExportDataset = 'sales' | 'expenses' | 'products' | 'customers'
export type ExportFormat  = 'xlsx' | 'csv'

export interface ExportDateRange {
  start: string // 'YYYY-MM-DD'
  end:   string // 'YYYY-MM-DD'
}

export const SALES_HEADERS = [
  'رقم البيع', 'التاريخ', 'المنتج', 'الكمية',
  'سعر الوحدة $', 'سعر الوحدة ل.س', 'إجمالي السطر $',
  'طريقة الدفع', 'الكاشير', 'إجمالي الفاتورة $',
] as const

export const EXPENSES_HEADERS = [
  'التاريخ', 'الفئة', 'الوصف', 'المبلغ $', 'المبلغ ل.س',
] as const

export const PRODUCTS_HEADERS = [
  'الاسم', 'الباركود', 'سعر البيع $', 'سعر البيع ل.س',
  'التكلفة $', 'المخزون الحالي', 'قيمة المخزون $',
] as const

export const CUSTOMERS_HEADERS = [
  'الاسم', 'الهاتف', 'الرصيد المستحق $', 'الرصيد المستحق ل.س', 'آخر شراء',
] as const
```

- [ ] **Step 3: Commit**

```bash
git add src/features/exports/export.types.ts package.json package-lock.json
git commit -m "feat(exports): install xlsx, add export types and header constants"
```

---

## Task 2: useExportFile — workbook builder (TDD)

**Files:**
- Create: `src/__tests__/features/useExportFile.test.ts`
- Create: `src/features/exports/composables/useExportFile.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/features/useExportFile.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { buildWorkbook, buildAndDownload } from '@/features/exports/composables/useExportFile'

describe('buildWorkbook', () => {
  it('creates a workbook with one sheet named Sheet1', () => {
    const wb = buildWorkbook(['الاسم'], [{ 'الاسم': 'أحمد' }])
    expect(wb.SheetNames).toEqual(['Sheet1'])
  })

  it('sets RTL direction on the worksheet', () => {
    const wb = buildWorkbook(['الاسم'], [{ 'الاسم': 'أحمد' }])
    expect(wb.Sheets['Sheet1']['!dir']).toBe('rtl')
  })

  it('writes data rows correctly', () => {
    const wb = buildWorkbook(
      ['المنتج', 'الكمية'],
      [{ 'المنتج': 'تلفزيون', 'الكمية': 3 }],
    )
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['Sheet1'])
    expect(rows).toHaveLength(1)
    expect((rows[0] as Record<string, unknown>)['المنتج']).toBe('تلفزيون')
    expect((rows[0] as Record<string, unknown>)['الكمية']).toBe(3)
  })

  it('sets column widths on the worksheet', () => {
    const wb = buildWorkbook(['الاسم', 'الرصيد'], [{ 'الاسم': 'أحمد', 'الرصيد': 100 }])
    expect(wb.Sheets['Sheet1']['!cols']).toHaveLength(2)
  })
})

describe('buildAndDownload', () => {
  it('throws "لا توجد بيانات للتصدير" when rows is empty', () => {
    expect(() => buildAndDownload(['الاسم'], [], 'test.xlsx', 'xlsx')).toThrow('لا توجد بيانات للتصدير')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/__tests__/features/useExportFile.test.ts
```

Expected: FAIL — `Cannot find module '@/features/exports/composables/useExportFile'`

- [ ] **Step 3: Implement `useExportFile.ts`**

Create `src/features/exports/composables/useExportFile.ts`:

```ts
import * as XLSX from 'xlsx'
import type { ExportFormat } from '../export.types'

export function buildWorkbook(
  headers: readonly string[] | string[],
  rows: Record<string, unknown>[],
): XLSX.WorkBook {
  const ws = XLSX.utils.json_to_sheet(rows, { header: headers as string[] })
  ws['!dir'] = 'rtl'
  ws['!cols'] = (headers as string[]).map(() => ({ wch: 20 }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return wb
}

export function buildAndDownload(
  headers: readonly string[] | string[],
  rows: Record<string, unknown>[],
  filename: string,
  format: ExportFormat,
): void {
  if (rows.length === 0) throw new Error('لا توجد بيانات للتصدير')
  const wb = buildWorkbook(headers, rows)
  if (format === 'xlsx') {
    XLSX.writeFile(wb, filename)
  } else {
    const ws  = wb.Sheets[wb.SheetNames[0]]
    const csv = XLSX.utils.sheet_to_csv(ws)
    const bom = '﻿'
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/__tests__/features/useExportFile.test.ts
```

Expected: PASS — 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/features/exports/composables/useExportFile.ts src/__tests__/features/useExportFile.test.ts
git commit -m "feat(exports): add buildWorkbook + buildAndDownload with tests"
```

---

## Task 3: useExportData — fetchSalesRows (TDD)

**Files:**
- Create: `src/__tests__/features/useExportData.test.ts`
- Create: `src/features/exports/composables/useExportData.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/features/useExportData.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { fetchSalesRows } from '@/features/exports/composables/useExportData'
import { db } from '@/data/powersync/db'

describe('fetchSalesRows', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([])
  })

  it('calls db.getAll with shop_id and date range params', async () => {
    await fetchSalesRows({ start: '2026-06-01', end: '2026-06-05' })
    expect(db.getAll).toHaveBeenCalledWith(
      expect.stringContaining('FROM sales'),
      expect.arrayContaining(['2026-06-01', '2026-06-05']),
    )
  })

  it('returns an empty array when db returns no rows', async () => {
    const result = await fetchSalesRows({ start: '2026-06-01', end: '2026-06-05' })
    expect(result).toEqual([])
  })

  it('maps a db row to Arabic-keyed export row', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([{
      display_sale_number: 'SALE-0001',
      created_at: '2026-06-05T10:30:00Z',
      total_usd: 450,
      payment_method: 'cash_usd',
      cashier_name: 'أحمد',
      product_name: 'iPhone',
      qty: 1,
      unit_price_usd: 450,
      unit_price_syp: 5625000,
    }])
    const rows = await fetchSalesRows({ start: '2026-06-05', end: '2026-06-05' })
    expect(rows).toHaveLength(1)
    expect(rows[0]['رقم البيع']).toBe('SALE-0001')
    expect(rows[0]['المنتج']).toBe('iPhone')
    expect(rows[0]['الكمية']).toBe(1)
    expect(rows[0]['طريقة الدفع']).toBe('نقد دولار')
    expect(rows[0]['الكاشير']).toBe('أحمد')
    expect(rows[0]['إجمالي السطر $']).toBe(450)
  })

  it('maps null cashier_name to "—"', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([{
      display_sale_number: 'SALE-0002',
      created_at: '2026-06-05T10:30:00Z',
      total_usd: 100,
      payment_method: 'credit',
      cashier_name: null,
      product_name: 'كتاب',
      qty: 2,
      unit_price_usd: 50,
      unit_price_syp: 625000,
    }])
    const rows = await fetchSalesRows({ start: '2026-06-05', end: '2026-06-05' })
    expect(rows[0]['الكاشير']).toBe('—')
    expect(rows[0]['طريقة الدفع']).toBe('آجل')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/__tests__/features/useExportData.test.ts
```

Expected: FAIL — `Cannot find module '@/features/exports/composables/useExportData'`

- [ ] **Step 3: Implement `fetchSalesRows` in `useExportData.ts`**

Create `src/features/exports/composables/useExportData.ts`:

```ts
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import type { ExportDateRange } from '../export.types'

const PAYMENT_LABELS: Record<string, string> = {
  cash_usd: 'نقد دولار',
  cash_syp: 'نقد ليرة',
  card:     'بطاقة',
  credit:   'آجل',
  split:    'دفع مختلط',
}

type SaleRow = {
  display_sale_number: string
  created_at: string
  total_usd: number
  payment_method: string
  cashier_name: string | null
  product_name: string
  qty: number
  unit_price_usd: number
  unit_price_syp: number
}

export async function fetchSalesRows(
  range: ExportDateRange,
): Promise<Record<string, unknown>[]> {
  const { shopId } = useDeviceStore()
  const rows = await db.getAll<SaleRow>(
    `SELECT
       s.display_sale_number,
       s.created_at,
       s.total_usd,
       s.payment_method,
       st.name  AS cashier_name,
       p.name   AS product_name,
       li.qty,
       li.unit_price_usd,
       li.unit_price_syp
     FROM sales s
     JOIN sale_line_items li ON li.sale_id = s.id
     JOIN products p         ON p.id = li.product_id
     LEFT JOIN cashier_shifts cs ON cs.id = s.shift_id
     LEFT JOIN staff st          ON st.id = cs.staff_id
     WHERE s.shop_id = ?
       AND s.created_at >= ?
       AND s.created_at <= ?
     ORDER BY s.created_at DESC, li.id ASC`,
    [shopId, range.start, range.end],
  )
  return rows.map(r => ({
    'رقم البيع':        r.display_sale_number,
    'التاريخ':          r.created_at.slice(0, 16).replace('T', ' '),
    'المنتج':           r.product_name,
    'الكمية':           r.qty,
    'سعر الوحدة $':     r.unit_price_usd,
    'سعر الوحدة ل.س':   r.unit_price_syp,
    'إجمالي السطر $':   Number((r.qty * r.unit_price_usd).toFixed(2)),
    'طريقة الدفع':      PAYMENT_LABELS[r.payment_method] ?? r.payment_method,
    'الكاشير':          r.cashier_name ?? '—',
    'إجمالي الفاتورة $': r.total_usd,
  }))
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/__tests__/features/useExportData.test.ts
```

Expected: PASS — 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/features/exports/composables/useExportData.ts src/__tests__/features/useExportData.test.ts
git commit -m "feat(exports): add fetchSalesRows with Arabic mapping and tests"
```

---

## Task 4: useExportData — fetchExpensesRows (TDD)

**Files:**
- Modify: `src/features/exports/composables/useExportData.ts`
- Modify: `src/__tests__/features/useExportData.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `src/__tests__/features/useExportData.test.ts` (after the existing `fetchSalesRows` describe block):

```ts
import { fetchSalesRows, fetchExpensesRows } from '@/features/exports/composables/useExportData'

// (already imported above — add fetchExpensesRows to the same import line)

describe('fetchExpensesRows', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([])
  })

  it('calls db.getAll with date range and shop_id', async () => {
    await fetchExpensesRows({ start: '2026-06-01', end: '2026-06-05' })
    expect(db.getAll).toHaveBeenCalledWith(
      expect.stringContaining('FROM expenses'),
      expect.arrayContaining(['2026-06-01', '2026-06-05']),
    )
  })

  it('maps a db row to Arabic-keyed export row', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([{
      expense_date: '2026-06-05',
      category: 'إيجار',
      description: 'إيجار شهر يونيو',
      amount_usd: 200,
      amount_syp: 2500000,
    }])
    const rows = await fetchExpensesRows({ start: '2026-06-01', end: '2026-06-05' })
    expect(rows).toHaveLength(1)
    expect(rows[0]['التاريخ']).toBe('2026-06-05')
    expect(rows[0]['الفئة']).toBe('إيجار')
    expect(rows[0]['المبلغ $']).toBe(200)
    expect(rows[0]['المبلغ ل.س']).toBe(2500000)
  })
})
```

Update the import at the top of the test file:

```ts
import { fetchSalesRows, fetchExpensesRows } from '@/features/exports/composables/useExportData'
```

- [ ] **Step 2: Run tests to verify the new ones fail**

```bash
npx vitest run src/__tests__/features/useExportData.test.ts
```

Expected: 4 pass (fetchSalesRows), 2 FAIL (fetchExpensesRows not exported yet).

- [ ] **Step 3: Add `fetchExpensesRows` to `useExportData.ts`**

Append to `src/features/exports/composables/useExportData.ts`:

```ts
type ExpenseRow = {
  expense_date: string
  category: string
  description: string | null
  amount_usd: number
  amount_syp: number
}

export async function fetchExpensesRows(
  range: ExportDateRange,
): Promise<Record<string, unknown>[]> {
  const { shopId } = useDeviceStore()
  const rows = await db.getAll<ExpenseRow>(
    `SELECT expense_date, category, notes AS description, amount_usd, amount_syp
     FROM expenses
     WHERE shop_id = ?
       AND expense_date BETWEEN ? AND ?
     ORDER BY expense_date DESC, created_at DESC`,
    [shopId, range.start, range.end],
  )
  return rows.map(r => ({
    'التاريخ':   r.expense_date,
    'الفئة':     r.category,
    'الوصف':     r.description ?? '',
    'المبلغ $':  r.amount_usd,
    'المبلغ ل.س': r.amount_syp,
  }))
}
```

- [ ] **Step 4: Run tests to verify all pass**

```bash
npx vitest run src/__tests__/features/useExportData.test.ts
```

Expected: PASS — 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/features/exports/composables/useExportData.ts src/__tests__/features/useExportData.test.ts
git commit -m "feat(exports): add fetchExpensesRows with tests"
```

---

## Task 5: useExportData — fetchProductsRows (TDD)

**Files:**
- Modify: `src/features/exports/composables/useExportData.ts`
- Modify: `src/__tests__/features/useExportData.test.ts`

- [ ] **Step 1: Add failing tests**

Add to the import line at the top of `src/__tests__/features/useExportData.test.ts`:

```ts
import { fetchSalesRows, fetchExpensesRows, fetchProductsRows } from '@/features/exports/composables/useExportData'
```

Append the following describe block:

```ts
describe('fetchProductsRows', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([])
  })

  it('calls db.getAll filtering only active products', async () => {
    await fetchProductsRows()
    expect(db.getAll).toHaveBeenCalledWith(
      expect.stringContaining('is_active'),
      expect.any(Array),
    )
  })

  it('maps a db row to Arabic-keyed export row with computed stock value', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([{
      name: 'iPhone 15',
      barcode: '1234567890',
      sale_price_usd: 500,
      sale_price_syp: 6250000,
      cost_usd: 380,
      current_stock: 10,
    }])
    const rows = await fetchProductsRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]['الاسم']).toBe('iPhone 15')
    expect(rows[0]['الباركود']).toBe('1234567890')
    expect(rows[0]['سعر البيع $']).toBe(500)
    expect(rows[0]['المخزون الحالي']).toBe(10)
    expect(rows[0]['قيمة المخزون $']).toBe(3800)
  })

  it('maps null barcode and cost to "—"', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([{
      name: 'منتج بدون باركود',
      barcode: null,
      sale_price_usd: 20,
      sale_price_syp: 250000,
      cost_usd: null,
      current_stock: 5,
    }])
    const rows = await fetchProductsRows()
    expect(rows[0]['الباركود']).toBe('—')
    expect(rows[0]['التكلفة $']).toBe('—')
    expect(rows[0]['قيمة المخزون $']).toBe('—')
  })
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

```bash
npx vitest run src/__tests__/features/useExportData.test.ts
```

Expected: 6 pass, 3 FAIL.

- [ ] **Step 3: Add `fetchProductsRows` to `useExportData.ts`**

Append to `src/features/exports/composables/useExportData.ts`:

```ts
type ProductRow = {
  name: string
  barcode: string | null
  sale_price_usd: number
  sale_price_syp: number
  cost_usd: number | null
  current_stock: number
}

export async function fetchProductsRows(): Promise<Record<string, unknown>[]> {
  const { shopId } = useDeviceStore()
  const rows = await db.getAll<ProductRow>(
    `SELECT name, barcode, sale_price_usd, sale_price_syp, cost_usd, current_stock
     FROM products
     WHERE shop_id = ?
       AND is_active = 1
     ORDER BY name ASC`,
    [shopId],
  )
  return rows.map(r => ({
    'الاسم':          r.name,
    'الباركود':       r.barcode ?? '—',
    'سعر البيع $':    r.sale_price_usd,
    'سعر البيع ل.س':  r.sale_price_syp,
    'التكلفة $':      r.cost_usd ?? '—',
    'المخزون الحالي': r.current_stock,
    'قيمة المخزون $': r.cost_usd != null
      ? Number((r.current_stock * r.cost_usd).toFixed(2))
      : '—',
  }))
}
```

- [ ] **Step 4: Run tests to verify all pass**

```bash
npx vitest run src/__tests__/features/useExportData.test.ts
```

Expected: PASS — 9 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/features/exports/composables/useExportData.ts src/__tests__/features/useExportData.test.ts
git commit -m "feat(exports): add fetchProductsRows with stock value computation and tests"
```

---

## Task 6: useExportData — fetchCustomersRows (TDD)

**Files:**
- Modify: `src/features/exports/composables/useExportData.ts`
- Modify: `src/__tests__/features/useExportData.test.ts`

- [ ] **Step 1: Add failing tests**

Update the import line:

```ts
import { fetchSalesRows, fetchExpensesRows, fetchProductsRows, fetchCustomersRows } from '@/features/exports/composables/useExportData'
```

Append:

```ts
describe('fetchCustomersRows', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([])
  })

  it('calls db.getAll with GROUP BY aggregation and shop_id twice', async () => {
    await fetchCustomersRows()
    const call = vi.mocked(db.getAll).mock.calls[0]
    expect(call[0]).toContain('GROUP BY')
    // shopId appears in JOIN condition and WHERE clause
    expect((call[1] as unknown[]).filter(v => v === '00000000-0000-0000-0000-000000000001')).toHaveLength(2)
  })

  it('maps a db row to Arabic-keyed export row', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([{
      name: 'محمد علي',
      phone: '0991234567',
      balance_usd: 150,
      balance_syp: 1875000,
      last_purchase: '2026-06-04T09:00:00Z',
    }])
    const rows = await fetchCustomersRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]['الاسم']).toBe('محمد علي')
    expect(rows[0]['الهاتف']).toBe('0991234567')
    expect(rows[0]['الرصيد المستحق $']).toBe(150)
    expect(rows[0]['الرصيد المستحق ل.س']).toBe(1875000)
  })

  it('maps null phone and last_purchase to "—"', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([{
      name: 'زبون بدون هاتف',
      phone: null,
      balance_usd: 0,
      balance_syp: 0,
      last_purchase: null,
    }])
    const rows = await fetchCustomersRows()
    expect(rows[0]['الهاتف']).toBe('—')
    expect(rows[0]['آخر شراء']).toBe('—')
  })
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

```bash
npx vitest run src/__tests__/features/useExportData.test.ts
```

Expected: 9 pass, 3 FAIL.

- [ ] **Step 3: Add `fetchCustomersRows` to `useExportData.ts`**

Append to `src/features/exports/composables/useExportData.ts`:

```ts
type CustomerRow = {
  name: string
  phone: string | null
  balance_usd: number
  balance_syp: number
  last_purchase: string | null
}

export async function fetchCustomersRows(): Promise<Record<string, unknown>[]> {
  const { shopId } = useDeviceStore()
  const rows = await db.getAll<CustomerRow>(
    `SELECT
       c.name,
       c.phone,
       COALESCE(SUM(CASE WHEN s.is_credit = 1 THEN s.total_usd ELSE 0 END), 0)
         - COALESCE(SUM(cp.amount_usd), 0) AS balance_usd,
       COALESCE(SUM(CASE WHEN s.is_credit = 1 THEN s.total_syp ELSE 0 END), 0)
         - COALESCE(SUM(cp.amount_syp), 0) AS balance_syp,
       MAX(s.created_at) AS last_purchase
     FROM customers c
     LEFT JOIN sales s              ON s.customer_id = c.id AND s.shop_id = ?
     LEFT JOIN customer_payments cp ON cp.customer_id = c.id
     WHERE c.shop_id = ?
       AND c.is_deleted = 0
     GROUP BY c.id
     ORDER BY c.name`,
    [shopId, shopId],
  )
  return rows.map(r => ({
    'الاسم':               r.name,
    'الهاتف':              r.phone ?? '—',
    'الرصيد المستحق $':    r.balance_usd,
    'الرصيد المستحق ل.س':  r.balance_syp,
    'آخر شراء':            r.last_purchase
      ? r.last_purchase.slice(0, 16).replace('T', ' ')
      : '—',
  }))
}
```

- [ ] **Step 4: Run all tests to verify they all pass**

```bash
npx vitest run src/__tests__/features/useExportData.test.ts
```

Expected: PASS — 12 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/features/exports/composables/useExportData.ts src/__tests__/features/useExportData.test.ts
git commit -m "feat(exports): add fetchCustomersRows with balance aggregation and tests"
```

---

## Task 7: ExportPage + route + BackOfficePage tile

**Files:**
- Create: `src/features/exports/ExportPage.vue`
- Create: `src/features/exports/index.ts`
- Modify: `src/router/index.ts`
- Modify: `src/features/products/BackOfficePage.vue`

- [ ] **Step 1: Create `ExportPage.vue`**

Create `src/features/exports/ExportPage.vue`:

```vue
<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppToast from '@/components/ui/AppToast.vue'
import { usePeriodToggle } from '@/features/dashboard/composables/usePeriodToggle'
import { getDateRange } from '@/features/dashboard/composables/periodUtils'
import {
  fetchSalesRows, fetchExpensesRows,
  fetchProductsRows, fetchCustomersRows,
} from './composables/useExportData'
import { buildAndDownload } from './composables/useExportFile'
import {
  SALES_HEADERS, EXPENSES_HEADERS,
  PRODUCTS_HEADERS, CUSTOMERS_HEADERS,
} from './export.types'
import type { ExportDataset, ExportFormat } from './export.types'

const router = useRouter()
const { period } = usePeriodToggle()

const selectedDataset  = ref<ExportDataset>('sales')
const selectedFormat   = ref<ExportFormat>('xlsx')
const useCustomRange   = ref(false)
const customStart      = ref('')
const customEnd        = ref('')
const loading          = ref(false)
const toast            = ref<{ message: string; type: 'success' | 'error' } | null>(null)

const showDateRange = computed(() =>
  selectedDataset.value === 'sales' || selectedDataset.value === 'expenses'
)

const effectiveDateRange = computed(() => {
  if (useCustomRange.value && customStart.value && customEnd.value) {
    return { start: customStart.value, end: customEnd.value }
  }
  return getDateRange(period.value)
})

const datasets: { key: ExportDataset; label: string; desc: string }[] = [
  { key: 'sales',     label: 'المبيعات',  desc: 'تفصيل الفواتير وأسطر البيع' },
  { key: 'expenses',  label: 'المصاريف', desc: 'مصاريف المحل حسب الفترة' },
  { key: 'products',  label: 'المنتجات',  desc: 'المخزون الحالي والأسعار' },
  { key: 'customers', label: 'الزبائن',   desc: 'الأرصدة والديون المستحقة' },
]

async function onExport() {
  loading.value = true
  toast.value   = null
  try {
    const today    = new Date().toISOString().slice(0, 10)
    const ext      = selectedFormat.value
    const range    = effectiveDateRange.value
    let rows: Record<string, unknown>[]
    let headers: readonly string[]
    let filename: string

    if (selectedDataset.value === 'sales') {
      rows     = await fetchSalesRows(range)
      headers  = SALES_HEADERS
      filename = `wafi-sales-${today}.${ext}`
    } else if (selectedDataset.value === 'expenses') {
      rows     = await fetchExpensesRows(range)
      headers  = EXPENSES_HEADERS
      filename = `wafi-expenses-${today}.${ext}`
    } else if (selectedDataset.value === 'products') {
      rows     = await fetchProductsRows()
      headers  = PRODUCTS_HEADERS
      filename = `wafi-products-${today}.${ext}`
    } else {
      rows     = await fetchCustomersRows()
      headers  = CUSTOMERS_HEADERS
      filename = `wafi-customers-${today}.${ext}`
    }

    buildAndDownload(headers, rows, filename, selectedFormat.value)
    toast.value = { message: 'تم تصدير الملف بنجاح', type: 'success' }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'حدث خطأ أثناء التصدير'
    toast.value = { message: msg, type: 'error' }
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="page-root" dir="rtl">
    <AppHeader title="تصدير البيانات" :show-back="true" @back="router.back()" />

    <main class="page-main">

      <!-- Step 1: Dataset -->
      <div class="step-section">
        <div class="step-label">١. اختر البيانات</div>
        <div class="dataset-grid">
          <button
            v-for="ds in datasets"
            :key="ds.key"
            type="button"
            class="dataset-card"
            :class="{ active: selectedDataset === ds.key }"
            @click="selectedDataset = ds.key"
          >
            <span class="ds-label">{{ ds.label }}</span>
            <span class="ds-desc">{{ ds.desc }}</span>
          </button>
        </div>
      </div>

      <!-- Step 2: Date range (Sales + Expenses only) -->
      <div v-if="showDateRange" class="step-section">
        <div class="step-label">٢. الفترة الزمنية</div>
        <div class="range-card">
          <div class="range-default">
            <span class="range-default-label">الفترة الحالية:</span>
            <span class="range-default-value">{{ effectiveDateRange.start }} → {{ effectiveDateRange.end }}</span>
          </div>
          <button type="button" class="custom-toggle" @click="useCustomRange = !useCustomRange">
            {{ useCustomRange ? 'استخدام الفترة الحالية' : 'تخصيص الفترة' }}
          </button>
          <div v-if="useCustomRange" class="custom-range-inputs">
            <label class="date-label">
              <span>من</span>
              <input v-model="customStart" type="date" class="date-input" />
            </label>
            <label class="date-label">
              <span>إلى</span>
              <input v-model="customEnd" type="date" class="date-input" />
            </label>
          </div>
        </div>
      </div>

      <!-- Step 3: Format -->
      <div class="step-section">
        <div class="step-label">{{ showDateRange ? '٣' : '٢' }}. الصيغة</div>
        <div class="format-row">
          <button
            type="button"
            class="format-btn"
            :class="{ active: selectedFormat === 'xlsx' }"
            @click="selectedFormat = 'xlsx'"
          >
            Excel (.xlsx)
          </button>
          <button
            type="button"
            class="format-btn"
            :class="{ active: selectedFormat === 'csv' }"
            @click="selectedFormat = 'csv'"
          >
            CSV (.csv)
          </button>
        </div>
      </div>

      <!-- Step 4: Export button -->
      <div class="step-section">
        <button
          type="button"
          class="export-btn"
          :disabled="loading"
          @click="onExport"
        >
          <span v-if="loading" class="spinner" aria-hidden="true"></span>
          <span>{{ loading ? 'جارٍ التصدير...' : 'تصدير' }}</span>
        </button>
      </div>

    </main>

    <AppToast
      v-if="toast"
      :message="toast.message"
      :type="toast.type"
      @dismiss="toast = null"
    />
  </div>
</template>

<style scoped>
.page-root {
  display: flex; flex-direction: column;
  min-height: 100dvh;
  background: #06090F;
  font-family: 'Tajawal', system-ui, sans-serif;
}
.page-main {
  flex: 1; padding: 1.5rem 1rem 80px;
  max-width: 42rem; margin-inline: auto; width: 100%;
  display: flex; flex-direction: column; gap: 1.5rem;
}

/* Steps */
.step-section { display: flex; flex-direction: column; gap: 0.75rem; }
.step-label {
  font-size: 11px; font-weight: 700; color: #3D4F6B;
  text-transform: uppercase; letter-spacing: 0.1em;
}

/* Dataset grid */
.dataset-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 0.625rem;
}
.dataset-card {
  display: flex; flex-direction: column; gap: 3px;
  padding: 14px 16px; border-radius: 12px; cursor: pointer;
  text-align: right; border: 1px solid rgba(26,86,219,0.18);
  background: rgba(255,255,255,0.03);
  transition: background 0.15s, border-color 0.15s;
}
.dataset-card.active {
  background: linear-gradient(135deg, rgba(26,86,219,0.18), rgba(26,86,219,0.08));
  border-color: rgba(26,86,219,0.50);
  box-shadow: 0 2px 12px rgba(26,86,219,0.15);
}
.ds-label { font-size: 14px; font-weight: 700; color: #E8EDF5; }
.ds-desc  { font-size: 11px; color: #637285; line-height: 1.4; }

/* Range card */
.range-card {
  padding: 14px 16px; border-radius: 12px;
  background: linear-gradient(135deg, rgba(26,86,219,0.10), rgba(255,255,255,0.03));
  border: 1px solid rgba(26,86,219,0.22);
  display: flex; flex-direction: column; gap: 10px;
}
.range-default { display: flex; gap: 8px; align-items: center; }
.range-default-label { font-size: 12px; color: #637285; }
.range-default-value { font-size: 13px; color: #C8D5E8; font-weight: 600; }
.custom-toggle {
  font-size: 13px; font-weight: 600; color: #60A5FA;
  background: none; border: none; cursor: pointer; text-align: right; padding: 0;
  font-family: 'Tajawal', system-ui, sans-serif;
}
.custom-range-inputs { display: flex; gap: 12px; flex-wrap: wrap; }
.date-label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #637285; }
.date-input {
  padding: 7px 10px; border-radius: 8px; font-size: 13px;
  background: rgba(255,255,255,0.05); border: 1px solid rgba(26,86,219,0.25);
  color: #E8EDF5; font-family: 'Tajawal', system-ui, sans-serif;
}

/* Format buttons */
.format-row { display: flex; gap: 10px; }
.format-btn {
  flex: 1; padding: 10px; border-radius: 10px; font-size: 14px; font-weight: 600;
  cursor: pointer; font-family: 'Tajawal', system-ui, sans-serif;
  border: 1px solid rgba(26,86,219,0.22);
  background: rgba(255,255,255,0.03); color: #637285;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.format-btn.active {
  background: linear-gradient(135deg, rgba(26,86,219,0.18), rgba(26,86,219,0.08));
  border-color: rgba(26,86,219,0.50); color: #E8EDF5;
}

/* Export button */
.export-btn {
  width: 100%; height: 52px; border-radius: 14px;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  border: none; color: white; font-size: 16px; font-weight: 700;
  cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;
  font-family: 'Tajawal', system-ui, sans-serif;
  box-shadow: 0 4px 18px rgba(26,86,219,0.40);
  transition: opacity 0.2s;
}
.export-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.spinner {
  width: 18px; height: 18px; border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: white;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
```

- [ ] **Step 2: Create `index.ts` barrel**

Create `src/features/exports/index.ts`:

```ts
export { default as ExportPage } from './ExportPage.vue'
export * from './export.types'
export * from './composables/useExportData'
export * from './composables/useExportFile'
```

- [ ] **Step 3: Add route to `src/router/index.ts`**

In `src/router/index.ts`, find the line:

```ts
{ path: '/shifts/history',  component: () => import('@/features/shifts/components/ShiftHistoryScreen.vue') },
```

Add the exports route directly before it:

```ts
{ path: '/exports', component: () => import('@/features/exports/ExportPage.vue') },
```

- [ ] **Step 4: Add Exports tile to `BackOfficePage.vue`**

In `src/features/products/BackOfficePage.vue`, find the `modules` array and add an exports entry:

```ts
const modules = [
  { key: 'products',  label: 'المنتجات',  description: 'إدارة المخزون والأسعار', route: '/products',  active: true  },
  { key: 'customers', label: 'الزبائن',   description: 'الديون والمدفوعات',       route: '/customers', active: true  },
  { key: 'exports',   label: 'التصدير',   description: 'Excel وCSV للبيانات',     route: '/exports',   active: true  },
  { key: 'reports',   label: 'التقارير',  description: 'الأرباح والمبيعات',       route: null,         active: false },
  { key: 'expenses',  label: 'المصاريف', description: 'تتبع مصاريف المحل',       route: null,         active: false },
  { key: 'shifts',    label: 'الكاشيرات', description: 'الورديات والصلاحيات',     route: null,         active: false },
]
```

Also add the exports SVG icon inside the `v-if` chain in the template. Find the `<svg v-if="mod.key === 'customers'"` block and add after it:

```html
<svg v-if="mod.key === 'exports'" xmlns="http://www.w3.org/2000/svg" class="nav-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
  <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
</svg>
```

- [ ] **Step 5: Run the full test suite**

```bash
npx vitest run
```

Expected: all tests passing, no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/features/exports/ExportPage.vue src/features/exports/index.ts src/router/index.ts src/features/products/BackOfficePage.vue
git commit -m "feat(exports): add ExportPage, route /exports, BackOfficePage tile"
```

---

## Self-Review

**Spec coverage:**
- ✅ Dedicated page at `/exports` — Task 7
- ✅ Dataset selector (4 cards) — Task 7 ExportPage
- ✅ Date range: default from period toggle, custom override — Task 7 ExportPage
- ✅ Format selector: xlsx / csv — Task 7 ExportPage
- ✅ Export button with loading state + toast — Task 7 ExportPage
- ✅ File naming `wafi-{dataset}-{date}.{ext}` — Task 7 onExport()
- ✅ Sales columns (10 fields, Arabic payment labels) — Task 3
- ✅ Expenses columns (5 fields) — Task 4
- ✅ Products columns (7 fields, computed stock value) — Task 5
- ✅ Customers columns (5 fields, balance aggregation) — Task 6
- ✅ RTL worksheet direction — Task 2 buildWorkbook
- ✅ UTF-8 BOM for CSV — Task 2 buildAndDownload
- ✅ Throws on empty rows — Task 2 buildAndDownload
- ✅ BackOfficePage tile — Task 7 Step 4
- ✅ `xlsx` library install — Task 1
- ✅ `useExportFile` unit tests — Task 2
- ✅ `useExportData` unit tests — Tasks 3–6

**No placeholders. No TODOs. All code is complete.**
