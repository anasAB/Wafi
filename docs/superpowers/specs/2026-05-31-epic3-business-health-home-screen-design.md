# Epic 3 — Business Health Home Screen: Design Spec

**Date:** 2026-05-31
**Epic:** EPIC-03
**Scope:** Ship-first wave (Stories 3.1, 3.2, 3.4, 3.5, 3.7)
**Deferred:** Story 3.3 (drill-down detail screens), Story 3.6 (cash drawer indicator)

---

## Scope

| Story | Title |
|---|---|
| 3.1 | See today's revenue, expenses, and profit at a glance |
| 3.2 | Toggle between Today, This Week, This Month |
| 3.4 | Log an expense in under 30 seconds |
| 3.5 | See top 5 selling products |
| 3.7 | Dashboard works offline with staleness indication |

Stories 3.3 (drill-down detail screens) and 3.6 (cash drawer indicator) are deferred. Story 3.6 is partially blocked on Epic 5 shifts; its "since last shift" concept doesn't apply until shifts exist.

---

## Architecture

### Approach

Two new feature folders:
- `src/features/dashboard/` — period toggle state, aggregation composables (revenue, profit, best sellers), staleness awareness
- `src/features/expenses/` — expense CRUD, types, form component

`src/pages/HomePage.vue` is **fully rewritten** to wire both features together. The existing "today's sales" card and its direct query are replaced by the `MetricCard` + `useDashboardMetrics` combination, which covers the same data plus expenses and profit.

### Folder structure

```
src/
  features/
    dashboard/
      composables/
        usePeriodToggle.ts          # singleton period state: 'today' | 'week' | 'month'
        useDashboardMetrics.ts      # revenue, COGS, expenses, profit, missingCostCount
        useBestSellers.ts           # top-5 products by period
      components/
        MetricCard.vue              # reusable card: label, USD value, SYP secondary, accent color
        PeriodToggle.vue            # اليوم | الأسبوع | الشهر segmented control
        BestSellersCard.vue         # ranked list card
        StalenessBar.vue            # "آخر تحديث منذ X دقيقة" banner

    expenses/
      composables/
        useExpenses.ts              # INSERT, load by period, soft-delete
      components/
        ExpenseForm.vue             # modal slide-up form
        ExpenseCategoryChips.vue    # chip selector with custom input
      expense.types.ts              # Expense interface, ExpenseCategory type

src/
  data/powersync/schema.ts          # add expenses table; add unit_cost_usd to sale_line_items
  features/payment/usePayment.ts    # populate unit_cost_usd on sale confirm
  pages/HomePage.vue                # full rewrite
```

---

## Data Layer

### Schema changes

**New `expenses` table:**

| Column | Type | Notes |
|---|---|---|
| `shop_id` | text | Required for RLS |
| `amount` | real | Raw entered amount |
| `currency` | text | `USD` or `SYP` |
| `amount_usd` | real | Converted at exchange rate on save |
| `category` | text | Predefined or custom string |
| `expense_date` | text | ISO date `YYYY-MM-DD`; backdatable up to 30 days, never future |
| `notes` | text | Optional, max 500 chars |
| `photo_url` | text | Optional blob or cloud URL |
| `paid_in_cash` | integer | 0/1, default 1 |
| `created_at` | text | ISO timestamp |
| `sync_status` | text | pending / syncing / synced / error |

**`sale_line_items` — add one column:**

| Column | Type | Notes |
|---|---|---|
| `unit_cost_usd` | real | `products.cost_price_usd` at time of sale |

This makes COGS historically accurate. `usePayment.ts` must populate it when confirming a sale (alongside the existing `unit_price_usd`).

### `usePeriodToggle` composable

Module-level singleton `ref<'today' | 'week' | 'month'>('today')`. All composables that need the period import from this module; changing the toggle once updates all reactive consumers simultaneously. Default is always `'today'`.

Period date boundaries (computed at query time in device local time):
- **Today:** `expense_date = CURRENT_DATE` / `sales.created_at >= today 00:00 local`
- **Week:** Monday of current week through today (ISO week; Syrian Saturday-start is configurable later)
- **Month:** First of current calendar month through today

### `useDashboardMetrics` composable

```ts
// Exposed API
revenueUsd: Ref<number>        // SUM(sales.total_usd) for period, shop-scoped
cogsUsd: Ref<number>           // SUM(sli.quantity × sli.unit_cost_usd) joined to sales for period
expensesUsd: Ref<number>       // SUM(expenses.amount_usd) for period
profitUsd: Ref<number>         // computed: revenueUsd - cogsUsd - expensesUsd
missingCostCount: Ref<number>  // COUNT(products WHERE (cost_price_usd = 0 OR cost_price_usd IS NULL) AND is_active = 1 AND deleted = 0)
load(): Promise<void>          // runs all queries for the current period
```

Performance: on-the-fly SQLite queries, no pre-aggregation. Acceptable for v1 volumes. `load()` is called on mount and whenever the period toggle changes.

### `useBestSellers` composable

```ts
items: Ref<BestSeller[]>   // up to 5 items: { nameAr, unitsSold, revenueUsd }
load(): Promise<void>
```

Query: joins `sale_line_items → sales → products`, filters by `shop_id` and period date range, groups by `product_id`, orders by `units_sold DESC, revenue DESC`, limit 5.

### `useExpenses` composable

```ts
expenses: Ref<Expense[]>
load(): Promise<void>                 // loads expenses for current period
save(data: NewExpense): Promise<void> // INSERT; sets sync_status='pending'
softDelete(id: string): Promise<void>
```

---

## Navigation & Home Screen Layout

No new routes needed for this wave. `HomePage.vue` is rewritten in-place at `/`.

**Home screen layout (phone, top to bottom):**

1. `AppHeader` — sync indicator, exchange rate widget (unchanged from Epic 1)
2. Greeting: "أهلاً 👋" + today's Arabic date
3. `StalenessBar` — visible only when offline >30 min since last sync
4. `PeriodToggle` — اليوم | الأسبوع | الشهر
5. Three `MetricCard`s stacked: Money in → Expenses → Profit
6. "إضافة مصروف" inline dashed button — opens `ExpenseForm` modal
7. `BestSellersCard` — top-5 sellers for current period
8. Low-stock card — from Epic 2 (`useLowStockAlerts`), wired in the existing `loadAlerts()` call
9. **Sticky bottom** — "بيع جديد" button (same as today, fixed position)

The low-stock card moves to position 8 (below best sellers). The existing Epic 2 low-stock wiring stays intact.

---

## Screens

### `MetricCard.vue`

Props: `label: string`, `amountUsd: number`, `syp: number`, `accent: 'blue' | 'orange' | 'green' | 'red' | 'gray'`, `warningCount?: number`

- USD value: large, bold, colored by accent
- Positive profit: green + "+" prefix
- Negative profit: red + "−" prefix
- Zero: gray, shows "$0.00"
- `warningCount` (profit card only): small amber badge "⚠ N منتج" — tapping navigates to `/products?filter=missing-cost`

### `PeriodToggle.vue`

Segmented control with three options. Imports `usePeriodToggle()` directly; no prop needed. Changing selection updates the singleton period ref only — it does NOT call `load()` directly.

`HomePage.vue` uses `watch(period, () => { metricsLoad(); sellersLoad() })` to react to period changes and reload all composables. This keeps `PeriodToggle` free of data-loading concerns.

### `BestSellersCard.vue`

Shows up to 5 ranked rows: rank badge (blue for #1, gray for others), Arabic product name, units sold, revenue in USD. Empty state: "لا توجد مبيعات في هذه الفترة" with icon. Tapping a product navigates to `/products/:id/edit`.

### `StalenessBar.vue`

Props: `lastSyncAt: string | null`. Shown only when offline AND `Date.now() - lastSyncAt > 30 minutes`. Displays: red dot + "آخر تحديث منذ X دقيقة". Disappears when back online and sync completes.

PowerSync does not expose a last-sync timestamp directly. `HomePage.vue` tracks this by writing `localStorage.setItem('lastSyncAt', new Date().toISOString())` whenever PowerSync's `db.status.connected` transitions from `false → true` or when `dataFlowStatus.downloading` transitions to `false`. `StalenessBar` reads this value.

### `ExpenseForm.vue`

Modal slide-up (bottom sheet on phone). Opens when the "Add expense" button is tapped.

Fields in order:
1. **Amount** (large numeric input, auto-focused on open)
2. **Currency toggle** USD / SYP — SYP shows "≈ X USD" below using current exchange rate
3. **Category chips** (`ExpenseCategoryChips.vue`) — predefined: إيجار / كهرباء / رواتب / بضاعة / صيانة / أخرى; selecting "أخرى" reveals a text input; custom categories saved and shown on future opens
4. **Date** (defaults today; date picker, backdatable 30 days, no future dates)
5. **Notes** (optional textarea)
6. **Photo** (optional; same compression logic as Epic 2 photos, max 500KB)

Buttons: Save (primary), Save & Add Another (secondary), Cancel.

`ExpenseForm` is stateless — it emits `saved` and `cancel`. `HomePage` controls the open/close ref.

### `ExpenseCategoryChips.vue`

Props: `modelValue: string`. Emits `update:modelValue`.

Predefined categories rendered as tappable chips. Custom categories are stored in `localStorage` and shown alongside predefined ones. Selecting "أخرى" shows a text field (required before save).

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Amount is 0 or empty on save | Red border on amount field + "أدخل المبلغ"; Save blocked |
| Category not selected | Chips highlight red + "اختر فئة"; Save blocked |
| "Other" category — text field empty | Error on text field; Save blocked |
| Date > today or > 30 days ago | Date picker restricts; manual entry resets to today |
| Expense photo too large to compress | Toast "تعذّر ضغط الصورة — حاول بصورة أخرى"; expense saves without photo |
| SYP selected, no exchange rate set | "حدد سعر الصرف أولاً" warning; SYP toggle disabled until rate set |
| 10%+ products missing cost price | Warning badge on profit card (non-blocking, informational) |
| Profit is negative | Red accent, "−" prefix — no alarm |
| Offline expense log | Saves locally, queues for sync, home screen updates optimistically |
| Period query returns 0 results | Cards show "$0.00", best sellers shows empty state |
| Staleness threshold | Banner appears at >30 min; disappears when online and synced |

---

## Offline Behaviour (Story 3.7)

- All queries run against local PowerSync SQLite — no server dependency
- `StalenessBar` reads PowerSync's last successful sync timestamp
- After a sale or expense saves locally, `load()` is called immediately (optimistic update within 1 second)
- When sync completes and data was stale, `StalenessBar` fades out

---

## Testing

| Test file | What it covers |
|---|---|
| `useDashboardMetrics.test.ts` | Revenue query, COGS (using unit_cost_usd), profit formula, missingCostCount, period date boundaries |
| `useBestSellers.test.ts` | Top-5 ranking, tie-breaking (units → revenue → name), empty period |
| `usePeriodToggle.test.ts` | Default 'today', toggle updates value, singleton shared |
| `useExpenses.test.ts` | INSERT USD and SYP (with conversion), load by period, softDelete |
| `ExpenseForm.test.ts` | Amount required, category required, SYP→USD display, `saved` emit, `cancel` emit |
| `MetricCard.test.ts` | Positive = green, negative = red, zero = gray; SYP secondary shown; warningCount badge |
| `usePayment.test.ts` (extend) | `unit_cost_usd` is written to `sale_line_items` on sale confirm |

---

## Out of Scope (this wave)

- Story 3.3 — Drill-down detail screens (sales list, expense list, profit breakdown)
- Story 3.6 — Cash drawer indicator (partial dependency on Epic 5 shifts)
- Pre-aggregated daily totals table (deferred; on-the-fly queries sufficient for v1)
- Number roll animation on period toggle (v1.5 polish)
- Owner WhatsApp digest (later v1)
- Saturday week start for Syrian convention (configurable in settings later)
- Expense approval workflow (v1.5)
- Photo OCR (v2)
