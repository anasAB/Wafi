# Profit Report Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dedicated `/reports` screen where the owner reviews profit over Week / Month / Quarter / custom range — headline verdict, a green/red profit trend chart, and a plain-language breakdown — making the +$5 Reporting Pack sellable.

**Architecture:** Reuse the Tier-1-verified profit engine (`useDashboardMetrics`) by extending it to accept an explicit date range; add a new `useProfitTrend(start, end, bucket)` that nets refunds + restocked-COGS reversal + expenses per bucket so the bars sum to the headline. A new `ReportsPage.vue` holds its own period state (not the shared `usePeriodToggle` singleton) and renders a `ProfitTrendChart.vue` (ApexCharts bar, colored by profit sign). Wire the existing empty `reports` nav entry to the new route.

**Tech Stack:** Vue 3 + TypeScript, Pinia, PowerSync (local SQLite), vue-i18n (Arabic-primary), vue3-apexcharts, Vitest + @vue/test-utils.

**Spec:** `docs/superpowers/specs/2026-06-23-profit-report-design.md` (approved; decisions locked there).

## Global Constraints

- **Reuse the verified profit engine.** No second profit calculation: revenue (net of refunds), COGS (with restocked reversal), expenses, and the missing-cost caveat all come from `useDashboardMetrics`. The trend composable must use the identical netting SQL shape.
- **Bars sum to the headline.** For any range, the trend buckets' profit must sum to `useDashboardMetrics`' profit for that same range. This is a required test (it's the bug Tier-1 fixed — two surfaces disagreeing).
- **Local-time date boundaries.** Bucket and range by `DATE(created_at, 'localtime')` exactly as `useDashboardMetrics`/`useSalesChart` do, so a late-night sale lands on the right day. Expenses bucket by `expense_date`.
- **Offline-first.** All queries run against the local DB; the screen works offline.
- **Arabic-primary, RTL; plain shop-owner language.** "ربح" / "دخل" / "تكلفة البضاعة" / "مصاريف" — not accounting jargon.
- **Permission gate:** `can_view_reports` (owner + a reports-granted manager). Cashier cannot reach `/reports`. Matches the existing nav gating and WAFI-058.
- **Do NOT mutate the shared `usePeriodToggle` singleton.** The Reports screen owns its own period state; range resolution lives in `periodUtils`.
- **Test commands:** single file `npx vitest run <path>`; full suite `npm run test`; type gate `npm run build`.

## Out of scope (deferred to Reports v2 per the spec)

Imported-history / multi-year profit (depends on the not-yet-built Import feature capturing per-sale cost + rate), P&L export/PDF, best-sellers (home dashboard already has it), pre-aggregation, advanced multi-metric charts. Do not build these.

---

### Task 1: Report period type + range/bucket resolvers

**Files:**
- Modify: `src/features/dashboard/composables/periodUtils.ts`
- Test: `src/features/dashboard/composables/__tests__/periodUtils.report.test.ts`

**Interfaces:**
- Produces: `ReportPeriod` (`'week' | 'month' | 'quarter' | 'custom'`); `getReportRange(period, customStart?, customEnd?): { start: string; end: string }`; `bucketForRange(start, end): 'day' | 'month'`. All consumed by Task 3 and Task 5.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/dashboard/composables/__tests__/periodUtils.report.test.ts
import { describe, it, expect } from 'vitest'
import { getReportRange, bucketForRange } from '../periodUtils'

describe('getReportRange', () => {
  it('quarter spans the last 3 calendar months through today', () => {
    const { start, end } = getReportRange('quarter')
    // start is the 1st of (current month - 2); end is today. Both YYYY-MM-DD.
    expect(start).toMatch(/^\d{4}-\d{2}-01$/)
    expect(end).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(start < end).toBe(true)
  })

  it('custom returns the provided range verbatim', () => {
    const { start, end } = getReportRange('custom', '2026-01-01', '2026-03-31')
    expect(start).toBe('2026-01-01')
    expect(end).toBe('2026-03-31')
  })

  it('week and month resolve to a valid start<=end range', () => {
    for (const p of ['week', 'month'] as const) {
      const { start, end } = getReportRange(p)
      expect(start <= end).toBe(true)
    }
  })
})

describe('bucketForRange', () => {
  it('uses day buckets for short ranges (<= 62 days)', () => {
    expect(bucketForRange('2026-06-01', '2026-06-30')).toBe('day')
  })
  it('uses month buckets for long ranges (> 62 days)', () => {
    expect(bucketForRange('2026-01-01', '2026-06-30')).toBe('month')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/dashboard/composables/__tests__/periodUtils.report.test.ts`
Expected: FAIL — `getReportRange` / `bucketForRange` not exported.

- [ ] **Step 3: Implement (append to `periodUtils.ts`)**

```ts
export type ReportPeriod = 'week' | 'month' | 'quarter' | 'custom'

// Reuses the file's existing private toDateStr(d). Quarter = the last 3 calendar
// months: 1st of (current month − 2) through today. Custom echoes the inputs.
export function getReportRange(
  period: ReportPeriod,
  customStart?: string,
  customEnd?: string,
): { start: string; end: string } {
  if (period === 'custom') {
    return { start: customStart ?? '', end: customEnd ?? '' }
  }
  if (period === 'week' || period === 'month') {
    // Delegate to the existing day-of-week / 1st-of-month logic.
    return getDateRange(period)
  }
  // quarter
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - 2, 1)
  return { start: toDateStr(start), end: toDateStr(now) }
}

// Day buckets stay readable up to ~2 months; longer ranges (quarter, long custom)
// switch to monthly buckets so the chart doesn't render 90+ bars on a cheap phone.
export function bucketForRange(start: string, end: string): 'day' | 'month' {
  const [sy, sm, sd] = start.split('-').map(Number)
  const [ey, em, ed] = end.split('-').map(Number)
  const from = new Date(sy, (sm ?? 1) - 1, sd ?? 1)
  const to   = new Date(ey, (em ?? 1) - 1, ed ?? 1)
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000)
  return days > 62 ? 'month' : 'day'
}
```

> Note: `getDateRange` and `toDateStr` already exist in this file; reuse them (don't redefine).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/dashboard/composables/__tests__/periodUtils.report.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/composables/periodUtils.ts src/features/dashboard/composables/__tests__/periodUtils.report.test.ts
git commit -m "feat(reports): report-period range + bucket resolvers"
```

---

### Task 2: Extend `useDashboardMetrics` with an explicit-range loader

**Files:**
- Modify: `src/features/dashboard/composables/useDashboardMetrics.ts`
- Test: `src/__tests__/features/useDashboardMetricsRange.test.ts`

**Interfaces:**
- Consumes: existing `useDashboardMetrics` query body.
- Produces: `useDashboardMetrics()` returns a new `loadRange(start: string, end: string): Promise<void>` alongside the existing `load(period)`. Both populate the same refs (`revenueUsd`, `cogsUsd`, `expensesUsd`, `profitUsd`, `costlessSalesInPeriod`, `profitIsEstimated`, …).

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/features/useDashboardMetricsRange.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useDashboardMetrics } from '@/features/dashboard/composables/useDashboardMetrics'
import { db } from '@/data/powersync/db'

describe('useDashboardMetrics.loadRange', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('runs the metric queries against the passed start/end and computes profit', async () => {
    // revenue 500, cogs 200, expenses 50 → profit 250; one costless sale → estimated.
    vi.mocked(db.getOptional).mockImplementation(async (sql: string) => {
      if (/SUM\(total_usd\)/.test(sql))            return { total: 500 } as any
      if (/as cogs/.test(sql) && /sale_line_items/.test(sql) && !/return/.test(sql)) return { cogs: 200 } as any
      if (/FROM expenses/.test(sql))               return { total: 50 } as any
      if (/FROM returns/.test(sql))                return { total: 0 } as any
      if (/return_line_items/.test(sql))           return { cogs: 0 } as any
      if (/FROM products/.test(sql))               return { count: 0 } as any
      if (/COUNT\(\*\) as count FROM sales/.test(sql)) return { count: 7 } as any
      if (/EXISTS/.test(sql))                      return { count: 1 } as any
      return { total: 0 } as any
    })

    const m = useDashboardMetrics()
    await m.loadRange('2026-04-01', '2026-06-30')

    expect(m.revenueUsd.value).toBe(500)
    expect(m.profitUsd.value).toBe(250)     // 500 - 200 - 50
    expect(m.profitIsEstimated.value).toBe(true)

    // every range-bounded query received the explicit start/end as params
    const revCall = vi.mocked(db.getOptional).mock.calls.find(c => /SUM\(total_usd\)/.test(c[0] as string))
    expect(revCall![1]).toEqual(expect.arrayContaining(['2026-04-01', '2026-06-30']))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/useDashboardMetricsRange.test.ts`
Expected: FAIL — `loadRange` is not a function.

- [ ] **Step 3: Refactor `useDashboardMetrics` to split range resolution from the queries**

Rename the body of `load` into a private `run(start, end)`, and make both `load` (period) and the new `loadRange` call it:

```ts
  async function run(start: string, end: string) {
    // ... the existing Promise.all query block and the ref assignments,
    //     unchanged except that `start`/`end` are parameters (delete the
    //     `const { start, end } = getDateRange(period)` line) ...
  }

  async function load(period: Period) {
    const { start, end } = getDateRange(period)
    await run(start, end)
  }

  async function loadRange(start: string, end: string) {
    await run(start, end)
  }
```

Add `loadRange` to the returned object.

- [ ] **Step 4: Run test + the existing dashboard tests to verify all pass**

Run: `npx vitest run src/__tests__/features/useDashboardMetricsRange.test.ts`
Then: `npx vitest run src/__tests__/features/usePeriodToggle.test.ts`
Expected: PASS (existing `load(period)` behaviour unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/composables/useDashboardMetrics.ts src/__tests__/features/useDashboardMetricsRange.test.ts
git commit -m "feat(reports): add explicit-range loader to useDashboardMetrics"
```

---

### Task 3: `useProfitTrend` composable (bars that sum to the headline)

**Files:**
- Create: `src/features/dashboard/composables/useProfitTrend.ts`
- Test: `src/__tests__/features/useProfitTrend.test.ts`

**Interfaces:**
- Consumes: `db`, `useDeviceStore`.
- Produces: `useProfitTrend()` → `{ points: Ref<ProfitTrendPoint[]>, load(start, end, bucket): Promise<void> }`, where `ProfitTrendPoint = { label: string; profitUsd: number }`. Each bucket's profit = revenue − refunds − (COGS − restocked-COGS reversal) − expenses. Buckets sum to `useDashboardMetrics` profit for the same range.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/features/useProfitTrend.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useProfitTrend } from '@/features/dashboard/composables/useProfitTrend'
import { db } from '@/data/powersync/db'

describe('useProfitTrend', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('nets refunds, restocked COGS, and expenses per day bucket', async () => {
    // Day 06-01: sales 100, cogs 40, expenses 10 → profit 50
    // Day 06-02: sales 200, cogs 80, refund 20, reversal 8, expenses 0 → (200-20)-(80-8)-0 = 108
    vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
      if (/FROM sales\b/.test(sql) && /total_usd/.test(sql))
        return [{ day: '2026-06-01', total: 100 }, { day: '2026-06-02', total: 200 }] as any
      if (/sale_line_items/.test(sql) && !/return/.test(sql))
        return [{ day: '2026-06-01', cogs: 40 }, { day: '2026-06-02', cogs: 80 }] as any
      if (/FROM returns/.test(sql) && /refund_amount_usd/.test(sql))
        return [{ day: '2026-06-02', total: 20 }] as any
      if (/return_line_items/.test(sql))
        return [{ day: '2026-06-02', cogs: 8 }] as any
      if (/FROM expenses/.test(sql))
        return [{ day: '2026-06-01', total: 10 }] as any
      return [] as any
    })

    const t = useProfitTrend()
    await t.load('2026-06-01', '2026-06-02', 'day')

    const byLabel = Object.fromEntries(t.points.value.map(p => [p.label, p.profitUsd]))
    expect(byLabel['1/6']).toBe(50)
    expect(byLabel['2/6']).toBe(108)
    // bars sum to the period profit (50 + 108 = 158)
    expect(t.points.value.reduce((s, p) => s + p.profitUsd, 0)).toBe(158)
  })

  it('groups by month when bucket is month', async () => {
    vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
      if (/FROM sales\b/.test(sql) && /total_usd/.test(sql))
        return [{ day: '2026-04', total: 300 }, { day: '2026-05', total: 100 }] as any
      if (/sale_line_items/.test(sql) && !/return/.test(sql))
        return [{ day: '2026-04', cogs: 100 }] as any
      return [] as any
    })
    const t = useProfitTrend()
    await t.load('2026-04-01', '2026-05-31', 'month')
    const byLabel = Object.fromEntries(t.points.value.map(p => [p.label, p.profitUsd]))
    expect(byLabel['2026-04']).toBe(200)   // 300 - 100
    expect(byLabel['2026-05']).toBe(100)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/useProfitTrend.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/features/dashboard/composables/useProfitTrend.ts
import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

export interface ProfitTrendPoint { label: string; profitUsd: number }

// SQLite bucket expression per granularity. Sales/returns bucket on created_at
// (local time); expenses on their expense_date (already a 'YYYY-MM-DD' string).
function bucketExpr(col: string, bucket: 'day' | 'month', isExpenseDate = false): string {
  if (isExpenseDate) {
    return bucket === 'month' ? `substr(${col}, 1, 7)` : col
  }
  return bucket === 'month'
    ? `strftime('%Y-%m', ${col}, 'localtime')`
    : `DATE(${col}, 'localtime')`
}

function dayLabel(key: string, bucket: 'day' | 'month'): string {
  if (bucket === 'month') return key                       // '2026-04'
  const [y, m, d] = key.split('-').map(Number)
  return `${d}/${m}`                                       // '1/6'
}

export function useProfitTrend() {
  const device = useDeviceStore()
  const points = ref<ProfitTrendPoint[]>([])

  async function load(start: string, end: string, bucket: 'day' | 'month') {
    const sb = bucketExpr('created_at', bucket)
    const sbS = bucketExpr('s.created_at', bucket)
    const sbR = bucketExpr('r.created_at', bucket)
    const eb = bucketExpr('expense_date', bucket, true)

    const [salesRows, cogsRows, refundRows, reversalRows, expenseRows] = await Promise.all([
      db.getAll<{ day: string; total: number }>(
        `SELECT ${sb} as day, COALESCE(SUM(total_usd), 0) as total
         FROM sales WHERE shop_id = ? AND DATE(created_at, 'localtime') BETWEEN ? AND ?
         GROUP BY day`, [device.shopId, start, end]),
      db.getAll<{ day: string; cogs: number }>(
        `SELECT ${sbS} as day, COALESCE(SUM(sli.quantity * COALESCE(sli.unit_cost_usd, 0)), 0) as cogs
         FROM sale_line_items sli JOIN sales s ON sli.sale_id = s.id
         WHERE s.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
         GROUP BY day`, [device.shopId, start, end]),
      db.getAll<{ day: string; total: number }>(
        `SELECT ${sb} as day, COALESCE(SUM(refund_amount_usd), 0) as total
         FROM returns WHERE shop_id = ? AND DATE(created_at, 'localtime') BETWEEN ? AND ?
         GROUP BY day`, [device.shopId, start, end]),
      // Same per-(sale, product) cost dedup as useDashboardMetrics/useSalesChart (WAFI-005).
      db.getAll<{ day: string; cogs: number }>(
        `SELECT ${sbR} as day, COALESCE(SUM(rli.qty_returned * COALESCE(c.unit_cost_usd, 0)), 0) as cogs
         FROM return_line_items rli JOIN returns r ON r.id = rli.return_id
         LEFT JOIN (
           SELECT sale_id, product_id, AVG(unit_cost_usd) as unit_cost_usd
           FROM sale_line_items GROUP BY sale_id, product_id
         ) c ON c.sale_id = r.original_sale_id AND c.product_id = rli.product_id
         WHERE r.shop_id = ? AND rli.restock = 1 AND DATE(r.created_at, 'localtime') BETWEEN ? AND ?
         GROUP BY day`, [device.shopId, start, end]),
      db.getAll<{ day: string; total: number }>(
        `SELECT ${eb} as day, COALESCE(SUM(amount_usd), 0) as total
         FROM expenses WHERE shop_id = ? AND expense_date BETWEEN ? AND ?
         GROUP BY day`, [device.shopId, start, end]),
    ])

    const salesMap    = new Map(salesRows.map(r => [r.day, r.total]))
    const cogsMap     = new Map(cogsRows.map(r => [r.day, r.cogs]))
    const refundMap   = new Map(refundRows.map(r => [r.day, r.total]))
    const reversalMap = new Map(reversalRows.map(r => [r.day, r.cogs]))
    const expenseMap  = new Map(expenseRows.map(r => [r.day, r.total]))

    const keys = Array.from(new Set([
      ...salesMap.keys(), ...cogsMap.keys(), ...refundMap.keys(),
      ...reversalMap.keys(), ...expenseMap.keys(),
    ])).sort()

    points.value = keys.map(k => {
      const rev  = (salesMap.get(k) ?? 0) - (refundMap.get(k) ?? 0)
      const cogs = (cogsMap.get(k)  ?? 0) - (reversalMap.get(k) ?? 0)
      const exp  = expenseMap.get(k) ?? 0
      return { label: dayLabel(k, bucket), profitUsd: rev - cogs - exp }   // no clamp — losses show negative
    })
  }

  return { points, load }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/useProfitTrend.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/composables/useProfitTrend.ts src/__tests__/features/useProfitTrend.test.ts
git commit -m "feat(reports): profit-trend composable (nets refunds/COGS-reversal/expenses)"
```

---

### Task 4: `ProfitTrendChart.vue` (green/red bars)

**Files:**
- Create: `src/features/dashboard/components/ProfitTrendChart.vue`
- Test: `src/__tests__/features/ProfitTrendChart.test.ts`

**Interfaces:**
- Consumes: `ProfitTrendPoint` (Task 3).
- Produces: presentational component. Prop: `points: ProfitTrendPoint[]`. Renders a `vue3-apexcharts` bar chart; negative bars red, positive green.

- [ ] **Step 1: Write the failing test** (stub ApexCharts; assert the series + categories passed to it)

```ts
// src/__tests__/features/ProfitTrendChart.test.ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ProfitTrendChart from '@/features/dashboard/components/ProfitTrendChart.vue'

const ApexStub = {
  name: 'apexchart',
  props: ['type', 'height', 'series', 'options'],
  template: '<div data-test="apex" />',
}

function mountChart(points: { label: string; profitUsd: number }[]) {
  return mount(ProfitTrendChart, {
    props: { points },
    global: { stubs: { apexchart: ApexStub, VueApexCharts: ApexStub } },
  })
}

describe('ProfitTrendChart', () => {
  it('passes labels and profit values to the chart', () => {
    const w = mountChart([{ label: '1/6', profitUsd: 50 }, { label: '2/6', profitUsd: -20 }])
    const apex = w.findComponent(ApexStub)
    expect(apex.props('series')[0].data).toEqual([50, -20])
    expect(apex.props('options').xaxis.categories).toEqual(['1/6', '2/6'])
  })

  it('configures a color range so negatives are red and positives green', () => {
    const w = mountChart([{ label: '1/6', profitUsd: 50 }])
    const apex = w.findComponent(ApexStub)
    const ranges = apex.props('options').plotOptions.bar.colors.ranges
    const neg = ranges.find((r: any) => r.to <= 0)
    const pos = ranges.find((r: any) => r.from >= 0)
    expect(neg.color.toUpperCase()).toContain('EF4444')   // red
    expect(pos.color.toUpperCase()).toContain('22C55E')   // green
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/ProfitTrendChart.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement**

```vue
<!-- src/features/dashboard/components/ProfitTrendChart.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import VueApexCharts from 'vue3-apexcharts'
import type { ProfitTrendPoint } from '../composables/useProfitTrend'

const props = defineProps<{ points: ProfitTrendPoint[] }>()

const series = computed(() => [{ name: 'الربح', data: props.points.map(p => p.profitUsd) }])

const options = computed(() => ({
  chart: { type: 'bar', background: 'transparent', toolbar: { show: false } },
  plotOptions: {
    bar: {
      borderRadius: 4,
      // Color each bar by value sign: loss = red, profit = green.
      colors: { ranges: [
        { from: -1e12, to: 0,    color: '#EF4444' },
        { from: 0,     to: 1e12, color: '#22C55E' },
      ] },
    },
  },
  dataLabels: { enabled: false },
  xaxis: { categories: props.points.map(p => p.label) },
  tooltip: { theme: 'dark', y: { formatter: (v: number) => `$${v.toFixed(2)}` } },
  grid: { borderColor: 'rgba(255,255,255,0.06)' },
}))
</script>

<template>
  <VueApexCharts type="bar" :height="180" :series="series" :options="options" />
</template>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/ProfitTrendChart.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/components/ProfitTrendChart.vue src/__tests__/features/ProfitTrendChart.test.ts
git commit -m "feat(reports): profit-trend bar chart component"
```

---

### Task 5: `ReportsPage.vue` (the screen)

**Files:**
- Create: `src/features/dashboard/components/ReportsPage.vue`
- Modify: `src/i18n/ar.ts` and `src/i18n/en.ts` (report screen strings)
- Test: `src/__tests__/features/ReportsPage.test.ts`

**Interfaces:**
- Consumes: `getReportRange`, `bucketForRange` (Task 1); `useDashboardMetrics().loadRange` (Task 2); `useProfitTrend` (Task 3); `ProfitTrendChart` (Task 4).
- Produces: the route component. Holds local period state (`ReportPeriod` + custom start/end). On period change: resolve range → `loadRange` + `useProfitTrend.load(range, bucket)`. Renders headline verdict, breakdown, caveat, empty state, inverted-range guard.

- [ ] **Step 1: Add i18n keys**

In `src/i18n/ar.ts` add a `reports` block (and the English mirror in `en.ts`):

```ts
  reports: {
    title: 'تقرير الأرباح',
    week: 'أسبوع', month: 'شهر', quarter: '٣ أشهر', custom: 'مخصص',
    profit: 'الربح', moneyIn: 'الدخل', cogs: 'تكلفة البضاعة', expenses: 'المصاريف',
    profitVerb: 'ربحت', lossVerb: 'خسرت',
    empty: 'لا توجد مبيعات في هذه الفترة',
    estimated: 'بعض المنتجات بلا تكلفة — الربح تقديري وقد يكون أقل',
    invalidRange: 'تاريخ البداية يجب أن يكون قبل تاريخ النهاية',
    from: 'من', to: 'إلى',
  },
```

- [ ] **Step 2: Write the failing test**

```ts
// src/__tests__/features/ReportsPage.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { mount, flushPromises } from '@vue/test-utils'
import { i18n } from '@/i18n'
import { db } from '@/data/powersync/db'
import ReportsPage from '@/features/dashboard/components/ReportsPage.vue'

const ApexStub = { name: 'apexchart', props: ['type','height','series','options'], template: '<div/>' }

function mountPage() {
  return mount(ReportsPage, {
    global: {
      plugins: [i18n],
      stubs: { apexchart: ApexStub, VueApexCharts: ApexStub, RouterLink: true },
    },
  })
}

describe('ReportsPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([] as any)
  })

  it('shows the profit headline for the default period', async () => {
    vi.mocked(db.getOptional).mockImplementation(async (sql: string) => {
      if (/SUM\(total_usd\)/.test(sql)) return { total: 500 } as any
      if (/as cogs/.test(sql) && /sale_line_items/.test(sql) && !/return/.test(sql)) return { cogs: 200 } as any
      if (/FROM expenses/.test(sql))    return { total: 50 } as any
      if (/COUNT\(\*\) as count FROM sales/.test(sql)) return { count: 7 } as any
      return { total: 0, cogs: 0, count: 0 } as any
    })
    const w = mountPage()
    await flushPromises()
    expect(w.text()).toContain('250')             // profit headline 500-200-50
  })

  it('shows the empty state when the period has no sales', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ total: 0, cogs: 0, count: 0 } as any)
    const w = mountPage()
    await flushPromises()
    expect(w.text()).toContain('لا توجد مبيعات في هذه الفترة')
  })

  it('rejects an inverted custom range (start > end) without querying', async () => {
    const w = mountPage()
    await flushPromises()
    await w.get('[data-test="period-custom"]').trigger('click')
    await w.get('[data-test="custom-start"]').setValue('2026-06-30')
    await w.get('[data-test="custom-end"]').setValue('2026-06-01')
    await flushPromises()
    expect(w.get('[data-test="range-error"]').exists()).toBe(true)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/ReportsPage.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 4: Implement**

```vue
<!-- src/features/dashboard/components/ReportsPage.vue -->
<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { getReportRange, bucketForRange } from '../composables/periodUtils'
import type { ReportPeriod } from '../composables/periodUtils'
import { useDashboardMetrics } from '../composables/useDashboardMetrics'
import { useProfitTrend } from '../composables/useProfitTrend'
import ProfitTrendChart from './ProfitTrendChart.vue'

const { t } = useI18n()
const metrics = useDashboardMetrics()
const trend   = useProfitTrend()

const period      = ref<ReportPeriod>('month')
const customStart = ref('')
const customEnd   = ref('')

const rangeError = computed(() =>
  period.value === 'custom'
  && customStart.value && customEnd.value
  && customStart.value > customEnd.value)

const isCustomIncomplete = computed(() =>
  period.value === 'custom' && (!customStart.value || !customEnd.value))

const hasSales = computed(() => metrics.invoiceCount.value > 0)

async function reload() {
  if (rangeError.value || isCustomIncomplete.value) return
  const { start, end } = getReportRange(period.value, customStart.value, customEnd.value)
  if (!start || !end) return
  await Promise.all([
    metrics.loadRange(start, end),
    trend.load(start, end, bucketForRange(start, end)),
  ])
}

function selectPeriod(p: ReportPeriod) { period.value = p }

watch([period, customStart, customEnd], reload)
onMounted(reload)
</script>

<template>
  <section class="reports-page" dir="rtl">
    <h1>{{ t('reports.title') }}</h1>

    <div class="period-toggle">
      <button data-test="period-week"    :class="{ active: period === 'week' }"    @click="selectPeriod('week')">{{ t('reports.week') }}</button>
      <button data-test="period-month"   :class="{ active: period === 'month' }"   @click="selectPeriod('month')">{{ t('reports.month') }}</button>
      <button data-test="period-quarter" :class="{ active: period === 'quarter' }" @click="selectPeriod('quarter')">{{ t('reports.quarter') }}</button>
      <button data-test="period-custom"  :class="{ active: period === 'custom' }"  @click="selectPeriod('custom')">{{ t('reports.custom') }}</button>
    </div>

    <div v-if="period === 'custom'" class="custom-range">
      <label>{{ t('reports.from') }} <input data-test="custom-start" type="date" v-model="customStart" /></label>
      <label>{{ t('reports.to') }} <input data-test="custom-end" type="date" v-model="customEnd" /></label>
      <p v-if="rangeError" data-test="range-error" class="warn">{{ t('reports.invalidRange') }}</p>
    </div>

    <template v-if="!rangeError && !isCustomIncomplete">
      <div v-if="hasSales" class="report-body">
        <div class="headline" :class="metrics.profitUsd.value >= 0 ? 'pos' : 'neg'">
          <span class="verb">{{ metrics.profitUsd.value >= 0 ? t('reports.profitVerb') : t('reports.lossVerb') }}</span>
          <span class="amount" data-test="profit-headline">${{ Math.abs(metrics.profitUsd.value).toFixed(2) }}</span>
        </div>

        <p v-if="metrics.profitIsEstimated.value" class="caveat">{{ t('reports.estimated') }}</p>

        <ProfitTrendChart :points="trend.points.value" />

        <ul class="breakdown">
          <li>{{ t('reports.moneyIn') }}<span>${{ metrics.revenueUsd.value.toFixed(2) }}</span></li>
          <li>− {{ t('reports.cogs') }}<span>${{ metrics.cogsUsd.value.toFixed(2) }}</span></li>
          <li>− {{ t('reports.expenses') }}<span>${{ metrics.expensesUsd.value.toFixed(2) }}</span></li>
          <li class="total">= {{ t('reports.profit') }}<span>${{ metrics.profitUsd.value.toFixed(2) }}</span></li>
        </ul>
      </div>

      <p v-else data-test="empty" class="empty">{{ t('reports.empty') }}</p>
    </template>
  </section>
</template>
```

> Styling: match the design system (glass card `#0D1828`, brand blue `#1A56DB`); keep the `data-test` hooks.

- [ ] **Step 5: Run test + type gate**

Run: `npx vitest run src/__tests__/features/ReportsPage.test.ts`
Then: `npm run build`
Expected: PASS; build clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/dashboard/components/ReportsPage.vue src/i18n/ar.ts src/i18n/en.ts src/__tests__/features/ReportsPage.test.ts
git commit -m "feat(reports): profit report screen (period, headline, breakdown, trend)"
```

---

### Task 6: Route + nav wiring + permission gate

**Files:**
- Modify: `src/router/index.ts` (add `/reports` route, gated by `can_view_reports`)
- Modify: `src/components/layout/AppSidebar.vue` (give the `reports` nav item `href: '/reports'`)
- Modify: `src/components/layout/AppBottomNav.vue` if it carries a reports entry (mirror the href)
- Test: `src/__tests__/router/reports.permission.test.ts`

**Interfaces:**
- Consumes: `ReportsPage.vue` (Task 5); existing `isRouteAllowed` / `canUserDo` (router/permissions.ts).
- Produces: a reachable, permission-gated `/reports` route and a live nav link.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/router/reports.permission.test.ts
import { describe, it, expect } from 'vitest'
import { canUserDo } from '@/router/permissions'
import type { Staff } from '@/features/staff/staff.types'

const cashier = { id: 'c', name: 'كاشير', role: 'cashier',
  permissions: { can_view_reports: false } } as unknown as Staff
const owner = { id: 'o', name: 'مالك', role: 'owner', permissions: {} } as unknown as Staff

describe('/reports permission', () => {
  it('owner may view reports', () => {
    expect(canUserDo(owner, 'can_view_reports')).toBe(true)
  })
  it('a cashier without can_view_reports may not', () => {
    expect(canUserDo(cashier, 'can_view_reports')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails or passes-trivially**

Run: `npx vitest run src/__tests__/router/reports.permission.test.ts`
Expected: PASS already if `canUserDo` behaves — this locks the gate behaviour. (If the existing `permissions.test.ts` already covers `can_view_reports`, keep this as the reports-specific guard.)

- [ ] **Step 3: Add the route**

In `src/router/index.ts`, add alongside the other routes:

```ts
    { path: '/reports', component: () => import('@/features/dashboard/components/ReportsPage.vue'), meta: { permission: 'can_view_reports' } },
```

- [ ] **Step 4: Wire the nav link**

In `src/components/layout/AppSidebar.vue`, change the `reports` entry's `href` from `null` to `'/reports'`:

```ts
  { key: 'reports',     labelKey: 'nav.reports',    href: '/reports',        permission: 'can_view_reports' },
```

(The sidebar already filters out `href: null` items and renders an icon for `reports`, so it appears automatically once the href is set.) If `AppBottomNav.vue` has a reports entry, set its href the same way.

- [ ] **Step 5: Run the test, full suite, and type gate**

Run: `npx vitest run src/__tests__/router/reports.permission.test.ts`
Then: `npm run test`
Then: `npm run build`
Expected: all PASS; build clean.

- [ ] **Step 6: Commit**

```bash
git add src/router/index.ts src/components/layout/AppSidebar.vue src/components/layout/AppBottomNav.vue src/__tests__/router/reports.permission.test.ts
git commit -m "feat(reports): route + nav wiring + permission gate for /reports"
```

---

## Self-Review

**Spec coverage** (DoD item → task):
- `/reports` reachable from the previously-empty reports nav entry; owner + manager only → Task 6 ✓
- Period selector Week/Month/Quarter/custom, default Month → Tasks 1, 5 ✓
- Headline profit (green/red) + plain-language verdict → Task 5 ✓
- Profit trend chart (green/red per bucket), bars sum to headline → Tasks 3 (sum), 4 (chart) ✓
- Plain breakdown money in − COGS − expenses = profit, reusing `useDashboardMetrics` → Tasks 2, 5 ✓
- Missing-cost caveat reused; empty-period state; inverted-range guard → Task 5 ✓
- Works offline; no second profit calc (reuses verified engine) → Tasks 2, 3 ✓
- Deferred items recorded as Reports v2 → "Out of scope" section ✓

**Placeholder scan:** No TBD/TODO. Every code step has full code; the `useDashboardMetrics` refactor (Task 2 Step 3) names the exact extraction (`run(start,end)`), not "similar to".

**Type consistency:** `ReportPeriod` (Task 1) is imported unchanged in Task 5. `ProfitTrendPoint` defined in Task 3 is the prop type in Task 4 and the chart input in Task 5. `loadRange(start, end)` signature matches between Task 2 (definition) and Task 5 (call). `useProfitTrend().load(start, end, bucket)` matches between Task 3 and Task 5. Chart consumes `points` in both Task 4 and Task 5.

**One deliberate spec deviation:** the spec suggested "extend `usePeriodToggle`"; the plan instead keeps the Reports screen's period state local and puts range resolution in `periodUtils`, because `usePeriodToggle` is a shared module-level singleton and mutating it would change the home dashboard. Same user-facing behaviour, no cross-screen side effect.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-25-profit-report-screen.md`. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session with checkpoints for review.

Which approach? (Or hand the plan to your dev — it's self-contained.)
