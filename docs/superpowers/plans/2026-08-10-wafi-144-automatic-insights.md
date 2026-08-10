# WAFI-144 — Automatic Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a stateless engine that compares the current period's
Revenue and Profit against the equivalent prior cycle (same weekday
last week / previous week / previous month) and surfaces a short
plain-language insight ("Sales are 12% lower than last Tuesday") on
Home and the Reports page.

**Architecture:** A pure date-range module (`insightRanges.ts`, no I/O,
fully unit-testable) computes the current/comparison window per
period. Two small new DB query helpers (`getShopCreatedAt`,
`getRevenueUsdUpToTimestamp`) fill the two gaps `useDashboardMetrics`
can't: reading `shops.created_at` (never exposed client-side today)
and a timestamp-bounded revenue query (needed only for the `day`
period's comparison-day truncation, since `sales.created_at` has real
time-of-day precision but `expenses.expense_date` does not). The
orchestrating composable `useAutomaticInsights.ts` combines these with
the existing `useDashboardMetrics` for every other case, applies the
threshold/direction rules, and returns typed `Insight[]` — no strings,
no i18n, no DOM. A new `InsightBanner.vue` component (mirroring
`AnomalyBanner.vue`'s existing card styling) owns phrasing/color and is
mounted on Home (`period: 'day'`) and the Reports page
(`period: 'week' | 'month'`, following its period selector).

**Tech Stack:** Vue 3 `<script setup>`, TypeScript, Vitest, PowerSync
(`db.getOptional`), vue-i18n (`useI18n`/`t()`).

## Global Constraints

- `INSIGHT_PERCENT_THRESHOLD = 10` (percent), `INSIGHT_MIN_ABSOLUTE_CHANGE_USD = 5` (dollars) — both metrics, named constants, not inlined.
- Metrics: Revenue and Profit only. No other metric in this ticket.
- Periods: `'day' | 'week' | 'month'` only. No quarter/custom support — those periods render nothing.
- No new database table, no new migration, no persistence, no read/dismiss state — every load is a live, stateless recompute.
- No pro-rating or estimation of expenses — profit's `day` insight is skipped entirely while today is in progress; it is never approximated.
- All date/time math uses local wall-clock `Date` getters (`getHours()`, `getDate()`, `getFullYear()`, `getMonth()`, `getDay()`) — never `Date.UTC`/`getUTCHours()`.
- Week is ISO/Monday-start (matches `periodUtils.ts`'s existing convention).
- USD only — no SYP handling, no new currency-formatting component; money renders exactly like existing code: `${{ value.toFixed(2) }}` inside `dir="ltr"`.
- A comparison period is "missing" iff its start date is before `shops.created_at` — not merely "no rows returned."
- The engine (`useAutomaticInsights.ts`, `insightRanges.ts`) returns typed data only — it must not import `vue-i18n` or produce any user-facing string.

---

## Task 1: Pure date-range logic (`insightRanges.ts`)

**Files:**
- Create: `src/features/dashboard/composables/insightRanges.ts`
- Test: `src/features/dashboard/composables/__tests__/insightRanges.test.ts`

**Interfaces:**
- Consumes: nothing (pure function, no imports from other new files).
- Produces:
  ```ts
  export type InsightPeriod = 'day' | 'week' | 'month'
  export interface InsightRange { start: string; end: string }
  export interface InsightRangePair {
    current: InsightRange
    comparison: InsightRange
    isCurrentDayComplete: boolean
  }
  export function getInsightRanges(period: InsightPeriod, now?: Date): InsightRangePair
  export function getComparisonCutoffIso(comparisonDateStr: string, now: Date): string
  ```
  Used by Task 4 (`useAutomaticInsights.ts`).

- [ ] **Step 1: Write the failing tests**

```ts
// src/features/dashboard/composables/__tests__/insightRanges.test.ts
import { describe, it, expect } from 'vitest'
import { getInsightRanges, getComparisonCutoffIso } from '../insightRanges'

describe('getInsightRanges', () => {
  it('day: compares today against the same weekday last week', () => {
    // Wednesday 2026-08-12
    const now = new Date(2026, 7, 12, 14, 30, 0)
    const { current, comparison, isCurrentDayComplete } = getInsightRanges('day', now)
    expect(current).toEqual({ start: '2026-08-12', end: '2026-08-12' })
    expect(comparison).toEqual({ start: '2026-08-05', end: '2026-08-05' })
    expect(isCurrentDayComplete).toBe(false)
  })

  it('day: isCurrentDayComplete is only true at exact local midnight', () => {
    const midnight = new Date(2026, 7, 12, 0, 0, 0, 0)
    expect(getInsightRanges('day', midnight).isCurrentDayComplete).toBe(true)
  })

  it('week: current is Monday-of-this-week through today; comparison is the same weekday offset in the prior week', () => {
    // Wednesday 2026-08-12 -> this week's Monday is 2026-08-10
    const now = new Date(2026, 7, 12, 9, 0, 0)
    const { current, comparison } = getInsightRanges('week', now)
    expect(current).toEqual({ start: '2026-08-10', end: '2026-08-12' })
    expect(comparison).toEqual({ start: '2026-08-03', end: '2026-08-05' })
  })

  it('week: Monday itself compares a single day against last Monday', () => {
    const monday = new Date(2026, 7, 10, 9, 0, 0)
    const { current, comparison } = getInsightRanges('week', monday)
    expect(current).toEqual({ start: '2026-08-10', end: '2026-08-10' })
    expect(comparison).toEqual({ start: '2026-08-03', end: '2026-08-03' })
  })

  it('month: current is 1st-of-month through today; comparison is 1st of prior month through the same day-of-month', () => {
    // 2026-08-12 -> prior month is July (31 days), day 12 exists there
    const now = new Date(2026, 7, 12, 9, 0, 0)
    const { current, comparison } = getInsightRanges('month', now)
    expect(current).toEqual({ start: '2026-08-01', end: '2026-08-12' })
    expect(comparison).toEqual({ start: '2026-07-01', end: '2026-07-12' })
  })

  it('month: clamps the comparison day-of-month to the prior month\'s length (no rollover)', () => {
    // 2026-03-31 -> prior month is February 2026 (28 days, not a leap year)
    const now = new Date(2026, 2, 31, 9, 0, 0)
    const { comparison } = getInsightRanges('month', now)
    expect(comparison).toEqual({ start: '2026-02-01', end: '2026-02-28' })
  })

  it('week and month always report the day as complete (whole-day granularity, no intraday truncation needed)', () => {
    const now = new Date(2026, 7, 12, 9, 0, 0)
    expect(getInsightRanges('week', now).isCurrentDayComplete).toBe(true)
    expect(getInsightRanges('month', now).isCurrentDayComplete).toBe(true)
  })
})

describe('getComparisonCutoffIso', () => {
  it('builds a timestamp on the comparison date at the same local wall-clock time as `now`', () => {
    const now = new Date(2026, 7, 12, 14, 30, 45)
    const cutoff = new Date(getComparisonCutoffIso('2026-08-05', now))
    expect(cutoff.getFullYear()).toBe(2026)
    expect(cutoff.getMonth()).toBe(7)
    expect(cutoff.getDate()).toBe(5)
    expect(cutoff.getHours()).toBe(14)
    expect(cutoff.getMinutes()).toBe(30)
    expect(cutoff.getSeconds()).toBe(45)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/dashboard/composables/__tests__/insightRanges.test.ts`
Expected: FAIL — `insightRanges` module not found.

- [ ] **Step 3: Implement `insightRanges.ts`**

```ts
// src/features/dashboard/composables/insightRanges.ts

export type InsightPeriod = 'day' | 'week' | 'month'

export interface InsightRange {
  start: string
  end: string
}

export interface InsightRangePair {
  current: InsightRange
  comparison: InsightRange
  /**
   * Only meaningful for period 'day'. True once the current day has fully
   * elapsed. In practice this is always false for the only caller today
   * (Home always evaluates 'day' as the live "today"), because a day that is
   * still being observed is by definition not yet complete — see the
   * "Data-layer constraint" note in the WAFI-144 design spec
   * (docs/superpowers/specs/2026-08-10-wafi-144-automatic-insights-design.md).
   * It's kept as a real, testable computation (not hardcoded to false) so a
   * future caller requesting a specific past day works without touching this
   * function. 'week'/'month' are always reported complete: their comparison
   * only needs whole-day granularity, which the existing date-bounded
   * queries already provide with no truncation.
   */
  isCurrentDayComplete: boolean
}

function toDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d)
  copy.setDate(copy.getDate() + days)
  return copy
}

function getDayRanges(now: Date): InsightRangePair {
  const today = toDateStr(now)
  const comparisonDate = toDateStr(addDays(now, -7))
  return {
    current: { start: today, end: today },
    comparison: { start: comparisonDate, end: comparisonDate },
    isCurrentDayComplete:
      now.getHours() === 0 && now.getMinutes() === 0 &&
      now.getSeconds() === 0 && now.getMilliseconds() === 0,
  }
}

function getWeekRanges(now: Date): InsightRangePair {
  // ISO week starts Monday. JS getDay(): 0=Sun, 1=Mon, ..., 6=Sat
  const day = now.getDay()
  const daysBackToMonday = day === 0 ? 6 : day - 1
  const mondayThisWeek = addDays(now, -daysBackToMonday)
  const mondayLastWeek = addDays(mondayThisWeek, -7)
  const comparisonEnd = addDays(mondayLastWeek, daysBackToMonday)
  return {
    current: { start: toDateStr(mondayThisWeek), end: toDateStr(now) },
    comparison: { start: toDateStr(mondayLastWeek), end: toDateStr(comparisonEnd) },
    isCurrentDayComplete: true,
  }
}

function daysInMonth(year: number, monthIndex: number): number {
  // Day 0 of the *next* month is the last day of `monthIndex`.
  return new Date(year, monthIndex + 1, 0).getDate()
}

function getMonthRanges(now: Date): InsightRangePair {
  const firstThisMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const firstPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const prevMonthLength = daysInMonth(firstPrevMonth.getFullYear(), firstPrevMonth.getMonth())
  const comparisonDay = Math.min(now.getDate(), prevMonthLength)
  const comparisonEnd = new Date(firstPrevMonth.getFullYear(), firstPrevMonth.getMonth(), comparisonDay)
  return {
    current: { start: toDateStr(firstThisMonth), end: toDateStr(now) },
    comparison: { start: toDateStr(firstPrevMonth), end: toDateStr(comparisonEnd) },
    isCurrentDayComplete: true,
  }
}

export function getInsightRanges(period: InsightPeriod, now: Date = new Date()): InsightRangePair {
  if (period === 'day') return getDayRanges(now)
  if (period === 'week') return getWeekRanges(now)
  return getMonthRanges(now)
}

/**
 * The comparison date's timestamp at the same local wall-clock time as `now`.
 * Used only for the 'day' period's comparison-day revenue truncation (see
 * Task 3) — the moment on `comparisonDateStr` that corresponds to "right
 * now" on the current day.
 */
export function getComparisonCutoffIso(comparisonDateStr: string, now: Date): string {
  const [y, m, d] = comparisonDateStr.split('-').map(Number)
  const cutoff = new Date(
    y, m - 1, d,
    now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds(),
  )
  return cutoff.toISOString()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/dashboard/composables/__tests__/insightRanges.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/composables/insightRanges.ts src/features/dashboard/composables/__tests__/insightRanges.test.ts
git commit -m "feat(WAFI-144): add pure insight comparison-range logic"
```

---

## Task 2: `shops.created_at` query helper

**Files:**
- Create: `src/composables/insights/shopCreatedAt.ts`
- Test: `src/composables/insights/__tests__/shopCreatedAt.test.ts`

**Interfaces:**
- Consumes: `db` from `@/data/powersync/db`, `useDeviceStore` from `@/store/device.store` (existing — `device.shopId`).
- Produces: `export async function getShopCreatedAt(): Promise<string | null>` — used by Task 4.

- [ ] **Step 1: Write the failing test**

```ts
// src/composables/insights/__tests__/shopCreatedAt.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getShopCreatedAt } from '../shopCreatedAt'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

vi.mock('@/data/powersync/db', () => ({
  db: { getOptional: vi.fn() },
}))

describe('getShopCreatedAt', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(db.getOptional).mockReset()
  })

  it('returns the shop\'s created_at when a row exists', async () => {
    useDeviceStore().shopId = 'shop-1'
    vi.mocked(db.getOptional).mockResolvedValue({ created_at: '2026-01-15T08:00:00.000Z' })
    const result = await getShopCreatedAt()
    expect(result).toBe('2026-01-15T08:00:00.000Z')
    expect(db.getOptional).toHaveBeenCalledWith(
      expect.stringContaining('FROM shops'),
      ['shop-1'],
    )
  })

  it('returns null when no shop row is found', async () => {
    useDeviceStore().shopId = 'shop-1'
    vi.mocked(db.getOptional).mockResolvedValue(undefined)
    expect(await getShopCreatedAt()).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/composables/insights/__tests__/shopCreatedAt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `shopCreatedAt.ts`**

```ts
// src/composables/insights/shopCreatedAt.ts
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

/**
 * Reads `shops.created_at` for the current device's shop. Not exposed by any
 * existing store/composable (device.store.ts, flags.store.ts,
 * useDiscountCaps.ts each select other columns only) — used to distinguish a
 * "missing" comparison period (shop didn't exist yet) from a genuine $0
 * result. See the WAFI-144 design spec's "Missing is a precise term" note.
 */
export async function getShopCreatedAt(): Promise<string | null> {
  const device = useDeviceStore()
  const row = await db.getOptional<{ created_at: string }>(
    `SELECT created_at FROM shops WHERE id = ?`,
    [device.shopId],
  )
  return row?.created_at ?? null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/composables/insights/__tests__/shopCreatedAt.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/composables/insights/shopCreatedAt.ts src/composables/insights/__tests__/shopCreatedAt.test.ts
git commit -m "feat(WAFI-144): add shops.created_at query helper"
```

---

## Task 3: Timestamp-bounded revenue query (day-period comparison truncation)

**Files:**
- Create: `src/composables/insights/revenueUpToTimestamp.ts`
- Test: `src/composables/insights/__tests__/revenueUpToTimestamp.test.ts`

**Interfaces:**
- Consumes: `db` from `@/data/powersync/db`, `useDeviceStore` from `@/store/device.store`.
- Produces: `export async function getRevenueUsdUpToTimestamp(dateStr: string, cutoffIso: string): Promise<number>` — used by Task 4, only on the `day` period's in-progress branch.

- [ ] **Step 1: Write the failing test**

```ts
// src/composables/insights/__tests__/revenueUpToTimestamp.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getRevenueUsdUpToTimestamp } from '../revenueUpToTimestamp'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

vi.mock('@/data/powersync/db', () => ({
  db: { getOptional: vi.fn() },
}))

describe('getRevenueUsdUpToTimestamp', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useDeviceStore().shopId = 'shop-1'
    vi.mocked(db.getOptional).mockReset()
  })

  it('returns sales total minus refunds, both bounded by the cutoff timestamp', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ total: 510 })  // sales query
      .mockResolvedValueOnce({ total: 10 })   // refunds query
    const result = await getRevenueUsdUpToTimestamp('2026-08-05', '2026-08-05T14:30:45.000Z')
    expect(result).toBe(500)
    expect(db.getOptional).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('FROM sales'),
      ['shop-1', '2026-08-05', '2026-08-05T14:30:45.000Z'],
    )
    expect(db.getOptional).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('FROM returns'),
      ['shop-1', '2026-08-05', '2026-08-05T14:30:45.000Z'],
    )
  })

  it('treats missing rows as zero', async () => {
    vi.mocked(db.getOptional).mockResolvedValue(undefined)
    expect(await getRevenueUsdUpToTimestamp('2026-08-05', '2026-08-05T14:30:45.000Z')).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/composables/insights/__tests__/revenueUpToTimestamp.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `revenueUpToTimestamp.ts`**

```ts
// src/composables/insights/revenueUpToTimestamp.ts
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

/**
 * Revenue (sales total minus refunds) for a single local calendar date,
 * bounded to records created at or before `cutoffIso`. Used only for the
 * 'day' period's comparison-day truncation while today is still in progress
 * (see the WAFI-144 design spec's "Data-layer constraint" note) — mirrors
 * useDashboardMetrics' revenue formula (revenueUsd = sales total - refunds)
 * but scoped to one date with a timestamp upper bound instead of
 * DATE(created_at,'localtime') BETWEEN start AND end, which cannot express
 * "before 14:30 today."
 */
export async function getRevenueUsdUpToTimestamp(dateStr: string, cutoffIso: string): Promise<number> {
  const device = useDeviceStore()
  const [salesRow, refundRow] = await Promise.all([
    db.getOptional<{ total: number }>(
      `SELECT COALESCE(SUM(total_usd), 0) as total
       FROM sales
       WHERE shop_id = ? AND DATE(created_at, 'localtime') = ? AND created_at <= ?`,
      [device.shopId, dateStr, cutoffIso],
    ),
    db.getOptional<{ total: number }>(
      `SELECT COALESCE(SUM(r.refund_amount_usd), 0) as total
       FROM returns r
       JOIN sales s ON s.id = r.original_sale_id
       WHERE r.shop_id = ? AND DATE(r.created_at, 'localtime') = ? AND r.created_at <= ?`,
      [device.shopId, dateStr, cutoffIso],
    ),
  ])
  const refunds = refundRow?.total ?? 0
  return (salesRow?.total ?? 0) - refunds
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/composables/insights/__tests__/revenueUpToTimestamp.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/composables/insights/revenueUpToTimestamp.ts src/composables/insights/__tests__/revenueUpToTimestamp.test.ts
git commit -m "feat(WAFI-144): add timestamp-bounded revenue query for day-period comparison truncation"
```

---

## Task 4: Threshold/direction evaluation logic (pure)

**Files:**
- Create: `src/composables/insights/evaluateInsight.ts`
- Test: `src/composables/insights/__tests__/evaluateInsight.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions).
- Produces:
  ```ts
  export type InsightDirection =
    | 'up' | 'down'
    | 'loss_to_profit' | 'profit_to_loss'
    | 'loss_widened' | 'loss_narrowed'

  export interface Insight {
    metric: 'revenue' | 'profit'
    direction: InsightDirection
    currentUsd: number
    previousUsd: number
    percentChange: number | null
  }

  export function evaluateRevenue(
    currentUsd: number,
    previousUsd: number,
    isMissing: boolean,
  ): Insight | null

  export function evaluateProfit(
    currentUsd: number,
    previousUsd: number,
    isMissing: boolean,
    skipIntraday: boolean,
  ): Insight | null
  ```
  Used by Task 5 (`useAutomaticInsights.ts`).

- [ ] **Step 1: Write the failing tests**

```ts
// src/composables/insights/__tests__/evaluateInsight.test.ts
import { describe, it, expect } from 'vitest'
import { evaluateRevenue, evaluateProfit } from '../evaluateInsight'

describe('evaluateRevenue', () => {
  it('generates an "up" insight when both thresholds are met', () => {
    const result = evaluateRevenue(115, 100, false)
    expect(result).toEqual({ metric: 'revenue', direction: 'up', currentUsd: 115, previousUsd: 100, percentChange: 15 })
  })

  it('generates a "down" insight when both thresholds are met', () => {
    const result = evaluateRevenue(85, 100, false)
    expect(result).toEqual({ metric: 'revenue', direction: 'down', currentUsd: 85, previousUsd: 100, percentChange: -15 })
  })

  it('skips when percent change is below the threshold', () => {
    expect(evaluateRevenue(108, 100, false)).toBeNull()
  })

  it('skips when the dollar change is below the floor even if percent is high', () => {
    expect(evaluateRevenue(6, 4, false)).toBeNull()
  })

  it('skips when the comparison baseline is zero', () => {
    expect(evaluateRevenue(45, 0, false)).toBeNull()
  })

  it('skips when the comparison period is missing', () => {
    expect(evaluateRevenue(450, 500, true)).toBeNull()
  })

  it('generates a "down" insight for an exact 100% drop (current is $0)', () => {
    const result = evaluateRevenue(0, 100, false)
    expect(result).toEqual({ metric: 'revenue', direction: 'down', currentUsd: 0, previousUsd: 100, percentChange: -100 })
  })
})

describe('evaluateProfit', () => {
  it('generates an "up" insight when both periods are profitable and thresholds are met', () => {
    const result = evaluateProfit(130, 100, false, false)
    expect(result).toEqual({ metric: 'profit', direction: 'up', currentUsd: 130, previousUsd: 100, percentChange: 30 })
  })

  it('skips when both are profitable but below the percent threshold', () => {
    expect(evaluateProfit(108, 100, false, false)).toBeNull()
  })

  it('classifies loss -> profit as loss_to_profit with no percentChange', () => {
    const result = evaluateProfit(30, -50, false, false)
    expect(result).toEqual({ metric: 'profit', direction: 'loss_to_profit', currentUsd: 30, previousUsd: -50, percentChange: null })
  })

  it('classifies profit -> loss as profit_to_loss', () => {
    const result = evaluateProfit(-50, 30, false, false)
    expect(result?.direction).toBe('profit_to_loss')
  })

  it('classifies a widening loss as loss_widened', () => {
    const result = evaluateProfit(-70, -20, false, false)
    expect(result?.direction).toBe('loss_widened')
  })

  it('classifies a narrowing loss as loss_narrowed', () => {
    const result = evaluateProfit(-20, -70, false, false)
    expect(result?.direction).toBe('loss_narrowed')
  })

  it('treats a $0 baseline moving to profit as loss_to_profit', () => {
    const result = evaluateProfit(40, 0, false, false)
    expect(result?.direction).toBe('loss_to_profit')
  })

  it('treats a $0 baseline moving to a loss as profit_to_loss', () => {
    const result = evaluateProfit(-40, 0, false, false)
    expect(result?.direction).toBe('profit_to_loss')
  })

  it('skips when the dollar-only change is below the floor', () => {
    expect(evaluateProfit(-48, -50, false, false)).toBeNull()
  })

  it('skips entirely when skipIntraday is true, regardless of thresholds', () => {
    expect(evaluateProfit(30, -50, false, true)).toBeNull()
  })

  it('skips when the comparison period is missing', () => {
    expect(evaluateProfit(130, 100, true, false)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/composables/insights/__tests__/evaluateInsight.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `evaluateInsight.ts`**

```ts
// src/composables/insights/evaluateInsight.ts

// Named per the WAFI-144 design spec's "Threshold and skip rules" — tunable
// later without redesigning the engine.
export const INSIGHT_PERCENT_THRESHOLD = 10
export const INSIGHT_MIN_ABSOLUTE_CHANGE_USD = 5

export type InsightDirection =
  | 'up' | 'down'
  | 'loss_to_profit' | 'profit_to_loss'
  | 'loss_widened' | 'loss_narrowed'

export interface Insight {
  metric: 'revenue' | 'profit'
  direction: InsightDirection
  currentUsd: number
  previousUsd: number
  percentChange: number | null
}

export function evaluateRevenue(
  currentUsd: number,
  previousUsd: number,
  isMissing: boolean,
): Insight | null {
  if (isMissing || previousUsd <= 0) return null
  const absDelta = Math.abs(currentUsd - previousUsd)
  const percent = (absDelta / previousUsd) * 100
  if (percent < INSIGHT_PERCENT_THRESHOLD || absDelta < INSIGHT_MIN_ABSOLUTE_CHANGE_USD) return null
  const direction: InsightDirection = currentUsd > previousUsd ? 'up' : 'down'
  return {
    metric: 'revenue',
    direction,
    currentUsd,
    previousUsd,
    percentChange: direction === 'up' ? percent : -percent,
  }
}

// $0 is treated as the profit/loss boundary, not as "a loss" or "a profit" —
// moving up from $0 reads as loss_to_profit, moving down from $0 reads as
// profit_to_loss, per the WAFI-144 design spec's worked-example table.
function classifyProfitDirection(previousUsd: number, currentUsd: number): InsightDirection {
  if (previousUsd >= 0) {
    // previousUsd === 0 or previousUsd > 0 (caller guarantees currentUsd <= 0
    // here whenever previousUsd > 0, since the both-profitable case is
    // handled by the percent path before this function is ever called).
    return currentUsd > 0 ? 'loss_to_profit' : 'profit_to_loss'
  }
  // previousUsd < 0 (a real loss)
  if (currentUsd > 0) return 'loss_to_profit'
  return currentUsd < previousUsd ? 'loss_widened' : 'loss_narrowed'
}

export function evaluateProfit(
  currentUsd: number,
  previousUsd: number,
  isMissing: boolean,
  skipIntraday: boolean,
): Insight | null {
  if (skipIntraday || isMissing) return null
  const absDelta = Math.abs(currentUsd - previousUsd)
  if (absDelta < INSIGHT_MIN_ABSOLUTE_CHANGE_USD) return null

  if (previousUsd > 0 && currentUsd > 0) {
    const percent = (absDelta / previousUsd) * 100
    if (percent < INSIGHT_PERCENT_THRESHOLD) return null
    const direction: InsightDirection = currentUsd > previousUsd ? 'up' : 'down'
    return {
      metric: 'profit',
      direction,
      currentUsd,
      previousUsd,
      percentChange: direction === 'up' ? percent : -percent,
    }
  }

  return {
    metric: 'profit',
    direction: classifyProfitDirection(previousUsd, currentUsd),
    currentUsd,
    previousUsd,
    percentChange: null,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/composables/insights/__tests__/evaluateInsight.test.ts`
Expected: PASS (17 tests)

- [ ] **Step 5: Commit**

```bash
git add src/composables/insights/evaluateInsight.ts src/composables/insights/__tests__/evaluateInsight.test.ts
git commit -m "feat(WAFI-144): add threshold/direction evaluation for revenue and profit insights"
```

---

## Task 5: Orchestrating composable (`useAutomaticInsights`)

**Files:**
- Create: `src/composables/useAutomaticInsights.ts`
- Test: `src/composables/__tests__/useAutomaticInsights.test.ts`

**Interfaces:**
- Consumes:
  - `getInsightRanges`, `getComparisonCutoffIso` from `@/features/dashboard/composables/insightRanges` (Task 1)
  - `getShopCreatedAt` from `@/composables/insights/shopCreatedAt` (Task 2)
  - `getRevenueUsdUpToTimestamp` from `@/composables/insights/revenueUpToTimestamp` (Task 3)
  - `evaluateRevenue`, `evaluateProfit`, `Insight` from `@/composables/insights/evaluateInsight` (Task 4)
  - `useDashboardMetrics` from `@/features/dashboard/composables/useDashboardMetrics` (existing)
- Produces:
  ```ts
  export function useAutomaticInsights(): {
    insights: Ref<Insight[]>
    loading: Ref<boolean>
    error: Ref<string | null>
    load: (period: InsightPeriod) => Promise<void>
  }
  ```
  Used by Task 7 (`InsightBanner.vue`).

- [ ] **Step 1: Write the failing tests**

```ts
// src/composables/__tests__/useAutomaticInsights.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAutomaticInsights } from '../useAutomaticInsights'
import { getShopCreatedAt } from '../insights/shopCreatedAt'
import { getRevenueUsdUpToTimestamp } from '../insights/revenueUpToTimestamp'
import { useDashboardMetrics } from '@/features/dashboard/composables/useDashboardMetrics'

vi.mock('../insights/shopCreatedAt')
vi.mock('../insights/revenueUpToTimestamp')
vi.mock('@/features/dashboard/composables/useDashboardMetrics')

function mockMetrics(revenueUsd: number, profitUsd: number) {
  return {
    revenueUsd: { value: revenueUsd },
    profitUsd: { value: profitUsd },
    loadRange: vi.fn().mockResolvedValue(undefined),
  }
}

describe('useAutomaticInsights', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(getShopCreatedAt).mockResolvedValue('2020-01-01T00:00:00.000Z')
  })

  it('week: loads current and comparison via useDashboardMetrics.loadRange and evaluates both metrics', async () => {
    const current = mockMetrics(115, 130)
    const comparison = mockMetrics(100, 100)
    vi.mocked(useDashboardMetrics)
      .mockReturnValueOnce(current as any)
      .mockReturnValueOnce(comparison as any)

    const { insights, load, error } = useAutomaticInsights()
    await load('week')

    expect(error.value).toBeNull()
    expect(insights.value).toEqual([
      { metric: 'revenue', direction: 'up', currentUsd: 115, previousUsd: 100, percentChange: 15 },
      { metric: 'profit', direction: 'up', currentUsd: 130, previousUsd: 100, percentChange: 30 },
    ])
  })

  it('day, in progress: uses getRevenueUsdUpToTimestamp for the comparison revenue and generates no profit insight', async () => {
    const current = mockMetrics(85, 999) // profit value must be ignored on this path
    vi.mocked(useDashboardMetrics).mockReturnValueOnce(current as any)
    vi.mocked(getRevenueUsdUpToTimestamp).mockResolvedValue(100)

    const midday = new Date(2026, 7, 12, 14, 0, 0)
    const { insights, load } = useAutomaticInsights()
    await load('day', midday)

    expect(getRevenueUsdUpToTimestamp).toHaveBeenCalledWith('2026-08-05', expect.stringContaining('2026-08-05'))
    expect(insights.value).toEqual([
      { metric: 'revenue', direction: 'down', currentUsd: 85, previousUsd: 100, percentChange: -15 },
    ])
  })

  it('skips both metrics when the comparison period predates shop creation', async () => {
    vi.mocked(getShopCreatedAt).mockResolvedValue('2026-08-20T00:00:00.000Z') // shop created AFTER the comparison window
    const current = mockMetrics(450, 200)
    const comparison = mockMetrics(0, 0)
    vi.mocked(useDashboardMetrics)
      .mockReturnValueOnce(current as any)
      .mockReturnValueOnce(comparison as any)

    const { insights, load } = useAutomaticInsights()
    await load('week')

    expect(insights.value).toEqual([])
  })

  it('sets error on failure and leaves insights empty', async () => {
    vi.mocked(useDashboardMetrics).mockImplementation(() => {
      throw new Error('db unavailable')
    })
    const { insights, error, load } = useAutomaticInsights()
    await load('week')
    expect(error.value).toBe('db unavailable')
    expect(insights.value).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/composables/__tests__/useAutomaticInsights.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `useAutomaticInsights.ts`**

Note: `load` accepts an optional second `now` parameter (defaulting to
`new Date()`) purely so tests can pin the clock — the same pattern
`getInsightRanges` already uses.

```ts
// src/composables/useAutomaticInsights.ts
import { ref } from 'vue'
import {
  getInsightRanges,
  getComparisonCutoffIso,
  type InsightPeriod,
} from '@/features/dashboard/composables/insightRanges'
import { getShopCreatedAt } from './insights/shopCreatedAt'
import { getRevenueUsdUpToTimestamp } from './insights/revenueUpToTimestamp'
import { evaluateRevenue, evaluateProfit, type Insight } from './insights/evaluateInsight'
import { useDashboardMetrics } from '@/features/dashboard/composables/useDashboardMetrics'

export function useAutomaticInsights() {
  const insights = ref<Insight[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function load(period: InsightPeriod, now: Date = new Date()) {
    loading.value = true
    error.value = null
    try {
      const { current, comparison, isCurrentDayComplete } = getInsightRanges(period, now)
      const shopCreatedAt = await getShopCreatedAt()
      const isMissing = shopCreatedAt !== null && new Date(comparison.start) < new Date(shopCreatedAt)

      const currentMetrics = useDashboardMetrics()
      await currentMetrics.loadRange(current.start, current.end)

      const skipProfitIntraday = period === 'day' && !isCurrentDayComplete

      let comparisonRevenueUsd: number
      let comparisonProfitUsd: number | null

      if (skipProfitIntraday) {
        const cutoffIso = getComparisonCutoffIso(comparison.start, now)
        comparisonRevenueUsd = await getRevenueUsdUpToTimestamp(comparison.start, cutoffIso)
        comparisonProfitUsd = null
      } else {
        const comparisonMetrics = useDashboardMetrics()
        await comparisonMetrics.loadRange(comparison.start, comparison.end)
        comparisonRevenueUsd = comparisonMetrics.revenueUsd.value
        comparisonProfitUsd = comparisonMetrics.profitUsd.value
      }

      const results: Insight[] = []

      const revenueInsight = evaluateRevenue(currentMetrics.revenueUsd.value, comparisonRevenueUsd, isMissing)
      if (revenueInsight) results.push(revenueInsight)

      if (comparisonProfitUsd !== null) {
        const profitInsight = evaluateProfit(
          currentMetrics.profitUsd.value,
          comparisonProfitUsd,
          isMissing,
          skipProfitIntraday,
        )
        if (profitInsight) results.push(profitInsight)
      }

      insights.value = results
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      insights.value = []
    } finally {
      loading.value = false
    }
  }

  return { insights, loading, error, load }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/composables/__tests__/useAutomaticInsights.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/composables/useAutomaticInsights.ts src/composables/__tests__/useAutomaticInsights.test.ts
git commit -m "feat(WAFI-144): add useAutomaticInsights orchestrating composable"
```

---

## Task 6: i18n strings

**Files:**
- Modify: `src/i18n/ar.ts`
- Modify: `src/i18n/en.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: an `insights` i18n namespace, keyed by `direction` (Task 4's `InsightDirection` values) plus one `noSalesToday` special case — used by Task 7 (`InsightBanner.vue`).

- [ ] **Step 1: Add the `insights` namespace to `ar.ts`**

Insert after the existing `anomalies` block (following the file's existing section-comment convention, e.g. near `src/i18n/ar.ts:174-176`):

```ts
  // WAFI-144: Automatic Insights — period-over-period revenue/profit
  // comparisons. Consumed by InsightBanner.vue. `direction` (from
  // evaluateInsight.ts) picks the phrase; {percent}/{current}/{previous} are
  // always positive numbers (sign is baked into the phrase, not the number).
  insights: {
    revenue: {
      up: 'المبيعات أعلى بنسبة {percent}% مقارنة بـ {label}',
      down: 'المبيعات أقل بنسبة {percent}% مقارنة بـ {label}',
      noSalesToday: 'لا توجد مبيعات اليوم، مقارنة بـ ${previous} في {label}',
    },
    profit: {
      up: 'الربح أعلى بنسبة {percent}% مقارنة بـ {label}',
      down: 'الربح أقل بنسبة {percent}% مقارنة بـ {label}',
      loss_to_profit: 'تحسن الربح بمقدار ${amount} — من خسارة إلى ربح',
      profit_to_loss: 'انخفض الربح بمقدار ${amount} — من ربح إلى خسارة',
      loss_widened: 'زادت الخسارة بمقدار ${amount}',
      loss_narrowed: 'تراجعت الخسارة بمقدار ${amount}',
    },
    comparisonLabel: {
      day: 'يوم {weekday} الماضي',
      week: 'الأسبوع الماضي',
      month: 'الشهر الماضي',
    },
  },
```

- [ ] **Step 2: Add the matching `insights` namespace to `en.ts`**

Insert after the existing `anomalies` block:

```ts
  insights: {
    revenue: {
      up: 'Revenue is {percent}% higher than {label}',
      down: 'Revenue is {percent}% lower than {label}',
      noSalesToday: 'No sales today, compared to ${previous} {label}',
    },
    profit: {
      up: 'Profit is {percent}% higher than {label}',
      down: 'Profit is {percent}% lower than {label}',
      loss_to_profit: 'Profit improved by ${amount} — from a loss to a profit',
      profit_to_loss: 'Profit dropped by ${amount} — from a profit to a loss',
      loss_widened: 'Loss widened by ${amount}',
      loss_narrowed: 'Loss narrowed by ${amount}',
    },
    comparisonLabel: {
      day: 'last {weekday}',
      week: 'last week',
      month: 'last month',
    },
  },
```

- [ ] **Step 3: Verify the app still boots with the new keys (no i18n schema mismatch)**

Run: `npx vue-tsc --noEmit`
Expected: no new type errors (this repo does not runtime-validate i18n key
parity between `ar.ts`/`en.ts`, but both files must stay structurally
parallel per existing convention — this step is a manual side-by-side
read of the two blocks just added, not a new automated check).

- [ ] **Step 4: Commit**

```bash
git add src/i18n/ar.ts src/i18n/en.ts
git commit -m "feat(WAFI-144): add insights i18n strings (ar/en)"
```

---

## Task 7: `InsightBanner.vue` component

**Files:**
- Create: `src/features/dashboard/components/InsightBanner.vue`
- Test: `src/features/dashboard/components/InsightBanner.test.ts`
- Read for reference (do not modify): `src/features/dashboard/components/AnomalyBanner.vue` (styling pattern to mirror)

**Interfaces:**
- Consumes:
  - `useAutomaticInsights` from `@/composables/useAutomaticInsights` (Task 5)
  - `InsightPeriod` from `@/features/dashboard/composables/insightRanges` (Task 1)
  - i18n keys from Task 6
- Produces: a Vue component with one prop:
  ```ts
  defineProps<{ period: InsightPeriod }>()
  ```
  Used by Task 8 (HomePage) and Task 9 (ReportsPage). Re-loads automatically whenever `period` changes (`watch`).

- [ ] **Step 1: Write the failing test**

```ts
// src/features/dashboard/components/InsightBanner.test.ts
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import InsightBanner from './InsightBanner.vue'
import { useAutomaticInsights } from '@/composables/useAutomaticInsights'

vi.mock('@/composables/useAutomaticInsights')

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      insights: {
        revenue: { up: 'Revenue is {percent}% higher than {label}', down: 'Revenue is {percent}% lower than {label}', noSalesToday: 'No sales today, compared to ${previous} {label}' },
        profit: { up: 'Profit is {percent}% higher than {label}', down: 'Profit is {percent}% lower than {label}', loss_to_profit: 'Profit improved by ${amount} — from a loss to a profit', profit_to_loss: 'Profit dropped by ${amount} — from a profit to a loss', loss_widened: 'Loss widened by ${amount}', loss_narrowed: 'Loss narrowed by ${amount}' },
        comparisonLabel: { day: 'last {weekday}', week: 'last week', month: 'last month' },
      },
    },
  },
})

function mockInsights(insights: unknown[]) {
  vi.mocked(useAutomaticInsights).mockReturnValue({
    insights: { value: insights } as any,
    loading: { value: false } as any,
    error: { value: null } as any,
    load: vi.fn().mockResolvedValue(undefined),
  })
}

describe('InsightBanner', () => {
  it('renders nothing when there are no insights', () => {
    mockInsights([])
    const wrapper = mount(InsightBanner, { props: { period: 'day' }, global: { plugins: [i18n] } })
    expect(wrapper.find('[data-test="insight-banner"]').exists()).toBe(false)
  })

  it('renders a revenue-up card with primary and secondary lines', () => {
    mockInsights([
      { metric: 'revenue', direction: 'up', currentUsd: 115, previousUsd: 100, percentChange: 15 },
    ])
    const wrapper = mount(InsightBanner, { props: { period: 'week' }, global: { plugins: [i18n] } })
    expect(wrapper.text()).toContain('Revenue is 15% higher than last week')
    expect(wrapper.text()).toContain('$115.00')
    expect(wrapper.text()).toContain('$100.00')
  })

  it('renders a dollar-only profit card with no percent figure', () => {
    mockInsights([
      { metric: 'profit', direction: 'loss_to_profit', currentUsd: 30, previousUsd: -50, percentChange: null },
    ])
    const wrapper = mount(InsightBanner, { props: { period: 'month' }, global: { plugins: [i18n] } })
    expect(wrapper.text()).toContain('Profit improved by $80.00 — from a loss to a profit')
  })

  it('calls load() again when the period prop changes', async () => {
    mockInsights([])
    const wrapper = mount(InsightBanner, { props: { period: 'week' }, global: { plugins: [i18n] } })
    const { load } = useAutomaticInsights()
    await wrapper.setProps({ period: 'month' })
    expect(load).toHaveBeenCalledWith('month')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/dashboard/components/InsightBanner.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement `InsightBanner.vue`**

```vue
<!-- src/features/dashboard/components/InsightBanner.vue -->
<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAutomaticInsights } from '@/composables/useAutomaticInsights'
import type { InsightPeriod } from '@/features/dashboard/composables/insightRanges'
import type { Insight } from '@/composables/insights/evaluateInsight'

const props = defineProps<{ period: InsightPeriod }>()
const { t } = useI18n()
const { insights, load } = useAutomaticInsights()

onMounted(() => load(props.period))
watch(() => props.period, (p) => load(p))

// Same weekday name as the comparison date, for the 'day' period's label
// ("last Tuesday"). Comparison is always exactly 7 days back (see
// insightRanges.ts), so today's own weekday name is the correct label.
const comparisonLabel = computed(() => {
  if (props.period === 'day') {
    const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date())
    return t('insights.comparisonLabel.day', { weekday })
  }
  return t(`insights.comparisonLabel.${props.period}`)
})

function primaryLine(insight: Insight): string {
  const label = comparisonLabel.value
  if (insight.metric === 'revenue') {
    if (insight.direction === 'down' && insight.currentUsd === 0) {
      return t('insights.revenue.noSalesToday', { previous: insight.previousUsd.toFixed(2), label })
    }
    const percent = Math.abs(insight.percentChange ?? 0).toFixed(0)
    return t(`insights.revenue.${insight.direction}`, { percent, label })
  }
  // profit
  if (insight.percentChange !== null) {
    const percent = Math.abs(insight.percentChange).toFixed(0)
    return t(`insights.profit.${insight.direction}`, { percent, label })
  }
  const amount = Math.abs(insight.currentUsd - insight.previousUsd).toFixed(2)
  return t(`insights.profit.${insight.direction}`, { amount })
}
</script>

<template>
  <div v-if="insights.length > 0" data-test="insight-banner" class="insight-banner">
    <div
      v-for="insight in insights"
      :key="insight.metric"
      class="insight-banner__item"
      :class="{
        'insight-banner__item--positive': ['up', 'loss_to_profit', 'loss_narrowed'].includes(insight.direction),
        'insight-banner__item--negative': ['down', 'profit_to_loss', 'loss_widened'].includes(insight.direction),
      }"
    >
      <p class="insight-banner__primary">{{ primaryLine(insight) }}</p>
      <p class="insight-banner__secondary" dir="ltr">
        ${{ insight.currentUsd.toFixed(2) }} · ${{ insight.previousUsd.toFixed(2) }}
      </p>
    </div>
  </div>
</template>

<style scoped>
/* Mirrors AnomalyBanner.vue's card styling for a consistent computed-insight
   visual language — plain scoped CSS, not Tailwind, matching that
   component's existing pattern. */
.insight-banner {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 12px 0;
}
.insight-banner__item {
  border-radius: 8px;
  padding: 10px 14px;
  background: #f5f7fa;
}
.insight-banner__item--positive {
  border-inline-start: 4px solid #16a34a;
}
.insight-banner__item--negative {
  border-inline-start: 4px solid #dc2626;
}
.insight-banner__primary {
  margin: 0;
  font-weight: 600;
}
.insight-banner__secondary {
  margin: 4px 0 0;
  font-size: 0.85em;
  color: #6b7280;
}
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/dashboard/components/InsightBanner.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/components/InsightBanner.vue src/features/dashboard/components/InsightBanner.test.ts
git commit -m "feat(WAFI-144): add InsightBanner component"
```

---

## Task 8: Mount on Home

**Files:**
- Modify: `src/pages/HomePage.vue` (near line 399, where `<AnomalyBanner />` is mounted)

**Interfaces:**
- Consumes: `InsightBanner` from `@/features/dashboard/components/InsightBanner.vue` (Task 7), with `period="day"` (a plain string literal — `'day'` is a valid `InsightPeriod`, no reactive binding needed since Home always shows "today").
- Produces: nothing new (leaf integration).

- [ ] **Step 1: Import and mount `InsightBanner`**

In `src/pages/HomePage.vue`, add the import alongside the existing `AnomalyBanner` import, and mount it directly after `<AnomalyBanner />`:

```vue
<!-- existing import line for AnomalyBanner stays; add: -->
import InsightBanner from '@/features/dashboard/components/InsightBanner.vue'
```

```vue
<!-- WAFI-015: anomaly banner is the first thing an owner sees on Home. -->
<AnomalyBanner />

<!-- WAFI-144: automatic insights (revenue/profit vs. same weekday last week). -->
<InsightBanner period="day" />
```

- [ ] **Step 2: Manual smoke check**

Run: `npm run dev`, open Home in a browser. With seeded demo data (or any
existing sales history at least 7 days old), confirm a revenue/profit
insight card renders below the anomaly banner when thresholds are met, and
renders nothing when they aren't. This is a manual step — no automated test
covers page-level mounting beyond Task 7's component test.

- [ ] **Step 3: Commit**

```bash
git add src/pages/HomePage.vue
git commit -m "feat(WAFI-144): mount InsightBanner on Home"
```

---

## Task 9: Mount on Reports page

**Files:**
- Modify: `src/features/dashboard/components/ReportsPage.vue` (near its period-toggle block and inline anomaly markup, `ReportsPage.vue:246-257`)

**Interfaces:**
- Consumes: `InsightBanner` from `@/features/dashboard/components/InsightBanner.vue` (Task 7), bound to the page's own `period` ref — rendered only for `'week'`/`'month'`, per the approved spec's explicit exclusion of quarter/custom.
- Produces: nothing new (leaf integration).

- [ ] **Step 1: Import `InsightBanner` and render it conditionally**

Add the import alongside this file's other component imports, and insert
the conditional render next to the existing inline anomaly block (after
`ReportsPage.vue`'s `anomalies-wrap` div, i.e. right after the block ending
at line 257):

```vue
import InsightBanner from './InsightBanner.vue'
```

```vue
<div v-if="anomalies.length > 0" class="anomalies-wrap">
  <p v-for="a in anomalies" :key="a.code" class="anomaly-banner">
    {{ t(`anomalies.${a.code}.title`) }} — {{ t(`anomalies.${a.code}.message`) }}
  </p>
</div>

<!-- WAFI-144: automatic insights — only defined for week/month; quarter and
     custom ranges have no unambiguous "equivalent prior cycle" (see design
     spec) and intentionally render nothing here. -->
<InsightBanner v-if="period === 'week' || period === 'month'" :period="period" />
```

Note: `period` here is `ReportsPage.vue`'s existing `ref<ReportPeriod>`
(`ReportPeriod = 'week' | 'month' | 'quarter' | 'custom'`, from
`periodUtils.ts:43`). The `v-if` guard means `InsightBanner` only ever
receives `period` as `'week' | 'month'` at runtime, matching its
`InsightPeriod` prop type — but TypeScript can't narrow a template `v-if`
guard against a sibling prop binding on its own, so a cast is needed at
the binding site to satisfy `vue-tsc`:

```vue
<InsightBanner
  v-if="period === 'week' || period === 'month'"
  :period="period as 'week' | 'month'"
/>
```

- [ ] **Step 2: Run the full test suite and type check**

Run: `npx vitest run && npx vue-tsc --noEmit`
Expected: PASS, no new type errors. (`ReportsPage.vue` has no existing test
asserting on `InsightBanner`'s presence — this integration is covered by
Task 7's component test plus the manual check below.)

- [ ] **Step 3: Manual smoke check**

Run: `npm run dev`, open the Reports page. Toggle between week/month/
quarter/custom and confirm the insight card appears only for week/month,
never for quarter/custom.

- [ ] **Step 4: Commit**

```bash
git add src/features/dashboard/components/ReportsPage.vue
git commit -m "feat(WAFI-144): mount InsightBanner on Reports page for week/month"
```

---

## Final check

- [ ] Run the full suite once more end to end: `npx vitest run && npx vue-tsc --noEmit`
- [ ] Confirm no migration, no new table, and no new event/notification type were introduced anywhere in the diff (`git diff main --stat` should show only `src/` and `docs/` changes, no `supabase/migrations/`).
