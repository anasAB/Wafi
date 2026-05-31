# Epic 3 — Drill-Down Screens & Cash Drawer: Design Spec

**Date:** 2026-05-31
**Epic:** EPIC-03 (continuation)
**Scope:** Stories 3.3 (drill-down detail screens) and 3.6 (cash drawer indicator)
**Depends on:** Epic 3 ship-first wave (useDashboardMetrics, usePeriodToggle, useExpenses, MetricCard all exist)

---

## Scope

| Story | Title |
|---|---|
| 3.3 | Drill into any metric card for details |
| 3.6 | See cash in drawer indicator |

---

## Architecture

### Approach

Extend existing features rather than creating new folders. Each drill-down target maps naturally to an existing feature:

- **Sales list** → extend `SaleHistoryScreen.vue` to accept a `?period=` query param
- **Expense list** → new page `ExpenseListPage.vue` in `src/features/expenses/`
- **Profit breakdown** → new `ProfitSheet.vue` bottom sheet in `src/features/dashboard/components/`
- **Cash drawer** → new `CashDrawerBar.vue` + `CashDrawerSheet.vue` + `useCashDrawer.ts` in `src/features/dashboard/`

The `MetricCard` gains a `tap` emit so clicking any card navigates or opens the appropriate view.

### File changes

```
Extend:
  src/features/sale-history/SaleHistoryScreen.vue    — read ?period= query param, filter by date range
  src/features/sale-history/useSaleHistory.ts         — accept optional { start, end } date range
  src/router/index.ts                                 — add /expenses route

Create:
  src/features/expenses/ExpenseListPage.vue           — list of expenses for period; tap → ExpenseForm pre-filled
  src/features/expenses/composables/useExpenseList.ts — load expenses by period, delete
  src/features/dashboard/components/ProfitSheet.vue   — bottom sheet with 5-row profit breakdown
  src/features/dashboard/components/CashDrawerBar.vue — summary row on home screen
  src/features/dashboard/components/CashDrawerSheet.vue — detail sheet with cash movements
  src/features/dashboard/composables/useCashDrawer.ts — cash USD/SYP totals since day start

  src/__tests__/features/useCashDrawer.test.ts
  src/__tests__/features/useExpenseList.test.ts
  src/__tests__/features/ProfitSheet.test.ts

Modify:
  src/features/dashboard/components/MetricCard.vue   — add 'tap' emit
  src/pages/HomePage.vue                             — wire card taps, add CashDrawerBar, ProfitSheet v-if
```

---

## Responsive Layout

All screens follow the same responsive patterns already used in this codebase:

| Screen | Phone | Desktop/Tablet |
|---|---|---|
| Sales list | Card stack, full width | Table layout (already exists in SaleHistoryScreen) |
| Expense list | Card stack | Table layout — columns: date, category, USD, notes indicator |
| Profit breakdown | Bottom sheet slides up from bottom | Centered modal (`sm:items-center`, `sm:rounded-2xl`) |
| Cash drawer detail | Bottom sheet | Centered modal |
| Cash drawer row | Full-width card | Max-width container matching home screen (`max-w-lg`) |

Bottom sheets use `items-end sm:items-center` + `rounded-t-2xl sm:rounded-2xl` — the same pattern as `StockAdjustmentDialog.vue` and `ExpenseForm.vue`.

---

## Data Layer

### Sales list — extend useSaleHistory

`useSaleHistory.ts` currently queries the last 7 days. Add an optional `dateRange?: { start: string; end: string }` parameter to `load()`. When present, use it instead of the default 7-day window.

`SaleHistoryScreen.vue` reads `route.query.period` on mount. If present, calls `getDateRange(period)` from `periodUtils.ts` and passes the result to `load()`.

The period toggle is already a singleton (`usePeriodToggle`) — changing period on this screen automatically updates the home screen's cards.

### Expense list — useExpenseList

```ts
// src/features/expenses/composables/useExpenseList.ts
expenses: Ref<Expense[]>
load(period: Period): Promise<void>      // queries expenses WHERE expense_date BETWEEN start AND end
deleteExpense(id: string): Promise<void> // deletes, then reloads
```

Tapping an expense row opens the existing `ExpenseForm.vue` pre-filled with the expense data. On save, closes and reloads the list.

### Profit breakdown — ProfitSheet (display only)

`ProfitSheet.vue` is a pure display component. It receives the already-computed values as props:

```ts
props: {
  revenueUsd:  number
  cogsUsd:     number
  expensesUsd: number
  profitUsd:   number   // computed: revenue - cogs - expenses
  period:      Period   // for the header label
  isOpen:      boolean
}
emits: ['close']
```

No DB queries — reads from `useDashboardMetrics()` refs in `HomePage.vue`.

**Five rows displayed:**
1. إجمالي البيع (Total sales) — `+$revenueUsd`
2. تكلفة البضاعة المباعة (COGS) — `−$cogsUsd`
3. الربح الإجمالي (Gross profit) — `$revenueUsd - $cogsUsd`
4. المصاريف (Expenses) — `−$expensesUsd`
5. **صافي الربح (Net profit)** — `$profitUsd` — large, bold, colored green/red/gray

### Cash drawer — useCashDrawer

```ts
// src/features/dashboard/composables/useCashDrawer.ts
cashUsd: Ref<number>    // net USD cash in drawer
cashSyp: Ref<number>    // net SYP cash in drawer
movements: Ref<CashMovement[]>  // chronological list for detail sheet
load(): Promise<void>
```

**Day start:** default 6 AM local time. Computed as:
```ts
const now = new Date()
const dayStart = new Date(now)
dayStart.setHours(6, 0, 0, 0)
if (now < dayStart) dayStart.setDate(dayStart.getDate() - 1) // before 6 AM → use yesterday's 6 AM
```

**Two parallel queries:**

```sql
-- Cash sales (USD and SYP tracked separately)
SELECT payment_method, COALESCE(SUM(total_usd), 0) as total_usd, COALESCE(SUM(total_syp), 0) as total_syp
FROM sales
WHERE shop_id = ? AND payment_method IN ('cash_usd', 'cash_syp') AND created_at >= ?
GROUP BY payment_method

-- Cash expenses (subtract from drawer)
SELECT currency, COALESCE(SUM(amount_usd), 0) as total_usd, COALESCE(SUM(amount), 0) as total_raw
FROM expenses
WHERE shop_id = ? AND paid_in_cash = 1 AND created_at >= ?
GROUP BY currency
```

**Result:**
- `cashUsd` = sum of cash_usd sales (total_usd) − USD cash expenses
- `cashSyp` = sum of cash_syp sales (total_syp) − SYP cash expenses

**Movements query** (for detail sheet):
```sql
-- Union of cash sales and cash expenses, sorted by time
SELECT 'sale' as type, total_usd as usd, total_syp as syp, payment_method as currency_hint, created_at
FROM sales WHERE shop_id = ? AND payment_method IN ('cash_usd', 'cash_syp') AND created_at >= ?
UNION ALL
SELECT 'expense' as type, -amount_usd as usd, -(CASE WHEN currency='SYP' THEN amount ELSE 0 END) as syp, currency as currency_hint, created_at
FROM expenses WHERE shop_id = ? AND paid_in_cash = 1 AND created_at >= ?
ORDER BY created_at DESC
```

`CashMovement` interface: `{ type: 'sale'|'expense', usd: number, syp: number, currencyHint: string, createdAt: string, label: string }`

---

## Screens

### Sales list (`/history?period=today|week|month`)

Reuses the existing `SaleHistoryScreen.vue`. When `?period=` is present:
- Header title changes to "مبيعات اليوم" / "مبيعات الأسبوع" / "مبيعات الشهر"
- Total amount shown in header right (sum of period sales)
- Period toggle shown below header (same singleton — changes home screen too)
- Pull-to-refresh reloads with same period
- If navigated to directly (no `?period=` param), defaults to `usePeriodToggle().period.value` (current singleton value — today by default)

**Phone layout:** Card list (existing). Each card: relative timestamp, item count, total USD, total SYP, payment method badge.
**Desktop layout:** Table (existing). Columns: date/time, items, total USD, total SYP, method.

### Expense list (`/expenses?period=today|week|month`)

New `ExpenseListPage.vue`. Same layout pattern as sales list.

**Phone layout:** Card list. Each card: amount (large), category, date, optional photo thumbnail (right side).
**Desktop layout:** Table. Columns: date, category, USD amount, SYP amount, notes indicator, photo indicator.

Tap a row → `ExpenseForm` opens pre-filled. Save → row updates in list. Delete button in form → row removed.

**Empty state:** "لا توجد مصاريف في هذه الفترة"

### Profit breakdown (ProfitSheet)

Bottom sheet on phone, centered modal on desktop (`sm:items-center`).

Five rows in order, with borders between them:
1. إجمالي البيع → green `+$X`
2. تكلفة البضاعة المباعة → red `−$X`
3. الربح الإجمالي → neutral `$X` (separator line, slightly bolder)
4. المصاريف → red `−$X`
5. **صافي الربح** → large bold, green/red/gray

If `cogsUsd = 0` and products exist: amber warning row below COGS: "بعض المنتجات بدون سعر تكلفة — الربح الإجمالي قد يكون أعلى من الحقيقي"

Closed by backdrop tap or swipe down.

### Cash drawer bar (CashDrawerBar)

Small card on home screen, below the best sellers card, above the low-stock card.

```
💰  النقد المتوقع في الدرج
    $35 + 1,160,000 ل.س        ›
```

- Shows `$0 + 0 ل.س` when no cash activity — never hidden
- Tapping opens `CashDrawerSheet`
- Loads on `onMounted` in `HomePage`

### Cash drawer detail (CashDrawerSheet)

Bottom sheet / centered modal.

**Header:** "حركات النقد — اليوم" + summary totals

**List:** chronological movements, newest first. Each row:
- Cash sale: green `+$X` or `+X ل.س`, label "بيع", relative time
- Cash expense: red `−$X` or `−X ل.س`, label "مصروف: [category]", relative time

**Footer:** total row showing `$X + Y ل.س`

---

## MetricCard tap wiring

`MetricCard.vue` gains a new `emit('tap')`. In `HomePage.vue`:

```ts
// Money In card → navigate to /history?period=...
// Expenses card → navigate to /expenses?period=...
// Profit card → open ProfitSheet
```

Cards already have `cursor-pointer` styling; no visual changes needed.

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| No sales in period | Empty state: "لا توجد مبيعات في هذه الفترة" |
| No expenses in period | Empty state: "لا توجد مصاريف في هذه الفترة" |
| Delete expense fails | Toast error; list not reloaded |
| COGS = 0 with active products | Warning row in ProfitSheet |
| Cash drawer 0 activity | Shows "$0 + 0 ل.س" — never hidden |
| Day not yet past 6 AM | useCashDrawer uses previous day's 6 AM as start |

---

## Testing

| Test file | What it covers |
|---|---|
| `useCashDrawer.test.ts` | Cash USD/SYP net calculation, day-start boundary (before/after 6 AM), empty day returns zeros, movements query |
| `useExpenseList.test.ts` | Load by period date range, deleteExpense removes and reloads, empty period |
| `ProfitSheet.test.ts` | All 5 rows render with correct signs; COGS=0 warning shown; zero profit shows gray |
| `SaleHistoryScreen.test.ts` (extend) | Period param filters by date range; no param keeps 7-day default |

---

## Out of Scope

- Sale detail screen (tap a sale in the list) — deferred; tap navigates to existing `/history` detail (reprint row already exists)
- Expense photo full-screen enlarge — deferred
- "Mark as reordered" on low-stock drill-down — Epic 2 gap, separate item
- Cash drawer day-start configuration in settings — hardcoded 6 AM for now
- Previous day cash history — deferred (Epic 5 shifts will supersede this)
