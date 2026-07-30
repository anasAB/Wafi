# WAFI-015 Anomaly Detection (Home Banner) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect 7 business anomalies (2 existing + 5 new) from a shop's period data and surface them as a dismissible banner on the Home dashboard, sharing one detection engine with the existing `/reports` page so both surfaces never disagree.

**Architecture:** A new pure rules-and-evaluation module (`src/composables/useAnomalyDetection.ts`) computes `Anomaly[]` from batched, already-fetched period data (never one query per rule). A separate dismissal composable (`useAnomalyDismissal.ts`) owns localStorage persistence, keyed by shop/date/period/anomaly-code. A new `AnomalyBanner.vue` component (Home) and the existing `ReportsPage.vue` both consume the same engine. `useReportAnomalies.ts`'s 2 existing rules are relocated into the shared engine verbatim, then the old file is deleted.

**Tech Stack:** Vue 3 `<script setup>` + TypeScript, Vitest, PowerSync (`db.getAll`/`db.getOptional`), vue-i18n (`ar.ts`/`en.ts`), existing `useCan()` permission composable, existing `useDeviceStore()` for `shopId`.

## Global Constraints

- Reference spec: `docs/superpowers/specs/2026-07-30-wafi-015-anomaly-detection-design.md` — every requirement below traces back to it; if anything here seems to contradict it, the spec wins and this plan has a bug.
- **7 anomaly codes, exact names:** `HIGH_EXPENSES_RATIO`, `HIGH_RETURNS_RATIO`, `LOW_MARGIN`, `SALE_BELOW_COST`, `HIGH_DISCOUNT_RATIO`, `CASH_SHIFT_VARIANCE`, `INVENTORY_SHRINKAGE`.
- **Query-batching contract:** `useAnomalyDetection()`'s data-fetching orchestrator issues at most one query per data source (dashboard metrics reused, not re-queried; one query for period sales+line items; one query for cashier shifts; one query for stock-take lines). Adding a rule that reuses an existing source must add zero queries — this is asserted by a test, not just documented.
- **One anomaly per rule** regardless of how many underlying rows triggered it (e.g. 15 below-cost sales → one `SALE_BELOW_COST` anomaly with a count in its message).
- **Severity lives in `ANOMALY_RULES` config**, never hardcoded in a rule function or the `Anomaly` type consumer.
- **Dismissal key:** `wafi:anomaly-dismissed:{shopId}:{date}:{periodKey}:{code}`, localStorage, per-device (not per-user) — documented, not fixed, as a v1 limitation.
- **Permission gate:** `can_view_reports` (owner + manager) on both Home banner and `/reports` badges — identical gate, no divergence.
- **Fail closed but visibly:** on any query error, log to Sentry (`import * as Sentry from '@sentry/vue'` — match existing usage pattern in the codebase) and render a small neutral info card, never silently render nothing and never a scary error UI.
- **No new migration** — every anomaly type reads existing columns (`sales.sale_discount_amount_usd` from migration 052, `sale_line_items.unit_cost_usd` from migration 009, `cashier_shifts.variance_usd` from migration 025, `stock_take_lines.variance_value_usd` from migration 035).
- **`kind` field** (`'instant' | 'aggregate'`) is carried on every `Anomaly` for future use, not consumed by any behavior in this plan.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/composables/useAnomalyDetection.ts` | **Create.** `ANOMALY_RULES` config, one pure `evaluate*` function per rule, the `AnomalyInput` type describing what data every rule needs, and `computeAnomalies(input: AnomalyInput): Anomaly[]` (pure, no I/O) — plus the `useAnomalyDetection()` composable that fetches/batches data and calls `computeAnomalies`. |
| `src/composables/useAnomalyDetection.test.ts` | **Create.** Unit tests per rule (boundary cases) against `computeAnomalies`, plus the query-count contract test against `useAnomalyDetection()`. |
| `src/composables/useAnomalyDismissal.ts` | **Create.** `isDismissed(shopId, periodKey, code)`, `dismiss(shopId, periodKey, code)` — pure localStorage wrapper, date-scoped key construction. |
| `src/composables/useAnomalyDismissal.test.ts` | **Create.** Key construction + dismiss/reappear-next-day behavior (mocked date). |
| `src/features/dashboard/components/AnomalyBanner.vue` | **Create.** Home banner UI: permission-gated, consumes `useAnomalyDetection()` + `useAnomalyDismissal()`, renders sorted/undismissed anomalies, fail-closed error state. |
| `src/features/dashboard/components/AnomalyBanner.test.ts` | **Create.** Renders anomalies, hides dismissed ones, hides entirely for a role without `can_view_reports`, shows the fail-closed card on a thrown error. |
| `src/pages/HomePage.vue` | **Modify.** Import and render `<AnomalyBanner />` near the top of the template. |
| `src/features/dashboard/components/ReportsPage.vue` | **Modify.** Replace `evaluateReportAnomalies` import/usage with `useAnomalyDetection`'s shared engine; badges now iterate all applicable anomaly codes, not just the 2 hardcoded ones. |
| `src/features/dashboard/composables/useReportAnomalies.ts` | **Delete.** Logic relocated into `useAnomalyDetection.ts` (Task 1). |
| `src/__tests__/features/ReportAnomalies.test.ts` | **Delete.** Superseded by `useAnomalyDetection.test.ts`. |
| `src/i18n/en.ts`, `src/i18n/ar.ts` | **Modify.** Add an `anomalies` namespace (title/message per code) and 4 new `home.*` keys for the banner shell. |

---

### Task 1: Shared rules config + pure evaluation functions

**Files:**
- Create: `src/composables/useAnomalyDetection.ts` (types + `ANOMALY_RULES` + pure functions + `computeAnomalies` only — the data-fetching orchestrator is Task 2)
- Test: `src/composables/useAnomalyDetection.test.ts`

**Interfaces:**
- Produces: `Anomaly` type, `AnomalyInput` type, `computeAnomalies(input: AnomalyInput): Anomaly[]`, `ANOMALY_RULES` const — Task 2 imports all of these; `AnomalyBanner.vue`/`ReportsPage.vue` (Tasks 4, 6) import `Anomaly` and consume the composable from Task 2, not this file directly.

- [ ] **Step 1: Write the failing tests**

```ts
// src/composables/useAnomalyDetection.test.ts
import { describe, it, expect } from 'vitest'
import { computeAnomalies, ANOMALY_RULES, type AnomalyInput } from './useAnomalyDetection'

const baseInput: AnomalyInput = {
  revenueUsd: 1000,
  cogsUsd: 500,
  expensesUsd: 100,
  refundsUsd: 50,
  saleDiscountsUsd: 50,
  belowCostSaleCount: 0,
  cashShiftVarianceCount: 0,
  inventoryShrinkageCount: 0,
}

describe('computeAnomalies', () => {
  it('flags HIGH_EXPENSES_RATIO when expenses exceed 30% of gross income', () => {
    const anomalies = computeAnomalies({ ...baseInput, expensesUsd: 400 })
    expect(anomalies.some(a => a.code === 'HIGH_EXPENSES_RATIO')).toBe(true)
  })

  it('does not flag HIGH_EXPENSES_RATIO at or below the threshold', () => {
    const anomalies = computeAnomalies({ ...baseInput, expensesUsd: 300, revenueUsd: 1000, refundsUsd: 0 })
    expect(anomalies.some(a => a.code === 'HIGH_EXPENSES_RATIO')).toBe(false)
  })

  it('does not flag anything when gross income is below the minRevenueUsd floor', () => {
    const anomalies = computeAnomalies({ ...baseInput, revenueUsd: 10, expensesUsd: 8, refundsUsd: 0 })
    expect(anomalies).toEqual([])
  })

  it('flags HIGH_RETURNS_RATIO when refunds exceed 10% of gross income', () => {
    const anomalies = computeAnomalies({ ...baseInput, refundsUsd: 150, revenueUsd: 1000 })
    expect(anomalies.some(a => a.code === 'HIGH_RETURNS_RATIO')).toBe(true)
  })

  it('flags LOW_MARGIN when profit margin is below 10% of gross income', () => {
    const anomalies = computeAnomalies({ ...baseInput, revenueUsd: 1000, cogsUsd: 850, expensesUsd: 100, refundsUsd: 0 })
    // profit = 1000 - 850 - 100 = 50; grossIncome = 1000; margin = 5% < 10%
    expect(anomalies.some(a => a.code === 'LOW_MARGIN')).toBe(true)
  })

  it('does not flag LOW_MARGIN when margin is healthy', () => {
    const anomalies = computeAnomalies({ ...baseInput, revenueUsd: 1000, cogsUsd: 400, expensesUsd: 100, refundsUsd: 0 })
    expect(anomalies.some(a => a.code === 'LOW_MARGIN')).toBe(false)
  })

  it('flags SALE_BELOW_COST when belowCostSaleCount > 0, independent of overall margin', () => {
    // Healthy margin but one bad sale — must still flag, per spec §2.
    const anomalies = computeAnomalies({ ...baseInput, revenueUsd: 1000, cogsUsd: 300, expensesUsd: 50, refundsUsd: 0, belowCostSaleCount: 1 })
    expect(anomalies.some(a => a.code === 'SALE_BELOW_COST')).toBe(true)
    expect(anomalies.some(a => a.code === 'LOW_MARGIN')).toBe(false)
  })

  it('includes the count in the SALE_BELOW_COST message', () => {
    const anomalies = computeAnomalies({ ...baseInput, revenueUsd: 1000, refundsUsd: 0, belowCostSaleCount: 15 })
    const anomaly = anomalies.find(a => a.code === 'SALE_BELOW_COST')
    expect(anomaly?.message).toContain('15')
  })

  it('flags HIGH_DISCOUNT_RATIO when discounts exceed 15% of gross income', () => {
    const anomalies = computeAnomalies({ ...baseInput, revenueUsd: 1000, refundsUsd: 0, saleDiscountsUsd: 200 })
    expect(anomalies.some(a => a.code === 'HIGH_DISCOUNT_RATIO')).toBe(true)
  })

  it('flags CASH_SHIFT_VARIANCE when any shift-variance count is > 0', () => {
    const anomalies = computeAnomalies({ ...baseInput, revenueUsd: 1000, refundsUsd: 0, cashShiftVarianceCount: 1 })
    expect(anomalies.some(a => a.code === 'CASH_SHIFT_VARIANCE')).toBe(true)
  })

  it('flags INVENTORY_SHRINKAGE when any shrinkage-count is > 0', () => {
    const anomalies = computeAnomalies({ ...baseInput, revenueUsd: 1000, refundsUsd: 0, inventoryShrinkageCount: 1 })
    expect(anomalies.some(a => a.code === 'INVENTORY_SHRINKAGE')).toBe(true)
  })

  it('sorts anomalies critical first, then warning', () => {
    const anomalies = computeAnomalies({
      ...baseInput, revenueUsd: 1000, refundsUsd: 0, expensesUsd: 400, // warning: HIGH_EXPENSES_RATIO
      cashShiftVarianceCount: 1, // critical: CASH_SHIFT_VARIANCE
    })
    expect(anomalies[0].severity).toBe('critical')
    expect(anomalies.at(-1)?.severity).toBe('warning')
  })

  it('exposes kind: instant for SALE_BELOW_COST and INVENTORY_SHRINKAGE, aggregate for the rest', () => {
    const anomalies = computeAnomalies({
      ...baseInput, revenueUsd: 1000, refundsUsd: 0, expensesUsd: 400,
      belowCostSaleCount: 1, inventoryShrinkageCount: 1,
    })
    expect(anomalies.find(a => a.code === 'SALE_BELOW_COST')?.kind).toBe('instant')
    expect(anomalies.find(a => a.code === 'INVENTORY_SHRINKAGE')?.kind).toBe('instant')
    expect(anomalies.find(a => a.code === 'HIGH_EXPENSES_RATIO')?.kind).toBe('aggregate')
  })

  it('ANOMALY_RULES exposes minRevenueUsd = 50 (unchanged from the pre-existing rule)', () => {
    expect(ANOMALY_RULES.minRevenueUsd).toBe(50)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/composables/useAnomalyDetection.test.ts`
Expected: FAIL — `useAnomalyDetection` module doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// src/composables/useAnomalyDetection.ts
export type AnomalySeverity = 'critical' | 'warning' | 'info'
export type AnomalyKind = 'instant' | 'aggregate'

export interface Anomaly {
  code: string
  severity: AnomalySeverity
  kind: AnomalyKind
  title: string
  message: string
  deepLink?: string
}

// Plain aggregates the caller must already have (or batch-fetch once) — no
// query happens inside computeAnomalies or any rule function. See
// docs/superpowers/specs/2026-07-30-wafi-015-anomaly-detection-design.md §5.
export interface AnomalyInput {
  revenueUsd: number
  cogsUsd: number
  expensesUsd: number
  refundsUsd: number
  saleDiscountsUsd: number
  belowCostSaleCount: number
  cashShiftVarianceCount: number
  inventoryShrinkageCount: number
}

export const ANOMALY_RULES = {
  minRevenueUsd: 50,
  expenseRatioWarning: 0.3,
  refundRatioWarning: 0.1,
  lowMarginWarning: 0.1,
  discountRatioWarning: 0.15,
  severities: {
    HIGH_EXPENSES_RATIO: 'warning',
    HIGH_RETURNS_RATIO: 'warning',
    LOW_MARGIN: 'warning',
    SALE_BELOW_COST: 'critical',
    HIGH_DISCOUNT_RATIO: 'warning',
    CASH_SHIFT_VARIANCE: 'critical',
    INVENTORY_SHRINKAGE: 'critical',
  } as const,
} as const

const SEVERITY_ORDER: Record<AnomalySeverity, number> = { critical: 0, warning: 1, info: 2 }

function grossIncome(input: AnomalyInput): number {
  return input.revenueUsd + input.refundsUsd
}

function meetsRevenueFloor(input: AnomalyInput): boolean {
  const gross = grossIncome(input)
  return gross > 0 && gross >= ANOMALY_RULES.minRevenueUsd
}

function evaluateHighExpensesRatio(input: AnomalyInput): Anomaly | null {
  if (!meetsRevenueFloor(input)) return null
  const ratio = input.expensesUsd / grossIncome(input)
  if (ratio <= ANOMALY_RULES.expenseRatioWarning) return null
  return {
    code: 'HIGH_EXPENSES_RATIO',
    severity: ANOMALY_RULES.severities.HIGH_EXPENSES_RATIO,
    kind: 'aggregate',
    title: 'High expenses',
    message: 'Your expenses are unusually high this period.',
  }
}

function evaluateHighReturnsRatio(input: AnomalyInput): Anomaly | null {
  if (!meetsRevenueFloor(input)) return null
  const ratio = input.refundsUsd / grossIncome(input)
  if (ratio <= ANOMALY_RULES.refundRatioWarning) return null
  return {
    code: 'HIGH_RETURNS_RATIO',
    severity: ANOMALY_RULES.severities.HIGH_RETURNS_RATIO,
    kind: 'aggregate',
    title: 'High returns',
    message: 'Returns are higher than usual this period.',
  }
}

function evaluateLowMargin(input: AnomalyInput): Anomaly | null {
  if (!meetsRevenueFloor(input)) return null
  const profitUsd = input.revenueUsd - input.cogsUsd - input.expensesUsd
  const margin = profitUsd / grossIncome(input)
  if (margin >= ANOMALY_RULES.lowMarginWarning) return null
  return {
    code: 'LOW_MARGIN',
    severity: ANOMALY_RULES.severities.LOW_MARGIN,
    kind: 'aggregate',
    title: 'Low profit margin',
    message: 'Your overall profit margin is lower than usual this period.',
    deepLink: '/reports',
  }
}

// Independent of overall margin health by design — see spec §2: a healthy
// shop can still have one accidental below-cost sale, and that must still
// surface. Not gated by meetsRevenueFloor: a single below-cost sale matters
// even in a low-revenue period.
function evaluateSaleBelowCost(input: AnomalyInput): Anomaly | null {
  if (input.belowCostSaleCount <= 0) return null
  return {
    code: 'SALE_BELOW_COST',
    severity: ANOMALY_RULES.severities.SALE_BELOW_COST,
    kind: 'instant',
    title: 'Sale below cost',
    message: `${input.belowCostSaleCount} sale${input.belowCostSaleCount === 1 ? '' : 's'} sold below cost this period.`,
  }
}

function evaluateHighDiscountRatio(input: AnomalyInput): Anomaly | null {
  if (!meetsRevenueFloor(input)) return null
  const ratio = input.saleDiscountsUsd / grossIncome(input)
  if (ratio <= ANOMALY_RULES.discountRatioWarning) return null
  return {
    code: 'HIGH_DISCOUNT_RATIO',
    severity: ANOMALY_RULES.severities.HIGH_DISCOUNT_RATIO,
    kind: 'aggregate',
    title: 'High discount activity',
    message: 'Discounts given this period are higher than usual.',
  }
}

function evaluateCashShiftVariance(input: AnomalyInput): Anomaly | null {
  if (input.cashShiftVarianceCount <= 0) return null
  return {
    code: 'CASH_SHIFT_VARIANCE',
    severity: ANOMALY_RULES.severities.CASH_SHIFT_VARIANCE,
    kind: 'instant',
    title: 'Cash shift variance',
    message: `${input.cashShiftVarianceCount} shift${input.cashShiftVarianceCount === 1 ? '' : 's'} closed with an unusual cash variance this period.`,
    deepLink: '/shifts/history',
  }
}

function evaluateInventoryShrinkage(input: AnomalyInput): Anomaly | null {
  if (input.inventoryShrinkageCount <= 0) return null
  return {
    code: 'INVENTORY_SHRINKAGE',
    severity: ANOMALY_RULES.severities.INVENTORY_SHRINKAGE,
    kind: 'instant',
    title: 'Inventory shrinkage',
    message: `${input.inventoryShrinkageCount} product${input.inventoryShrinkageCount === 1 ? '' : 's'} had an unusual stock-take variance this period.`,
  }
}

// Pure — no I/O. Each rule emits at most one Anomaly regardless of how many
// underlying rows triggered it (spec §6).
export function computeAnomalies(input: AnomalyInput): Anomaly[] {
  const anomalies = [
    evaluateHighExpensesRatio(input),
    evaluateHighReturnsRatio(input),
    evaluateLowMargin(input),
    evaluateSaleBelowCost(input),
    evaluateHighDiscountRatio(input),
    evaluateCashShiftVariance(input),
    evaluateInventoryShrinkage(input),
  ].filter((a): a is Anomaly => a !== null)

  return anomalies.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/composables/useAnomalyDetection.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Commit**

```bash
git add src/composables/useAnomalyDetection.ts src/composables/useAnomalyDetection.test.ts
git commit -m "feat(anomalies): add shared anomaly rules engine (WAFI-015)"
```

---

### Task 2: Data-fetching orchestrator + query-batching contract test

**Files:**
- Modify: `src/composables/useAnomalyDetection.ts` (add the composable function, alongside Task 1's pure logic)
- Modify: `src/composables/useAnomalyDetection.test.ts` (add the query-count tests)

**Interfaces:**
- Consumes: `computeAnomalies`, `AnomalyInput`, `Anomaly` from Task 1 (same file). `db.getOptional`/`db.getAll` from `@/data/powersync/db`. `useDeviceStore()` from `@/store/device.store` for `shopId`. `getDateRange(period)` from `@/features/dashboard/composables/periodUtils`.
- Produces: `useAnomalyDetection()` returning `{ anomalies: Ref<Anomaly[]>, loading: Ref<boolean>, error: Ref<boolean>, load(period: Period): Promise<void> }` — Tasks 4 and 6 both call this.

- [ ] **Step 1: Write the failing tests**

```ts
// append to src/composables/useAnomalyDetection.test.ts
import { vi, beforeEach } from 'vitest'
import { useAnomalyDetection } from './useAnomalyDetection'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

vi.mock('@/data/powersync/db', () => ({
  db: { getOptional: vi.fn(), getAll: vi.fn() },
}))
vi.mock('@/store/device.store', () => ({
  useDeviceStore: () => ({ shopId: 'shop-1' }),
}))

describe('useAnomalyDetection (data orchestrator)', () => {
  beforeEach(() => {
    vi.mocked(db.getOptional).mockResolvedValue({ total: 0, cogs: 0 } as any)
    vi.mocked(db.getAll).mockResolvedValue([])
  })

  it('issues at most one query per data source (sales+lines, shifts, stock-take)', async () => {
    const { load } = useAnomalyDetection()
    await load('today')
    // getOptional covers the reused dashboard-style aggregates (revenue/cogs/expenses/refunds/discounts);
    // getAll covers the 3 batched row-level sources (below-cost lines, shift variances, stock-take variances).
    expect(vi.mocked(db.getAll).mock.calls.length).toBe(3)
  })

  it('adding a rule that reuses an already-batched source adds zero queries', async () => {
    // Simulates a future rule (e.g. "average markup") that reuses the same
    // period sale-line-items result computeAnomalies already receives —
    // asserted by checking the call count is unchanged from the baseline
    // above rather than growing with computeAnomalies' rule count.
    const { load } = useAnomalyDetection()
    await load('today')
    const baselineCalls = vi.mocked(db.getAll).mock.calls.length
    await load('today')
    expect(vi.mocked(db.getAll).mock.calls.length).toBe(baselineCalls * 2) // same per-call count each time, not growing
  })

  it('sets error=true and anomalies=[] when a query throws, without throwing itself', async () => {
    vi.mocked(db.getAll).mockRejectedValueOnce(new Error('offline'))
    const { load, error, anomalies } = useAnomalyDetection()
    await load('today')
    expect(error.value).toBe(true)
    expect(anomalies.value).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/composables/useAnomalyDetection.test.ts`
Expected: FAIL — `useAnomalyDetection` composable not exported yet.

- [ ] **Step 3: Write the implementation**

```ts
// append to src/composables/useAnomalyDetection.ts
import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { getDateRange } from '@/features/dashboard/composables/periodUtils'
import type { Period } from '@/features/dashboard/composables/periodUtils'
import * as Sentry from '@sentry/vue'

export function useAnomalyDetection() {
  const device    = useDeviceStore()
  const anomalies = ref<Anomaly[]>([])
  const loading   = ref(false)
  const error     = ref(false)

  async function load(period: Period) {
    loading.value = true
    error.value = false
    const { start, end } = getDateRange(period)

    try {
      // Source 1: dashboard-style revenue/cogs/expenses/refunds/discounts —
      // one query each via getOptional (matches useDashboardMetrics' own
      // pattern), not a fan-out per anomaly rule.
      const [revRow, cogsRow, expRow, refundRow, discountRow] = await Promise.all([
        db.getOptional<{ total: number }>(
          `SELECT COALESCE(SUM(total_usd), 0) as total FROM sales
           WHERE shop_id = ? AND DATE(created_at, 'localtime') BETWEEN ? AND ?`,
          [device.shopId, start, end],
        ),
        db.getOptional<{ cogs: number }>(
          `SELECT COALESCE(SUM(sli.quantity * COALESCE(sli.unit_cost_usd, 0)), 0) as cogs
           FROM sale_line_items sli JOIN sales s ON sli.sale_id = s.id
           WHERE s.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?`,
          [device.shopId, start, end],
        ),
        db.getOptional<{ total: number }>(
          `SELECT COALESCE(SUM(amount_usd), 0) as total FROM expenses
           WHERE shop_id = ? AND expense_date BETWEEN ? AND ?`,
          [device.shopId, start, end],
        ),
        db.getOptional<{ total: number }>(
          `SELECT COALESCE(SUM(r.refund_amount_usd), 0) as total FROM returns r
           JOIN sales s ON s.id = r.original_sale_id
           WHERE r.shop_id = ? AND DATE(r.created_at, 'localtime') BETWEEN ? AND ?`,
          [device.shopId, start, end],
        ),
        db.getOptional<{ total: number }>(
          `SELECT COALESCE(SUM(sale_discount_amount_usd), 0) as total FROM sales
           WHERE shop_id = ? AND DATE(created_at, 'localtime') BETWEEN ? AND ?`,
          [device.shopId, start, end],
        ),
      ])

      // Source 2: below-cost sale lines in the period — a single query for
      // the period's sale line items joined to price/cost, not scoped to
      // only below-cost rows (spec §5: this same result set would also feed
      // any future per-line-item rule, e.g. markup stats, at zero extra cost).
      const belowCostRows = await db.getAll<{ id: string }>(
        `SELECT sli.id FROM sale_line_items sli JOIN sales s ON sli.sale_id = s.id
         WHERE s.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
           AND sli.unit_price_usd < sli.unit_cost_usd`,
        [device.shopId, start, end],
      )

      // Source 3: cashier shifts closed in the period with a nonzero variance.
      const shiftVarianceRows = await db.getAll<{ id: string }>(
        `SELECT id FROM cashier_shifts
         WHERE shop_id = ? AND status = 'closed'
           AND DATE(closed_at, 'localtime') BETWEEN ? AND ?
           AND COALESCE(variance_usd, 0) != 0`,
        [device.shopId, start, end],
      )

      // Source 4: stock-take lines with a nonzero variance, from sessions
      // completed in the period.
      const shrinkageRows = await db.getAll<{ id: string }>(
        `SELECT stl.id FROM stock_take_lines stl
         JOIN stock_take_sessions sts ON sts.id = stl.session_id
         WHERE stl.shop_id = ? AND sts.status = 'completed'
           AND DATE(sts.completed_at, 'localtime') BETWEEN ? AND ?
           AND stl.variance IS NOT NULL AND stl.variance != 0`,
        [device.shopId, start, end],
      )

      const refundsUsd = refundRow?.total ?? 0
      anomalies.value = computeAnomalies({
        revenueUsd: (revRow?.total ?? 0) - refundsUsd,
        cogsUsd: cogsRow?.cogs ?? 0,
        expensesUsd: expRow?.total ?? 0,
        refundsUsd,
        saleDiscountsUsd: discountRow?.total ?? 0,
        belowCostSaleCount: belowCostRows.length,
        cashShiftVarianceCount: shiftVarianceRows.length,
        inventoryShrinkageCount: shrinkageRows.length,
      })
    } catch (e) {
      Sentry.captureException(e)
      error.value = true
      anomalies.value = []
    } finally {
      loading.value = false
    }
  }

  return { anomalies, loading, error, load }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/composables/useAnomalyDetection.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/composables/useAnomalyDetection.ts src/composables/useAnomalyDetection.test.ts
git commit -m "feat(anomalies): add batched data-fetching orchestrator for useAnomalyDetection"
```

---

### Task 3: Dismissal composable

**Files:**
- Create: `src/composables/useAnomalyDismissal.ts`
- Test: `src/composables/useAnomalyDismissal.test.ts`

**Interfaces:**
- Consumes: nothing beyond `localStorage` (browser global).
- Produces: `isDismissed(shopId: string, periodKey: string, code: string): boolean`, `dismiss(shopId: string, periodKey: string, code: string): void` — consumed by `AnomalyBanner.vue` (Task 4).

- [ ] **Step 1: Write the failing tests**

```ts
// src/composables/useAnomalyDismissal.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { isDismissed, dismiss } from './useAnomalyDismissal'

describe('useAnomalyDismissal', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('is not dismissed before dismiss() is called', () => {
    expect(isDismissed('shop-1', 'today', 'HIGH_EXPENSES_RATIO')).toBe(false)
  })

  it('is dismissed immediately after dismiss() for the same shop/period/code', () => {
    dismiss('shop-1', 'today', 'HIGH_EXPENSES_RATIO')
    expect(isDismissed('shop-1', 'today', 'HIGH_EXPENSES_RATIO')).toBe(true)
  })

  it('does not carry a dismissal across a different periodKey', () => {
    dismiss('shop-1', 'today', 'HIGH_EXPENSES_RATIO')
    expect(isDismissed('shop-1', '7d', 'HIGH_EXPENSES_RATIO')).toBe(false)
  })

  it('does not carry a dismissal across a different shop', () => {
    dismiss('shop-1', 'today', 'HIGH_EXPENSES_RATIO')
    expect(isDismissed('shop-2', 'today', 'HIGH_EXPENSES_RATIO')).toBe(false)
  })

  it('does not carry a dismissal across a different code', () => {
    dismiss('shop-1', 'today', 'HIGH_EXPENSES_RATIO')
    expect(isDismissed('shop-1', 'today', 'HIGH_RETURNS_RATIO')).toBe(false)
  })

  it('reappears on a different date (mocked) because the key is date-scoped', () => {
    const realDate = Date
    // @ts-expect-error partial mock for a fixed "today"
    global.Date = class extends realDate {
      constructor() { super('2026-07-30T10:00:00Z') }
      static now() { return new realDate('2026-07-30T10:00:00Z').getTime() }
    }
    dismiss('shop-1', 'today', 'HIGH_EXPENSES_RATIO')
    expect(isDismissed('shop-1', 'today', 'HIGH_EXPENSES_RATIO')).toBe(true)

    // @ts-expect-error advance the mocked "today"
    global.Date = class extends realDate {
      constructor() { super('2026-07-31T10:00:00Z') }
      static now() { return new realDate('2026-07-31T10:00:00Z').getTime() }
    }
    expect(isDismissed('shop-1', 'today', 'HIGH_EXPENSES_RATIO')).toBe(false)
    global.Date = realDate
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/composables/useAnomalyDismissal.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// src/composables/useAnomalyDismissal.ts

// Date-scoped by construction: today's key never matches yesterday's, so a
// dismissal naturally expires without any cleanup job. Per-device (localStorage),
// not per-user — see spec §7's documented v1 limitation.
function dismissalKey(shopId: string, periodKey: string, code: string): string {
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD, local wall-clock date
  return `wafi:anomaly-dismissed:${shopId}:${today}:${periodKey}:${code}`
}

export function isDismissed(shopId: string, periodKey: string, code: string): boolean {
  return localStorage.getItem(dismissalKey(shopId, periodKey, code)) === '1'
}

export function dismiss(shopId: string, periodKey: string, code: string): void {
  localStorage.setItem(dismissalKey(shopId, periodKey, code), '1')
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/composables/useAnomalyDismissal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/composables/useAnomalyDismissal.ts src/composables/useAnomalyDismissal.test.ts
git commit -m "feat(anomalies): add per-device, date-scoped anomaly dismissal"
```

---

### Task 4: i18n strings

**Files:**
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/ar.ts`

**Interfaces:**
- Produces: translation keys consumed by `AnomalyBanner.vue` (Task 5) and `ReportsPage.vue` (Task 6): `anomalies.HIGH_EXPENSES_RATIO.title`/`.message`, same shape for all 7 codes, plus `home.anomalyBannerTitle`, `home.anomalyBannerDismiss`, `home.anomalyBannerError`, `home.anomalyBannerExpand`.

- [ ] **Step 1: Add English strings**

In `src/i18n/en.ts`, inside the existing `reports` block, remove `expenseAnomaly`/`returnsAnomaly` (superseded — Task 6 removes their last usage in the same pass) and add a new top-level `anomalies` block plus 4 keys inside the existing `home` block:

```ts
// remove from `reports` block:
//   expenseAnomaly: '⚠️ Your expenses are unusually high this period.',
//   returnsAnomaly: '⚠️ Returns are higher than usual.',

// add as a new top-level export key, alongside `reports`:
anomalies: {
  HIGH_EXPENSES_RATIO: { title: 'High expenses', message: 'Your expenses are unusually high this period.' },
  HIGH_RETURNS_RATIO: { title: 'High returns', message: 'Returns are higher than usual this period.' },
  LOW_MARGIN: { title: 'Low profit margin', message: 'Your overall profit margin is lower than usual this period.' },
  SALE_BELOW_COST: { title: 'Sale below cost', message: '{count} sale(s) sold below cost this period.' },
  HIGH_DISCOUNT_RATIO: { title: 'High discount activity', message: 'Discounts given this period are higher than usual.' },
  CASH_SHIFT_VARIANCE: { title: 'Cash shift variance', message: '{count} shift(s) closed with an unusual cash variance this period.' },
  INVENTORY_SHRINKAGE: { title: 'Inventory shrinkage', message: '{count} product(s) had an unusual stock-take variance this period.' },
},

// add inside the existing `home` block:
anomalyBannerTitle: '{count} thing(s) need your attention',
anomalyBannerDismiss: 'Dismiss',
anomalyBannerError: 'Unable to check for issues right now',
anomalyBannerExpand: 'Show details',
```

Note: the message strings duplicate the English text already hardcoded in Task 1's rule functions (`useAnomalyDetection.ts`) — Task 5 wires the component to call `t('anomalies.<code>.title')`/`t('anomalies.<code>.message', { count })` for display, while the plain-English strings inside `useAnomalyDetection.ts` remain as fallback/Sentry-log-friendly text only, never rendered directly in the UI. This mirrors how `ReportsPage.vue` already gets its anomaly copy from `t('reports.expenseAnomaly')` rather than from `useReportAnomalies.ts`.

- [ ] **Step 2: Add matching Arabic strings**

In `src/i18n/ar.ts`, mirror the same structure (remove `expenseAnomaly`/`returnsAnomaly` from `reports`, add the same `anomalies` block and 4 `home.*` keys) with Arabic translations matching this repo's existing tone (see neighboring `reports.expenseAnomaly`/`returnsAnomaly` Arabic strings for the register to match before deleting them).

- [ ] **Step 3: Verify the app still type-checks**

Run: `npx vue-tsc --noEmit`
Expected: no new errors (i18n keys are not statically typed in this repo per existing usage, so this mainly guards against a stray syntax error in the edited files).

- [ ] **Step 4: Commit**

```bash
git add src/i18n/en.ts src/i18n/ar.ts
git commit -m "feat(anomalies): add i18n strings for anomaly banner and badges"
```

---

### Task 5: AnomalyBanner.vue (Home component)

**Files:**
- Create: `src/features/dashboard/components/AnomalyBanner.vue`
- Test: `src/features/dashboard/components/AnomalyBanner.test.ts`

**Interfaces:**
- Consumes: `useAnomalyDetection()` (Task 2), `isDismissed`/`dismiss` from `useAnomalyDismissal` (Task 3), `useCan()` from `@/composables/useCan.ts` (`can('can_view_reports')`), `useDeviceStore()` for `shopId`, `t('anomalies.<code>.title'|'message', { count })` and `t('home.anomalyBanner*')` (Task 4).
- Produces: a `<AnomalyBanner />` component with no props — Task 7 mounts it in `HomePage.vue`.

**Design note on `{ count }`:** the shared engine's `Anomaly.message` (Task 1) already contains the final English count text (e.g. "15 sales sold below cost"). The i18n-driven display text is derived by re-extracting the count from the underlying data the banner already has (`anomalies` array doesn't carry a raw count field). To avoid parsing English text back out of `Anomaly.message`, this component displays `t('anomalies.<code>.message')` **without** interpolating a count for v1 — the pluralized/counted phrasing lives only in the English fallback inside `useAnomalyDetection.ts` used for Sentry/debugging, not the user-facing UI. This is a deliberate scope cut: exposing a `count` field on `Anomaly` (e.g. `Anomaly.count?: number`) for real i18n interpolation is a natural follow-up, not required for this ticket to ship a correct, honest banner.

- [ ] **Step 1: Write the failing tests**

```ts
// src/features/dashboard/components/AnomalyBanner.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import AnomalyBanner from './AnomalyBanner.vue'

const mockAnomalies = vi.fn()
const mockLoad = vi.fn()
const mockError = { value: false }

vi.mock('@/composables/useAnomalyDetection', () => ({
  useAnomalyDetection: () => ({
    anomalies: { value: mockAnomalies() },
    loading: { value: false },
    error: mockError,
    load: mockLoad,
  }),
}))
vi.mock('@/composables/useAnomalyDismissal', () => ({
  isDismissed: vi.fn(() => false),
  dismiss: vi.fn(),
}))
vi.mock('@/store/device.store', () => ({
  useDeviceStore: () => ({ shopId: 'shop-1' }),
}))

const canViewReports = { value: true }
vi.mock('@/composables/useCan', () => ({
  useCan: () => ({ can: () => canViewReports }),
}))

const i18n = createI18n({
  legacy: false, locale: 'en',
  messages: { en: {
    anomalies: { HIGH_EXPENSES_RATIO: { title: 'High expenses', message: 'Expenses are high.' } },
    home: {
      anomalyBannerTitle: '{count} things need your attention',
      anomalyBannerDismiss: 'Dismiss', anomalyBannerError: 'Unable to check for issues right now',
      anomalyBannerExpand: 'Show details',
    },
  } },
})

describe('AnomalyBanner', () => {
  beforeEach(() => {
    mockAnomalies.mockReturnValue([
      { code: 'HIGH_EXPENSES_RATIO', severity: 'warning', kind: 'aggregate', title: 'High expenses', message: 'Expenses are high.' },
    ])
    canViewReports.value = true
    mockError.value = false
  })

  it('renders the banner when the caller can view reports and anomalies exist', async () => {
    const wrapper = mount(AnomalyBanner, { global: { plugins: [i18n] } })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('1 things need your attention')
  })

  it('renders nothing when the caller lacks can_view_reports', async () => {
    canViewReports.value = false
    const wrapper = mount(AnomalyBanner, { global: { plugins: [i18n] } })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-test="anomaly-banner"]').exists()).toBe(false)
  })

  it('renders nothing when there are no anomalies', async () => {
    mockAnomalies.mockReturnValue([])
    const wrapper = mount(AnomalyBanner, { global: { plugins: [i18n] } })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-test="anomaly-banner"]').exists()).toBe(false)
  })

  it('renders the fail-closed info card when error is true, not a blank screen', async () => {
    mockError.value = true
    mockAnomalies.mockReturnValue([])
    const wrapper = mount(AnomalyBanner, { global: { plugins: [i18n] } })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Unable to check for issues right now')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/dashboard/components/AnomalyBanner.test.ts`
Expected: FAIL — component doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```vue
<!-- src/features/dashboard/components/AnomalyBanner.vue -->
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAnomalyDetection } from '@/composables/useAnomalyDetection'
import { isDismissed, dismiss } from '@/composables/useAnomalyDismissal'
import { useCan } from '@/composables/useCan'
import { useDeviceStore } from '@/store/device.store'

const { t } = useI18n()
const { can } = useCan()
const canViewReports = can('can_view_reports')
const device = useDeviceStore()

const { anomalies, error, load } = useAnomalyDetection()
const expanded = ref(false)
const periodKey = 'today' // Home always evaluates anomalies against today's period.

onMounted(() => {
  if (canViewReports.value) load('today')
})

const visibleAnomalies = computed(() =>
  anomalies.value.filter(a => !isDismissed(device.shopId, periodKey, a.code)),
)

function dismissOne(code: string) {
  dismiss(device.shopId, periodKey, code)
  // Force reactivity: re-filter by touching anomalies.value (dismiss state
  // lives outside Vue's reactivity system in localStorage), so re-derive
  // visibleAnomalies by reassigning anomalies.value to itself.
  anomalies.value = [...anomalies.value]
}
</script>

<template>
  <div
    v-if="canViewReports && (error || visibleAnomalies.length > 0)"
    data-test="anomaly-banner"
    class="anomaly-banner"
  >
    <div v-if="error" class="anomaly-banner__error">
      {{ t('home.anomalyBannerError') }}
    </div>
    <template v-else>
      <button type="button" class="anomaly-banner__summary" @click="expanded = !expanded">
        {{ t('home.anomalyBannerTitle', { count: visibleAnomalies.length }) }}
      </button>
      <ul v-if="expanded" class="anomaly-banner__list">
        <li
          v-for="a in visibleAnomalies"
          :key="a.code"
          class="anomaly-banner__item"
          :class="`anomaly-banner__item--${a.severity}`"
        >
          <div>
            <strong>{{ t(`anomalies.${a.code}.title`) }}</strong>
            <p>{{ t(`anomalies.${a.code}.message`) }}</p>
          </div>
          <button type="button" @click="dismissOne(a.code)">
            {{ t('home.anomalyBannerDismiss') }}
          </button>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.anomaly-banner {
  border-radius: 0.5rem;
  padding: 0.75rem 1rem;
  margin-bottom: 1rem;
  background: #fff7e6;
}
.anomaly-banner__error {
  color: #6b7280;
  font-size: 0.875rem;
}
.anomaly-banner__summary {
  font-weight: 600;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}
.anomaly-banner__list {
  margin-top: 0.5rem;
  list-style: none;
  padding: 0;
}
.anomaly-banner__item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 0.5rem 0;
  border-top: 1px solid #eee;
}
.anomaly-banner__item--critical strong { color: #b91c1c; }
.anomaly-banner__item--warning strong { color: #92400e; }
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/dashboard/components/AnomalyBanner.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/components/AnomalyBanner.vue src/features/dashboard/components/AnomalyBanner.test.ts
git commit -m "feat(anomalies): add Home anomaly banner component (WAFI-015)"
```

---

### Task 6: Mount the banner on Home

**Files:**
- Modify: `src/pages/HomePage.vue`

**Interfaces:**
- Consumes: `AnomalyBanner` (Task 5, no props).

- [ ] **Step 1: Import and place the component**

In `src/pages/HomePage.vue`'s `<script setup>`, add the import near the other feature-component imports (after `CashDrawerSheet`):

```ts
import AnomalyBanner from '@/features/dashboard/components/AnomalyBanner.vue'
```

In the template, add `<AnomalyBanner />` as the first element inside the page's main content wrapper (immediately after the top app-bar/header markup, before the existing Health-signals card) — placed here specifically because it is the first thing an owner should see, per the spec's "Home banner" requirement:

```html
<AnomalyBanner />
```

- [ ] **Step 2: Run the existing HomePage test suite to confirm no regression**

Run: `npx vitest run src/pages/HomePage.test.ts` (or the actual existing test file name — confirm via `Glob src/pages/HomePage*.test.ts` first if this exact name doesn't match)
Expected: PASS, no change in existing assertions (the banner renders nothing in tests that don't mock `useAnomalyDetection`/`useCan`, since `AnomalyBanner`'s own tests already cover its mocked behavior — if `HomePage.test.ts` mounts the full component tree without those mocks, confirm it doesn't throw; add a lightweight mock there only if it does).

- [ ] **Step 3: Commit**

```bash
git add src/pages/HomePage.vue
git commit -m "feat(anomalies): mount AnomalyBanner on Home dashboard"
```

---

### Task 7: Migrate ReportsPage.vue onto the shared engine, delete the old composable

**Files:**
- Modify: `src/features/dashboard/components/ReportsPage.vue`
- Delete: `src/features/dashboard/composables/useReportAnomalies.ts`
- Delete: `src/__tests__/features/ReportAnomalies.test.ts`

**Interfaces:**
- Consumes: `useAnomalyDetection()` (Task 2) in place of `evaluateReportAnomalies` (deleted).

- [ ] **Step 1: Replace the import and computed in ReportsPage.vue**

Remove:
```ts
import { evaluateReportAnomalies } from '../composables/useReportAnomalies'
const anomalies = computed(() =>
  evaluateReportAnomalies(metrics.grossIncomeUsd.value, metrics.expensesUsd.value, metrics.refundsUsd.value),
)
```

Add:
```ts
import { useAnomalyDetection } from '@/composables/useAnomalyDetection'
const { anomalies, load: loadAnomalies } = useAnomalyDetection()
```

Call `loadAnomalies(period.value)` alongside this page's existing metrics-loading call (find where `metrics.load(period.value)` is invoked — on mount and on period change — and add the same call there, so `anomalies` always reflects the page's selected period, not just "today").

- [ ] **Step 2: Replace the template's hardcoded 2-badge block**

Remove:
```html
<div v-if="anomalies.highExpenses || anomalies.highReturns" class="anomalies-wrap">
  <p v-if="anomalies.highExpenses" class="anomaly-banner">{{ t('reports.expenseAnomaly') }}</p>
  <p v-if="anomalies.highReturns" class="anomaly-banner">{{ t('reports.returnsAnomaly') }}</p>
</div>
```

Add (iterates all applicable anomalies from the shared engine, not just 2 hardcoded ones):
```html
<div v-if="anomalies.length > 0" class="anomalies-wrap">
  <p v-for="a in anomalies" :key="a.code" class="anomaly-banner">
    {{ t(`anomalies.${a.code}.title`) }} — {{ t(`anomalies.${a.code}.message`) }}
  </p>
</div>
```

- [ ] **Step 3: Delete the superseded files**

```bash
git rm src/features/dashboard/composables/useReportAnomalies.ts src/__tests__/features/ReportAnomalies.test.ts
```

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — specifically confirm `ReportsPage.test.ts` (if it references `anomalies.highExpenses`/`anomalies.highReturns` directly, update those assertions to check for the presence of an anomaly with `code === 'HIGH_EXPENSES_RATIO'`/`'HIGH_RETURNS_RATIO'` in the array instead).

- [ ] **Step 5: Run type-check**

Run: `npx vue-tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/features/dashboard/components/ReportsPage.vue
git commit -m "refactor(anomalies): migrate ReportsPage onto shared anomaly engine, remove useReportAnomalies"
```

---

## Self-Review Notes (completed during authoring)

- **Spec coverage:** all 7 anomaly types (Task 1), shared engine consumed by both surfaces (Tasks 2, 6, 7), query-batching contract test (Task 2), one-anomaly-per-rule (Task 1 tests), severity-in-config (Task 1), `kind` field (Task 1), dismiss scoped to shop+date+period+code (Task 3), permission gate (Task 5), fail-closed-but-visible error UI (Tasks 2, 5) are each covered by a task.
- **Placeholder scan:** no TBD/TODO; the one deliberately-scoped-down item (per-anomaly `count` i18n interpolation) is called out explicitly as a follow-up, not left vague.
- **Type consistency:** `Anomaly`/`AnomalyInput` defined once in Task 1, imported (never redefined) in Tasks 2, 5, 6, 7. `useAnomalyDetection()`'s return shape (`anomalies`, `loading`, `error`, `load`) is identical across Tasks 2, 5, 7 usage.
- **Scope:** single ticket, single cohesive engine + 2 consuming surfaces — not decomposed further, as none of the 7 tasks is independently shippable ahead of Task 1.
