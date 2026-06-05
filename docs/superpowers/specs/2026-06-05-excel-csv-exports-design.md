# Excel / CSV Exports — Design Spec

**Date:** 2026-06-05
**Feature:** Excel/CSV data exports for sales, expenses, products, and customers
**Scope:** v1 — dedicated export page, SheetJS, four datasets, date-range filtering

---

## Overview

A dedicated export page at `/exports` lets the owner download any of four datasets (Sales, Expenses, Products, Customers) as either `.xlsx` or `.csv`. SheetJS handles both formats from the same data-building pipeline. Arabic column headers and RTL worksheet direction are applied to all Excel files.

---

## Page Layout & UX Flow

Route: `/exports` — accessible as a tile from `BackOfficePage`.

The page renders four vertical steps:

### Step 1 — Dataset selector
Four tappable cards in a 2×2 grid:
- **المبيعات** (Sales)
- **المصاريف** (Expenses)
- **المنتجات** (Products — inventory snapshot)
- **الزبائن** (Customers)

Only one dataset active at a time. Tapping a card highlights it and shows/hides the date range step below.

### Step 2 — Date range (Sales and Expenses only)
Hidden for Products and Customers (point-in-time snapshots).

- Default: current period from the `usePeriodToggle` singleton (today / week / month)
- "تخصيص الفترة" toggle reveals two date inputs (start, end) for custom range override
- Date inputs use `<input type="date">` with Arabic label

### Step 3 — Format selector
Two buttons side by side:
- **Excel (.xlsx)** — default selected
- **CSV (.csv)**

### Step 4 — Export button
- Label: `تصدير`
- Triggers: data fetch → workbook build → file download
- Loading state: spinner replaces button label during generation
- Success: `AppToast` "تم تصدير الملف"
- Error: `AppToast` with error message (e.g. "لا توجد بيانات للتصدير" if result is empty)

### File naming
`wafi-{dataset}-{YYYY-MM-DD}.xlsx` / `.csv`
Examples: `wafi-sales-2026-06-05.xlsx`, `wafi-customers-2026-06-05.csv`

---

## Export Contents

### Sales — one row per line item (sale header repeated)

| Arabic Header | Field |
|---|---|
| رقم البيع | display_sale_number |
| التاريخ | sale created_at (formatted YYYY-MM-DD HH:mm) |
| المنتج | product name |
| الكمية | qty |
| سعر الوحدة $ | unit_price_usd |
| سعر الوحدة ل.س | unit_price_syp |
| إجمالي السطر $ | line total (qty × unit_price_usd) |
| طريقة الدفع | payment_method mapped to Arabic in composable (cash_usd→نقد دولار, cash_syp→نقد ليرة, card→بطاقة, credit→آجل, split→دفع مختلط) |
| الكاشير | staff name (or "—" if no shift) |
| إجمالي الفاتورة $ | sale total_usd |

### Expenses — one row per expense

| Arabic Header | Field |
|---|---|
| التاريخ | expense_date |
| الفئة | category |
| الوصف | description |
| المبلغ $ | amount_usd |
| المبلغ ل.س | amount_syp |

### Products — one row per active product (snapshot)

| Arabic Header | Field |
|---|---|
| الاسم | name |
| الباركود | barcode (or "—") |
| سعر البيع $ | sale_price_usd |
| سعر البيع ل.س | sale_price_syp |
| التكلفة $ | cost_usd (or "—") |
| المخزون الحالي | current_stock |
| قيمة المخزون $ | current_stock × cost_usd |

### Customers — one row per customer

| Arabic Header | Field |
|---|---|
| الاسم | name |
| الهاتف | phone (or "—") |
| الرصيد المستحق $ | outstanding balance USD (sum of credit sales minus payments) |
| الرصيد المستحق ل.س | outstanding balance SYP |
| آخر شراء | latest sale created_at |

---

## Architecture

```
src/features/exports/
  export.types.ts
  composables/
    useExportData.ts
    useExportFile.ts
  ExportPage.vue
  index.ts
```

### `export.types.ts`
```ts
export type ExportDataset = 'sales' | 'expenses' | 'products' | 'customers'
export type ExportFormat  = 'xlsx' | 'csv'
export interface ExportDateRange { start: string; end: string }
```

### `useExportData.ts`
Four async fetch functions, each scoped to `shop_id` from `useDeviceStore`:

- `fetchSalesRows(range: ExportDateRange): Promise<Record<string, unknown>[]>`
  - JOIN: `sales` → `sale_line_items` → `products` → `staff` (LEFT JOIN on shift → staff)
  - Filter: `sales.created_at BETWEEN range.start AND range.end`
  - Returns one flat object per line item

- `fetchExpensesRows(range: ExportDateRange): Promise<Record<string, unknown>[]>`
  - Filter: `expense_date BETWEEN range.start AND range.end`

- `fetchProductsRows(): Promise<Record<string, unknown>[]>`
  - Filter: `is_active = true`
  - Computes `stock_value_usd = current_stock * cost_usd`

- `fetchCustomersRows(): Promise<Record<string, unknown>[]>`
  - JOIN: `customers` LEFT JOIN aggregated `customer_payments` and `sales` (credit only)
  - Computes outstanding balance: sum(credit sales) − sum(payments)
  - Computes latest sale date

### `useExportFile.ts`
Pure function — no Vue reactivity, fully unit-testable:

```ts
export function buildAndDownload(
  headers: string[],
  rows: Record<string, unknown>[],
  filename: string,
  format: ExportFormat
): void
```

- Creates a SheetJS worksheet via `XLSX.utils.json_to_sheet(rows, { header: headers })`
- Sets `ws['!cols']` for column widths (auto-fit to content)
- Sets RTL direction: `ws['!dir'] = 'rtl'`
- For `.xlsx`: `XLSX.writeFile(wb, filename)`
- For `.csv`: converts to CSV string, wraps in UTF-8 BOM Blob, triggers `<a>` download

### `ExportPage.vue`
- Uses `useExportData` and `useExportFile`
- Local state: `selectedDataset`, `selectedFormat`, `dateRange`, `useCustomRange`, `loading`
- `onExport()`: calls appropriate fetch function → `buildAndDownload()` → toast

---

## DB Queries

All queries run against PowerSync local SQLite via `db.execute()`.

### Sales query
```sql
SELECT
  s.display_sale_number,
  s.created_at,
  s.total_usd,
  s.payment_method,
  st.name AS cashier_name,
  p.name  AS product_name,
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
ORDER BY s.created_at DESC, li.id ASC
```

### Customers query
```sql
SELECT
  c.name,
  c.phone,
  COALESCE(SUM(CASE WHEN s.is_credit = 1 THEN s.total_usd ELSE 0 END), 0)
    - COALESCE(SUM(cp.amount_usd), 0) AS balance_usd,
  COALESCE(SUM(CASE WHEN s.is_credit = 1 THEN s.total_syp ELSE 0 END), 0)
    - COALESCE(SUM(cp.amount_syp), 0) AS balance_syp,
  MAX(s.created_at) AS last_purchase
FROM customers c
LEFT JOIN sales s          ON s.customer_id = c.id AND s.shop_id = ?
LEFT JOIN customer_payments cp ON cp.customer_id = c.id
WHERE c.shop_id = ?
  AND c.is_deleted = 0
GROUP BY c.id
ORDER BY c.name
```

---

## Library

`xlsx` (SheetJS community edition) — `npm install xlsx`
No other new dependencies.

---

## Testing

- `useExportFile` — unit tests: given rows + headers, assert correct column count, BOM present for CSV, worksheet direction = rtl
- `useExportData` — unit tests per fetch function using the existing `db` mock
- `ExportPage` — no dedicated component tests; covered by composable tests

---

## Out of Scope

- Scheduled/automatic exports (v2)
- Email delivery of exports (v2)
- WhatsApp sharing of export files (v2)
- Filtering by cashier or product category within the export page (v1.5)
