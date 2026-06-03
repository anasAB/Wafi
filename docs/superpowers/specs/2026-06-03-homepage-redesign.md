# Spec: إعادة تصميم الصفحة الرئيسية (الرئيسية)

**Date:** 2026-06-03  
**Status:** Approved  
**File:** `src/pages/HomePage.vue`  
**Route:** `/`

---

## Context

The current `HomePage.vue` is a phone-first, single-column Tailwind page with real data composables. The `DashboardPage.vue` (prototype, unrouted) has a dark sidebar layout using emerald green (`#00CC88`). A new mockup (`homePage.png`) shows a full dark SaaS dashboard with blue accents, KPI strip, area chart, health signals, and a sidebar.

This spec defines the complete redesign of `HomePage.vue` to match that mockup.

---

## Decisions

| Decision | Choice | Reason |
|---|---|---|
| Layout | Responsive — sidebar on desktop, bottom nav on mobile | Best of both: phone-first + desktop power |
| Accent color | Blue `#1A56DB` | Matches brand spec and mockup |
| Chart | Yes — Area chart for last 7 days | Full mockup match; adds real value |
| Chart library | ApexCharts (`vue3-apexcharts`) | Already common in Vue 3 ecosystem; supports RTL and dark themes natively |
| Data | Keep existing real composables | `useDashboardMetrics`, `useBestSellers`, `useCashDrawer`, etc. all stay |
| Dark background | `#06090F` main, `#070B14` sidebar, `#0D1828` cards | Matches design spec (Design_Spec_v2) |

---

## Color Tokens

| Token | Value | Usage |
|---|---|---|
| `--bg-main` | `#06090F` | Main content background |
| `--bg-sidebar` | `#070B14` | Sidebar background |
| `--bg-card` | `#0D1828` | Card backgrounds |
| `--accent` | `#1A56DB` | Primary interactive elements |
| `--accent-hover` | `#1D4ED8` | Button hover |
| `--accent-muted` | `rgba(26,86,219,.12)` | Card borders, tinted backgrounds |
| `--text-primary` | `#E8EDF5` | Headings, values |
| `--text-secondary` | `#C8D5E8` | Body text |
| `--text-muted` | `#637285` | Labels, subtitles |
| `--text-dim` | `#3D4F6B` | Section headers, timestamps |
| `--border` | `rgba(255,255,255,.06)` | Card borders |
| `--green` | `#22C55E` | Positive deltas, health signals |
| `--yellow` | `#F59E0B` | Warning signals |
| `--red` | `#EF4444` | Danger signals |

---

## Layout Structure

### Desktop (≥900px)

```
┌─────────────────────────────────────────┐
│  Sidebar (220px)  │  Main content        │
│                   │  ┌─ Topbar ─────┐   │
│  Brand            │  │ Greeting     │   │
│  Nav items        │  │ Rate pill    │   │
│  User footer      │  └──────────────┘   │
│                   │  ┌─ Body ───────┐   │
│                   │  │ Period row   │   │
│                   │  │ KPI strip    │   │
│                   │  │ Content row: │   │
│                   │  │  Chart+Table │ Signals+Feed │
│                   │  └──────────────┘   │
└─────────────────────────────────────────┘
```

- Sidebar: `position: sticky; height: 100svh` — scrolls with page content only
- Topbar: `position: sticky; top: 0` — stays fixed while body scrolls
- Content row: `grid-template-columns: 1fr 300px`

### Mobile (<900px)

```
┌──────────────────────┐
│ Header (shop + rate) │  sticky top
├──────────────────────┤
│ Greeting             │
│ Period toggle        │
│ KPI 2×2 grid         │
│ Sell button (full)   │
│ Mini chart           │
│ Health signals       │
│ Best sellers         │
│ Add expense          │
├──────────────────────┤
│ Bottom nav (4 items) │  sticky bottom
└──────────────────────┘
```

---

## Sections

### 1. Sidebar (desktop only)

- Brand: shop icon (emoji placeholder) + shop name + "وافي POS"
- Nav items with SVG Heroicons (no emoji icons):
  - لوحة التحكم (active on `/`)
  - نقطة البيع → `/pos`
  - سجل المبيعات → `/history`
  - _(section header: الإدارة)_
  - المخزون → `/products`
  - الزبائن → `/customers`
  - التقارير → `/history`
  - المصاريف → `/expenses`
- Footer: user avatar (initials) + name + role
- Width: 220px, `border-left` in RTL

### 2. Topbar (desktop) / Header (mobile)

- Desktop: greeting text + date on the right, actions on the left
- Mobile: shop name pill on the right, rate pill + bell on the left
- Rate pill: shows `$١ = X ل.س`, opens `ExchangeRateEditor` on click
- Bell: shows red dot when `hasAlerts` is true

### 3. Period toggle

- Three options: اليوم / الأسبوع / الشهر
- Active tab gets `background: #1A56DB`
- Drives all metrics and chart data

### 4. KPI strip

Four cards in a row (desktop) or 2×2 grid (mobile):

| Card | Data source | Delta |
|---|---|---|
| المال الداخل | `metrics.revenueUsd` | vs previous period |
| الربح الإجمالي | `metrics.profitUsd` + margin % | vs previous period |
| الفواتير | `metrics.invoiceCount` — **new field** to add to `useDashboardMetrics` via `COUNT(*)` on sales table | avg per invoice |
| النقد في الصندوق | `drawer.cashUsd` | last reconciliation time |

- Delta colors: green for positive, red for negative
- Values: USD primary, SYP secondary (using `currentRate`)

### 5. Sell button

- Full-width on mobile, inline in topbar area on desktop
- Blue `#1A56DB`, large, prominent
- Disabled + warning when `currentRate === null`

### 6. Area Chart — آخر ٧ أيام

- Library: `vue3-apexcharts`
- Two series: المبيعات (blue `#1A56DB`) and الربح (green `#22C55E`)
- Type: `area` with gradient fill, smooth curves
- X axis: last 7 day names in Arabic (RTL)
- Dark theme: transparent background, grid lines `rgba(255,255,255,.05)`
- Data: new composable `useSalesChart()` querying daily sales totals for last 7 days
- Desktop: full height ~180px. Mobile: compact ~100px

### 7. Best sellers table

- Columns: rank, product name, sale count, profit value
- Data: `useBestSellers()` composable (already exists)
- Max 3 rows on desktop, 3 rows on mobile
- Badge label: "حسب الربح"

### 8. Health signals panel (desktop right / mobile below chart)

Four signal types with colored dots:
- 🟡 Low stock: count + top 3 names (from `useLowStockAlerts`)
- 🔴 Customer over credit limit (from customers data — new query)
- 🟢 Margin trending up/down (derived from metrics)
- 🟢 Cash variance (from `useCashDrawer`)

Each signal is tappable and navigates to the relevant page.

### 9. Live activity feed (desktop only, right column)

- Last 3-5 sales from `useSaleHistory().loadHistory()` (already exists, default loads last 7 days — filter to last few hours in component) with: `totalUsd`, `paymentMethod`, `createdAt`
- Green pulsing dot "النشاط المباشر" header
- Not shown on mobile (too dense)

### 10. Add expense button

- Dashed border, blue tint
- Opens `ExpenseForm` sheet (same as current behavior)
- Shows on both desktop and mobile

### 11. Bottom nav (mobile only)

Four items: الرئيسية, المخزون, الزبائن, التقارير  
Active item: `#1A56DB`, inactive: `#364A66`

---

## New Composables Needed

| Composable | Purpose |
|---|---|
| `useSalesChart()` | Returns last 7 days daily totals: `{ labels: string[], sales: number[], profit: number[] }`. Queries `sales` and `sale_line_items` grouped by `DATE(created_at, 'localtime')`. |
| `useDashboardMetrics` — add `invoiceCount` | Add `SELECT COUNT(*) as count FROM sales ...` to existing parallel query block |
| Customer over-limit check | Derived inside component from existing customers data — no new composable |

---

## Components to Create / Modify

| File | Change |
|---|---|
| `src/pages/HomePage.vue` | **Full rewrite** — new layout, new sections, ApexCharts |
| `src/features/dashboard/composables/useSalesChart.ts` | **New** — last 7 days chart data |

All existing composables (`useDashboardMetrics`, `useBestSellers`, `useCashDrawer`, `useLowStockAlerts`, `usePeriodToggle`, `useExchangeRate`) are kept as-is.

---

## New Dependency

```
vue3-apexcharts + apexcharts
```

Install: `npm install vue3-apexcharts apexcharts`  
Register globally in `main.ts` or locally in `HomePage.vue`.

---

## What Does NOT Change

- All existing composables and their logic
- Router configuration
- `AppDialog`, `ExpenseForm`, `ProfitSheet`, `CashDrawerSheet` modals (still used)
- `AppToast` (still used)
- Offline/sync behavior (`StalenessBar` is removed from the new design — its content is absorbed into the topbar bell/status)

---

## Responsive Breakpoint

- `< 900px` → mobile layout (bottom nav, no sidebar, stacked cards)
- `≥ 900px` → desktop layout (sidebar, topbar, multi-column)

Implemented via `@media (min-width: 900px)` in scoped CSS (consistent with existing `DashboardPage.vue` pattern).

---

## RTL Notes

- `direction: rtl` on the shell
- Sidebar appears on the RIGHT in RTL (first in DOM, `border-left`)
- Chevron arrows and icons that have directionality must use `rtl:rotate-180` or be replaced with symmetric icons
- Chart x-axis labels right-to-left (today on the right)
- Money values: `direction: ltr; text-align: right` inside RTL containers
