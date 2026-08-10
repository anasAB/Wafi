# WAFI-146 Dashboard 2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `/dashboard` screen with 5 expandable "intelligence cards" (Revenue, Profit, Inventory, Staff, Customer) that explain *why* a metric moved, not just what it is — per `docs/superpowers/specs/2026-08-10-wafi-146-dashboard-2-design.md` (v3).

**Architecture:** One presentation-only shell (`IntelligenceCard.vue`) wrapped by 5 card components, each backed by its own composable. Revenue/Profit share a `ComparisonMetric`/`ComparisonDriver` data shape; Inventory/Staff/Customer keep their own natural shapes (snapshot/ranking/count). All composables extend existing queries (`useDashboardMetrics`, `useDeadStockReport`, `useStaffPerformanceMetrics`) rather than duplicating them. Refresh is event-driven (WAFI-143 events) with debounced coalescing, `Promise.allSettled` orchestration, and per-card loading/ready/error/placeholder state.

**Tech Stack:** Vue 3 `<script setup>`, TypeScript, Vitest, PowerSync `db` (SQLite), vue-i18n, vue-router.

## Global Constraints

- Route: `/dashboard`, `meta: { permission: 'can_view_reports', feature: 'reporting_pack' }` — same gating as `/reports`.
- Staff card additionally requires `can_view_staff_performance` (owner-only, WAFI-018) — card and its load call are both omitted, not shown locked.
- Comparison basis inherited verbatim from WAFI-144's `insightRanges.ts` (`day`/`week`/`month`) — no new comparison-range logic.
- For `day` period, every card's drivers/details are gated on `isCurrentDayComplete` (from `getInsightRanges`) — hidden with an explicit placeholder state until true. Headlines are unaffected (they use WAFI-144's existing truncation/skip behavior).
- Discount total = `SUM(sales.sale_discount_amount_usd)` (sale-level only — the same column and query shape `useAnomalyDetection.ts` already uses; line-level `sale_line_items.discount_amount_usd` is NOT included, matching existing precedent).
- Shop-average staff discount rate = `SUM(all staff discountUsd) / SUM(all staff revenueUsd)` (dollar-weighted), never `average(perStaffRate)`.
- No new event types, no new messaging backend, no new tables/migrations. Every new query is an extension of an existing composable's WHERE/GROUP BY.
- RTL Arabic UI, dark theme — match `InsightBanner.vue`/`HomePage.vue`'s existing scoped-CSS conventions (colors `#1A56DB` accent, `#E8EDF5` text, `#637285` muted, card bg `rgba(26,86,219,0.10)` gradient).
- All display strings via `useI18n()`'s `t()` at the component layer — composables return raw numbers only.

---

### Task 1: `useDashboardMetrics` — add `returnCount` and `discountUsd`

**Files:**
- Modify: `src/features/dashboard/composables/useDashboardMetrics.ts`
- Test: `src/features/dashboard/composables/__tests__/useDashboardMetrics.test.ts` (create if it doesn't already exist — check first with Glob; if it exists, add to it)

**Interfaces:**
- Consumes: nothing new.
- Produces: `useDashboardMetrics()` now also returns `returnCount: Ref<number>` and `discountUsd: Ref<number>`, populated by `run()`/`load()`/`loadRange()` exactly like the existing refs.

- [ ] **Step 1: Write the failing tests**

```ts
// src/features/dashboard/composables/__tests__/useDashboardMetrics.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/store/device.store', () => ({
  useDeviceStore: () => ({ shopId: 'shop1' }),
}))

import { db } from '@/data/powersync/db'
import { useDashboardMetrics } from '@/features/dashboard/composables/useDashboardMetrics'

describe('useDashboardMetrics — returnCount and discountUsd', () => {
  beforeEach(() => vi.resetAllMocks())

  it('exposes returnCount from a COUNT(*) query against returns, separate from refundsUsd', async () => {
    vi.mocked(db.getOptional).mockImplementation(async (sql: unknown) => {
      const s = sql as string
      if (/COUNT\(\*\) as count FROM returns/.test(s)) return { count: 7 } as any
      if (/SUM\(r\.refund_amount_usd\)/.test(s)) return { total: 340 } as any
      return { total: 0, count: 0 } as any
    })
    const metrics = useDashboardMetrics()
    await metrics.loadRange('2026-08-01', '2026-08-10')
    expect(metrics.returnCount.value).toBe(7)
    expect(metrics.refundsUsd.value).toBe(340)
  })

  it('exposes discountUsd from SUM(sale_discount_amount_usd) FROM sales', async () => {
    vi.mocked(db.getOptional).mockImplementation(async (sql: unknown) => {
      const s = sql as string
      if (/SUM\(sale_discount_amount_usd\)/.test(s)) return { total: 120.5 } as any
      return { total: 0, count: 0 } as any
    })
    const metrics = useDashboardMetrics()
    await metrics.loadRange('2026-08-01', '2026-08-10')
    expect(metrics.discountUsd.value).toBe(120.5)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/dashboard/composables/__tests__/useDashboardMetrics.test.ts`
Expected: FAIL — `returnCount`/`discountUsd` are `undefined`.

- [ ] **Step 3: Implement**

In `useDashboardMetrics.ts`, add two new refs near the existing ones (after `costlessSalesInPeriod`):

```ts
  const returnCount = ref(0)
  const discountUsd = ref(0)
```

Add two new queries to the `Promise.all` array in `run()` (alongside `refundRow`, `cogsReversalRow`, etc.):

```ts
      db.getOptional<{ count: number }>(
        `SELECT COUNT(*) as count
         FROM returns r
         JOIN sales s ON s.id = r.original_sale_id
         WHERE r.shop_id = ? AND DATE(r.created_at, 'localtime') BETWEEN ? AND ?${s.clause}`,
        [device.shopId, start, end, ...s.params]
      ),
      db.getOptional<{ total: number }>(
        `SELECT COALESCE(SUM(sale_discount_amount_usd), 0) as total
         FROM sales WHERE shop_id = ? AND DATE(created_at, 'localtime') BETWEEN ? AND ?${sales.clause}`,
        [device.shopId, start, end, ...sales.params]
      ),
```

Update the destructuring of `Promise.all`'s result array to add `returnCountRow` and `discountRow` in matching position, and set the refs after the array:

```ts
    returnCount.value = returnCountRow?.count ?? 0
    discountUsd.value = discountRow?.total ?? 0
```

Add both new refs to the function's return object.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/dashboard/composables/__tests__/useDashboardMetrics.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full existing suite for this file to check nothing broke**

Run: `npx vitest run src/features/dashboard/composables/__tests__/`
Expected: PASS (no regressions in `ReportsPage`/`HomePage`-adjacent tests that construct `useDashboardMetrics` return shape)

- [ ] **Step 6: Commit**

```bash
git add src/features/dashboard/composables/useDashboardMetrics.ts src/features/dashboard/composables/__tests__/useDashboardMetrics.test.ts
git commit -m "feat(WAFI-146): add returnCount and discountUsd to useDashboardMetrics"
```

---

### Task 2: `useStaffPerformanceMetrics` — add per-staff `discountUsd`/`discountRate`

**Files:**
- Modify: `src/features/dashboard/composables/useStaffPerformanceMetrics.ts`
- Test: `src/features/dashboard/composables/__tests__/useStaffPerformanceMetrics.test.ts` (create if none exists)

**Interfaces:**
- Consumes: nothing new.
- Produces: `StaffPerformanceRow` gains `discountUsd: number` and `discountRate: number | null` (null when `revenueUsd` is 0 — "no data," matching the existing `avgTicketUsd` null convention in this same file).

- [ ] **Step 1: Write the failing test**

```ts
// src/features/dashboard/composables/__tests__/useStaffPerformanceMetrics.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/store/device.store', () => ({ useDeviceStore: () => ({ shopId: 'shop1' }) }))

import { db } from '@/data/powersync/db'
import { useStaffPerformanceMetrics } from '@/features/dashboard/composables/useStaffPerformanceMetrics'

describe('useStaffPerformanceMetrics — discountUsd/discountRate', () => {
  beforeEach(() => vi.resetAllMocks())

  it('computes discountRate = discountUsd / grossUsd per staff, null when grossUsd is 0', async () => {
    vi.mocked(db.getAll).mockImplementation(async (sql: unknown) => {
      const s = sql as string
      if (/COUNT\(\*\) AS salesCount/.test(s)) {
        return [{ staffId: 's1', name: 'Ahmed', salesCount: 10, grossUsd: 1000 }] as any
      }
      if (/SUM\(sli\.quantity/.test(s)) return [] as any
      if (/cs\.staff_id AS staffId, COALESCE\(SUM\(r\.refund_amount_usd\)/.test(s)) return [] as any
      if (/rli\.qty_returned/.test(s)) return [] as any
      if (/SUM\(sale_discount_amount_usd\)/.test(s)) {
        return [{ staffId: 's1', discountUsd: 100 }] as any
      }
      return [] as any
    })
    const perf = useStaffPerformanceMetrics()
    await perf.load('2026-08-01', '2026-08-10')
    expect(perf.rows.value[0].discountUsd).toBe(100)
    expect(perf.rows.value[0].discountRate).toBe(10) // 100/1000 * 100
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/dashboard/composables/__tests__/useStaffPerformanceMetrics.test.ts`
Expected: FAIL — `discountUsd`/`discountRate` are `undefined`.

- [ ] **Step 3: Implement**

Add `discountUsd: number` and `discountRate: number | null` to the `StaffPerformanceRow` interface (after `avgTicketUsd`), with a comment matching the file's existing style:

```ts
  // discountUsd: sale-level discount only (SUM(sale_discount_amount_usd)),
  // same column/precedent useAnomalyDetection.ts already uses for the
  // shop-wide discount total — NOT line-level discounts.
  discountUsd: number
  // null (not 0) when revenueUsd is 0 — same "no data" convention as avgTicketUsd.
  discountRate: number | null
```

Add a fifth query to the `Promise.all` in `load()`:

```ts
      db.getAll<{ staffId: string; discountUsd: number }>(
        `SELECT s.staff_id AS staffId, COALESCE(SUM(s.sale_discount_amount_usd), 0) AS discountUsd
         FROM sales s
         WHERE s.shop_id = ? AND s.staff_id IS NOT NULL
           AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
         GROUP BY s.staff_id`,
        [device.shopId, start, end]
      ),
```

Destructure it as `discountRows`, build `discountMap`, and in the `built` map callback add:

```ts
      const discountUsd = discountMap.get(s.staffId) ?? 0
```

to the returned row object, plus:

```ts
        discountUsd,
        discountRate: revenueUsd > 0 ? (discountUsd / revenueUsd) * 100 : null,
```

(placed after `avgTicketUsd` in the returned object, before the closing `}`). Note `revenueUsd` here must be the same `revenueUsd` already computed two lines above in that same map callback (`s.grossUsd - returnRevenue`) — reuse it, don't recompute.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/dashboard/composables/__tests__/useStaffPerformanceMetrics.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/composables/useStaffPerformanceMetrics.ts src/features/dashboard/composables/__tests__/useStaffPerformanceMetrics.test.ts
git commit -m "feat(WAFI-146): add per-staff discountUsd/discountRate to useStaffPerformanceMetrics"
```

---

### Task 3: `useRevenueIntelligence` composable

**Files:**
- Create: `src/features/dashboard/composables/useRevenueIntelligence.ts`
- Test: `src/features/dashboard/composables/__tests__/useRevenueIntelligence.test.ts`

**Interfaces:**
- Consumes: `useDashboardMetrics()` (Task 1's `returnCount`/`discountUsd` not needed here — Revenue only needs `revenueUsd`/`invoiceCount`/`returnCount`), `getInsightRanges`/`InsightPeriod` from `@/features/dashboard/composables/insightRanges`.
- Produces:
  ```ts
  export interface ComparisonMetric {
    currentUsd: number
    previousUsd: number
    changePct: number | null
    direction: 'up' | 'down' | 'flat'
  }
  export interface ComparisonDriver {
    key: 'transactionCount' | 'returnCount' | 'avgBasket'
    current: number
    previous: number
    changePct: number | null
  }
  export interface RevenueIntelligenceData {
    metric: ComparisonMetric
    drivers: ComparisonDriver[] | null   // null = placeholder state (day incomplete)
  }
  export function useRevenueIntelligence(): {
    data: Ref<RevenueIntelligenceData | null>
    state: Ref<'loading' | 'ready' | 'error'>
    load: (period: InsightPeriod) => Promise<void>
  }
  ```
  `ComparisonMetric`/`ComparisonDriver` are exported from this file and reused by Task 4 (`useProfitIntelligence`) via `import type`.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/dashboard/composables/__tests__/useRevenueIntelligence.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/store/device.store', () => ({ useDeviceStore: () => ({ shopId: 'shop1' }) }))

import { db } from '@/data/powersync/db'
import { useRevenueIntelligence } from '@/features/dashboard/composables/useRevenueIntelligence'

function mockRow(current: { total?: number; count?: number }, previous: { total?: number; count?: number }) {
  let call = 0
  vi.mocked(db.getOptional).mockImplementation(async () => {
    call++
    // useDashboardMetrics issues 8 getOptional calls per loadRange() — current period first, then previous.
    const isFirstPeriod = call <= 8
    const src = isFirstPeriod ? current : previous
    return { total: src.total ?? 0, count: src.count ?? 0 } as any
  })
}

describe('useRevenueIntelligence', () => {
  beforeEach(() => vi.resetAllMocks())

  it('computes metric + drivers for a completed week period (no day-gating)', async () => {
    mockRow({ total: 900, count: 45 }, { total: 1000, count: 55 })
    const { data, load } = useRevenueIntelligence()
    await load('week')
    expect(data.value?.metric.currentUsd).toBe(900)
    expect(data.value?.metric.previousUsd).toBe(1000)
    expect(data.value?.metric.direction).toBe('down')
    expect(data.value?.drivers).not.toBeNull()
    expect(data.value?.drivers?.find(d => d.key === 'transactionCount')).toEqual(
      expect.objectContaining({ current: 45, previous: 55 })
    )
  })

  it('returns changePct null and drivers unaffected when previousUsd is 0', async () => {
    mockRow({ total: 500, count: 10 }, { total: 0, count: 0 })
    const { data, load } = useRevenueIntelligence()
    await load('week')
    expect(data.value?.metric.changePct).toBeNull()
    expect(data.value?.metric.direction).toBe('up')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/dashboard/composables/__tests__/useRevenueIntelligence.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/features/dashboard/composables/useRevenueIntelligence.ts
import { ref } from 'vue'
import { useDashboardMetrics } from './useDashboardMetrics'
import { getInsightRanges, type InsightPeriod } from './insightRanges'

export interface ComparisonMetric {
  currentUsd: number
  previousUsd: number
  changePct: number | null
  direction: 'up' | 'down' | 'flat'
}

export interface ComparisonDriver {
  key: string
  current: number
  previous: number
  changePct: number | null
}

export interface RevenueIntelligenceData {
  metric: ComparisonMetric
  drivers: ComparisonDriver[] | null
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null
  return ((current - previous) / previous) * 100
}

function direction(current: number, previous: number): 'up' | 'down' | 'flat' {
  if (current === previous) return 'flat'
  return current > previous ? 'up' : 'down'
}

function buildDriver(key: string, current: number, previous: number): ComparisonDriver {
  return { key, current, previous, changePct: pctChange(current, previous) }
}

export function useRevenueIntelligence() {
  const data = ref<RevenueIntelligenceData | null>(null)
  const state = ref<'loading' | 'ready' | 'error'>('loading')

  async function load(period: InsightPeriod) {
    state.value = 'loading'
    try {
      const { current, comparison, isCurrentDayComplete } = getInsightRanges(period)

      const currentMetrics = useDashboardMetrics()
      const previousMetrics = useDashboardMetrics()
      await Promise.all([
        currentMetrics.loadRange(current.start, current.end),
        previousMetrics.loadRange(comparison.start, comparison.end),
      ])

      const metric: ComparisonMetric = {
        currentUsd: currentMetrics.revenueUsd.value,
        previousUsd: previousMetrics.revenueUsd.value,
        changePct: pctChange(currentMetrics.revenueUsd.value, previousMetrics.revenueUsd.value),
        direction: direction(currentMetrics.revenueUsd.value, previousMetrics.revenueUsd.value),
      }

      // Drivers are gated on isCurrentDayComplete for 'day' — week/month are
      // always "complete" per insightRanges.ts, so this only ever hides
      // drivers during an in-progress today. See design spec's "Day-period
      // truncation" section.
      const showDrivers = period !== 'day' || isCurrentDayComplete
      const drivers = showDrivers
        ? [
            buildDriver('transactionCount', currentMetrics.invoiceCount.value, previousMetrics.invoiceCount.value),
            buildDriver('returnCount', currentMetrics.returnCount.value, previousMetrics.returnCount.value),
            buildDriver(
              'avgBasket',
              currentMetrics.invoiceCount.value > 0 ? currentMetrics.revenueUsd.value / currentMetrics.invoiceCount.value : 0,
              previousMetrics.invoiceCount.value > 0 ? previousMetrics.revenueUsd.value / previousMetrics.invoiceCount.value : 0,
            ),
          ]
        : null

      data.value = { metric, drivers }
      state.value = 'ready'
    } catch {
      state.value = 'error'
    }
  }

  return { data, state, load }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/dashboard/composables/__tests__/useRevenueIntelligence.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/composables/useRevenueIntelligence.ts src/features/dashboard/composables/__tests__/useRevenueIntelligence.test.ts
git commit -m "feat(WAFI-146): add useRevenueIntelligence composable"
```

---

### Task 4: `useProfitIntelligence` composable

**Files:**
- Create: `src/features/dashboard/composables/useProfitIntelligence.ts`
- Test: `src/features/dashboard/composables/__tests__/useProfitIntelligence.test.ts`

**Interfaces:**
- Consumes: `useDashboardMetrics()`, `getInsightRanges`, `ComparisonMetric`/`ComparisonDriver` types from Task 3's `useRevenueIntelligence.ts`.
- Produces:
  ```ts
  export interface ProfitIntelligenceData {
    metric: ComparisonMetric              // profit USD, NOT margin — see spec
    marginCurrentPct: number | null       // null when currentUsd revenue is 0
    marginPreviousPct: number | null
    drivers: ComparisonDriver[] | null    // ['revenue', 'cogs', 'discounts'], in that order
  }
  export function useProfitIntelligence(): {
    data: Ref<ProfitIntelligenceData | null>
    state: Ref<'loading' | 'ready' | 'error'>
    load: (period: InsightPeriod) => Promise<void>
  }
  ```

- [ ] **Step 1: Write the failing test**

```ts
// src/features/dashboard/composables/__tests__/useProfitIntelligence.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/store/device.store', () => ({ useDeviceStore: () => ({ shopId: 'shop1' }) }))

import { db } from '@/data/powersync/db'
import { useProfitIntelligence } from '@/features/dashboard/composables/useProfitIntelligence'

describe('useProfitIntelligence', () => {
  beforeEach(() => vi.resetAllMocks())

  it('headline metric is profit USD, not margin percentage', async () => {
    let call = 0
    vi.mocked(db.getOptional).mockImplementation(async (sql: unknown) => {
      call++
      const isCurrent = call <= 8
      const s = sql as string
      if (/SUM\(total_usd\)/.test(s)) return { total: isCurrent ? 10000 : 12000 } as any
      if (/sli\.quantity \* COALESCE\(sli\.unit_cost_usd/.test(s)) return { cogs: isCurrent ? 6000 : 6500 } as any
      if (/SUM\(sale_discount_amount_usd\)/.test(s)) return { total: isCurrent ? 200 : 150 } as any
      return { total: 0, count: 0, cogs: 0 } as any
    })
    const { data, load } = useProfitIntelligence()
    await load('week')
    // current profit = 10000 - 6000 = 4000; previous = 12000 - 6500 = 5500
    expect(data.value?.metric.currentUsd).toBe(4000)
    expect(data.value?.metric.previousUsd).toBe(5500)
    expect(data.value?.marginCurrentPct).toBeCloseTo(40)   // 4000/10000
    expect(data.value?.marginPreviousPct).toBeCloseTo(45.83, 1) // 5500/12000
    expect(data.value?.drivers?.map(d => d.key)).toEqual(['revenue', 'cogs', 'discounts'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/dashboard/composables/__tests__/useProfitIntelligence.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/features/dashboard/composables/useProfitIntelligence.ts
import { ref } from 'vue'
import { useDashboardMetrics } from './useDashboardMetrics'
import { getInsightRanges, type InsightPeriod } from './insightRanges'
import type { ComparisonMetric, ComparisonDriver } from './useRevenueIntelligence'

export interface ProfitIntelligenceData {
  metric: ComparisonMetric
  marginCurrentPct: number | null
  marginPreviousPct: number | null
  drivers: ComparisonDriver[] | null
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null
  return ((current - previous) / previous) * 100
}

function direction(current: number, previous: number): 'up' | 'down' | 'flat' {
  if (current === previous) return 'flat'
  return current > previous ? 'up' : 'down'
}

function buildDriver(key: string, current: number, previous: number): ComparisonDriver {
  return { key, current, previous, changePct: pctChange(current, previous) }
}

export function useProfitIntelligence() {
  const data = ref<ProfitIntelligenceData | null>(null)
  const state = ref<'loading' | 'ready' | 'error'>('loading')

  async function load(period: InsightPeriod) {
    state.value = 'loading'
    try {
      const { current, comparison, isCurrentDayComplete } = getInsightRanges(period)

      // Same two-instance pattern as useRevenueIntelligence — cogsUsd and
      // discountUsd are read directly off these, never a second/independent
      // COGS or discount query (per design spec Task-3 note).
      const currentMetrics = useDashboardMetrics()
      const previousMetrics = useDashboardMetrics()
      await Promise.all([
        currentMetrics.loadRange(current.start, current.end),
        previousMetrics.loadRange(comparison.start, comparison.end),
      ])

      const metric: ComparisonMetric = {
        currentUsd: currentMetrics.profitUsd.value,
        previousUsd: previousMetrics.profitUsd.value,
        changePct: pctChange(currentMetrics.profitUsd.value, previousMetrics.profitUsd.value),
        direction: direction(currentMetrics.profitUsd.value, previousMetrics.profitUsd.value),
      }

      const marginCurrentPct = currentMetrics.revenueUsd.value > 0
        ? (currentMetrics.profitUsd.value / currentMetrics.revenueUsd.value) * 100
        : null
      const marginPreviousPct = previousMetrics.revenueUsd.value > 0
        ? (previousMetrics.profitUsd.value / previousMetrics.revenueUsd.value) * 100
        : null

      const showDrivers = period !== 'day' || isCurrentDayComplete
      const drivers = showDrivers
        ? [
            buildDriver('revenue', currentMetrics.revenueUsd.value, previousMetrics.revenueUsd.value),
            buildDriver('cogs', currentMetrics.cogsUsd.value, previousMetrics.cogsUsd.value),
            buildDriver('discounts', currentMetrics.discountUsd.value, previousMetrics.discountUsd.value),
          ]
        : null

      data.value = { metric, marginCurrentPct, marginPreviousPct, drivers }
      state.value = 'ready'
    } catch {
      state.value = 'error'
    }
  }

  return { data, state, load }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/dashboard/composables/__tests__/useProfitIntelligence.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/composables/useProfitIntelligence.ts src/features/dashboard/composables/__tests__/useProfitIntelligence.test.ts
git commit -m "feat(WAFI-146): add useProfitIntelligence composable"
```

---

### Task 5: `useInventoryIntelligence` composable

**Files:**
- Create: `src/features/dashboard/composables/useInventoryIntelligence.ts`
- Test: `src/features/dashboard/composables/__tests__/useInventoryIntelligence.test.ts`

**Interfaces:**
- Consumes: `useDeadStockReport` from `./useDeadStockReport` (existing, unchanged).
- Produces:
  ```ts
  export interface InventoryIntelligenceData {
    totalFrozenCapitalUsd: number
    productCount: number
    topOffenders: DeadStockRow[]   // sorted by valueUsd desc, top 5
  }
  export function useInventoryIntelligence(): {
    data: Ref<InventoryIntelligenceData | null>
    state: Ref<'loading' | 'ready' | 'error'>
    load: () => Promise<void>
  }
  ```
  No `period`/`InsightPeriod` argument — this card is a point-in-time snapshot (see spec's "Shape note"), so `load()` takes no arguments and is unaffected by the dashboard's period selector.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/dashboard/composables/__tests__/useInventoryIntelligence.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/store/device.store', () => ({ useDeviceStore: () => ({ shopId: 'shop1' }) }))

import { db } from '@/data/powersync/db'
import { useInventoryIntelligence } from '@/features/dashboard/composables/useInventoryIntelligence'

describe('useInventoryIntelligence', () => {
  beforeEach(() => vi.resetAllMocks())

  it('uses the 60-day threshold and surfaces frozen capital + top offenders', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { id: 'p1', name_ar: 'منتج أ', current_stock: 10, cost_price_usd: 50, created_at: '2026-01-01', last_sold_at: null },
      { id: 'p2', name_ar: 'منتج ب', current_stock: 2, cost_price_usd: 5, created_at: '2026-01-01', last_sold_at: null },
    ] as any)
    const { data, load } = useInventoryIntelligence()
    await load()
    expect(data.value?.productCount).toBe(2)
    expect(data.value?.totalFrozenCapitalUsd).toBe(510) // 10*50 + 2*5
    expect(data.value?.topOffenders[0].productId).toBe('p1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/dashboard/composables/__tests__/useInventoryIntelligence.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/features/dashboard/composables/useInventoryIntelligence.ts
import { ref } from 'vue'
import { useDeadStockReport } from './useDeadStockReport'

export interface InventoryIntelligenceData {
  totalFrozenCapitalUsd: number
  productCount: number
  topOffenders: ReturnType<typeof useDeadStockReport>['rows']['value']
}

export function useInventoryIntelligence() {
  const data = ref<InventoryIntelligenceData | null>(null)
  const state = ref<'loading' | 'ready' | 'error'>('loading')

  async function load() {
    state.value = 'loading'
    try {
      const deadStock = useDeadStockReport()
      deadStock.thresholdDays.value = 60
      deadStock.sort.value = 'value'
      await deadStock.load()

      data.value = {
        totalFrozenCapitalUsd: deadStock.totalFrozenCapitalUsd.value,
        productCount: deadStock.costedRows.value.length,
        topOffenders: deadStock.rows.value.slice(0, 5),
      }
      state.value = 'ready'
    } catch {
      state.value = 'error'
    }
  }

  return { data, state, load }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/dashboard/composables/__tests__/useInventoryIntelligence.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/composables/useInventoryIntelligence.ts src/features/dashboard/composables/__tests__/useInventoryIntelligence.test.ts
git commit -m "feat(WAFI-146): add useInventoryIntelligence composable"
```

---

### Task 6: `useStaffIntelligence` composable

**Files:**
- Create: `src/features/dashboard/composables/useStaffIntelligence.ts`
- Test: `src/features/dashboard/composables/__tests__/useStaffIntelligence.test.ts`

**Interfaces:**
- Consumes: `useStaffPerformanceMetrics` (Task 2's extended version), `getInsightRanges`/`InsightPeriod`.
- Produces:
  ```ts
  export interface StaffIntelligenceData {
    topPerformer: { staffId: string; name: string; revenueUsd: number } | null
    highestDiscountRate: { staffId: string; name: string; discountRatePct: number } | null
    shopAverageDiscountRatePct: number | null   // dollar-weighted; null if shop revenue is 0
  }
  export function useStaffIntelligence(): {
    data: Ref<StaffIntelligenceData | null>
    state: Ref<'loading' | 'ready' | 'error'>
    load: (period: InsightPeriod) => Promise<void>
  }
  ```

- [ ] **Step 1: Write the failing test**

```ts
// src/features/dashboard/composables/__tests__/useStaffIntelligence.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/store/device.store', () => ({ useDeviceStore: () => ({ shopId: 'shop1' }) }))

import { db } from '@/data/powersync/db'
import { useStaffIntelligence } from '@/features/dashboard/composables/useStaffIntelligence'

describe('useStaffIntelligence', () => {
  beforeEach(() => vi.resetAllMocks())

  it('shop average discount rate is dollar-weighted, not an average of per-staff rates', async () => {
    vi.mocked(db.getAll).mockImplementation(async (sql: unknown) => {
      const s = sql as string
      if (/COUNT\(\*\) AS salesCount/.test(s)) {
        return [
          { staffId: 'ahmed', name: 'Ahmed', salesCount: 10, grossUsd: 1000 },
          { staffId: 'sara', name: 'Sara', salesCount: 2, grossUsd: 100 },
        ] as any
      }
      if (/SUM\(sale_discount_amount_usd\)/.test(s)) {
        return [
          { staffId: 'ahmed', discountUsd: 100 },
          { staffId: 'sara', discountUsd: 0 },
        ] as any
      }
      return [] as any
    })
    const { data, load } = useStaffIntelligence()
    await load('week')
    // weighted: (100 + 0) / (1000 + 100) = 9.0909...%, NOT average(10%, 0%) = 5%
    expect(data.value?.shopAverageDiscountRatePct).toBeCloseTo(9.09, 1)
    expect(data.value?.topPerformer?.staffId).toBe('ahmed')
    expect(data.value?.highestDiscountRate?.staffId).toBe('ahmed')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/dashboard/composables/__tests__/useStaffIntelligence.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/features/dashboard/composables/useStaffIntelligence.ts
import { ref } from 'vue'
import { useStaffPerformanceMetrics } from './useStaffPerformanceMetrics'
import { getInsightRanges, type InsightPeriod } from './insightRanges'

export interface StaffIntelligenceData {
  topPerformer: { staffId: string; name: string; revenueUsd: number } | null
  highestDiscountRate: { staffId: string; name: string; discountRatePct: number } | null
  shopAverageDiscountRatePct: number | null
}

export function useStaffIntelligence() {
  const data = ref<StaffIntelligenceData | null>(null)
  const state = ref<'loading' | 'ready' | 'error'>('loading')

  async function load(period: InsightPeriod) {
    state.value = 'loading'
    try {
      const { current } = getInsightRanges(period)
      const perf = useStaffPerformanceMetrics()
      await perf.load(current.start, current.end)
      const rows = perf.rows.value

      if (rows.length === 0) {
        data.value = { topPerformer: null, highestDiscountRate: null, shopAverageDiscountRatePct: null }
        state.value = 'ready'
        return
      }

      const topPerformer = rows.reduce((best, r) => (r.revenueUsd > best.revenueUsd ? r : best))
      const withRate = rows.filter(r => r.discountRate !== null)
      const highestDiscountRow = withRate.length
        ? withRate.reduce((best, r) => (r.discountRate! > best.discountRate! ? r : best))
        : null

      // Dollar-weighted shop average: total discount / total revenue across
      // ALL staff, not average(perStaffRate) — those disagree, see design
      // spec's Staff card section and this test's worked example.
      const totalRevenue = rows.reduce((sum, r) => sum + r.revenueUsd, 0)
      const totalDiscount = rows.reduce((sum, r) => sum + r.discountUsd, 0)
      const shopAverageDiscountRatePct = totalRevenue > 0 ? (totalDiscount / totalRevenue) * 100 : null

      data.value = {
        topPerformer: { staffId: topPerformer.staffId, name: topPerformer.name, revenueUsd: topPerformer.revenueUsd },
        highestDiscountRate: highestDiscountRow
          ? { staffId: highestDiscountRow.staffId, name: highestDiscountRow.name, discountRatePct: highestDiscountRow.discountRate! }
          : null,
        shopAverageDiscountRatePct,
      }
      state.value = 'ready'
    } catch {
      state.value = 'error'
    }
  }

  return { data, state, load }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/dashboard/composables/__tests__/useStaffIntelligence.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/composables/useStaffIntelligence.ts src/features/dashboard/composables/__tests__/useStaffIntelligence.test.ts
git commit -m "feat(WAFI-146): add useStaffIntelligence composable"
```

---

### Task 7: `useCustomerIntelligence` composable

**Files:**
- Create: `src/features/dashboard/composables/useCustomerIntelligence.ts`
- Test: `src/features/dashboard/composables/__tests__/useCustomerIntelligence.test.ts`

**Interfaces:**
- Consumes: `db` from `@/data/powersync/db`, `useDeviceStore` from `@/store/device.store`.
- Produces:
  ```ts
  export interface InactiveCustomerRow {
    customerId: string
    customerName: string
    lastPurchaseAt: string
    daysSincePurchase: number
  }
  export interface CustomerIntelligenceData {
    inactiveCount: number
    inactiveCustomers: InactiveCustomerRow[]   // sorted lastPurchaseAt ascending (oldest first)
  }
  export function useCustomerIntelligence(): {
    data: Ref<CustomerIntelligenceData | null>
    state: Ref<'loading' | 'ready' | 'error'>
    load: () => Promise<void>
  }
  ```
  No `period` argument — same reasoning as Inventory (point-in-time observation, not a period comparison).

- [ ] **Step 1: Write the failing test**

```ts
// src/features/dashboard/composables/__tests__/useCustomerIntelligence.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/store/device.store', () => ({ useDeviceStore: () => ({ shopId: 'shop1' }) }))

import { db } from '@/data/powersync/db'
import { useCustomerIntelligence } from '@/features/dashboard/composables/useCustomerIntelligence'

describe('useCustomerIntelligence', () => {
  beforeEach(() => vi.resetAllMocks())

  it('excludes customers with zero qualifying sales and sorts oldest-first', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { customerId: 'c1', customerName: 'زبون ١', lastPurchaseAt: '2026-05-01T00:00:00.000Z' },
      { customerId: 'c2', customerName: 'زبون ٢', lastPurchaseAt: '2026-06-01T00:00:00.000Z' },
    ] as any)
    const { data, load } = useCustomerIntelligence()
    await load()
    expect(data.value?.inactiveCount).toBe(2)
    expect(data.value?.inactiveCustomers[0].customerId).toBe('c1') // oldest first
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/dashboard/composables/__tests__/useCustomerIntelligence.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/features/dashboard/composables/useCustomerIntelligence.ts
import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

export interface InactiveCustomerRow {
  customerId: string
  customerName: string
  lastPurchaseAt: string
  daysSincePurchase: number
}

export interface CustomerIntelligenceData {
  inactiveCount: number
  inactiveCustomers: InactiveCustomerRow[]
}

const INACTIVE_THRESHOLD_DAYS = 60

export function useCustomerIntelligence() {
  const data = ref<CustomerIntelligenceData | null>(null)
  const state = ref<'loading' | 'ready' | 'error'>('loading')

  async function load() {
    state.value = 'loading'
    try {
      const device = useDeviceStore()
      const cutoff = new Date(Date.now() - INACTIVE_THRESHOLD_DAYS * 24 * 3_600_000).toISOString()

      // A qualifying sale is any sales row with a non-null customer_id for
      // that customer — credit sales count, and a sale that was later
      // returned still counts (it was still a visit; see design spec's
      // explicit domain rule). Customers with zero qualifying sales ever
      // are excluded by the JOIN itself (no matching sales row = not
      // present in the GROUP BY result at all).
      const rows = await db.getAll<{ customerId: string; customerName: string; lastPurchaseAt: string }>(
        `SELECT s.customer_id AS customerId, c.name AS customerName, MAX(s.created_at) AS lastPurchaseAt
         FROM sales s
         JOIN customers c ON c.id = s.customer_id
         WHERE s.shop_id = ? AND s.customer_id IS NOT NULL
           AND (c.deleted = 0 OR c.deleted IS NULL)
         GROUP BY s.customer_id, c.name
         HAVING MAX(s.created_at) < ?
         ORDER BY lastPurchaseAt ASC`,
        [device.shopId, cutoff]
      )

      const now = Date.now()
      const inactiveCustomers: InactiveCustomerRow[] = rows.map(r => ({
        customerId: r.customerId,
        customerName: r.customerName,
        lastPurchaseAt: r.lastPurchaseAt,
        daysSincePurchase: Math.floor((now - new Date(r.lastPurchaseAt).getTime()) / (24 * 3_600_000)),
      }))

      data.value = { inactiveCount: inactiveCustomers.length, inactiveCustomers }
      state.value = 'ready'
    } catch {
      state.value = 'error'
    }
  }

  return { data, state, load }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/dashboard/composables/__tests__/useCustomerIntelligence.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/composables/useCustomerIntelligence.ts src/features/dashboard/composables/__tests__/useCustomerIntelligence.test.ts
git commit -m "feat(WAFI-146): add useCustomerIntelligence composable"
```

---

### Task 8: `useSendChurnReminder` composable

**Files:**
- Create: `src/features/messaging/useSendChurnReminder.ts`
- Test: `src/features/messaging/__tests__/useSendChurnReminder.test.ts`

**Interfaces:**
- Consumes: `resolvePhone`, `openWhatsApp` from `./whatsapp` (existing, unchanged).
- Produces:
  ```ts
  export interface PrepareChurnReminderInput {
    customerName: string
    shopName: string
    phoneRaw?: string
  }
  export interface PreparedChurnReminder {
    text: string
    phone: string | null   // null = no usable phone number; caller must hide the "Send" action
  }
  export function useSendChurnReminder(): {
    prepare: (input: PrepareChurnReminderInput) => PreparedChurnReminder
    send: (phone: string, text: string) => void
  }
  ```

- [ ] **Step 1: Write the failing test**

```ts
// src/features/messaging/__tests__/useSendChurnReminder.test.ts
import { describe, it, expect, vi } from 'vitest'
vi.mock('../whatsapp', () => ({
  resolvePhone: vi.fn((raw: string) => (raw ? '963900000000' : null)),
  openWhatsApp: vi.fn(),
}))

import { openWhatsApp } from '../whatsapp'
import { useSendChurnReminder } from '../useSendChurnReminder'

describe('useSendChurnReminder', () => {
  it('prepares a plain check-in message and resolves the phone', () => {
    const { prepare } = useSendChurnReminder()
    const result = prepare({ customerName: 'أحمد', shopName: 'محل أحمد', phoneRaw: '0900000000' })
    expect(result.phone).toBe('963900000000')
    expect(result.text).toContain('أحمد')
    expect(result.text).toContain('محل أحمد')
  })

  it('returns phone null when no phone number is on file', () => {
    const { prepare } = useSendChurnReminder()
    const result = prepare({ customerName: 'أحمد', shopName: 'محل أحمد' })
    expect(result.phone).toBeNull()
  })

  it('send() only opens WhatsApp — never sends automatically on prepare()', () => {
    const { prepare } = useSendChurnReminder()
    prepare({ customerName: 'أحمد', shopName: 'محل أحمد', phoneRaw: '0900000000' })
    expect(openWhatsApp).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/messaging/__tests__/useSendChurnReminder.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/features/messaging/useSendChurnReminder.ts
/**
 * useSendChurnReminder — compose a plain "we miss you" WhatsApp check-in for
 * a customer flagged inactive on the Dashboard 2.0 Customer card.
 *
 * Mirrors useSendStatement.ts's prepare/send split: prepare() is pure (no
 * I/O), send() is the only function that opens WhatsApp, and it is never
 * called automatically — the caller (CustomerIntelligenceCard.vue) must
 * call it from an explicit user tap. No new messaging backend.
 */
import { resolvePhone, openWhatsApp } from './whatsapp'

export interface PrepareChurnReminderInput {
  customerName: string
  shopName: string
  phoneRaw?: string
}

export interface PreparedChurnReminder {
  text: string
  phone: string | null
}

export function useSendChurnReminder() {
  function prepare(input: PrepareChurnReminderInput): PreparedChurnReminder {
    const { customerName, shopName, phoneRaw } = input
    const text = `مرحباً ${customerName}، اشتقنا لزيارتك في ${shopName}! تفضل بزيارتنا قريباً 🙏`
    const phone = phoneRaw?.trim() ? resolvePhone(phoneRaw.trim(), '963') : null
    return { text, phone }
  }

  function send(phone: string, text: string): void {
    openWhatsApp(phone, text)
  }

  return { prepare, send }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/messaging/__tests__/useSendChurnReminder.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/messaging/useSendChurnReminder.ts src/features/messaging/__tests__/useSendChurnReminder.test.ts
git commit -m "feat(WAFI-146): add useSendChurnReminder composable"
```

---

### Task 9: `IntelligenceCard.vue` shared presentation shell

**Files:**
- Create: `src/features/dashboard/components/IntelligenceCard.vue`
- Test: `src/features/dashboard/components/IntelligenceCard.test.ts`

**Interfaces:**
- Consumes: nothing (pure presentation component).
- Produces: a component with props `state: 'loading' | 'ready' | 'error' | 'placeholder'`, `expanded: boolean`, and slots `headline`, `default` (body, shown when expanded), `placeholder` (optional override text). Emits `toggle` (no payload) and `retry` (no payload, only meaningful in `error` state).

- [ ] **Step 1: Write the failing test**

```ts
// src/features/dashboard/components/IntelligenceCard.test.ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import IntelligenceCard from './IntelligenceCard.vue'

describe('IntelligenceCard', () => {
  it('renders the headline slot always, and the body slot only when expanded', async () => {
    const wrapper = mount(IntelligenceCard, {
      props: { state: 'ready', expanded: false },
      slots: { headline: '<span data-testid="headline">Revenue down</span>', default: '<div data-testid="body">Details</div>' },
    })
    expect(wrapper.find('[data-testid="headline"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="body"]').exists()).toBe(false)

    await wrapper.setProps({ expanded: true })
    expect(wrapper.find('[data-testid="body"]').exists()).toBe(true)
  })

  it('emits toggle on header click', async () => {
    const wrapper = mount(IntelligenceCard, { props: { state: 'ready', expanded: false } })
    await wrapper.find('[data-testid="ic-header"]').trigger('click')
    expect(wrapper.emitted('toggle')).toHaveLength(1)
  })

  it('shows an error state with a retry button that emits retry, distinct from an empty ready state', () => {
    const wrapper = mount(IntelligenceCard, { props: { state: 'error', expanded: false } })
    expect(wrapper.find('[data-testid="ic-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ic-retry"]').exists()).toBe(true)
  })

  it('shows the placeholder state distinctly from ready/error', () => {
    const wrapper = mount(IntelligenceCard, {
      props: { state: 'placeholder', expanded: true },
      slots: { placeholder: 'Available once today closes' },
    })
    expect(wrapper.find('[data-testid="ic-placeholder"]').text()).toContain('Available once today closes')
    expect(wrapper.find('[data-testid="ic-error"]').exists()).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/dashboard/components/IntelligenceCard.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement**

```vue
<!-- src/features/dashboard/components/IntelligenceCard.vue -->
<!-- WAFI-146: presentation-only shell shared by all 5 intelligence cards.
     Deliberately owns no domain data shape — see design spec's "Shared
     card shell" section for why Inventory/Staff/Customer don't fit a
     single comparison-shaped interface. -->
<script setup lang="ts">
defineProps<{
  state: 'loading' | 'ready' | 'error' | 'placeholder'
  expanded: boolean
}>()
const emit = defineEmits<{ toggle: []; retry: [] }>()
</script>

<template>
  <div class="ic-card">
    <button type="button" data-testid="ic-header" class="ic-header" @click="emit('toggle')">
      <div class="ic-headline"><slot name="headline" /></div>
      <svg class="ic-chevron" :class="{ 'ic-chevron--open': expanded }" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </button>

    <div v-if="expanded" class="ic-body">
      <div v-if="state === 'loading'" class="ic-loading">…</div>
      <div v-else-if="state === 'error'" data-testid="ic-error" class="ic-error">
        <span>حدث خطأ في التحميل</span>
        <button type="button" data-testid="ic-retry" class="ic-retry-btn" @click="emit('retry')">إعادة المحاولة</button>
      </div>
      <div v-else-if="state === 'placeholder'" data-testid="ic-placeholder" class="ic-placeholder">
        <slot name="placeholder" />
      </div>
      <div v-else>
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
.ic-card {
  background: linear-gradient(135deg, rgba(26,86,219,0.10), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.25);
  border-radius: 14px;
  overflow: hidden;
}
.ic-header {
  width: 100%; display: flex; align-items: center; justify-content: space-between;
  gap: 10px; padding: 16px 18px; background: transparent; border: none; cursor: pointer;
  font-family: 'Tajawal', sans-serif; text-align: right;
}
.ic-headline { flex: 1; color: #E8EDF5; }
.ic-chevron { color: #637285; transition: transform .2s; flex-shrink: 0; }
.ic-chevron--open { transform: rotate(180deg); }
.ic-body { padding: 0 18px 16px; }
.ic-loading { color: #637285; font-size: 12px; text-align: center; padding: 12px 0; }
.ic-error { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 12px 0; color: #EF4444; font-size: 12px; }
.ic-retry-btn {
  border: 1px solid rgba(239,68,68,0.4); background: rgba(239,68,68,0.12); color: #EF4444;
  border-radius: 8px; padding: 5px 12px; font-size: 11px; font-weight: 700; cursor: pointer;
}
.ic-placeholder { color: #637285; font-size: 12px; text-align: center; padding: 12px 0; }
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/dashboard/components/IntelligenceCard.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/components/IntelligenceCard.vue src/features/dashboard/components/IntelligenceCard.test.ts
git commit -m "feat(WAFI-146): add IntelligenceCard presentation shell"
```

---

### Task 10: i18n strings for Dashboard 2.0

**Files:**
- Modify: `src/i18n/locales/ar.json` (or wherever the project's ar/en locale files live — confirm exact path with Glob `src/**/locales/ar*.json` or `src/**/i18n/**/ar.json` before editing; `InsightBanner.vue`'s existing `insights.*` keys are the reference to follow).
- Modify: matching `en.json`.

**Interfaces:**
- Consumes: nothing.
- Produces: new i18n keys under a `dashboard2.*` namespace, consumed by Tasks 11-16.

- [ ] **Step 1: Locate the existing insights i18n keys to match structure**

Run: `grep -rn "insights\." src/i18n/ 2>/dev/null || grep -rln "\"insights\"" src --include=*.json`

Use the result to find the exact locale file paths and copy the nesting style used for `insights.revenue.up`/`insights.revenue.down` etc.

- [ ] **Step 2: Add the `dashboard2` keys to the Arabic locale file**

Add (merging into the existing JSON structure at the same nesting depth as `insights`):

```json
"dashboard2": {
  "periodLabel": { "today": "اليوم", "week": "الأسبوع", "month": "الشهر" },
  "revenue": {
    "headline": { "up": "الإيرادات ↑{percent}%", "down": "الإيرادات ↓{percent}%", "flat": "الإيرادات بدون تغيير" },
    "transactionCount": "عدد الفواتير",
    "returnCount": "عدد المرتجعات",
    "avgBasket": "متوسط الفاتورة",
    "viewTransactions": "عرض الفواتير"
  },
  "profit": {
    "headline": { "up": "الربح ↑{percent}%", "down": "الربح ↓{percent}%", "flat": "الربح بدون تغيير" },
    "margin": "الهامش {current}% ← {previous}% ({sign}{pp} نقطة)",
    "revenue": "الإيرادات",
    "cogs": "تكلفة البضاعة",
    "discounts": "الخصومات"
  },
  "inventory": {
    "headline": "{amount}$ مجمّدة في مخزون راكد",
    "supporting": "{count} منتج لم يُبَع منذ 60 يوماً",
    "viewDeadStock": "عرض المخزون الراكد"
  },
  "staff": {
    "topPerformer": "الأفضل أداءً: {name} — {revenue}$",
    "highestDiscountRate": "أعلى نسبة خصم: {name} — {rate}% (متوسط المحل {shopAverage}%)",
    "viewPerformance": "عرض أداء {name}"
  },
  "customer": {
    "headline": "{count} زبون غير نشط منذ 60+ يوماً",
    "lastPurchase": "آخر شراء: منذ {days} يوماً",
    "sendReminder": "إرسال تذكير",
    "viewDetail": "عرض تفاصيل الزبون"
  },
  "placeholder": "التفاصيل متاحة بعد اكتمال فترة اليوم"
}
```

- [ ] **Step 3: Add the matching keys to the English locale file**

Mirror the same structure with English text (e.g. `"headline": { "up": "Revenue ↑{percent}%", ... }`), same key names, same interpolation placeholders.

- [ ] **Step 4: Verify both locale files still parse as valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/ar.json', 'utf8')); JSON.parse(require('fs').readFileSync('src/i18n/locales/en.json', 'utf8')); console.log('OK')"`

(Adjust paths to whatever Step 1 found.) Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(WAFI-146): add dashboard2 i18n strings (ar/en)"
```

---

### Task 11: `RevenueIntelligenceCard.vue`

**Files:**
- Create: `src/features/dashboard/components/RevenueIntelligenceCard.vue`
- Test: `src/features/dashboard/components/RevenueIntelligenceCard.test.ts`

**Interfaces:**
- Consumes: `IntelligenceCard.vue` (Task 9), `useRevenueIntelligence` (Task 3), `InsightPeriod` type.
- Produces: a component with prop `period: InsightPeriod`, exposing `reload(): Promise<void>` via `defineExpose` so `Dashboard2Screen.vue` (Task 16) can trigger it from the coalesced refresh/pull-to-refresh without re-mounting the component.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/dashboard/components/RevenueIntelligenceCard.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/store/device.store', () => ({ useDeviceStore: () => ({ shopId: 'shop1' }) }))
import { db } from '@/data/powersync/db'
import RevenueIntelligenceCard from './RevenueIntelligenceCard.vue'

describe('RevenueIntelligenceCard', () => {
  beforeEach(() => vi.resetAllMocks())

  it('renders the headline with current/previous values on load', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ total: 900, count: 45 } as any)
    const wrapper = mount(RevenueIntelligenceCard, { props: { period: 'week' } })
    await flushPromises()
    expect(wrapper.text()).toContain('الإيرادات')
  })

  it('exposes reload() for the parent to call on refresh', () => {
    const wrapper = mount(RevenueIntelligenceCard, { props: { period: 'week' } })
    expect(typeof wrapper.vm.reload).toBe('function')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/dashboard/components/RevenueIntelligenceCard.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement**

```vue
<!-- src/features/dashboard/components/RevenueIntelligenceCard.vue -->
<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import IntelligenceCard from './IntelligenceCard.vue'
import { useRevenueIntelligence } from '../composables/useRevenueIntelligence'
import type { InsightPeriod } from '../composables/insightRanges'

const props = defineProps<{ period: InsightPeriod }>()
const { t } = useI18n()
const router = useRouter()
const { data, state, load } = useRevenueIntelligence()
const expanded = ref(false)

async function reload() { await load(props.period) }
defineExpose({ reload })

onMounted(reload)
watch(() => props.period, reload)

const cardState = computed(() => {
  if (state.value !== 'ready') return state.value
  return data.value?.drivers === null ? 'placeholder' : 'ready'
})

const headline = computed(() => {
  if (!data.value) return ''
  const { direction, changePct } = data.value.metric
  const percent = changePct !== null ? Math.abs(changePct).toFixed(0) : '0'
  return t(`dashboard2.revenue.headline.${direction}`, { percent })
})

function driverLabel(key: string): string {
  return t(`dashboard2.revenue.${key}`)
}
</script>

<template>
  <IntelligenceCard
    :state="cardState"
    :expanded="expanded"
    @toggle="expanded = !expanded"
    @retry="reload"
  >
    <template #headline>{{ headline }}</template>
    <template #placeholder>{{ t('dashboard2.placeholder') }}</template>

    <ul v-if="data?.drivers" class="rev-drivers">
      <li v-for="d in data.drivers" :key="d.key" class="rev-driver-row">
        <span class="rev-driver-label">{{ driverLabel(d.key) }}</span>
        <span class="rev-driver-value" dir="ltr">{{ d.previous.toFixed(0) }} → {{ d.current.toFixed(0) }}</span>
      </li>
      <li>
        <RouterLink to="" @click.prevent="router.push(`/history?period=${props.period}`)" class="rev-action-link">
          {{ t('dashboard2.revenue.viewTransactions') }}
        </RouterLink>
      </li>
    </ul>
  </IntelligenceCard>
</template>

<style scoped>
.rev-drivers { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.rev-driver-row { display: flex; align-items: center; justify-content: space-between; font-size: 12px; }
.rev-driver-label { color: #9AA8BE; }
.rev-driver-value { color: #E8EDF5; font-weight: 700; }
.rev-action-link { color: #60A5FA; font-size: 12px; text-decoration: none; cursor: pointer; }
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/dashboard/components/RevenueIntelligenceCard.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/components/RevenueIntelligenceCard.vue src/features/dashboard/components/RevenueIntelligenceCard.test.ts
git commit -m "feat(WAFI-146): add RevenueIntelligenceCard"
```

---

### Task 12: `ProfitIntelligenceCard.vue`

**Files:**
- Create: `src/features/dashboard/components/ProfitIntelligenceCard.vue`
- Test: `src/features/dashboard/components/ProfitIntelligenceCard.test.ts`

**Interfaces:**
- Consumes: `IntelligenceCard.vue`, `useProfitIntelligence` (Task 4).
- Produces: same `period` prop + `reload()` expose pattern as Task 11.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/dashboard/components/ProfitIntelligenceCard.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/store/device.store', () => ({ useDeviceStore: () => ({ shopId: 'shop1' }) }))
import { db } from '@/data/powersync/db'
import ProfitIntelligenceCard from './ProfitIntelligenceCard.vue'

describe('ProfitIntelligenceCard', () => {
  beforeEach(() => vi.resetAllMocks())

  it('headline reads as profit dollars, and margin appears only as a supporting line', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ total: 4000, cogs: 0, count: 0 } as any)
    const wrapper = mount(ProfitIntelligenceCard, { props: { period: 'week' } })
    await flushPromises()
    expect(wrapper.text()).toContain('الربح')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/dashboard/components/ProfitIntelligenceCard.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement**

```vue
<!-- src/features/dashboard/components/ProfitIntelligenceCard.vue -->
<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IntelligenceCard from './IntelligenceCard.vue'
import { useProfitIntelligence } from '../composables/useProfitIntelligence'
import type { InsightPeriod } from '../composables/insightRanges'

const props = defineProps<{ period: InsightPeriod }>()
const { t } = useI18n()
const { data, state, load } = useProfitIntelligence()
const expanded = ref(false)

async function reload() { await load(props.period) }
defineExpose({ reload })

onMounted(reload)
watch(() => props.period, reload)

const cardState = computed(() => {
  if (state.value !== 'ready') return state.value
  return data.value?.drivers === null ? 'placeholder' : 'ready'
})

const headline = computed(() => {
  if (!data.value) return ''
  const { direction, changePct } = data.value.metric
  const percent = changePct !== null ? Math.abs(changePct).toFixed(0) : '0'
  return t(`dashboard2.profit.headline.${direction}`, { percent })
})

const marginLine = computed(() => {
  if (!data.value || data.value.marginCurrentPct === null || data.value.marginPreviousPct === null) return ''
  const current = data.value.marginCurrentPct
  const previous = data.value.marginPreviousPct
  const pp = current - previous
  return t('dashboard2.profit.margin', {
    current: current.toFixed(0), previous: previous.toFixed(0),
    sign: pp >= 0 ? '+' : '', pp: pp.toFixed(0),
  })
})

function driverLabel(key: string): string {
  return t(`dashboard2.profit.${key}`)
}
</script>

<template>
  <IntelligenceCard :state="cardState" :expanded="expanded" @toggle="expanded = !expanded" @retry="reload">
    <template #headline>{{ headline }}</template>
    <template #placeholder>{{ t('dashboard2.placeholder') }}</template>

    <div v-if="data?.drivers">
      <p class="profit-margin-line">{{ marginLine }}</p>
      <ul class="profit-drivers">
        <li v-for="d in data.drivers" :key="d.key" class="profit-driver-row">
          <span class="profit-driver-label">{{ driverLabel(d.key) }}</span>
          <span class="profit-driver-value" dir="ltr">${{ d.previous.toFixed(0) }} → ${{ d.current.toFixed(0) }}</span>
        </li>
      </ul>
    </div>
  </IntelligenceCard>
</template>

<style scoped>
.profit-margin-line { font-size: 12px; color: #9AA8BE; margin: 0 0 10px; }
.profit-drivers { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.profit-driver-row { display: flex; align-items: center; justify-content: space-between; font-size: 12px; }
.profit-driver-label { color: #9AA8BE; }
.profit-driver-value { color: #E8EDF5; font-weight: 700; }
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/dashboard/components/ProfitIntelligenceCard.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/components/ProfitIntelligenceCard.vue src/features/dashboard/components/ProfitIntelligenceCard.test.ts
git commit -m "feat(WAFI-146): add ProfitIntelligenceCard"
```

---

### Task 13: `InventoryIntelligenceCard.vue`

**Files:**
- Create: `src/features/dashboard/components/InventoryIntelligenceCard.vue`
- Test: `src/features/dashboard/components/InventoryIntelligenceCard.test.ts`

**Interfaces:**
- Consumes: `IntelligenceCard.vue`, `useInventoryIntelligence` (Task 5).
- Produces: no `period` prop (point-in-time). Exposes `reload(): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/dashboard/components/InventoryIntelligenceCard.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/store/device.store', () => ({ useDeviceStore: () => ({ shopId: 'shop1' }) }))
import { db } from '@/data/powersync/db'
import InventoryIntelligenceCard from './InventoryIntelligenceCard.vue'

describe('InventoryIntelligenceCard', () => {
  beforeEach(() => vi.resetAllMocks())

  it('leads with the dollar figure, count as supporting text', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { id: 'p1', name_ar: 'منتج', current_stock: 10, cost_price_usd: 50, created_at: '2026-01-01', last_sold_at: null },
    ] as any)
    const wrapper = mount(InventoryIntelligenceCard)
    await flushPromises()
    expect(wrapper.text()).toContain('500')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/dashboard/components/InventoryIntelligenceCard.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement**

```vue
<!-- src/features/dashboard/components/InventoryIntelligenceCard.vue -->
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import IntelligenceCard from './IntelligenceCard.vue'
import { useInventoryIntelligence } from '../composables/useInventoryIntelligence'

const { t } = useI18n()
const router = useRouter()
const { data, state, load } = useInventoryIntelligence()
const expanded = ref(false)

async function reload() { await load() }
defineExpose({ reload })
onMounted(reload)

const headline = computed(() =>
  data.value ? t('dashboard2.inventory.headline', { amount: data.value.totalFrozenCapitalUsd.toFixed(0) }) : ''
)
const supporting = computed(() =>
  data.value ? t('dashboard2.inventory.supporting', { count: data.value.productCount }) : ''
)
</script>

<template>
  <IntelligenceCard :state="state" :expanded="expanded" @toggle="expanded = !expanded" @retry="reload">
    <template #headline>
      <div>{{ headline }}</div>
      <div class="inv-supporting">{{ supporting }}</div>
    </template>

    <ul v-if="data" class="inv-offenders">
      <li v-for="row in data.topOffenders" :key="row.productId" class="inv-offender-row">
        <span>{{ row.nameAr }}</span>
        <span dir="ltr">${{ row.valueUsd.toFixed(0) }}</span>
      </li>
      <li>
        <button type="button" class="inv-action-link" @click="router.push('/reports?tab=deadStock')">
          {{ t('dashboard2.inventory.viewDeadStock') }}
        </button>
      </li>
    </ul>
  </IntelligenceCard>
</template>

<style scoped>
.inv-supporting { font-size: 11px; color: #637285; margin-top: 2px; }
.inv-offenders { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.inv-offender-row { display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: #C8D5E8; }
.inv-action-link { border: none; background: transparent; color: #60A5FA; font-size: 12px; cursor: pointer; padding: 0; }
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/dashboard/components/InventoryIntelligenceCard.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/components/InventoryIntelligenceCard.vue src/features/dashboard/components/InventoryIntelligenceCard.test.ts
git commit -m "feat(WAFI-146): add InventoryIntelligenceCard"
```

---

### Task 14: `StaffIntelligenceCard.vue`

**Files:**
- Create: `src/features/dashboard/components/StaffIntelligenceCard.vue`
- Test: `src/features/dashboard/components/StaffIntelligenceCard.test.ts`

**Interfaces:**
- Consumes: `IntelligenceCard.vue`, `useStaffIntelligence` (Task 6).
- Produces: prop `period: InsightPeriod`, exposes `reload(): Promise<void>`. This component performs no permission check itself — `Dashboard2Screen.vue` (Task 16) decides whether to render it at all, per the spec's "omitted entirely, not shown locked" rule.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/dashboard/components/StaffIntelligenceCard.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/store/device.store', () => ({ useDeviceStore: () => ({ shopId: 'shop1' }) }))
import { db } from '@/data/powersync/db'
import StaffIntelligenceCard from './StaffIntelligenceCard.vue'

describe('StaffIntelligenceCard', () => {
  beforeEach(() => vi.resetAllMocks())

  it('shows top performer and highest discount rate as two separate facts', async () => {
    vi.mocked(db.getAll).mockImplementation(async (sql: unknown) => {
      const s = sql as string
      if (/COUNT\(\*\) AS salesCount/.test(s)) {
        return [{ staffId: 'ahmed', name: 'Ahmed', salesCount: 10, grossUsd: 1000 }] as any
      }
      if (/SUM\(sale_discount_amount_usd\)/.test(s)) {
        return [{ staffId: 'ahmed', discountUsd: 50 }] as any
      }
      return [] as any
    })
    const wrapper = mount(StaffIntelligenceCard, { props: { period: 'week' } })
    await flushPromises()
    expect(wrapper.text()).toContain('Ahmed')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/dashboard/components/StaffIntelligenceCard.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement**

```vue
<!-- src/features/dashboard/components/StaffIntelligenceCard.vue -->
<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import IntelligenceCard from './IntelligenceCard.vue'
import { useStaffIntelligence } from '../composables/useStaffIntelligence'
import type { InsightPeriod } from '../composables/insightRanges'

const props = defineProps<{ period: InsightPeriod }>()
const { t } = useI18n()
const router = useRouter()
const { data, state, load } = useStaffIntelligence()
const expanded = ref(false)

async function reload() { await load(props.period) }
defineExpose({ reload })
onMounted(reload)
watch(() => props.period, reload)

const topPerformerLine = computed(() =>
  data.value?.topPerformer
    ? t('dashboard2.staff.topPerformer', { name: data.value.topPerformer.name, revenue: data.value.topPerformer.revenueUsd.toFixed(0) })
    : ''
)
const highestDiscountLine = computed(() =>
  data.value?.highestDiscountRate && data.value.shopAverageDiscountRatePct !== null
    ? t('dashboard2.staff.highestDiscountRate', {
        name: data.value.highestDiscountRate.name,
        rate: data.value.highestDiscountRate.discountRatePct.toFixed(1),
        shopAverage: data.value.shopAverageDiscountRatePct.toFixed(1),
      })
    : ''
)
</script>

<template>
  <IntelligenceCard :state="state" :expanded="expanded" @toggle="expanded = !expanded" @retry="reload">
    <template #headline>{{ topPerformerLine }}</template>

    <div v-if="data">
      <p v-if="highestDiscountLine" class="staff-discount-line">{{ highestDiscountLine }}</p>
      <button
        v-if="data.topPerformer"
        type="button"
        class="staff-action-link"
        @click="router.push('/reports/staff')"
      >
        {{ t('dashboard2.staff.viewPerformance', { name: data.topPerformer.name }) }}
      </button>
    </div>
  </IntelligenceCard>
</template>

<style scoped>
.staff-discount-line { font-size: 12px; color: #9AA8BE; margin: 0 0 10px; }
.staff-action-link { border: none; background: transparent; color: #60A5FA; font-size: 12px; cursor: pointer; padding: 0; }
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/dashboard/components/StaffIntelligenceCard.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/components/StaffIntelligenceCard.vue src/features/dashboard/components/StaffIntelligenceCard.test.ts
git commit -m "feat(WAFI-146): add StaffIntelligenceCard"
```

---

### Task 15: `CustomerIntelligenceCard.vue`

**Files:**
- Create: `src/features/dashboard/components/CustomerIntelligenceCard.vue`
- Test: `src/features/dashboard/components/CustomerIntelligenceCard.test.ts`

**Interfaces:**
- Consumes: `IntelligenceCard.vue`, `useCustomerIntelligence` (Task 7), `useSendChurnReminder` (Task 8), `useDeviceStore` (for shop name — check `device.store.ts` for the exact field name before using it; if no shop-name field exists there, read it from wherever `HomePage.vue`/`useSendStatement` callers source `shopName` today and reuse that).
- Produces: no `period` prop (point-in-time). Exposes `reload(): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/dashboard/components/CustomerIntelligenceCard.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/store/device.store', () => ({ useDeviceStore: () => ({ shopId: 'shop1', shopName: 'محل تجريبي' }) }))
import { db } from '@/data/powersync/db'
import CustomerIntelligenceCard from './CustomerIntelligenceCard.vue'

describe('CustomerIntelligenceCard', () => {
  beforeEach(() => vi.resetAllMocks())

  it('renders inactive count in the headline', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { customerId: 'c1', customerName: 'زبون', lastPurchaseAt: '2026-05-01T00:00:00.000Z' },
    ] as any)
    const wrapper = mount(CustomerIntelligenceCard)
    await flushPromises()
    expect(wrapper.text()).toContain('1')
  })

  it('hides the send-reminder action when the customer has no phone on file', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { customerId: 'c1', customerName: 'زبون', lastPurchaseAt: '2026-05-01T00:00:00.000Z', phone: null, mobile: null },
    ] as any)
    const wrapper = mount(CustomerIntelligenceCard)
    await flushPromises()
    expect(wrapper.find('[data-testid="send-reminder-c1"]').exists()).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/dashboard/components/CustomerIntelligenceCard.test.ts`
Expected: FAIL — component not found. (Also expected to surface the need for `phone`/`mobile` on `useCustomerIntelligence`'s query — see Step 3's note.)

- [ ] **Step 3: Implement**

First, extend Task 7's `useCustomerIntelligence.ts` query and `InactiveCustomerRow` to also select `c.phone`/`c.mobile` (needed here to decide whether "Send reminder" is shown) — add `phone: string | null` and `mobile: string | null` to `InactiveCustomerRow`, add `c.phone, c.mobile` to the `SELECT`, and pass them through in the `.map()`. This is a small addition to an already-created file, not a new task — do it as part of this task's Step 3, then re-run Task 7's test file to confirm no regression before continuing.

```vue
<!-- src/features/dashboard/components/CustomerIntelligenceCard.vue -->
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import IntelligenceCard from './IntelligenceCard.vue'
import { useCustomerIntelligence } from '../composables/useCustomerIntelligence'
import { useSendChurnReminder } from '@/features/messaging/useSendChurnReminder'
import { useDeviceStore } from '@/store/device.store'

const { t } = useI18n()
const router = useRouter()
const device = useDeviceStore()
const { data, state, load } = useCustomerIntelligence()
const { prepare, send } = useSendChurnReminder()
const expanded = ref(false)

async function reload() { await load() }
defineExpose({ reload })
onMounted(reload)

const headline = computed(() =>
  data.value ? t('dashboard2.customer.headline', { count: data.value.inactiveCount }) : ''
)

function reminderPhone(row: { phone?: string | null; mobile?: string | null }): string | null {
  const prepared = prepare({ customerName: '', shopName: '', phoneRaw: row.phone || row.mobile || undefined })
  return prepared.phone
}

function sendReminder(row: { customerName: string; phone?: string | null; mobile?: string | null }) {
  const prepared = prepare({
    customerName: row.customerName,
    shopName: device.shopName ?? '',
    phoneRaw: row.phone || row.mobile || undefined,
  })
  if (prepared.phone) send(prepared.phone, prepared.text)
}
</script>

<template>
  <IntelligenceCard :state="state" :expanded="expanded" @toggle="expanded = !expanded" @retry="reload">
    <template #headline>{{ headline }}</template>

    <ul v-if="data" class="cust-list">
      <li v-for="row in data.inactiveCustomers" :key="row.customerId" class="cust-row">
        <div class="cust-row-main">
          <span>{{ row.customerName }}</span>
          <span class="cust-row-days" dir="ltr">{{ t('dashboard2.customer.lastPurchase', { days: row.daysSincePurchase }) }}</span>
        </div>
        <div class="cust-row-actions">
          <button
            v-if="reminderPhone(row)"
            type="button"
            :data-testid="`send-reminder-${row.customerId}`"
            class="cust-action-link"
            @click="sendReminder(row)"
          >
            {{ t('dashboard2.customer.sendReminder') }}
          </button>
          <button type="button" class="cust-action-link" @click="router.push(`/customers/${row.customerId}`)">
            {{ t('dashboard2.customer.viewDetail') }}
          </button>
        </div>
      </li>
    </ul>
  </IntelligenceCard>
</template>

<style scoped>
.cust-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.cust-row { border-bottom: 1px solid rgba(255,255,255,.05); padding-bottom: 8px; }
.cust-row-main { display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: #E8EDF5; }
.cust-row-days { color: #637285; }
.cust-row-actions { display: flex; gap: 12px; margin-top: 4px; }
.cust-action-link { border: none; background: transparent; color: #60A5FA; font-size: 11px; cursor: pointer; padding: 0; }
</style>
```

**Note on `device.shopName`:** verify this field exists on `useDeviceStore()` before using it (Glob/Grep `src/store/device.store.ts` for a `shopName` field). If it doesn't exist under that exact name, use whatever field `HomePage.vue`'s shop-name display or `useSendStatement`'s callers already source `shopName` from, and adjust this task's code to match — do not invent a new field.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/dashboard/components/CustomerIntelligenceCard.test.ts src/features/dashboard/composables/__tests__/useCustomerIntelligence.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/components/CustomerIntelligenceCard.vue src/features/dashboard/components/CustomerIntelligenceCard.test.ts src/features/dashboard/composables/useCustomerIntelligence.ts
git commit -m "feat(WAFI-146): add CustomerIntelligenceCard, extend useCustomerIntelligence with phone fields"
```

---

### Task 16: `Dashboard2Screen.vue` — layout, orchestration, coalesced refresh

**Files:**
- Create: `src/features/dashboard/components/Dashboard2Screen.vue`
- Test: `src/features/dashboard/components/Dashboard2Screen.test.ts`

**Interfaces:**
- Consumes: all 5 card components (Tasks 11-15), `useCan` from `@/composables/useCan`, `useEventSubscription` from `@/services/events/useEventSubscription`, `useDeviceStore`.
- Produces: the mounted screen. No further consumers within this plan (Task 17 wires the route to this component's import path only).

- [ ] **Step 1: Write the failing test**

```ts
// src/features/dashboard/components/Dashboard2Screen.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/store/device.store', () => ({ useDeviceStore: () => ({ shopId: 'shop1', shopName: 'محل' }) }))
vi.mock('@/composables/useCan', () => ({ useCan: () => ({ can: () => ({ value: true }) }) }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
import { db } from '@/data/powersync/db'
import Dashboard2Screen from './Dashboard2Screen.vue'

describe('Dashboard2Screen', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(db.getOptional).mockResolvedValue({ total: 0, count: 0, cogs: 0 } as any)
    vi.mocked(db.getAll).mockResolvedValue([] as any)
    vi.mocked(db.watch).mockImplementation(async function* () { yield { rows: { _array: [] } } as any })
  })

  it('renders all 5 cards when the viewer has staff-performance permission', async () => {
    const wrapper = mount(Dashboard2Screen)
    await flushPromises()
    expect(wrapper.findComponent({ name: 'StaffIntelligenceCard' }).exists()).toBe(true)
  })

  it('renders the period selector with today/week/month options', () => {
    const wrapper = mount(Dashboard2Screen)
    expect(wrapper.text()).toContain('اليوم')
    expect(wrapper.text()).toContain('الأسبوع')
    expect(wrapper.text()).toContain('الشهر')
  })
})
```

Note: `db.watch` in the shared mock (`src/__tests__/__mocks__/db.ts`) may already support async-iterable mocking used elsewhere (e.g. `NotificationCenterScreen`'s tests) — check that file first and match its existing mocking convention instead of the ad hoc generator above if a helper already exists.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/dashboard/components/Dashboard2Screen.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement**

```vue
<!-- src/features/dashboard/components/Dashboard2Screen.vue -->
<!-- WAFI-146: Dashboard 2.0. Home (HomePage.vue) stays the fast operational
     glance; this screen is the "why did this move" layer, gated behind the
     Reporting Pack same as /reports. -->
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useCan } from '@/composables/useCan'
import { useDeviceStore } from '@/store/device.store'
import { useEventSubscription } from '@/services/events/useEventSubscription'
import type { DomainEventType } from '@/services/events/domainEvent.types'
import type { InsightPeriod } from '../composables/insightRanges'
import RevenueIntelligenceCard from './RevenueIntelligenceCard.vue'
import ProfitIntelligenceCard from './ProfitIntelligenceCard.vue'
import InventoryIntelligenceCard from './InventoryIntelligenceCard.vue'
import StaffIntelligenceCard from './StaffIntelligenceCard.vue'
import CustomerIntelligenceCard from './CustomerIntelligenceCard.vue'

const { t } = useI18n()
const router = useRouter()
const device = useDeviceStore()
const { can } = useCan()
const canViewStaffPerformance = can('can_view_staff_performance')

const period = ref<InsightPeriod>('day')
const expandedKey = ref<string | null>(null) // mobile accordion: only one card expanded at a time
const isMobile = ref(window.matchMedia('(max-width: 767px)').matches)

const revenueRef = ref<InstanceType<typeof RevenueIntelligenceCard> | null>(null)
const profitRef = ref<InstanceType<typeof ProfitIntelligenceCard> | null>(null)
const inventoryRef = ref<InstanceType<typeof InventoryIntelligenceCard> | null>(null)
const staffRef = ref<InstanceType<typeof StaffIntelligenceCard> | null>(null)
const customerRef = ref<InstanceType<typeof CustomerIntelligenceCard> | null>(null)

async function reloadAll() {
  const loaders = [
    revenueRef.value?.reload(),
    profitRef.value?.reload(),
    inventoryRef.value?.reload(),
    customerRef.value?.reload(),
  ]
  if (canViewStaffPerformance.value) loaders.push(staffRef.value?.reload())
  await Promise.allSettled(loaders)
}

function setPeriod(p: InsightPeriod) { period.value = p }

// Coalesced event-driven refresh: several of these can fire within
// milliseconds of a single sale (sale.completed + customer.debt_changed,
// etc.) — batch them into one refresh cycle rather than one per event.
let refreshTimer: ReturnType<typeof setTimeout> | null = null
function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => { void reloadAll() }, 300)
}

const REFRESH_ON_EVENTS: DomainEventType[] = [
  'sale.completed', 'sale.returned', 'customer.debt_changed', 'sale.discounted',
]
const subs = REFRESH_ON_EVENTS.map(type =>
  useEventSubscription(type, scheduleRefresh, { shopId: device.shopId })
)

onBeforeUnmount(() => {
  subs.forEach(s => s.stop())
  if (refreshTimer) clearTimeout(refreshTimer)
})

onMounted(reloadAll)

const PERIODS: InsightPeriod[] = ['day', 'week', 'month']
</script>

<template>
  <div class="d2-root" dir="rtl">
    <header class="d2-period-row">
      <div class="d2-period-toggle">
        <button
          v-for="p in PERIODS" :key="p"
          class="d2-period-btn" :class="{ active: period === p }"
          @click="setPeriod(p)"
        >{{ t(`dashboard2.periodLabel.${p}`) }}</button>
      </div>
    </header>

    <div class="d2-grid">
      <RevenueIntelligenceCard ref="revenueRef" :period="period" />
      <ProfitIntelligenceCard ref="profitRef" :period="period" />
      <InventoryIntelligenceCard ref="inventoryRef" />
      <StaffIntelligenceCard v-if="canViewStaffPerformance" ref="staffRef" :period="period" />
      <CustomerIntelligenceCard ref="customerRef" />
    </div>

    <div class="d2-quick-actions">
      <button type="button" @click="router.push('/pos')">بيع جديد</button>
      <button type="button" @click="router.push('/expenses/new')">تسجيل مصروف</button>
      <button type="button" @click="router.push('/customers')">تسجيل دفعة</button>
      <button type="button" @click="router.push('/shifts/history')">فتح دوام</button>
    </div>
  </div>
</template>

<style scoped>
.d2-root { padding: 16px; }
.d2-period-row { margin-bottom: 16px; }
.d2-period-toggle { display: flex; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07); border-radius: 10px; padding: 3px; gap: 2px; width: fit-content; }
.d2-period-btn { padding: 7px 14px; border-radius: 8px; background: transparent; border: none; color: #637285; font-family: 'Tajawal', sans-serif; font-size: 12px; font-weight: 600; cursor: pointer; }
.d2-period-btn.active { background: #1A56DB; color: white; font-weight: 700; }
.d2-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
  margin-bottom: 20px;
}
@media (min-width: 768px) { .d2-grid { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 1024px) { .d2-grid { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); } }
.d2-quick-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.d2-quick-actions button {
  flex: 1; min-width: 140px; padding: 10px; border-radius: 10px;
  border: 1.5px dashed rgba(26,86,219,.3); background: rgba(26,86,219,.04);
  color: #C8D5E8; font-family: 'Tajawal', sans-serif; font-size: 12px; cursor: pointer;
}
</style>
```

**Note on quick-action routes:** `/expenses/new` as written above is a guess — verify the actual route for "add expense" (likely a dialog triggered from `HomePage.vue`'s `showExpenseForm`, not a standalone route) and "record payment" (likely under `/customers/:id` or `/customers/collections`) before finalizing this template; adjust the `@click` handlers to whatever the real navigation/dialog-open mechanism is (may need to import `ExpenseForm.vue` and toggle a local `ref` the same way `HomePage.vue` does, rather than a router push, if no standalone route exists).

**Note on mobile accordion:** the `expandedKey`/`isMobile` refs are declared but the accordion coordination itself (passing `expanded`/`toggle` down to override each card's own internal `expanded` state on mobile) is not fully wired in this first pass — each card currently manages its own `expanded` ref internally (Tasks 11-15). Wiring true cross-card accordion coordination requires lifting `expanded` state out of each card component and into this screen (each card's `expanded` prop driven by `expandedKey === cardKey`, `toggle` emitting to set/clear `expandedKey` here instead of flipping a local ref). This is a real gap between this task and the design spec's "Expand behavior" requirement — treat it as this task's Step 3b, not deferred:

- [ ] **Step 3b: Lift expand state for mobile accordion**

Change each of Tasks 11-15's card components to accept `expanded: boolean` as a prop (instead of an internal `ref`) and emit `toggle` up instead of flipping a local ref — i.e. remove `const expanded = ref(false)` from each and change `@toggle="expanded = !expanded"` to `@toggle="emit('toggle')"` with `const emit = defineEmits<{ toggle: [] }>()` added. Then in `Dashboard2Screen.vue`, bind:

```vue
<RevenueIntelligenceCard ref="revenueRef" :period="period" :expanded="isMobile ? expandedKey === 'revenue' : cardExpanded.revenue" @toggle="onToggle('revenue')" />
```
with:
```ts
const cardExpanded = ref<Record<string, boolean>>({ revenue: false, profit: false, inventory: false, staff: false, customer: false })
function onToggle(key: string) {
  if (isMobile.value) {
    expandedKey.value = expandedKey.value === key ? null : key
  } else {
    cardExpanded.value[key] = !cardExpanded.value[key]
  }
}
```
repeated for all 5 cards. Go back and re-run each of Tasks 11-15's component tests after this change (their `expanded` prop contract changes from "component-owned" to "parent-owned") — update those tests to pass `:expanded` as a prop and assert the emitted `toggle` event instead of asserting an internal state flip.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/dashboard/components/`
Expected: PASS across all card tests and `Dashboard2Screen.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/components/
git commit -m "feat(WAFI-146): add Dashboard2Screen with coalesced refresh and mobile accordion"
```

---

### Task 17: Route + nav entry

**Files:**
- Modify: `src/router/index.ts`
- Modify: whatever component renders the sidebar/bottom-nav items (find it via Grep for the existing `/reports` nav entry, e.g. Grep `"/reports"` across `src/components` or `src/features/**/App*` — `App.vue` was seen importing shell pieces in `HomePage.vue`'s context, so check `App.vue` and any `AppSidebar.vue`/`BottomNav.vue` files first).
- Test: extend `src/router/__tests__/index.test.ts` if it asserts route entries by path (check its structure first).

**Interfaces:**
- Consumes: `Dashboard2Screen.vue` (Task 16).
- Produces: nothing further consumed within this plan.

- [ ] **Step 1: Find the nav component**

Run: `grep -rln "/reports'" src/components src/features 2>/dev/null` (or use Grep tool) to find every file referencing the `/reports` route as a nav link — that's the sidebar/bottom-nav component(s) to also edit.

- [ ] **Step 2: Write the failing router test**

Add to `src/router/__tests__/index.test.ts` (matching its existing test style — read a couple of its existing cases first to match conventions exactly):

```ts
it('registers /dashboard gated by can_view_reports + reporting_pack, same as /reports', () => {
  const route = router.getRoutes().find(r => r.path === '/dashboard')
  expect(route).toBeDefined()
  expect(route?.meta).toEqual({ permission: 'can_view_reports', feature: 'reporting_pack' })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/router/__tests__/index.test.ts`
Expected: FAIL — no `/dashboard` route registered.

- [ ] **Step 4: Add the route**

In `src/router/index.ts`, add immediately after the existing `/reports` entry:

```ts
    { path: '/dashboard', component: () => import('@/features/dashboard/components/Dashboard2Screen.vue'), meta: { permission: 'can_view_reports', feature: 'reporting_pack' } },
```

- [ ] **Step 5: Add the nav entry**

In whatever component Step 1 found, add a new nav item pointing to `/dashboard` alongside the existing `/reports` item — copy that item's exact markup/icon pattern and swap the path/label/icon (use a distinct icon from `/reports`'s to avoid visual duplication; a simple line-chart or "grid" icon consistent with the existing SVG icon style already used in that nav component).

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/router/__tests__/index.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/router/index.ts src/router/__tests__/index.test.ts
git add -A  # picks up the nav component edit found in Step 1/5
git commit -m "feat(WAFI-146): register /dashboard route and nav entry"
```

---

### Task 18: Domain Interaction Matrix + plan status update

**Files:**
- Modify: `AI_PRINCIPAL_ENGINEER_REVIEW.md`
- Modify: `WAFI_Production_Readiness_Plan_v3.md` (mark WAFI-146 status, matching how WAFI-143/144/145 entries were closed out per their commit history — check one of those commits, e.g. `git show 642c834` for WAFI-143's status-update format, and match it)

**Interfaces:** none — documentation only.

- [ ] **Step 1: Update the Domain Interaction Matrix**

In `AI_PRINCIPAL_ENGINEER_REVIEW.md`'s `DOMAIN INTERACTION MATRIX` table, append "Dashboard 2.0" to the "Reports/Dashboards affected" column for the `Sales`, `Returns`, `Inventory`, `Staff`, and `Customer Credit` rows (the exact rows listed in the spec's Cross-Epic Edge-Case Checklist).

- [ ] **Step 2: Add the final-review checklist block**

Below the existing `### WAFI-145 — Owner Notification Center (final review)` block in the same file, add:

```
### WAFI-146 — Dashboard 2.0 (final review)

```
## Cross-Epic Edge-Case Checklist (final review)
Matrix rows re-checked after implementation: Sales, Returns, Inventory, Staff, Customer Credit, Insights
Domains touched but not covered in the original spec checklist: none
```
```

(Fill in "Domains touched but not covered" honestly if implementation surfaced something the spec missed — don't leave the "none" as a rubber stamp if it isn't true.)

- [ ] **Step 3: Update the readiness plan status**

In `WAFI_Production_Readiness_Plan_v3.md`, mark WAFI-146 as done in whatever status convention the prior WAFI-143/144/145 entries used (check via `git log --oneline --grep="WAFI-143.*status\|close out WAFI-143"` and read that commit's diff for the exact format).

- [ ] **Step 4: Commit**

```bash
git add AI_PRINCIPAL_ENGINEER_REVIEW.md WAFI_Production_Readiness_Plan_v3.md
git commit -m "docs(WAFI-146): update Domain Interaction Matrix and readiness plan status"
```

---

## Self-Review Notes

**Spec coverage:** every card (Revenue/Profit/Inventory/Staff/Customer), the shared shell, comparison-basis inheritance + day-gating, coalesced refresh, `Promise.allSettled` orchestration, mobile accordion, i18n data/presentation split, route/nav gating, and the Domain Interaction Matrix update from the v3 spec each have a task. The two known implementation gaps flagged inline (Task 16's quick-action routes, Task 16 Step 3b's accordion lift) are called out explicitly with an instruction to verify against real code rather than left as silent assumptions — per this plan's own Global Constraints and the earlier review's insistence on verifying before implementing.

**Known follow-ups intentionally NOT in this plan** (per spec's Scope section): register-offline-duration tracking, supplier price-change history, selectable comparison anchors, sparklines, "View returns"/"View discounts" list screens, a real churn-prediction model. None of these should be added to this plan without a new design spec first.
