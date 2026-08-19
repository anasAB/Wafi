# WAFI-147A: Report Generation & On-Demand Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `Report`/`ReportSection` contract, 5 shared aggregation primitives (`readProfitCache`, `getStaffMetrics`, `getCustomerAgingSnapshot`, `readShiftCashReconciliation`, `queryDeadStockRows`), all 13 report definitions from `WAFI_Event_Driven_Platform_Plan_v1.md:639-786`, and an on-demand (lazy, no scheduling) Reports UI.

**Architecture:** A report definition is a plain async function `(shopId, range, context?) => Promise<Report>` registered in a keyed `Record<ReportId, ReportDefinition>`. Each report composes `SummarySection`/`DetailSection` values from the shared report-data primitives (`readProfitCache`, `getStaffMetrics`, `getCustomerAgingSnapshot`, `readShiftCashReconciliation`, `queryDeadStockRows`) plus report-specific SQL where no primitive fits. Sections carry a `visibility: 'shop' | 'staff'` tag; `contextRequirement?: 'staff'` on the definition itself tells the UI which reports need a selected staff member before `compute()` can run at all. The Reports list page reads only registry metadata; a per-report page calls `compute()` lazily for the one selected report.

**Tech Stack:** Vue 3 + TypeScript (Vitest), PowerSync/SQLite client queries, Node's built-in `node:sqlite` for real-SQL integration tests.

**Spec:** `docs/superpowers/specs/2026-08-18-wafi147a-automatic-reports-design.md`, as amended by this plan's own Task 0 and §9 below (read both in full before starting — see §9 for exactly which decisions exist only in this plan and were folded back into the spec as part of writing it, so spec and plan do not diverge going into execution).

## Global Constraints

- No scheduling, no background/unattended execution, no automated delivery (WhatsApp/email/PDF/Excel export) — those are WAFI-147B/147C, explicitly out of scope here.
- `ReportDateRange` is `{ from: string; to: string }`, inclusive, `YYYY-MM-DD`, device-local calendar dates. Every date-bounded query must implement the identical semantic invariant already used throughout this codebase (`DATE(created_at, 'localtime') BETWEEN ? AND ?` or an equivalent boundary comparison), never mixing UTC truncation with local-date filtering. **Client-side range construction must use local calendar date parts (`getFullYear()`/`getMonth()`/`getDate()`, see `useProfitCache.ts`'s `toDateStr()`), never `toISOString().slice(0, 10)`** — `toISOString()` is UTC and produces the wrong calendar day near local midnight (e.g. a device in Damascus, UTC+3, at 01:00 local on Aug 19 is still Aug 18 in UTC).
- **Money units are NOT uniform across tables — verified per column, not assumed:** `profit_cache`'s numeric columns (`revenue_usd`, `cogs_usd`, `expenses_usd`, `discount_usd`, `refunds_usd`, `cogs_reversal_usd`, `revenue_syp`) are `bigint` storing integer **cents** (migration `086_profit_cache_apply.sql`, line comment: "minor units (cents), never float") — only `readProfitCache` (Task 2) divides by 100. Every other USD column touched by this plan (`sales.total_usd`, `sale_line_items.unit_price_usd`/`line_total_usd`/`discount_amount_usd`/`unit_cost_usd`, `products.cost_price_usd`, `customer_payments.amount_usd`, `returns.refund_amount_usd`, `cash_movements.amount`, `cashier_shifts.*_cash_usd`/`variance_usd`) is a plain `NUMERIC(_, 2)` dollar value already — summing these directly (no `/100`) is correct; dividing them by 100 would be a real bug. Do not port `readProfitCache`'s cents-handling pattern to any other query.
- Row types (`TopCustomerRow`, `DeadStockRow`, etc.) are defined locally in each report's own file — never centralized into a generic `Record<string, unknown>` shape.
- `ReportDefinition.compute` signature is `(shopId: string, range: ReportDateRange, context?: ReportContext) => Promise<Report>` where `ReportContext = { staffId?: string }` — see Task 5. The registry is a catalogue only — `compute()` implementations may be client-oriented (call `db`/PowerSync directly); this is not a promise of reuse by a future server-side scheduler. The registry provides compile-time key validity (a typo'd `ReportId` fails to compile), **not** compile-time duplicate-registration detection — two definition files assigning the same key both compile; the last one imported silently wins at runtime. Task 21's registration barrel is the single place new report ids get added, specifically so a human reviewing that one file's diff can catch an accidental duplicate — this is a process safeguard, not a type-system guarantee, and must not be described as one.
- Reports list page must never call any report's `compute()` — only per-report pages do, lazily, on open.
- `can_view_reports` + `reporting_pack` feature flag gates the Reports list and every shop-aggregate report (reuse `/reports`'s existing `meta` exactly). `can_view_staff_performance` additionally gates Employee Summary (whole-report) and the staff-identifying sections of Weekly Summary, Monthly Health, Discount Report, Returns Report (section-level omission) — this is UI/report visibility, not a new RLS/security boundary.
- **Historical vs. current-snapshot metrics must be labeled explicitly in the UI**, not silently mixed. `products.current_stock`/`cost_price_usd` reflect today's state regardless of `ReportDateRange` — any metric built from them (inventory valuation, dead stock, turnover) is a *current snapshot*, not a value "as of" the report's date range, and its `ReportMetric`/section title must say so (e.g. "Current inventory value" or "(as of today)" appended to the title), even inside a report whose other sections (revenue, profit) are genuinely period-scoped. A Monthly Health report for July containing an August-18 inventory valuation is correct behavior, mislabeled as a July figure, if this isn't made explicit.

---

### Task 0: Pre-implementation domain verification

**Files:** none — this task produces decisions recorded in this plan (edits below) and, where a decision changes the approved spec's acceptance criteria, an amendment to `docs/superpowers/specs/2026-08-18-wafi147a-automatic-reports-design.md`. No code, no tests. This task exists because a prior review of this plan found several report definitions had drifted from both the original 13-report spec and from this codebase's actual authoritative business logic — verify before writing code, not after.

**Findings already verified and applied throughout this plan (do not re-derive):**

1. **Employee Summary needs a `staffId` the fixed `(shopId, range)` signature can't carry.** Resolved by adding `ReportContext = { staffId?: string }` as `compute`'s third, optional parameter (Task 1, Task 5, Task 10, Task 21) — `REPORT_DEFINITIONS['employee-summary'].compute` no longer throws; it reads `context?.staffId` and returns a `'forbidden'`-style explicit error `Report` state (not a thrown exception) when absent, so the registry is genuinely uniform: every entry is callable through the same signature.
2. **Daily Closing's and Cash Flow's cash-reconciliation figures must come from `cashier_shifts.z_report_data`, not be recomputed from revenue/expenses.** `z_report_data` is an immutable `JSONB`/JSON snapshot of `ZReportMetrics` (`src/features/shifts/shift.types.ts`), captured verbatim at shift-close time by the already-verified `computeCashReconciliation` engine (`src/features/shifts/composables/cashReconciliation.ts`, invoked via `useZReport.ts`) — it already accounts for cash sales, cash credit-payment collection, cash refunds, mid-shift pay-ins/pay-outs, and cash expenses, in the exact equation this app enforces at close time. Reinventing `expected = opening + revenue - expenses` (the plan's original draft) omits credit-payment collection, refunds, and pay-in/pay-out movements entirely and is a real correctness bug — fixed in Tasks 6 and 7 below by reading and summing `z_report_data`'s fields via `json_extract` across shifts closed within range, never recomputing the equation.
3. **Money units are per-column, not per-codebase** — see the Global Constraints entry above. `profit_cache` alone uses integer cents; every other table this plan touches is plain `NUMERIC` dollars.
4. **Local-date generation in the UI must not use `toISOString()`** — see the Global Constraints entry above; fixed in Task 21.

**Decisions made now, applied throughout this plan (recorded here so they don't need re-litigating per-task):**

5. **Weekly Summary's "inventory changes" field (from the original 13-report spec) is real and buildable — restored, not dropped.** `stock_adjustments` (migration `009_expand_domain_tables_for_sync.sql`) records every inventory change via `old_value`/`new_value`/`reason` columns — the delta is `new_value - old_value`, not a stored `delta_quantity` column (verified against the actual migration, not assumed). Task 8 adds an "Inventory Changes" detail section computing that delta, summarizing adjustment count and net quantity change in range.
6. **Inventory Health's Dead Stock section is real and buildable — restored, not dropped.** Task 16 now includes a `detailSection` built from the same query Task 17's dedicated Dead Stock report uses (extracted as a small shared function both tasks call — see Task 16/17 below — not duplicated SQL).
7. **Confirmed de-scoped items** (checked against the actual codebase, genuinely absent, not merely inconvenient to build) — this is the authoritative final list; do not re-add these speculatively in any task below, and do not treat their absence as an oversight:
   - Profit Trend: "profit by product category" (no product-category cost attribution exists) and "profit vs. target" (no target/goal concept exists anywhere in this codebase).
   - Top Customers: "top 20 by loyalty" (no loyalty/points system exists; CLAUDE.md places loyalty in v1.5).
   - Inventory Health: "shrinkage summary" (no reconciled expected-vs-counted shrinkage mechanism exists; `stock_adjustments`' free-text reasons are not a structured shrinkage vocabulary).
   - Dead Stock: "suggested actions (discount, bundle, discontinue)" (a business-rules/product decision, not a data query — a candidate for a future WAFI-156 business rule, not fabricated heuristics here).
   - Credit Report: "average collection time" (derivable from `CustomerAgingRow.lastPaymentDate` as a follow-up aggregation, deliberately not built in this pass to keep Task 13 scoped to what's directly returned by the primitive).
   - **This list is the final 147A acceptance criteria for these 5 reports** — `docs/superpowers/specs/2026-08-18-wafi147a-automatic-reports-design.md` should be amended with a short "§8 Confirmed de-scopes" section listing exactly this, as part of this task's own deliverable, before Task 6 begins. Do not let this list live only in a plan-task footnote.
8. **Returns Report's "By Staff" section gets its own row shape, not a raw `StaffMetricsRow` dump.** `getStaffMetrics` (Task 3) is extended with `returnRevenueUsd`/`returnCount` fields (already computed internally, previously discarded); Task 12 maps those into an explicit `ReturnByStaffRow { staffId, name, returnCount, returnRevenueUsd }`, not a filtered pass-through of the full staff metrics row.
9. **Cadence-to-range mapping, decided explicitly (not left as an implicit rolling-window accident):** `'daily'` → today only. `'weekly'` → the last 7 calendar days ending today (a rolling window, not "the current Sunday-to-Sunday week" — chosen because a report opened mid-week should show a meaningful trailing week, not a partial current week). `'monthly'` → the last 30 calendar days ending today (same rolling-window rationale, not the current calendar month). `'per-shift'` → today only, further narrowed to one staff member via `ReportContext.staffId` (Employee Summary). This is a real product decision, not a placeholder — if a calendar-aligned week/month is wanted instead, that is a deliberate future change to `defaultRangeForCadence` (Task 21) alone, isolated from every report definition (none of which hardcode a window length themselves).
10. **Integration test coverage acceptance criterion, made explicit:** every genuinely distinct high-risk query *shape* introduced across Tasks 2-18 gets at least one real-SQLite integration test in Task 22 — not one per report (13 reports share far fewer distinct query shapes than 13). The shapes requiring coverage: date-boundary inclusion (Task 22 already has this), `getCustomerAgingSnapshot`'s as-of-date filter (already has this), the cents-vs-dollars distinction from finding 3 above (assert `readProfitCache` divides and no other primitive does), the `z_report_data` JSON-extraction aggregation from finding 2 above, discount-by-product / returns-by-product attribution (`discount_amount_usd`/return line joins), and top-N ranking (`ORDER BY ... LIMIT 20`, off-by-one/tie-breaking). Task 22 is expanded below to add the missing ones.

- [x] **Step 1 & 2 (already done, not deferred to implementation time):** the design spec itself has been amended with §8 (Confirmed De-Scopes, verbatim the list above) and §9 (Amendments — `ReportContext`, `contextRequirement`, the 5 shared primitives, rolling cadence ranges, `SectionVisibility`/whole-report gating, current-snapshot labeling). This closes the gap a review of this plan correctly flagged: several design decisions existed only in this plan, not in the spec it claimed to implement "verbatim." Spec and plan are consistent as of this commit — read `docs/superpowers/specs/2026-08-18-wafi147a-automatic-reports-design.md` §§8-9 alongside this Task 0 before starting Task 1.

```bash
git add docs/superpowers/specs/2026-08-18-wafi147a-automatic-reports-design.md
git commit -m "docs(WAFI-147A): amend spec S8-S9 -- confirmed de-scopes, ReportContext, contextRequirement, 5 primitives, SectionVisibility, rolling cadence, current-snapshot labeling"
```

---

### Task 1: `Report`/`ReportSection` type shell + `detailSection()` helper

**Files:**
- Create: `src/features/reports/report.types.ts`
- Test: `src/features/reports/__tests__/report.types.test.ts`

**Interfaces:**
- Produces: `ReportDateRange`, `ReportId`, `ReportContext`, `Report`, `ReportSection`, `SummarySection`, `ReportMetric`, `ReportColumn`, `DetailSection`, `detailSection<Row extends object>(args): DetailSection`, `summarySection(args): SummarySection`.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/reports/__tests__/report.types.test.ts
import { describe, it, expect } from 'vitest'
import { detailSection, summarySection } from '../report.types'

interface FakeRow { id: string; label: string; total: number }

describe('summarySection', () => {
  it('builds a well-shaped summary section', () => {
    const s = summarySection({ title: 'Totals', metrics: [{ label: 'Revenue', value: 100, unit: 'USD' }] })
    expect(s).toEqual({ type: 'summary', title: 'Totals', metrics: [{ label: 'Revenue', value: 100, unit: 'USD' }], visibility: 'shop' })
  })
})

describe('detailSection', () => {
  it('normalizes typed rows/columns into the plain runtime shape', () => {
    const rows: FakeRow[] = [{ id: 'r1', label: 'A', total: 10 }]
    const s = detailSection<FakeRow>({
      title: 'Rows',
      columns: [{ key: 'label', label: 'Label' }, { key: 'total', label: 'Total' }],
      rows,
    })
    expect(s).toEqual({
      type: 'detail',
      title: 'Rows',
      columns: [{ key: 'label', label: 'Label' }, { key: 'total', label: 'Total' }],
      rows,
      visibility: 'shop',
    })
  })

  it('accepts an explicit visibility: "staff" for staff-identifying sections', () => {
    const s = detailSection<FakeRow>({ title: 'Staff', columns: [{ key: 'id', label: 'ID' }], rows: [], visibility: 'staff' })
    expect(s.visibility).toBe('staff')
  })

  it('mixed sections coexist in one Report without a shared row type', () => {
    const report = {
      id: 'daily-closing' as const, name: 'X', dateRange: { from: '2026-08-01', to: '2026-08-01' }, generatedAt: '2026-08-01T00:00:00.000Z',
      sections: [
        summarySection({ title: 'S', metrics: [] }),
        detailSection<FakeRow>({ title: 'D', columns: [{ key: 'id', label: 'ID' }], rows: [] }),
      ],
    }
    expect(report.sections).toHaveLength(2)
    expect(report.sections[0].type).toBe('summary')
    expect(report.sections[1].type).toBe('detail')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/reports/__tests__/report.types.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `report.types.ts`**

```ts
// src/features/reports/report.types.ts
// WAFI-147A: the report output contract. See design spec S2 for the full rationale
// behind the section-level (not report-level) SummarySection|DetailSection union.

export type ReportDateRange = {
  /** Device-local calendar date, YYYY-MM-DD, inclusive. */
  from: string
  /** Device-local calendar date, YYYY-MM-DD, inclusive. */
  to: string
}

export type ReportMetric = { label: string; value: string | number; unit?: string }

/** 'staff' means "identifies an individual staff member's figures" -- gated by
 *  can_view_staff_performance at render time (see ReportDetailPage, Task 21),
 *  the same structurally-owner-only flag WAFI-018 established for
 *  /reports/staff. Defaults to 'shop' (every existing call site that doesn't
 *  pass this stays correct with no change) -- only the handful of genuinely
 *  staff-identifying sections (Task 0 P0 finding 2) pass 'staff' explicitly. */
export type SectionVisibility = 'shop' | 'staff'

export type SummarySection = {
  type: 'summary'
  title: string
  metrics: ReportMetric[]
  visibility: SectionVisibility
}

export type ReportColumn = { key: string; label: string }

/** Plain, generic-free runtime shape -- a single Report's sections legitimately mix
 *  DetailSection built from different Row types at once, which a generic on this type
 *  itself cannot express without an `unknown` escape hatch. Row typing is checked at
 *  detailSection()'s call site instead (see below). */
export type DetailSection = {
  type: 'detail'
  title: string
  columns: ReportColumn[]
  rows: object[]
  visibility: SectionVisibility
}

export type ReportSection = SummarySection | DetailSection

// ReportId lives here, not in reportRegistry.ts, so Report.id can be typed as
// ReportId without a circular import (reportRegistry.ts imports Report from this
// file; if ReportId lived there instead, this file would need to import it back).
export type ReportId =
  | 'daily-closing' | 'weekly-summary' | 'monthly-health' | 'employee-summary'
  | 'inventory-health' | 'discount-report' | 'returns-report' | 'credit-report'
  | 'cash-flow' | 'profit-trend' | 'top-customers' | 'top-products' | 'dead-stock'

/** Extra, report-specific invocation context a compute() may need beyond
 *  (shopId, range) -- currently only Employee Summary's staffId. Optional so
 *  every other report's compute() can ignore it entirely; see Task 10. */
export type ReportContext = { staffId?: string }

export type Report = {
  id: ReportId
  name: string
  dateRange: ReportDateRange
  generatedAt: string
  sections: ReportSection[]
}

export function summarySection(args: { title: string; metrics: ReportMetric[]; visibility?: SectionVisibility }): SummarySection {
  return { type: 'summary', title: args.title, metrics: args.metrics, visibility: args.visibility ?? 'shop' }
}

/** The only place row typing is checked. Each report definition calls this with its own
 *  Row type; `columns` is checked against that Row's actual keys at compile time, then
 *  normalized into the plain runtime DetailSection shape. */
export function detailSection<Row extends object>(args: {
  title: string
  columns: { key: keyof Row; label: string }[]
  rows: Row[]
  visibility?: SectionVisibility
}): DetailSection {
  return {
    type: 'detail',
    title: args.title,
    columns: args.columns.map((c) => ({ key: String(c.key), label: c.label })),
    rows: args.rows,
    visibility: args.visibility ?? 'shop',
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/features/reports/__tests__/report.types.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add src/features/reports/report.types.ts src/features/reports/__tests__/report.types.test.ts
git commit -m "feat(WAFI-147A): add Report/ReportSection contract with detailSection() row-typing helper"
```

---

### Task 1b: Shared local-date utilities (Task 0 P1 finding 19)

An earlier draft of this plan had `shiftLocalDate()` (Task 8) and `toLocalDateStr()` (Task 21) as two separately-written, near-identical implementations of the same local-calendar-date logic. Not a reporting engine — just the two small date functions every report-adjacent piece of code needs, written once.

**Files:**
- Create: `src/features/reports/dateUtils.ts`
- Test: `src/features/reports/__tests__/dateUtils.test.ts`

**Interfaces:**
- Produces: `function formatLocalDate(d: Date): string` (YYYY-MM-DD from local date parts); `function addCalendarDays(dateStr: string, days: number): string` (shifts a YYYY-MM-DD string by N local calendar days, positive or negative).

- [ ] **Step 1: Write the failing test**

```ts
// src/features/reports/__tests__/dateUtils.test.ts
import { describe, it, expect } from 'vitest'
import { formatLocalDate, addCalendarDays } from '../dateUtils'

describe('formatLocalDate', () => {
  it('formats local date parts as YYYY-MM-DD, zero-padded', () => {
    expect(formatLocalDate(new Date(2026, 0, 5))).toBe('2026-01-05') // month is 0-indexed in the Date constructor
  })
})

describe('addCalendarDays', () => {
  it('shifts forward and backward across a month boundary', () => {
    expect(addCalendarDays('2026-08-01', -7)).toBe('2026-07-25')
    expect(addCalendarDays('2026-08-29', 7)).toBe('2026-09-05')
  })
  it('is a no-op for 0 days', () => {
    expect(addCalendarDays('2026-08-18', 0)).toBe('2026-08-18')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/reports/__tests__/dateUtils.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `dateUtils.ts`**

```ts
// src/features/reports/dateUtils.ts
// WAFI-147A: the ONE place local-calendar-date formatting/arithmetic lives
// for this feature -- matches useProfitCache.ts's toDateStr() convention.
// NEVER toISOString() (UTC, wrong day near local midnight).

export function formatLocalDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function addCalendarDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return formatLocalDate(new Date(y, m - 1, d + days))
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/features/reports/__tests__/dateUtils.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add src/features/reports/dateUtils.ts src/features/reports/__tests__/dateUtils.test.ts
git commit -m "feat(WAFI-147A): add shared local-date utilities, replacing two near-duplicate implementations"
```

---

### Task 2: `readProfitCache` primitive

**Files:**
- Create: `src/features/reports/primitives/readProfitCache.ts`
- Test: `src/features/reports/primitives/__tests__/readProfitCache.test.ts`

**Interfaces:**
- Consumes: `db` from `@/data/powersync/db` (existing), `ReportDateRange` (Task 1).
- Produces: `interface ProfitCacheSummary { revenueUsd, revenueSyp, cogsUsd, cogsReversalUsd, expensesUsd, refundsUsd, discountUsd, invoiceCount, returnCount, costlessSaleCount, netRevenueUsd, netCogsUsd, profitUsd }`; `function readProfitCache(shopId: string, range: ReportDateRange): Promise<ProfitCacheSummary>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/reports/primitives/__tests__/readProfitCache.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetAll = vi.fn()
vi.mock('@/data/powersync/db', () => ({ db: { getAll: (...args: unknown[]) => mockGetAll(...args) } }))

import { readProfitCache } from '../readProfitCache'

describe('readProfitCache', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sums integer-cent columns across rows before converting to dollars once', async () => {
    mockGetAll.mockResolvedValue([
      { revenue_usd: 10000, revenue_syp: 500000, cogs_usd: 4000, cogs_reversal_usd: 0, expenses_usd: 1000, refunds_usd: 0, discount_usd: 500, invoice_count: 3, return_count: 0, costless_sale_count: 0 },
      { revenue_usd: 5000, revenue_syp: 250000, cogs_usd: 2000, cogs_reversal_usd: 0, expenses_usd: 0, refunds_usd: 200, discount_usd: 0, invoice_count: 1, return_count: 1, costless_sale_count: 0 },
    ])

    const result = await readProfitCache('shop1', { from: '2026-08-01', to: '2026-08-02' })

    expect(mockGetAll).toHaveBeenCalledWith(
      expect.stringContaining('FROM profit_cache WHERE shop_id = ? AND day BETWEEN ? AND ?'),
      ['shop1', '2026-08-01', '2026-08-02'],
    )
    expect(result.revenueUsd).toBe(150)
    expect(result.refundsUsd).toBe(2)
    expect(result.netRevenueUsd).toBe(148)
    expect(result.invoiceCount).toBe(4)
    expect(result.returnCount).toBe(1)
  })

  it('clamps a transiently negative costlessSaleCount to zero for display (no profitIsEstimated field on this primitive -- see Task 0 P1 finding 20, this only covers the clamp)', async () => {
    mockGetAll.mockResolvedValue([
      { revenue_usd: 1000, revenue_syp: 0, cogs_usd: 0, cogs_reversal_usd: 0, expenses_usd: 0, refunds_usd: 0, discount_usd: 0, invoice_count: 1, return_count: 0, costless_sale_count: -1 },
    ])
    const result = await readProfitCache('shop1', { from: '2026-08-01', to: '2026-08-01' })
    expect(result.costlessSaleCount).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/reports/primitives/__tests__/readProfitCache.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `readProfitCache.ts`**

```ts
// src/features/reports/primitives/readProfitCache.ts
// WAFI-147A primitive 1: thin wrapper over the existing profit_cache table
// (WAFI-153, migration 086) -- no new table, no new computation, same
// cents-first-then-divide convention as useProfitCache.ts (see design spec S4).
import { db } from '@/data/powersync/db'
import type { ReportDateRange } from '../report.types'

export interface ProfitCacheSummary {
  revenueUsd: number; revenueSyp: number; cogsUsd: number; cogsReversalUsd: number
  expensesUsd: number; refundsUsd: number; discountUsd: number
  invoiceCount: number; returnCount: number; costlessSaleCount: number
  netRevenueUsd: number; netCogsUsd: number; profitUsd: number
}

type ProfitCacheRow = {
  revenue_usd: number; revenue_syp: number; cogs_usd: number; cogs_reversal_usd: number
  expenses_usd: number; refunds_usd: number; discount_usd: number
  invoice_count: number; return_count: number; costless_sale_count: number
}

export async function readProfitCache(shopId: string, range: ReportDateRange): Promise<ProfitCacheSummary> {
  const rows = await db.getAll<ProfitCacheRow>(
    `SELECT revenue_usd, revenue_syp, cogs_usd, cogs_reversal_usd, expenses_usd,
            refunds_usd, discount_usd, invoice_count, return_count, costless_sale_count
     FROM profit_cache WHERE shop_id = ? AND day BETWEEN ? AND ?`,
    [shopId, range.from, range.to],
  )

  const sums = rows.reduce((acc, r) => ({
    revenueCents: acc.revenueCents + r.revenue_usd, revenueSyp: acc.revenueSyp + r.revenue_syp,
    cogsCents: acc.cogsCents + r.cogs_usd, cogsRevCents: acc.cogsRevCents + r.cogs_reversal_usd,
    expensesCents: acc.expensesCents + r.expenses_usd, refundsCents: acc.refundsCents + r.refunds_usd,
    discountCents: acc.discountCents + r.discount_usd, invoiceCount: acc.invoiceCount + r.invoice_count,
    returnCount: acc.returnCount + r.return_count, costlessCount: acc.costlessCount + r.costless_sale_count,
  }), {
    revenueCents: 0, revenueSyp: 0, cogsCents: 0, cogsRevCents: 0, expensesCents: 0,
    refundsCents: 0, discountCents: 0, invoiceCount: 0, returnCount: 0, costlessCount: 0,
  })

  const revenueUsd = sums.revenueCents / 100
  const refundsUsd = sums.refundsCents / 100
  const cogsUsd = sums.cogsCents / 100
  const cogsReversalUsd = sums.cogsRevCents / 100
  const expensesUsd = sums.expensesCents / 100
  const discountUsd = sums.discountCents / 100
  const netRevenueUsd = revenueUsd - refundsUsd
  const netCogsUsd = cogsUsd - cogsReversalUsd

  return {
    revenueUsd, revenueSyp: sums.revenueSyp, cogsUsd, cogsReversalUsd, expensesUsd, discountUsd,
    invoiceCount: sums.invoiceCount, returnCount: sums.returnCount,
    costlessSaleCount: Math.max(0, sums.costlessCount),
    netRevenueUsd, netCogsUsd, profitUsd: netRevenueUsd - netCogsUsd - expensesUsd,
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/features/reports/primitives/__tests__/readProfitCache.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add src/features/reports/primitives/readProfitCache.ts src/features/reports/primitives/__tests__/readProfitCache.test.ts
git commit -m "feat(WAFI-147A): add readProfitCache primitive over the existing profit_cache table"
```

---

### Task 3: `getStaffMetrics` primitive (generalized from `useStaffPerformanceMetrics.ts`)

**Files:**
- Create: `src/features/reports/primitives/getStaffMetrics.ts`
- Test: `src/features/reports/primitives/__tests__/getStaffMetrics.test.ts`

**Interfaces:**
- Consumes: `db` (existing).
- Produces: `interface StaffMetricsRow { staffId, name, revenueUsd, cogsUsd, marginUsd, marginPct, salesCount, avgTicketUsd, discountUsd, discountRate, returnRevenueUsd, returnCount }` (based on `useStaffPerformanceMetrics.ts`'s `StaffPerformanceRow`, renamed here since it's now a plain function's output, extended with `returnRevenueUsd`/`returnCount` per Task 0 finding 8 — those two values are already computed internally by the original composable's return-netting logic but were previously discarded after being folded into `revenueUsd`/`cogsUsd`); `function getStaffMetrics(shopId: string, range: ReportDateRange): Promise<StaffMetricsRow[]>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/reports/primitives/__tests__/getStaffMetrics.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetAll = vi.fn()
vi.mock('@/data/powersync/db', () => ({ db: { getAll: (...args: unknown[]) => mockGetAll(...args) } }))

import { getStaffMetrics } from '../getStaffMetrics'

describe('getStaffMetrics', () => {
  beforeEach(() => vi.clearAllMocks())

  it('computes revenue/cogs/margin net of returns, attributed the same way as useStaffPerformanceMetrics.ts, and surfaces raw return figures separately', async () => {
    mockGetAll
      .mockResolvedValueOnce([{ staffId: 's1', name: 'Ali', salesCount: 2, grossUsd: 100 }]) // sales
      .mockResolvedValueOnce([{ staffId: 's1', cogs: 40 }]) // cogs
      .mockResolvedValueOnce([{ staffId: 's1', total: 10, returnCount: 2 }]) // return revenue + count
      .mockResolvedValueOnce([{ staffId: 's1', cogs: 4 }]) // return cogs
      .mockResolvedValueOnce([{ staffId: 's1', discountUsd: 5 }]) // discounts

    const rows = await getStaffMetrics('shop1', { from: '2026-08-01', to: '2026-08-07' })

    expect(rows).toHaveLength(1)
    expect(rows[0].revenueUsd).toBe(90) // 100 - 10
    expect(rows[0].cogsUsd).toBe(36) // 40 - 4
    expect(rows[0].marginUsd).toBe(54)
    expect(rows[0].marginPct).toBe(100) // only staff member, 100% of shop-period margin
    expect(rows[0].avgTicketUsd).toBe(50) // gross 100 / 2 sales, unaffected by return attribution
    expect(rows[0].discountRate).toBeCloseTo((5 / 90) * 100)
    expect(rows[0].returnRevenueUsd).toBe(10)
    expect(rows[0].returnCount).toBe(2)
  })

  it('avgTicketUsd and discountRate are null (not 0) when there is no data to divide by', async () => {
    mockGetAll
      .mockResolvedValueOnce([{ staffId: 's1', name: 'Ali', salesCount: 0, grossUsd: 0 }])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    const rows = await getStaffMetrics('shop1', { from: '2026-08-01', to: '2026-08-01' })
    expect(rows[0].avgTicketUsd).toBeNull()
    expect(rows[0].discountRate).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/reports/primitives/__tests__/getStaffMetrics.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `getStaffMetrics.ts`**

Port `useStaffPerformanceMetrics.ts`'s `load()` logic verbatim into a plain async function taking `shopId` explicitly (the composable read it from `useDeviceStore()`; this primitive takes it as a parameter since report definitions already have `shopId` from their own `compute(shopId, range)` signature) and returning the array directly instead of writing into a `ref`.

```ts
// src/features/reports/primitives/getStaffMetrics.ts
// WAFI-147A primitive 2: generalized from useStaffPerformanceMetrics.ts (WAFI-018) --
// same query/attribution logic, extracted to a plain function so report definitions
// (which are not Vue components) can call it directly without a ref-based composable.
import { db } from '@/data/powersync/db'
import type { ReportDateRange } from '../report.types'

export interface StaffMetricsRow {
  staffId: string
  name: string
  revenueUsd: number
  cogsUsd: number
  marginUsd: number
  marginPct: number | null
  salesCount: number
  avgTicketUsd: number | null
  discountUsd: number
  discountRate: number | null
  /** Task 0 finding 8: surfaced separately (not just netted into revenueUsd/
   *  cogsUsd above) so Returns Report (Task 12) has a real per-staff return
   *  figure instead of dumping the whole row. */
  returnRevenueUsd: number
  returnCount: number
}

export async function getStaffMetrics(shopId: string, range: ReportDateRange): Promise<StaffMetricsRow[]> {
  const { from: start, to: end } = range
  const [salesRows, cogsRows, returnRevenueRows, returnCogsRows, discountRows] = await Promise.all([
    db.getAll<{ staffId: string; name: string; salesCount: number; grossUsd: number }>(
      `SELECT s.staff_id AS staffId, st.name AS name,
              COUNT(*) AS salesCount, COALESCE(SUM(s.total_usd), 0) AS grossUsd
       FROM sales s
       JOIN staff st ON st.id = s.staff_id
       WHERE s.shop_id = ? AND s.staff_id IS NOT NULL
         AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY s.staff_id, st.name`,
      [shopId, start, end],
    ),
    db.getAll<{ staffId: string; cogs: number }>(
      `SELECT s.staff_id AS staffId,
              COALESCE(SUM(sli.quantity * COALESCE(sli.unit_cost_usd, 0)), 0) AS cogs
       FROM sale_line_items sli
       JOIN sales s ON sli.sale_id = s.id
       WHERE s.shop_id = ? AND s.staff_id IS NOT NULL
         AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY s.staff_id`,
      [shopId, start, end],
    ),
    // Task 0 P2 finding 21: staffId here is whoever's SHIFT the return fell
    // under (cashier_shifts.staff_id via r.shift_id) -- the staff member who
    // PROCESSED the return, not necessarily the original sale's cashier. Both
    // Returns Report's "By Staff" section (Task 12) and any future consumer
    // must be read as "returns processed by," not "returns caused by."
    db.getAll<{ staffId: string; total: number; returnCount: number }>(
      `SELECT cs.staff_id AS staffId, COALESCE(SUM(r.refund_amount_usd), 0) AS total, COUNT(*) AS returnCount
       FROM returns r
       JOIN cashier_shifts cs ON cs.id = r.shift_id
       WHERE r.shop_id = ? AND cs.staff_id IS NOT NULL
         AND DATE(r.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY cs.staff_id`,
      [shopId, start, end],
    ),
    db.getAll<{ staffId: string; cogs: number }>(
      `SELECT cs.staff_id AS staffId,
              COALESCE(SUM(rli.qty_returned * COALESCE(c.unit_cost_usd, 0)), 0) AS cogs
       FROM return_line_items rli
       JOIN returns r ON r.id = rli.return_id
       JOIN cashier_shifts cs ON cs.id = r.shift_id
       LEFT JOIN (
         SELECT sale_id, product_id, AVG(unit_cost_usd) as unit_cost_usd
         FROM sale_line_items
         WHERE shop_id = ?
         GROUP BY sale_id, product_id
       ) c ON c.sale_id = r.original_sale_id AND c.product_id = rli.product_id
       WHERE r.shop_id = ? AND rli.restock = 1 AND cs.staff_id IS NOT NULL
         AND DATE(r.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY cs.staff_id`,
      [shopId, shopId, start, end],
    ),
    db.getAll<{ staffId: string; discountUsd: number }>(
      `SELECT s.staff_id AS staffId, COALESCE(SUM(s.sale_discount_amount_usd), 0) AS discountUsd
       FROM sales s
       WHERE s.shop_id = ? AND s.staff_id IS NOT NULL
         AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY s.staff_id`,
      [shopId, start, end],
    ),
  ])

  const cogsMap = new Map(cogsRows.map((r) => [r.staffId, r.cogs]))
  const returnRevenueMap = new Map(returnRevenueRows.map((r) => [r.staffId, r.total]))
  const returnCountMap = new Map(returnRevenueRows.map((r) => [r.staffId, r.returnCount]))
  const returnCogsMap = new Map(returnCogsRows.map((r) => [r.staffId, r.cogs]))
  const discountMap = new Map(discountRows.map((r) => [r.staffId, r.discountUsd]))

  const built = salesRows.map((s): StaffMetricsRow => {
    const returnRevenue = returnRevenueMap.get(s.staffId) ?? 0
    const returnCogs = returnCogsMap.get(s.staffId) ?? 0
    const revenueUsd = s.grossUsd - returnRevenue
    const cogsUsd = (cogsMap.get(s.staffId) ?? 0) - returnCogs
    const marginUsd = revenueUsd - cogsUsd
    const avgTicketUsd = s.salesCount > 0 ? s.grossUsd / s.salesCount : null
    const discountUsd = discountMap.get(s.staffId) ?? 0
    return {
      staffId: s.staffId, name: s.name, revenueUsd, cogsUsd, marginUsd, marginPct: null,
      salesCount: s.salesCount, avgTicketUsd, discountUsd,
      discountRate: revenueUsd > 0 ? (discountUsd / revenueUsd) * 100 : null,
      // Task 0 finding 8 (Returns Report needs this per-staff, not just netted
      // into revenueUsd/cogsUsd above): the same values already computed for
      // the netting above, surfaced separately rather than discarded.
      returnRevenueUsd: returnRevenue,
      returnCount: returnCountMap.get(s.staffId) ?? 0,
    }
  })

  const totalMarginUsd = built.reduce((sum, r) => sum + r.marginUsd, 0)
  return built.map((r) => ({
    ...r,
    marginPct: totalMarginUsd !== 0 ? (r.marginUsd / totalMarginUsd) * 100 : null,
  }))
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/features/reports/primitives/__tests__/getStaffMetrics.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add src/features/reports/primitives/getStaffMetrics.ts src/features/reports/primitives/__tests__/getStaffMetrics.test.ts
git commit -m "feat(WAFI-147A): add getStaffMetrics primitive generalized from useStaffPerformanceMetrics.ts"
```

---

### Task 4: `getCustomerAgingSnapshot` primitive (as-of-date)

**Files:**
- Create: `src/features/reports/primitives/getCustomerAgingSnapshot.ts`
- Test: `src/features/reports/primitives/__tests__/getCustomerAgingSnapshot.test.ts`

**Interfaces:**
- Consumes: `db` (existing).
- Produces: `interface CustomerAgingRow { customerId, customerName, balanceUsd, oldestUnpaidDate, daysOutstanding, lastPaymentDate }`; `function getCustomerAgingSnapshot(shopId: string, asOfDate: string): Promise<CustomerAgingRow[]>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/reports/primitives/__tests__/getCustomerAgingSnapshot.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetAll = vi.fn()
const mockGetOptional = vi.fn()
vi.mock('@/data/powersync/db', () => ({
  db: { getAll: (...a: unknown[]) => mockGetAll(...a), getOptional: (...a: unknown[]) => mockGetOptional(...a) },
}))

import { getCustomerAgingSnapshot } from '../getCustomerAgingSnapshot'

describe('getCustomerAgingSnapshot', () => {
  beforeEach(() => vi.clearAllMocks())

  it('filters the balance formula by asOfDate, not the live current balance', async () => {
    mockGetAll.mockResolvedValue([{ id: 'c1', name: 'Sara', balance_usd: 50 }])
    mockGetOptional
      .mockResolvedValueOnce({ oldest: '2026-08-01T00:00:00.000Z' })
      .mockResolvedValueOnce({ paid_at: '2026-08-05' })

    const rows = await getCustomerAgingSnapshot('shop1', '2026-08-09')

    // the balance query must include the as-of-date bound in every subquery
    const [sql, params] = mockGetAll.mock.calls[0]
    expect(sql).toContain('<= ?')
    expect(params).toContain('2026-08-09')
    expect(rows[0]).toMatchObject({ customerId: 'c1', customerName: 'Sara', balanceUsd: 50, lastPaymentDate: '2026-08-05' })
  })

  it('excludes customers with a balance effectively at zero', async () => {
    mockGetAll.mockResolvedValue([{ id: 'c1', name: 'Sara', balance_usd: 0.0001 }])
    const rows = await getCustomerAgingSnapshot('shop1', '2026-08-09')
    expect(rows).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/reports/primitives/__tests__/getCustomerAgingSnapshot.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `getCustomerAgingSnapshot.ts`**

Base this on `creditDebtors.ts`'s `fetchCreditDebtors`/`BALANCE_USD_EXPR`, adding the `asOfDate` bound to every subquery per design spec S4's correction (`sales`/`returns` use `created_at`; `customer_payments` uses its `paid_at` DATE column, the semantically correct date for "was this payment made by this date").

```ts
// src/features/reports/primitives/getCustomerAgingSnapshot.ts
// WAFI-147A primitive 3: as-of-date snapshot, NOT current-state (design spec S4's
// correction). Adapted from creditDebtors.ts's canonical balance formula -- that
// formula has no date boundary (always means "balance right now"), which would
// silently misreport a historical report's period-end balance as today's live
// balance. Every subquery here is bounded by asOfDate.
//
// Task 0 P1 finding 13, verified: customer_payments.paid_at is a DATE column
// (migration 009_expand_domain_tables_for_sync.sql), not a TIMESTAMPTZ -- no
// time-of-day component, so `paid_at <= asOfDate` needs no end-of-day boundary
// adjustment. Also verified: the oldest-unpaid-sale subquery below intentionally
// nets only `returns` against `is_credit = 1` sales, mirroring the main balance
// formula's first+third components -- NOT its fourth component (is_credit = 0
// store-credit refunds), which is a debt source with no originating credit sale
// to anchor a FIFO age against, so it's correctly excluded here, not an
// oversight or an inconsistency to fix.
import { db } from '@/data/powersync/db'

export interface CustomerAgingRow {
  customerId: string
  customerName: string
  balanceUsd: number
  oldestUnpaidDate: string
  daysOutstanding: number
  lastPaymentDate: string | null
}

type CustomerBalanceRow = { id: string; name: string; balance_usd: number }
type OldestRow = { oldest: string | null }
type LastPaymentRow = { paid_at: string | null }

const BALANCE_USD_EXPR_AS_OF = `
  (COALESCE((SELECT SUM(total_usd) FROM sales
              WHERE customer_id = c.id AND is_credit = 1 AND shop_id = ? AND DATE(created_at, 'localtime') <= ?), 0)
 - COALESCE((SELECT SUM(amount_usd) FROM customer_payments
              WHERE customer_id = c.id AND shop_id = ? AND paid_at <= ?), 0)
 - COALESCE((SELECT SUM(r.refund_amount_usd) FROM returns r JOIN sales s ON s.id = r.original_sale_id
              WHERE s.customer_id = c.id AND s.is_credit = 1 AND r.shop_id = ? AND DATE(r.created_at, 'localtime') <= ?), 0)
 - COALESCE((SELECT SUM(r.refund_amount_usd) FROM returns r JOIN sales s ON s.id = r.original_sale_id
              WHERE s.customer_id = c.id AND s.is_credit = 0 AND r.refund_method = 'store_credit' AND r.shop_id = ? AND DATE(r.created_at, 'localtime') <= ?), 0)
  ) AS balance_usd`

function daysBetween(fromIso: string, toIso: string): number {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime()
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)))
}

export async function getCustomerAgingSnapshot(shopId: string, asOfDate: string): Promise<CustomerAgingRow[]> {
  const customerRows = await db.getAll<CustomerBalanceRow>(
    `SELECT c.id, c.name, ${BALANCE_USD_EXPR_AS_OF}
     FROM customers c
     WHERE c.shop_id = ? AND (c.deleted = 0 OR c.deleted IS NULL)`,
    [shopId, asOfDate, shopId, asOfDate, shopId, asOfDate, shopId, asOfDate, shopId],
  )

  const results: CustomerAgingRow[] = []
  for (const c of customerRows) {
    if (Math.abs(c.balance_usd) <= 0.001) continue

    let oldestUnpaidDate = asOfDate
    if (c.balance_usd > 0.001) {
      const oldestRow = await db.getOptional<OldestRow>(
        `SELECT MIN(s.created_at) AS oldest FROM (
           SELECT s.id, s.created_at, s.total_usd
             - COALESCE((SELECT SUM(amount_usd) FROM customer_payments cp WHERE cp.sale_id = s.id AND cp.paid_at <= ?), 0)
             - COALESCE((SELECT SUM(r.refund_amount_usd) FROM returns r WHERE r.original_sale_id = s.id AND DATE(r.created_at, 'localtime') <= ?), 0)
             AS remaining_usd
           FROM sales s WHERE s.customer_id = ? AND s.is_credit = 1 AND s.shop_id = ?
             AND DATE(s.created_at, 'localtime') <= ?
         ) s WHERE s.remaining_usd > 0.001`,
        [asOfDate, asOfDate, c.id, shopId, asOfDate],
      )
      oldestUnpaidDate = oldestRow?.oldest ?? asOfDate
    }

    const lastPaymentRow = await db.getOptional<LastPaymentRow>(
      `SELECT MAX(paid_at) AS paid_at FROM customer_payments WHERE customer_id = ? AND shop_id = ? AND paid_at <= ?`,
      [c.id, shopId, asOfDate],
    )

    results.push({
      customerId: c.id,
      customerName: c.name,
      balanceUsd: c.balance_usd,
      oldestUnpaidDate,
      daysOutstanding: daysBetween(oldestUnpaidDate, asOfDate),
      lastPaymentDate: lastPaymentRow?.paid_at ?? null,
    })
  }
  return results
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/features/reports/primitives/__tests__/getCustomerAgingSnapshot.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add src/features/reports/primitives/getCustomerAgingSnapshot.ts src/features/reports/primitives/__tests__/getCustomerAgingSnapshot.test.ts
git commit -m "feat(WAFI-147A): add getCustomerAgingSnapshot primitive with as-of-date semantics"
```

---

### Task 4b: `readShiftCashReconciliation` primitive (added by Task 0, finding 2)

Not one of the spec's original 3 primitives — discovered during Task 0's domain verification that Daily Closing's and Cash Flow's cash-reconciliation figures must come from `cashier_shifts.z_report_data`, an immutable snapshot of `ZReportMetrics` (`src/features/shifts/shift.types.ts`) already captured by the app's own verified `computeCashReconciliation` engine at shift-close time (`src/features/shifts/composables/cashReconciliation.ts`, invoked via `useZReport.ts`). Reinventing this equation from raw revenue/expenses (the plan's original draft) omits cash credit-payment collection, cash refunds, and mid-shift pay-in/pay-out movements — a real correctness bug, not a simplification. This is a 4th shared primitive, used by Tasks 6 and 7.

**Files:**
- Create: `src/features/reports/primitives/readShiftCashReconciliation.ts`
- Test: `src/features/reports/primitives/__tests__/readShiftCashReconciliation.test.ts`

**Interfaces:**
- Consumes: `db` (existing), `ReportDateRange` (Task 1).
- Produces: `interface ShiftCashSummary { expectedUsd, actualUsd, varianceUsd, cashSalesUsd, cashExpensesUsd, cashRefundsUsd, cashCreditPaymentsUsd, cashPayInsUsd, cashPayOutsUsd }`; `function readShiftCashReconciliation(shopId: string, range: ReportDateRange): Promise<ShiftCashSummary>` — sums the named fields out of every closed shift's `z_report_data` JSON within range. Returns all-zero when no eligible snapshot exists (no shift closed in range) and tolerates known legacy `NULL` snapshots (pre-WAFI-060 rows); throws on a malformed or incomplete non-null snapshot (Task 0 P0 finding 12).

- [ ] **Step 1: Write the failing test**

```ts
// src/features/reports/primitives/__tests__/readShiftCashReconciliation.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetAll = vi.fn()
vi.mock('@/data/powersync/db', () => ({ db: { getAll: (...a: unknown[]) => mockGetAll(...a) } }))

import { readShiftCashReconciliation } from '../readShiftCashReconciliation'

describe('readShiftCashReconciliation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sums the ZReportMetrics fields out of every closed shift\'s z_report_data in range', async () => {
    mockGetAll.mockResolvedValue([
      { id: 'sh1', z_report_data: JSON.stringify({ expectedUsd: 100, actualUsd: 98, varianceUsd: -2, cashUsdSales: 80, cashExpensesUsd: 10, cashRefundsUsd: 5, cashCreditPaymentsUsd: 20, cashPayInsUsd: 0, cashPayOutsUsd: 15 }) },
      { id: 'sh2', z_report_data: JSON.stringify({ expectedUsd: 50, actualUsd: 50, varianceUsd: 0, cashUsdSales: 40, cashExpensesUsd: 0, cashRefundsUsd: 0, cashCreditPaymentsUsd: 10, cashPayInsUsd: 5, cashPayOutsUsd: 0 }) },
    ])

    const result = await readShiftCashReconciliation('shop1', { from: '2026-08-18', to: '2026-08-18' })

    expect(mockGetAll).toHaveBeenCalledWith(
      expect.stringContaining("status = 'closed'"),
      ['shop1', '2026-08-18', '2026-08-18'],
    )
    expect(result.expectedUsd).toBe(150)
    expect(result.actualUsd).toBe(148)
    expect(result.varianceUsd).toBe(-2)
    expect(result.cashCreditPaymentsUsd).toBe(30)
    expect(result.cashPayOutsUsd).toBe(15)
  })

  it('treats a shift with no z_report_data (legacy/pre-WAFI-060 row) as all-zero, not a throw', async () => {
    mockGetAll.mockResolvedValue([{ id: 'sh-legacy', z_report_data: null }])
    const result = await readShiftCashReconciliation('shop1', { from: '2026-08-01', to: '2026-08-01' })
    expect(result.expectedUsd).toBe(0)
  })

  it('throws, naming the shift, on unparseable JSON -- never silently treats it as zero (Task 0 P0 finding 12)', async () => {
    mockGetAll.mockResolvedValue([{ id: 'sh-broken', z_report_data: '{not valid json' }])
    await expect(readShiftCashReconciliation('shop1', { from: '2026-08-01', to: '2026-08-01' }))
      .rejects.toThrow(/sh-broken/)
  })

  it('throws, naming the field, when a required numeric field is missing or NaN -- never silently treats it as zero', async () => {
    mockGetAll.mockResolvedValue([{ id: 'sh-incomplete', z_report_data: JSON.stringify({ expectedUsd: 100, actualUsd: 100, varianceUsd: 0, cashUsdSales: 80, cashExpensesUsd: 0, cashRefundsUsd: 0, cashCreditPaymentsUsd: 0, cashPayInsUsd: 0 /* cashPayOutsUsd missing */ }) }])
    await expect(readShiftCashReconciliation('shop1', { from: '2026-08-01', to: '2026-08-01' }))
      .rejects.toThrow(/sh-incomplete.*cashPayOutsUsd/)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/reports/primitives/__tests__/readShiftCashReconciliation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `readShiftCashReconciliation.ts`**

```ts
// src/features/reports/primitives/readShiftCashReconciliation.ts
// WAFI-147A primitive 4 (added by Task 0, finding 2): the ONLY source of cash-
// reconciliation figures for any report -- never recompute expected/actual/
// variance from raw revenue and expenses. z_report_data is an immutable
// snapshot of ZReportMetrics (shift.types.ts), captured at close time by the
// app's own verified computeCashReconciliation engine (cashReconciliation.ts,
// via useZReport.ts) -- it already accounts for cash sales, cash credit-
// payment collection, cash refunds, and mid-shift pay-ins/pay-outs.
import { db } from '@/data/powersync/db'
import type { ReportDateRange } from '../report.types'

export interface ShiftCashSummary {
  expectedUsd: number; actualUsd: number; varianceUsd: number
  cashSalesUsd: number; cashExpensesUsd: number; cashRefundsUsd: number
  cashCreditPaymentsUsd: number; cashPayInsUsd: number; cashPayOutsUsd: number
}

const ZERO: ShiftCashSummary = {
  expectedUsd: 0, actualUsd: 0, varianceUsd: 0, cashSalesUsd: 0, cashExpensesUsd: 0,
  cashRefundsUsd: 0, cashCreditPaymentsUsd: 0, cashPayInsUsd: 0, cashPayOutsUsd: 0,
}

// Subset of ZReportMetrics (shift.types.ts) this primitive reads back out of the
// JSON snapshot -- field names must match that interface exactly, since
// z_report_data is JSON.stringify(zReport) written verbatim at close time.
type ZReportSubset = {
  expectedUsd: number; actualUsd: number; varianceUsd: number
  cashUsdSales: number; cashExpensesUsd: number; cashRefundsUsd: number
  cashCreditPaymentsUsd: number; cashPayInsUsd: number; cashPayOutsUsd: number
}

const REQUIRED_FIELDS: (keyof ZReportSubset)[] = [
  'expectedUsd', 'actualUsd', 'varianceUsd', 'cashUsdSales', 'cashExpensesUsd',
  'cashRefundsUsd', 'cashCreditPaymentsUsd', 'cashPayInsUsd', 'cashPayOutsUsd',
]

/** Task 0 P0 finding 12: a financial report must never silently treat
 *  malformed/incomplete z_report_data as zero -- that would understate real
 *  cash movement and look like a clean reconciliation when the underlying
 *  data is actually broken. JSON.parse() throwing, or any required field
 *  being missing/non-finite (NaN, undefined, a string), is treated as a hard
 *  failure: this function throws, which surfaces as the report's visible
 *  error state (ReportDetailPage.vue's existing catch/error.value), not a
 *  silently-wrong number. A legacy pre-WAFI-060 row with a genuinely NULL
 *  z_report_data column is the one deliberately tolerated case -- that's a
 *  known, documented absence (shifts closed before the Z-report snapshot
 *  existed), not malformed data. */
function parseZReport(shiftId: string, raw: string): ZReportSubset {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`readShiftCashReconciliation: shift ${shiftId} has unparseable z_report_data`)
  }
  const obj = parsed as Record<string, unknown>
  for (const field of REQUIRED_FIELDS) {
    const value = obj[field]
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`readShiftCashReconciliation: shift ${shiftId}'s z_report_data.${field} is missing or not a finite number`)
    }
  }
  return obj as unknown as ZReportSubset
}

export async function readShiftCashReconciliation(shopId: string, range: ReportDateRange): Promise<ShiftCashSummary> {
  const rows = await db.getAll<{ id: string; z_report_data: string | null }>(
    `SELECT id, z_report_data FROM cashier_shifts
     WHERE shop_id = ? AND status = 'closed' AND DATE(closed_at, 'localtime') BETWEEN ? AND ?`,
    [shopId, range.from, range.to],
  )

  return rows.reduce<ShiftCashSummary>((acc, row) => {
    if (!row.z_report_data) return acc // legacy pre-WAFI-060 row, no snapshot -- contributes nothing, does not throw
    const z = parseZReport(row.id, row.z_report_data)
    return {
      expectedUsd: acc.expectedUsd + z.expectedUsd,
      actualUsd: acc.actualUsd + z.actualUsd,
      varianceUsd: acc.varianceUsd + z.varianceUsd,
      cashSalesUsd: acc.cashSalesUsd + z.cashUsdSales,
      cashExpensesUsd: acc.cashExpensesUsd + z.cashExpensesUsd,
      cashRefundsUsd: acc.cashRefundsUsd + z.cashRefundsUsd,
      cashCreditPaymentsUsd: acc.cashCreditPaymentsUsd + z.cashCreditPaymentsUsd,
      cashPayInsUsd: acc.cashPayInsUsd + z.cashPayInsUsd,
      cashPayOutsUsd: acc.cashPayOutsUsd + z.cashPayOutsUsd,
    }
  }, ZERO)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/features/reports/primitives/__tests__/readShiftCashReconciliation.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add src/features/reports/primitives/readShiftCashReconciliation.ts src/features/reports/primitives/__tests__/readShiftCashReconciliation.test.ts
git commit -m "feat(WAFI-147A): add readShiftCashReconciliation primitive reusing the app's own verified Z-report engine"
```

---

### Task 4c: `queryDeadStockRows` primitive (moved from a report definition, Task 0 P0 finding 6)

An earlier draft of this plan put `queryDeadStockRows`/`DeadStockRow` inside `definitions/inventoryHealth.ts`, with Task 17's dedicated Dead Stock report importing it from there. Review correctly flagged this as backwards: a primitive genuinely shared by two report definitions belongs in `primitives/`, not inside one of its own consumers (that dependency direction makes `inventoryHealth.ts` a load-bearing import for an unrelated report, and buries a shared primitive one level too deep). Moved here as the 5th shared primitive.

**Files:**
- Create: `src/features/reports/primitives/queryDeadStockRows.ts`
- Test: `src/features/reports/primitives/__tests__/queryDeadStockRows.test.ts`

**Interfaces:**
- Consumes: `db` (existing).
- Produces: `interface DeadStockRow { productId, nameAr, currentStock, valueUsd, lastSoldAt }`; `function queryDeadStockRows(shopId: string, thresholdDays: number): Promise<DeadStockRow[]>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/reports/primitives/__tests__/queryDeadStockRows.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetAll = vi.fn()
vi.mock('@/data/powersync/db', () => ({ db: { getAll: (...a: unknown[]) => mockGetAll(...a) } }))

import { queryDeadStockRows } from '../queryDeadStockRows'

describe('queryDeadStockRows', () => {
  beforeEach(() => vi.clearAllMocks())

  it('computes valueUsd as current_stock * cost_price_usd and excludes uncosted products', async () => {
    mockGetAll.mockResolvedValue([
      { id: 'p1', name_ar: 'قلم', current_stock: 10, cost_price_usd: 2, last_sold_at: null },
      { id: 'p2', name_ar: 'دفتر', current_stock: 5, cost_price_usd: 0, last_sold_at: '2026-05-01' }, // uncosted, excluded
    ])
    const rows = await queryDeadStockRows('shop1', 90)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ productId: 'p1', currentStock: 10, valueUsd: 20, lastSoldAt: null })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/reports/primitives/__tests__/queryDeadStockRows.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `queryDeadStockRows.ts`**

```ts
// src/features/reports/primitives/queryDeadStockRows.ts
// WAFI-147A primitive 5: shared by Inventory Health's Dead Stock section
// (Task 16) and the dedicated Dead Stock report (Task 17) -- ported from
// useDeadStockReport.ts's query (Vue-bound composable's logic, extracted to
// a plain function). Threshold is a parameter (the original report spec
// offers 60/90/180) rather than hardcoded, so both callers can share one
// implementation even with different defaults.
import { db } from '@/data/powersync/db'

export interface DeadStockRow {
  productId: string; nameAr: string; currentStock: number; valueUsd: number; lastSoldAt: string | null
}

export async function queryDeadStockRows(shopId: string, thresholdDays: number): Promise<DeadStockRow[]> {
  const cutoff = new Date(Date.now() - thresholdDays * 24 * 3_600_000).toISOString()
  const rows = await db.getAll<{ id: string; name_ar: string; current_stock: number; cost_price_usd: number; last_sold_at: string | null }>(
    `SELECT p.id, p.name_ar, p.current_stock, p.cost_price_usd, ls.last_sold_at
     FROM products p
     LEFT JOIN (
       SELECT sli.product_id, MAX(s.created_at) AS last_sold_at
       FROM sale_line_items sli JOIN sales s ON s.id = sli.sale_id
       WHERE s.shop_id = ? GROUP BY sli.product_id
     ) ls ON ls.product_id = p.id
     WHERE p.shop_id = ? AND (p.deleted = 0 OR p.deleted IS NULL) AND p.current_stock > 0
       AND (ls.last_sold_at IS NULL OR ls.last_sold_at < ?)`,
    [shopId, shopId, cutoff],
  )
  return rows
    .filter((r) => r.cost_price_usd > 0)
    .map((r) => ({ productId: r.id, nameAr: r.name_ar, currentStock: r.current_stock, valueUsd: r.current_stock * r.cost_price_usd, lastSoldAt: r.last_sold_at }))
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/features/reports/primitives/__tests__/queryDeadStockRows.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/reports/primitives/queryDeadStockRows.ts src/features/reports/primitives/__tests__/queryDeadStockRows.test.ts
git commit -m "feat(WAFI-147A): add queryDeadStockRows as a shared primitive, not a report-definition export"
```

---

### Task 5: Empty registry

**Files:**
- Create: `src/features/reports/reportRegistry.ts`
- Test: `src/features/reports/__tests__/reportRegistry.test.ts`

**Interfaces:**
- Consumes: `Report`, `ReportId`, `ReportContext`, `ReportDateRange` (Task 1 — `ReportId` is defined there, not here, to avoid a circular import since `Report.id: ReportId`).
- Produces: `interface ReportDefinition { id: ReportId; name: string; cadenceHint: 'per-shift'|'daily'|'weekly'|'monthly'; contextRequirement?: 'staff'; compute: (shopId: string, range: ReportDateRange, context?: ReportContext) => Promise<Report> }`; `const REPORT_DEFINITIONS: Record<ReportId, ReportDefinition>`. `cadenceHint` is purely descriptive; `contextRequirement` is the real, checkable invocation contract Task 21's UI branches on (Task 0 P0 finding 4 — do not conflate the two).

- [ ] **Step 1: Write the failing test**

```ts
// src/features/reports/__tests__/reportRegistry.test.ts
import { describe, it, expect } from 'vitest'
import { REPORT_DEFINITIONS } from '../reportRegistry'
import type { ReportId } from '../report.types'

const EXPECTED_IDS: ReportId[] = [
  'daily-closing', 'cash-flow', 'weekly-summary', 'profit-trend', 'employee-summary',
  'discount-report', 'returns-report', 'credit-report', 'top-customers', 'top-products',
  'inventory-health', 'dead-stock', 'monthly-health',
]

describe('REPORT_DEFINITIONS', () => {
  it('is empty until report definitions are registered in later tasks', () => {
    expect(Object.keys(REPORT_DEFINITIONS)).toHaveLength(0)
  })
})

describe('ReportId', () => {
  it('documents all 13 report ids as a compile-time check', () => {
    // This test exists to fail to compile (not to fail at runtime) if a future
    // edit removes a ReportId member -- assigning the full expected list to a
    // ReportId[]-typed const is the check.
    expect(EXPECTED_IDS).toHaveLength(13)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/reports/__tests__/reportRegistry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `reportRegistry.ts`**

```ts
// src/features/reports/reportRegistry.ts
// WAFI-147A: the canonical catalogue of report types. NOT a promise that a
// report's compute() implementation is reusable by a future server-side
// scheduler (147B) -- see design spec S3. Each report definition file
// (Tasks 6-18) adds its own entry here.
//
// NOTE on duplicate-key safety: Record<ReportId, ReportDefinition> gives
// compile-time KEY validity (a typo'd id fails to compile) -- it does NOT give
// compile-time duplicate-registration detection. Two files both assigning
// REPORT_DEFINITIONS['daily-closing'] = ... both compile; whichever import
// runs last silently wins at runtime. The registration barrel (Task 21,
// src/features/reports/index.ts) is the single reviewable place new report
// ids get added specifically so a duplicate is visible in one file's diff --
// this is a process safeguard, not a type-system guarantee.
import type { Report, ReportId, ReportContext, ReportDateRange } from './report.types'

export interface ReportDefinition {
  id: ReportId
  name: string
  /** Display/UX metadata only -- does NOT determine execution, scheduling,
   *  eligibility, or availability. Scheduling is 147B's problem entirely.
   *  Task 0 P0 finding 4: this is PURELY descriptive -- ReportDetailPage
   *  (Task 21) must never branch on cadenceHint to decide what context a
   *  report needs. That's contextRequirement's job, below. */
  cadenceHint: 'per-shift' | 'daily' | 'weekly' | 'monthly'
  /** What ReportDetailPage must collect before calling compute(). Absent
   *  (undefined) means only (shopId, range) is needed -- the common case.
   *  'staff' means compute() requires context.staffId (currently only
   *  Employee Summary) -- the page must show a staff selector and withhold
   *  compute() until one is chosen. This is a real, checkable invocation
   *  contract, not inferred from cadenceHint or any other unrelated field. */
  contextRequirement?: 'staff'
  compute: (shopId: string, range: ReportDateRange, context?: ReportContext) => Promise<Report>
}

export const REPORT_DEFINITIONS: Record<ReportId, ReportDefinition> = {} as Record<ReportId, ReportDefinition>
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/features/reports/__tests__/reportRegistry.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add src/features/reports/reportRegistry.ts src/features/reports/__tests__/reportRegistry.test.ts
git commit -m "feat(WAFI-147A): add ReportId type and empty report registry"
```

---

### Task 6: Daily Closing report definition

**Files:**
- Create: `src/features/reports/definitions/dailyClosing.ts`
- Modify: `src/features/reports/reportRegistry.ts` (register the entry)
- Test: `src/features/reports/definitions/__tests__/dailyClosing.test.ts`

**Interfaces:**
- Consumes: `readProfitCache` (Task 2), `getStaffMetrics` (Task 3), `readShiftCashReconciliation` (Task 4b — **never** recompute cash reconciliation from raw revenue/expenses), `summarySection`/`detailSection` (Task 1), `db`.
- Produces: `interface TopProductRow { productId, nameAr, quantitySold, revenueUsd }`; adds `REPORT_DEFINITIONS['daily-closing']`.

**Sections:** Sales Totals (summary) + Cash Reconciliation (summary) + Expenses (summary) + Top 5 Products (detail) + Staff Performance (detail, `getStaffMetrics` reused directly as rows).

- [ ] **Step 1: Write the failing test**

```ts
// src/features/reports/definitions/__tests__/dailyClosing.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetAll = vi.fn()
vi.mock('@/data/powersync/db', () => ({ db: { getAll: (...a: unknown[]) => mockGetAll(...a) } }))

vi.mock('../../primitives/readProfitCache', () => ({
  readProfitCache: vi.fn().mockResolvedValue({
    revenueUsd: 500, revenueSyp: 0, cogsUsd: 200, cogsReversalUsd: 0, expensesUsd: 50,
    refundsUsd: 0, discountUsd: 10, invoiceCount: 8, returnCount: 0, costlessSaleCount: 0,
    netRevenueUsd: 500, netCogsUsd: 200, profitUsd: 250,
  }),
}))
vi.mock('../../primitives/getStaffMetrics', () => ({
  getStaffMetrics: vi.fn().mockResolvedValue([
    { staffId: 's1', name: 'Ali', revenueUsd: 500, cogsUsd: 200, marginUsd: 300, marginPct: 100, salesCount: 8, avgTicketUsd: 62.5, discountUsd: 10, discountRate: 2 },
  ]),
})
vi.mock('../../primitives/readShiftCashReconciliation', () => ({
  readShiftCashReconciliation: vi.fn().mockResolvedValue({
    expectedUsd: 145, actualUsd: 150, varianceUsd: 5, cashSalesUsd: 400, cashExpensesUsd: 50,
    cashRefundsUsd: 0, cashCreditPaymentsUsd: 0, cashPayInsUsd: 0, cashPayOutsUsd: 0,
  }),
})

import { computeDailyClosingReport } from '../dailyClosing'

describe('computeDailyClosingReport', () => {
  beforeEach(() => vi.clearAllMocks())

  it('builds sales/cash/expenses summaries plus top-products/staff detail sections, reading cash reconciliation from readShiftCashReconciliation (never recomputing it)', async () => {
    mockGetAll
      .mockResolvedValueOnce([{ productId: 'p1', nameAr: 'قلم', quantitySold: 10, revenueUsd: 100 }]) // top 5
      .mockResolvedValueOnce([{ total: 300 }]) // customer payments received

    const report = await computeDailyClosingReport('shop1', { from: '2026-08-18', to: '2026-08-18' })

    expect(report.id).toBe('daily-closing')
    const types = report.sections.map((s) => s.type)
    expect(types).toEqual(['summary', 'summary', 'summary', 'detail', 'detail'])
    const cashSection = report.sections[1]
    expect(cashSection.type).toBe('summary')
    if (cashSection.type === 'summary') {
      expect(cashSection.metrics.find((m) => m.label === 'Expected cash')?.value).toBe(145)
      expect(cashSection.metrics.find((m) => m.label === 'Variance')?.value).toBe(5)
    }
    const salesSummary = report.sections[0]
    expect(salesSummary.type).toBe('summary')
    if (salesSummary.type === 'summary') {
      expect(salesSummary.metrics.find((m) => m.label === 'Average basket')?.value).toBeCloseTo(500 / 8)
    }
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/reports/definitions/__tests__/dailyClosing.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `dailyClosing.ts`**

```ts
// src/features/reports/definitions/dailyClosing.ts
// WAFI-147A report 1/13. "generated at shift close or midnight" per the original
// spec's cadence -- this compute() is on-demand only; no scheduling here (147B).
import { db } from '@/data/powersync/db'
import { readProfitCache } from '../primitives/readProfitCache'
import { getStaffMetrics } from '../primitives/getStaffMetrics'
import { readShiftCashReconciliation } from '../primitives/readShiftCashReconciliation'
import { summarySection, detailSection } from '../report.types'
import type { Report, ReportDateRange } from '../report.types'
import { REPORT_DEFINITIONS } from '../reportRegistry'

export interface TopProductRow {
  productId: string
  nameAr: string
  quantitySold: number
  revenueUsd: number
}

export async function computeDailyClosingReport(shopId: string, range: ReportDateRange): Promise<Report> {
  const [profit, staff, cash, topProductRows, paymentsRow] = await Promise.all([
    readProfitCache(shopId, range),
    getStaffMetrics(shopId, range),
    readShiftCashReconciliation(shopId, range),
    db.getAll<TopProductRow>(
      `SELECT sli.product_id AS productId, p.name_ar AS nameAr,
              SUM(sli.quantity) AS quantitySold, SUM(sli.line_total_usd) AS revenueUsd
       FROM sale_line_items sli
       JOIN sales s ON s.id = sli.sale_id
       JOIN products p ON p.id = sli.product_id
       WHERE sli.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY sli.product_id, p.name_ar
       ORDER BY revenueUsd DESC LIMIT 5`,
      [shopId, range.from, range.to],
    ),
    // paid_at is a DATE column (verified, migration 009), not a timestamp --
    // plain BETWEEN is correct and inclusive with no end-of-day adjustment
    // needed. Do not "fix" this into a timestamp-style >=/< comparison; that
    // would be solving a problem this column doesn't have (Task 0 P1
    // finding 10, second review).
    db.getOptional<{ total: number }>(
      `SELECT COALESCE(SUM(amount_usd), 0) AS total FROM customer_payments
       WHERE shop_id = ? AND paid_at BETWEEN ? AND ?`,
      [shopId, range.from, range.to],
    ),
  ])

  return {
    id: 'daily-closing',
    name: 'Daily Closing Report',
    dateRange: range,
    generatedAt: new Date().toISOString(),
    sections: [
      summarySection({
        title: 'Sales Totals',
        metrics: [
          { label: 'Total sales', value: profit.revenueUsd, unit: 'USD' },
          { label: 'Transactions', value: profit.invoiceCount },
          { label: 'Average basket', value: profit.invoiceCount > 0 ? profit.revenueUsd / profit.invoiceCount : 0, unit: 'USD' },
        ],
      }),
      summarySection({
        title: 'Cash Reconciliation',
        metrics: [
          { label: 'Expected cash', value: cash.expectedUsd, unit: 'USD' },
          { label: 'Actual cash', value: cash.actualUsd, unit: 'USD' },
          { label: 'Variance', value: cash.varianceUsd, unit: 'USD' },
        ],
      }),
      summarySection({
        title: 'Expenses & Customer Payments',
        metrics: [
          { label: 'Expenses', value: profit.expensesUsd, unit: 'USD' },
          { label: 'Customer payments received', value: paymentsRow?.total ?? 0, unit: 'USD' },
        ],
      }),
      detailSection<TopProductRow>({
        title: 'Top 5 Products',
        columns: [
          { key: 'nameAr', label: 'Product' },
          { key: 'quantitySold', label: 'Qty' },
          { key: 'revenueUsd', label: 'Revenue' },
        ],
        rows: topProductRows,
      }),
      detailSection({
        title: 'Staff Performance',
        columns: [
          { key: 'name', label: 'Staff' },
          { key: 'revenueUsd', label: 'Revenue' },
          { key: 'salesCount', label: 'Sales' },
        ],
        rows: staff,
        visibility: 'staff', // Task 0 P0 finding 4 (second review) -- previously missing here
      }),
    ],
  }
}

REPORT_DEFINITIONS['daily-closing'] = {
  id: 'daily-closing',
  name: 'Daily Closing Report',
  cadenceHint: 'daily',
  compute: computeDailyClosingReport,
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/features/reports/definitions/__tests__/dailyClosing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/reports/definitions/dailyClosing.ts src/features/reports/definitions/__tests__/dailyClosing.test.ts src/features/reports/reportRegistry.ts
git commit -m "feat(WAFI-147A): add Daily Closing report definition"
```

---

### Task 7: Cash Flow report definition

**Files:**
- Create: `src/features/reports/definitions/cashFlow.ts`
- Test: `src/features/reports/definitions/__tests__/cashFlow.test.ts`

**Interfaces:** Consumes `readShiftCashReconciliation` (Task 4b — the sole source of cash in/out figures; **never** an independently-derived cash equation). Pure `SummarySection` report.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/reports/definitions/__tests__/cashFlow.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../primitives/readShiftCashReconciliation', () => ({
  readShiftCashReconciliation: vi.fn().mockResolvedValue({
    expectedUsd: 145, actualUsd: 148, varianceUsd: 3, cashSalesUsd: 400, cashExpensesUsd: 50,
    cashRefundsUsd: 10, cashCreditPaymentsUsd: 30, cashPayInsUsd: 5, cashPayOutsUsd: 15,
  }),
}))

import { computeCashFlowReport } from '../cashFlow'

describe('computeCashFlowReport', () => {
  beforeEach(() => vi.clearAllMocks())
  it('derives cash in/out entirely from readShiftCashReconciliation, matching the app\'s own Z-report equation', async () => {
    const report = await computeCashFlowReport('shop1', { from: '2026-08-18', to: '2026-08-18' })
    expect(report.sections).toHaveLength(1)
    const [section] = report.sections
    expect(section.type).toBe('summary')
    if (section.type === 'summary') {
      // cash in = sales + credit-payment collection + pay-ins; cash out = expenses + refunds + pay-outs
      expect(section.metrics.find((m) => m.label === 'Cash in')?.value).toBe(400 + 30 + 5)
      expect(section.metrics.find((m) => m.label === 'Cash out')?.value).toBe(50 + 10 + 15)
      expect(section.metrics.find((m) => m.label === 'Drawer variance')?.value).toBe(3)
    }
  })
})
```

- [ ] **Step 2-4:** write, run to fail, implement, run to pass — same cycle as prior tasks.

- [ ] **Step 3 implementation reference:**

```ts
// src/features/reports/definitions/cashFlow.ts
// WAFI-147A: derives every figure from readShiftCashReconciliation (Task 4b) --
// the app's own verified Z-report cash equation -- never an independently
// constructed "cash in = sales + payments, cash out = expenses + movements"
// equation, which would omit refunds and pay-in/pay-out movements (Task 0
// finding 2).
import { readShiftCashReconciliation } from '../primitives/readShiftCashReconciliation'
import { summarySection } from '../report.types'
import type { Report, ReportDateRange } from '../report.types'
import { REPORT_DEFINITIONS } from '../reportRegistry'

export async function computeCashFlowReport(shopId: string, range: ReportDateRange): Promise<Report> {
  const cash = await readShiftCashReconciliation(shopId, range)
  const cashIn = cash.cashSalesUsd + cash.cashCreditPaymentsUsd + cash.cashPayInsUsd
  const cashOut = cash.cashExpensesUsd + cash.cashRefundsUsd + cash.cashPayOutsUsd

  return {
    id: 'cash-flow', name: 'Cash Flow Report', dateRange: range, generatedAt: new Date().toISOString(),
    sections: [summarySection({
      title: 'Cash Flow',
      metrics: [
        { label: 'Cash in', value: cashIn, unit: 'USD' },
        { label: 'Cash out', value: cashOut, unit: 'USD' },
        { label: 'Net cash flow', value: cashIn - cashOut, unit: 'USD' },
        { label: 'Drawer variance', value: cash.varianceUsd, unit: 'USD' },
      ],
    })],
  }
}

REPORT_DEFINITIONS['cash-flow'] = { id: 'cash-flow', name: 'Cash Flow Report', cadenceHint: 'daily', compute: computeCashFlowReport }
```

- [ ] **Step 5: Commit**

```bash
git add src/features/reports/definitions/cashFlow.ts src/features/reports/definitions/__tests__/cashFlow.test.ts src/features/reports/reportRegistry.ts
git commit -m "feat(WAFI-147A): add Cash Flow report definition"
```

---

### Task 8: Weekly Summary report definition

**Files:**
- Create: `src/features/reports/definitions/weeklySummary.ts`
- Test: `src/features/reports/definitions/__tests__/weeklySummary.test.ts`

**Interfaces:** Consumes `readProfitCache`, `getStaffMetrics`, `getCustomerAgingSnapshot` (all Tasks 2-4), `db`. Sections: Revenue/Profit/Expenses (summary, from `readProfitCache` + a prior-week `readProfitCache` call for week-over-week deltas) + Staff Ranking (detail, `getStaffMetrics` sorted by revenue desc) + **Inventory Changes (detail — Task 0 finding 5, restored from the original 13-report spec, `stock_adjustments`)** + Customer Debt Trend (summary, `getCustomerAgingSnapshot(shopId, range.to)` totalled vs. a prior-week-end call).

- [ ] **Steps 1-4:** TDD cycle as before, mocking `readProfitCache`/`getStaffMetrics`/`getCustomerAgingSnapshot`/`db`.

- [ ] **Step 3 implementation reference:**

```ts
// src/features/reports/definitions/weeklySummary.ts
import { db } from '@/data/powersync/db'
import { readProfitCache } from '../primitives/readProfitCache'
import { getStaffMetrics } from '../primitives/getStaffMetrics'
import { getCustomerAgingSnapshot } from '../primitives/getCustomerAgingSnapshot'
import { summarySection, detailSection } from '../report.types'
import type { Report, ReportDateRange } from '../report.types'
import { REPORT_DEFINITIONS } from '../reportRegistry'
import { addCalendarDays } from '../dateUtils'

function priorWeekRange(range: ReportDateRange): ReportDateRange {
  return { from: addCalendarDays(range.from, -7), to: addCalendarDays(range.to, -7) }
}

export interface InventoryChangeRow { productId: string; nameAr: string; adjustmentCount: number; netQuantityDelta: number }

export async function computeWeeklySummaryReport(shopId: string, range: ReportDateRange): Promise<Report> {
  const prior = priorWeekRange(range)
  const [current, previous, staff, currentAging, priorAging, inventoryChanges, dailyRows] = await Promise.all([
    readProfitCache(shopId, range),
    readProfitCache(shopId, prior),
    getStaffMetrics(shopId, range),
    getCustomerAgingSnapshot(shopId, range.to),
    getCustomerAgingSnapshot(shopId, prior.to),
    db.getAll<InventoryChangeRow>(
      `SELECT sa.product_id AS productId, p.name_ar AS nameAr,
              COUNT(*) AS adjustmentCount, SUM(sa.new_value - sa.old_value) AS netQuantityDelta
       FROM stock_adjustments sa
       JOIN products p ON p.id = sa.product_id
       WHERE sa.shop_id = ? AND DATE(sa.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY sa.product_id, p.name_ar ORDER BY adjustmentCount DESC`,
      [shopId, range.from, range.to],
    ),
    // "Best/worst performing days" (original 13-report spec field, previously
    // dropped without note in an earlier draft of this plan -- restored here).
    // profit_cache already has one row per day; no new aggregation needed.
    db.getAll<{ day: string; revenue_usd: number }>(
      `SELECT day, revenue_usd FROM profit_cache WHERE shop_id = ? AND day BETWEEN ? AND ? ORDER BY revenue_usd DESC`,
      [shopId, range.from, range.to],
    ),
  ])

  const currentDebt = currentAging.reduce((s, r) => s + Math.max(0, r.balanceUsd), 0)
  const priorDebt = priorAging.reduce((s, r) => s + Math.max(0, r.balanceUsd), 0)
  const ranked = [...staff].sort((a, b) => b.revenueUsd - a.revenueUsd)
  const bestDay = dailyRows[0]
  const worstDay = dailyRows[dailyRows.length - 1]

  return {
    id: 'weekly-summary', name: 'Weekly Summary', dateRange: range, generatedAt: new Date().toISOString(),
    sections: [
      summarySection({
        title: 'Week over Week',
        metrics: [
          { label: 'Revenue', value: current.revenueUsd, unit: 'USD' },
          { label: 'Revenue vs. last week', value: current.revenueUsd - previous.revenueUsd, unit: 'USD' },
          { label: 'Profit', value: current.profitUsd, unit: 'USD' },
          { label: 'Expenses', value: current.expensesUsd, unit: 'USD' },
        ],
      }),
      detailSection({
        title: 'Staff Ranking',
        columns: [{ key: 'name', label: 'Staff' }, { key: 'revenueUsd', label: 'Revenue' }],
        rows: ranked,
        visibility: 'staff',
      }),
      detailSection<InventoryChangeRow>({
        title: 'Inventory Changes',
        columns: [{ key: 'nameAr', label: 'Product' }, { key: 'adjustmentCount', label: 'Adjustments' }, { key: 'netQuantityDelta', label: 'Net Qty Change' }],
        rows: inventoryChanges,
      }),
      summarySection({
        title: 'Best/Worst Performing Days',
        metrics: dailyRows.length === 0 ? [] : [
          { label: 'Best day', value: `${bestDay.day} ($${(bestDay.revenue_usd / 100).toFixed(2)})` },
          { label: 'Worst day', value: `${worstDay.day} ($${(worstDay.revenue_usd / 100).toFixed(2)})` },
        ],
      }),
      // Customer Debt Trend is a real field in the original spec's Weekly
      // Summary list (WAFI_Event_Driven_Platform_Plan_v1.md:667), not an
      // addition invented merely because getCustomerAgingSnapshot exists.
      summarySection({
        title: 'Customer Debt Trend',
        metrics: [
          { label: 'Outstanding debt', value: currentDebt, unit: 'USD' },
          { label: 'Change vs. last week', value: currentDebt - priorDebt, unit: 'USD' },
        ],
      }),
    ],
  }
}

REPORT_DEFINITIONS['weekly-summary'] = { id: 'weekly-summary', name: 'Weekly Summary', cadenceHint: 'weekly', compute: computeWeeklySummaryReport }
```

- [ ] **Step 5: Commit**

```bash
git add src/features/reports/definitions/weeklySummary.ts src/features/reports/definitions/__tests__/weeklySummary.test.ts src/features/reports/reportRegistry.ts
git commit -m "feat(WAFI-147A): add Weekly Summary report definition"
```

---

### Task 9: Profit Trend report definition

**Files:**
- Create: `src/features/reports/definitions/profitTrend.ts`
- Test: `src/features/reports/definitions/__tests__/profitTrend.test.ts`

**Interfaces:** Pure `DetailSection` report. Daily profit series queried directly from `profit_cache` (one row per day already exists there — no need to call `readProfitCache`, which sums a range; this report needs the per-day rows themselves).

```ts
// src/features/reports/definitions/profitTrend.ts
import { db } from '@/data/powersync/db'
import { detailSection } from '../report.types'
import type { Report, ReportDateRange } from '../report.types'
import { REPORT_DEFINITIONS } from '../reportRegistry'

export interface DailyProfitRow { day: string; revenueUsd: number; profitUsd: number }

export async function computeProfitTrendReport(shopId: string, range: ReportDateRange): Promise<Report> {
  const rows = await db.getAll<{ day: string; revenue_usd: number; cogs_usd: number; expenses_usd: number; refunds_usd: number; cogs_reversal_usd: number }>(
    `SELECT day, revenue_usd, cogs_usd, expenses_usd, refunds_usd, cogs_reversal_usd
     FROM profit_cache WHERE shop_id = ? AND day BETWEEN ? AND ? ORDER BY day ASC`,
    [shopId, range.from, range.to],
  )
  const daily: DailyProfitRow[] = rows.map((r) => {
    const revenueUsd = r.revenue_usd / 100
    const profitUsd = (r.revenue_usd - r.refunds_usd) / 100 - (r.cogs_usd - r.cogs_reversal_usd) / 100 - r.expenses_usd / 100
    return { day: r.day, revenueUsd, profitUsd }
  })

  return {
    id: 'profit-trend', name: 'Profit Trend Report', dateRange: range, generatedAt: new Date().toISOString(),
    sections: [
      detailSection<DailyProfitRow>({
        title: 'Daily Profit',
        columns: [{ key: 'day', label: 'Day' }, { key: 'revenueUsd', label: 'Revenue' }, { key: 'profitUsd', label: 'Profit' }],
        rows: daily,
      }),
    ],
  }
}

REPORT_DEFINITIONS['profit-trend'] = { id: 'profit-trend', name: 'Profit Trend Report', cadenceHint: 'monthly', compute: computeProfitTrendReport }
```

Note: "profit by product category" and "profit vs. target" (from the original 13-report spec) are deferred — this codebase has no product-category-level cost attribution and no "target" concept anywhere (confirmed absent during the WAFI-147 investigation); do not invent placeholder data for either. Ship the daily-series section, which is real and buildable; if category/target become real requirements later, extend this report then.

- [ ] **Steps 1-2, 4-5:** standard TDD cycle + commit, test asserting the `daily` rows and single detail section.

---

### Task 10: Employee Summary report definition

**Files:**
- Create: `src/features/reports/definitions/employeeSummary.ts`
- Test: `src/features/reports/definitions/__tests__/employeeSummary.test.ts`

**Interfaces:** Per spec, generated per single staff member. `ReportDefinition.compute`'s signature (Task 5) is `(shopId, range, context?: ReportContext)` where `ReportContext = { staffId?: string }` — the registry entry below is a real, callable implementation through that same uniform signature (not a throwing stub): when `context?.staffId` is present it returns the real report; when absent it returns an explicit `not-selected` state as data (a one-`SummarySection` `Report` saying so), never an exception. Task 21's per-report page checks `definition.contextRequirement === 'staff'` (not `cadenceHint` — Task 0 P0 finding 4) to know it must collect a `staffId` before calling `compute`, and re-calls `compute` once one is chosen.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/reports/definitions/__tests__/employeeSummary.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetAll = vi.fn()
const mockGetOptional = vi.fn()
vi.mock('@/data/powersync/db', () => ({
  db: { getAll: (...a: unknown[]) => mockGetAll(...a), getOptional: (...a: unknown[]) => mockGetOptional(...a) },
}))
vi.mock('../../primitives/getStaffMetrics', () => ({
  getStaffMetrics: vi.fn().mockResolvedValue([
    { staffId: 's1', name: 'Ali', revenueUsd: 500, cogsUsd: 200, marginUsd: 300, marginPct: 100, salesCount: 8, avgTicketUsd: 62.5, discountUsd: 10, discountRate: 2, returnRevenueUsd: 0, returnCount: 0 },
  ]),
}))

import { REPORT_DEFINITIONS } from '../../reportRegistry'
import '../employeeSummary' // side-effect: registers REPORT_DEFINITIONS['employee-summary']

describe('employee-summary report definition', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns a real report when context.staffId is provided, through the uniform compute() signature', async () => {
    mockGetAll.mockResolvedValue([{ variance_usd: -2 }])
    mockGetOptional.mockResolvedValue({ hours: 8 })

    const report = await REPORT_DEFINITIONS['employee-summary'].compute('shop1', { from: '2026-08-18', to: '2026-08-18' }, { staffId: 's1' })

    expect(report.sections[0].type).toBe('summary')
    if (report.sections[0].type === 'summary') {
      expect(report.sections[0].title).toBe('Ali')
      expect(report.sections[0].metrics.find((m) => m.label === 'Revenue')?.value).toBe(500)
    }
  })

  it('returns an explicit not-selected state, never a thrown exception, when staffId is missing', async () => {
    const report = await REPORT_DEFINITIONS['employee-summary'].compute('shop1', { from: '2026-08-18', to: '2026-08-18' })
    expect(report.sections[0].type).toBe('summary')
    if (report.sections[0].type === 'summary') {
      expect(report.sections[0].title).toBe('لم يتم اختيار موظف')
    }
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/reports/definitions/__tests__/employeeSummary.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `employeeSummary.ts`**

```ts
// src/features/reports/definitions/employeeSummary.ts
// WAFI-147A: the only report needing ReportContext.staffId beyond (shopId,
// range) -- see Task 0 finding 1. compute() is a real, uniform implementation:
// absent staffId is an explicit, renderable Report state, never a throw.
import { db } from '@/data/powersync/db'
import { getStaffMetrics } from '../primitives/getStaffMetrics'
import { summarySection } from '../report.types'
import type { Report, ReportDateRange, ReportContext } from '../report.types'
import { REPORT_DEFINITIONS } from '../reportRegistry'

export async function computeEmployeeSummaryReport(shopId: string, range: ReportDateRange, context?: ReportContext): Promise<Report> {
  const staffId = context?.staffId
  if (!staffId) {
    return {
      id: 'employee-summary', name: 'Employee Summary', dateRange: range, generatedAt: new Date().toISOString(),
      sections: [summarySection({ title: 'لم يتم اختيار موظف', metrics: [] })],
    }
  }

  const [staffRows, cashRows, hoursRow] = await Promise.all([
    getStaffMetrics(shopId, range),
    db.getAll<{ variance_usd: number | null }>(
      `SELECT variance_usd FROM cashier_shifts WHERE shop_id = ? AND staff_id = ? AND status = 'closed'
       AND DATE(closed_at, 'localtime') BETWEEN ? AND ?`,
      [shopId, staffId, range.from, range.to],
    ),
    db.getOptional<{ hours: number }>(
      `SELECT COALESCE(SUM((julianday(closed_at) - julianday(opened_at)) * 24), 0) AS hours
       FROM cashier_shifts WHERE shop_id = ? AND staff_id = ? AND status = 'closed'
       AND DATE(closed_at, 'localtime') BETWEEN ? AND ?`,
      [shopId, staffId, range.from, range.to],
    ),
  ])

  const row = staffRows.find((r) => r.staffId === staffId)
  const variance = cashRows.reduce((s, r) => s + (r.variance_usd ?? 0), 0)

  return {
    id: 'employee-summary', name: 'Employee Summary', dateRange: range, generatedAt: new Date().toISOString(),
    sections: [summarySection({
      title: row?.name ?? 'Employee',
      metrics: [
        { label: 'Sales count', value: row?.salesCount ?? 0 },
        { label: 'Revenue', value: row?.revenueUsd ?? 0, unit: 'USD' },
        { label: 'Average basket', value: row?.avgTicketUsd ?? 0, unit: 'USD' },
        { label: 'Discounts given', value: row?.discountUsd ?? 0, unit: 'USD' },
        { label: 'Cash variance', value: variance, unit: 'USD' },
        { label: 'Hours worked', value: Math.round((hoursRow?.hours ?? 0) * 10) / 10 },
      ],
      visibility: 'staff',
    })],
  }
}

REPORT_DEFINITIONS['employee-summary'] = {
  id: 'employee-summary',
  name: 'Employee Summary',
  cadenceHint: 'per-shift',
  contextRequirement: 'staff', // the real, checkable signal Task 21's UI branches on -- not cadenceHint
  compute: computeEmployeeSummaryReport,
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/features/reports/definitions/__tests__/employeeSummary.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add src/features/reports/definitions/employeeSummary.ts src/features/reports/definitions/__tests__/employeeSummary.test.ts src/features/reports/reportRegistry.ts
git commit -m "feat(WAFI-147A): add Employee Summary report definition using ReportContext, no throwing stub"
```

---

### Task 11: Discount Report definition

**Files:**
- Create: `src/features/reports/definitions/discountReport.ts`
- Test: `src/features/reports/definitions/__tests__/discountReport.test.ts`

**Interfaces:** `interface DiscountByProductRow { productId, nameAr, discountUsd }`. Sections: Total (summary, from `readProfitCache().discountUsd`) + By Staff (detail, `getStaffMetrics` filtered/sorted by `discountUsd`) + By Product (detail, new query) + Below-Cost Sales (detail, new query on `sales` where a line's `unit_price_usd < unit_cost_usd`).

```ts
// src/features/reports/definitions/discountReport.ts
import { db } from '@/data/powersync/db'
import { readProfitCache } from '../primitives/readProfitCache'
import { getStaffMetrics } from '../primitives/getStaffMetrics'
import { summarySection, detailSection } from '../report.types'
import type { Report, ReportDateRange } from '../report.types'
import { REPORT_DEFINITIONS } from '../reportRegistry'

export interface DiscountByProductRow { productId: string; nameAr: string; discountUsd: number }
export interface BelowCostSaleRow { saleId: string; productId: string; nameAr: string; unitPriceUsd: number; unitCostUsd: number }

export async function computeDiscountReport(shopId: string, range: ReportDateRange): Promise<Report> {
  const [profit, staff, byProduct, belowCost] = await Promise.all([
    readProfitCache(shopId, range),
    getStaffMetrics(shopId, range),
    db.getAll<DiscountByProductRow>(
      `SELECT sli.product_id AS productId, p.name_ar AS nameAr,
              SUM(COALESCE(sli.discount_amount_usd, 0)) AS discountUsd
       FROM sale_line_items sli
       JOIN products p ON p.id = sli.product_id
       JOIN sales s ON s.id = sli.sale_id
       WHERE sli.shop_id = ? AND sli.discount_amount_usd > 0
         AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY sli.product_id, p.name_ar ORDER BY discountUsd DESC`,
      [shopId, range.from, range.to],
    ),
    db.getAll<BelowCostSaleRow>(
      `SELECT sli.sale_id AS saleId, sli.product_id AS productId, p.name_ar AS nameAr,
              sli.unit_price_usd AS unitPriceUsd, COALESCE(sli.unit_cost_usd, 0) AS unitCostUsd
       FROM sale_line_items sli
       JOIN sales s ON s.id = sli.sale_id
       JOIN products p ON p.id = sli.product_id
       WHERE sli.shop_id = ? AND sli.unit_cost_usd IS NOT NULL AND sli.unit_price_usd < sli.unit_cost_usd
         AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?`,
      [shopId, range.from, range.to],
    ),
  ])

  return {
    id: 'discount-report', name: 'Discount Report', dateRange: range, generatedAt: new Date().toISOString(),
    sections: [
      summarySection({ title: 'Total Discounts', metrics: [{ label: 'Total discount given', value: profit.discountUsd, unit: 'USD' }] }),
      detailSection({
        title: 'By Staff',
        columns: [{ key: 'name', label: 'Staff' }, { key: 'discountUsd', label: 'Discount' }],
        rows: [...staff].sort((a, b) => b.discountUsd - a.discountUsd),
        visibility: 'staff',
      }),
      detailSection<DiscountByProductRow>({
        title: 'By Product',
        columns: [{ key: 'nameAr', label: 'Product' }, { key: 'discountUsd', label: 'Discount' }],
        rows: byProduct,
      }),
      detailSection<BelowCostSaleRow>({
        title: 'Below-Cost Sales',
        columns: [{ key: 'nameAr', label: 'Product' }, { key: 'unitPriceUsd', label: 'Sold at' }, { key: 'unitCostUsd', label: 'Cost' }],
        rows: belowCost,
      }),
    ],
  }
}

REPORT_DEFINITIONS['discount-report'] = { id: 'discount-report', name: 'Discount Report', cadenceHint: 'weekly', compute: computeDiscountReport }
```

**Schema note:** `sale_line_items.discount_amount_usd` genuinely exists (migration `052_sale_discounts.sql`, alongside `discount_type`/`discount_value`) — a real per-line discount column, distinct from `sales.sale_discount_amount_usd` (the sale-level total `useStaffPerformanceMetrics.ts`'s "By Staff" figures use). The "By Product" query above sums this per-line column directly; this is true per-product attribution, not an approximation, and needs no re-scoping.

- [ ] **Steps 1-2, 4-5:** standard TDD cycle + commit.

---

### Task 12: Returns Report definition

**Files:**
- Create: `src/features/reports/definitions/returnsReport.ts`
- Test: `src/features/reports/definitions/__tests__/returnsReport.test.ts`

**Interfaces:** `interface ReturnByProductRow { productId, nameAr, returnCount, refundUsd }`; `interface ReturnByReasonRow { reason, count }`; `interface ReturnByStaffRow { staffId, name, returnCount, returnRevenueUsd }` (Task 0 finding 8 — mapped from `getStaffMetrics`' extended fields, not a raw `StaffMetricsRow` dump). Mirrors Task 11's shape but against `returns`/`return_line_items` (which DO carry `product_id` via `return_line_items`, so no scoping caveat here).

```ts
// src/features/reports/definitions/returnsReport.ts
import { db } from '@/data/powersync/db'
import { readProfitCache } from '../primitives/readProfitCache'
import { getStaffMetrics } from '../primitives/getStaffMetrics'
import { summarySection, detailSection } from '../report.types'
import type { Report, ReportDateRange } from '../report.types'
import { REPORT_DEFINITIONS } from '../reportRegistry'

export interface ReturnByProductRow { productId: string; nameAr: string; returnCount: number; refundUsd: number }
export interface ReturnByReasonRow { reason: string; count: number }
export interface ReturnByStaffRow { staffId: string; name: string; returnCount: number; returnRevenueUsd: number }

export async function computeReturnsReport(shopId: string, range: ReportDateRange): Promise<Report> {
  const [profit, staff, byProduct, byReason] = await Promise.all([
    readProfitCache(shopId, range),
    getStaffMetrics(shopId, range),
    db.getAll<ReturnByProductRow>(
      `SELECT rli.product_id AS productId, p.name_ar AS nameAr,
              COUNT(*) AS returnCount, SUM(rli.qty_returned * rli.unit_price_usd) AS refundUsd
       FROM return_line_items rli
       JOIN returns r ON r.id = rli.return_id
       JOIN products p ON p.id = rli.product_id
       WHERE r.shop_id = ? AND DATE(r.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY rli.product_id, p.name_ar ORDER BY refundUsd DESC`,
      [shopId, range.from, range.to],
    ),
    db.getAll<ReturnByReasonRow>(
      `SELECT COALESCE(reason, 'unspecified') AS reason, COUNT(*) AS count
       FROM returns WHERE shop_id = ? AND DATE(created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY reason ORDER BY count DESC`,
      [shopId, range.from, range.to],
    ),
  ])

  return {
    id: 'returns-report', name: 'Returns Report', dateRange: range, generatedAt: new Date().toISOString(),
    sections: [
      summarySection({
        title: 'Total Returns',
        metrics: [
          { label: 'Return count', value: profit.returnCount },
          { label: 'Return value', value: profit.refundsUsd, unit: 'USD' },
        ],
      }),
      detailSection<ReturnByStaffRow>({
        title: 'By Staff',
        columns: [{ key: 'name', label: 'Staff' }, { key: 'returnCount', label: 'Count' }, { key: 'returnRevenueUsd', label: 'Refund' }],
        rows: staff
          .filter((s) => s.returnCount > 0)
          .map((s): ReturnByStaffRow => ({ staffId: s.staffId, name: s.name, returnCount: s.returnCount, returnRevenueUsd: s.returnRevenueUsd })),
        visibility: 'staff',
      }),
      detailSection<ReturnByProductRow>({
        title: 'By Product',
        columns: [{ key: 'nameAr', label: 'Product' }, { key: 'returnCount', label: 'Count' }, { key: 'refundUsd', label: 'Refund' }],
        rows: byProduct,
      }),
      detailSection<ReturnByReasonRow>({
        title: 'Return Reasons',
        columns: [{ key: 'reason', label: 'Reason' }, { key: 'count', label: 'Count' }],
        rows: byReason,
      }),
    ],
  }
}

REPORT_DEFINITIONS['returns-report'] = { id: 'returns-report', name: 'Returns Report', cadenceHint: 'weekly', compute: computeReturnsReport }
```

- [ ] **Steps 1-2, 4-5:** standard TDD cycle + commit. Step 1's test mocks `getStaffMetrics` returning rows with non-zero `returnCount`/`returnRevenueUsd` (Task 3's extended fields) and asserts the "By Staff" section's rows are real `ReturnByStaffRow` objects (`staffId`/`name`/`returnCount`/`returnRevenueUsd` only), not a pass-through of the full `StaffMetricsRow`.

---

### Task 13: Credit Report definition

**Files:**
- Create: `src/features/reports/definitions/creditReport.ts`
- Test: `src/features/reports/definitions/__tests__/creditReport.test.ts`

**Interfaces:** Consumes `getCustomerAgingSnapshot` (Task 4). Sections: Totals (summary) + Overdue Accounts (detail, aging rows with `daysOutstanding > 30`) + Risk Distribution (detail, bucketed by `daysOutstanding`).

```ts
// src/features/reports/definitions/creditReport.ts
import { getCustomerAgingSnapshot } from '../primitives/getCustomerAgingSnapshot'
import { summarySection, detailSection } from '../report.types'
import type { Report, ReportDateRange } from '../report.types'
import { REPORT_DEFINITIONS } from '../reportRegistry'
import type { CustomerAgingRow } from '../primitives/getCustomerAgingSnapshot'

export interface RiskBucketRow { bucket: string; customerCount: number; totalOwedUsd: number }

function bucketFor(days: number): string {
  if (days <= 30) return '0-30 days'
  if (days <= 60) return '31-60 days'
  if (days <= 90) return '61-90 days'
  return '90+ days'
}

export async function computeCreditReport(shopId: string, range: ReportDateRange): Promise<Report> {
  const [current, prior] = await Promise.all([
    getCustomerAgingSnapshot(shopId, range.to),
    getCustomerAgingSnapshot(shopId, range.from),
  ])
  const debtors = current.filter((r) => r.balanceUsd > 0.001)
  const currentIds = new Set(current.map((r) => r.customerId))
  const priorDebtIds = new Set(prior.filter((r) => r.balanceUsd > 0.001).map((r) => r.customerId))
  const newDebtCustomers = debtors.filter((r) => !priorDebtIds.has(r.customerId))
  const overdue = debtors.filter((r) => r.daysOutstanding > 30)

  const bucketMap = new Map<string, RiskBucketRow>()
  for (const r of debtors) {
    const b = bucketFor(r.daysOutstanding)
    const existing = bucketMap.get(b) ?? { bucket: b, customerCount: 0, totalOwedUsd: 0 }
    existing.customerCount += 1
    existing.totalOwedUsd += r.balanceUsd
    bucketMap.set(b, existing)
  }

  return {
    id: 'credit-report', name: 'Credit Report', dateRange: range, generatedAt: new Date().toISOString(),
    sections: [
      summarySection({
        title: 'Outstanding Credit',
        metrics: [
          { label: 'Total outstanding', value: debtors.reduce((s, r) => s + r.balanceUsd, 0), unit: 'USD' },
          { label: 'New debt this period', value: newDebtCustomers.reduce((s, r) => s + r.balanceUsd, 0), unit: 'USD' },
        ],
      }),
      detailSection<CustomerAgingRow>({
        title: 'Overdue Accounts',
        columns: [{ key: 'customerName', label: 'Customer' }, { key: 'balanceUsd', label: 'Owed' }, { key: 'daysOutstanding', label: 'Days' }],
        rows: overdue,
      }),
      detailSection<RiskBucketRow>({
        title: 'Risk Distribution',
        columns: [{ key: 'bucket', label: 'Age bucket' }, { key: 'customerCount', label: 'Customers' }, { key: 'totalOwedUsd', label: 'Owed' }],
        rows: [...bucketMap.values()],
      }),
    ],
  }
}

REPORT_DEFINITIONS['credit-report'] = { id: 'credit-report', name: 'Credit Report', cadenceHint: 'weekly', compute: computeCreditReport }
```

Note: "Average collection time" and "Payments received" (from the original spec) are covered indirectly — `lastPaymentDate` is already on `CustomerAgingRow` per customer; a shop-wide average is a straightforward follow-up aggregation over the same rows if needed, deliberately not added here to keep this task's scope to what's testable against the primitive as specified.

- [ ] **Steps 1-2, 4-5:** standard TDD cycle + commit.

---

### Task 14: Top Customers report definition

**Files:**
- Create: `src/features/reports/definitions/topCustomers.ts`
- Test: `src/features/reports/definitions/__tests__/topCustomers.test.ts`

**Interfaces:** Pure `DetailSection` report. `interface TopCustomerRow { customerId, customerName, revenueUsd, visitCount }`.

```ts
// src/features/reports/definitions/topCustomers.ts
import { db } from '@/data/powersync/db'
import { detailSection } from '../report.types'
import type { Report, ReportDateRange } from '../report.types'
import { REPORT_DEFINITIONS } from '../reportRegistry'

export interface TopCustomerRow { customerId: string; customerName: string; revenueUsd: number; visitCount: number }
export interface AtRiskCustomerRow { customerId: string; customerName: string; lastVisit: string }
export interface NewCustomerRow { customerId: string; customerName: string; createdAt: string; revenueUsd: number }

export async function computeTopCustomersReport(shopId: string, range: ReportDateRange): Promise<Report> {
  const [byRevenue, byVisits, atRisk, newCustomers] = await Promise.all([
    db.getAll<TopCustomerRow>(
      `SELECT c.id AS customerId, c.name AS customerName, SUM(s.total_usd) AS revenueUsd, COUNT(*) AS visitCount
       FROM sales s JOIN customers c ON c.id = s.customer_id
       WHERE s.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY c.id, c.name ORDER BY revenueUsd DESC LIMIT 20`,
      [shopId, range.from, range.to],
    ),
    db.getAll<TopCustomerRow>(
      `SELECT c.id AS customerId, c.name AS customerName, SUM(s.total_usd) AS revenueUsd, COUNT(*) AS visitCount
       FROM sales s JOIN customers c ON c.id = s.customer_id
       WHERE s.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY c.id, c.name ORDER BY visitCount DESC LIMIT 20`,
      [shopId, range.from, range.to],
    ),
    db.getAll<AtRiskCustomerRow>(
      `SELECT c.id AS customerId, c.name AS customerName, MAX(s.created_at) AS lastVisit
       FROM customers c LEFT JOIN sales s ON s.customer_id = c.id AND s.shop_id = ?
       WHERE c.shop_id = ? AND (c.deleted = 0 OR c.deleted IS NULL)
       GROUP BY c.id, c.name
       HAVING lastVisit IS NULL OR DATE(lastVisit, 'localtime') < DATE(?, '-60 days')`,
      [shopId, shopId, range.to],
    ),
    // Task 0 P0 finding 7: revenueUsd here MUST be bound to `range`, not
    // all-time -- an earlier draft's unbounded subquery computed lifetime
    // revenue for a "new customers THIS PERIOD" row, which is meaningless
    // (and that draft never even displayed the column, hiding the bug).
    db.getAll<NewCustomerRow>(
      `SELECT c.id AS customerId, c.name AS customerName, c.created_at AS createdAt,
              COALESCE((SELECT SUM(total_usd) FROM sales
                        WHERE customer_id = c.id AND shop_id = ? AND DATE(created_at, 'localtime') BETWEEN ? AND ?), 0) AS revenueUsd
       FROM customers c
       WHERE c.shop_id = ? AND DATE(c.created_at, 'localtime') BETWEEN ? AND ?`,
      [shopId, range.from, range.to, shopId, range.from, range.to],
    ),
  ])

  return {
    id: 'top-customers', name: 'Top Customers Report', dateRange: range, generatedAt: new Date().toISOString(),
    sections: [
      detailSection<TopCustomerRow>({ title: 'Top 20 by Revenue', columns: [{ key: 'customerName', label: 'Customer' }, { key: 'revenueUsd', label: 'Revenue' }], rows: byRevenue }),
      detailSection<TopCustomerRow>({ title: 'Top 20 by Visits', columns: [{ key: 'customerName', label: 'Customer' }, { key: 'visitCount', label: 'Visits' }], rows: byVisits }),
      // Task 0 P0 finding 17 (corrected in second review): the query is
      // relative to `range.to`, not necessarily today (e.g. an Aug 1-31
      // report computes at-risk status as of Aug 31, not the day the report
      // happens to be opened) -- "as of report end" is the precise wording,
      // not "current," which would misleadingly imply it always means today.
      detailSection<AtRiskCustomerRow>({ title: 'At-Risk Customers (no visit in 60 days as of report end)', columns: [{ key: 'customerName', label: 'Customer' }, { key: 'lastVisit', label: 'Last visit' }], rows: atRisk }),
      detailSection<NewCustomerRow>({ title: 'New Customers This Period', columns: [{ key: 'customerName', label: 'Customer' }, { key: 'createdAt', label: 'Joined' }, { key: 'revenueUsd', label: 'Revenue (this period)' }], rows: newCustomers }),
    ],
  }
}

REPORT_DEFINITIONS['top-customers'] = { id: 'top-customers', name: 'Top Customers Report', cadenceHint: 'monthly', compute: computeTopCustomersReport }
```

Note: "Top 20 by loyalty" from the original spec is dropped — this codebase has no loyalty/points concept (confirmed absent; CLAUDE.md explicitly places loyalty in v1.5, not built). Do not fabricate a loyalty metric; ship the 4 sections above that map to real data (Top 20 by Revenue, Top 20 by Visits, At-Risk, New Customers).

- [ ] **Steps 1-2, 4-5:** standard TDD cycle + commit.

---

### Task 15: Top Products report definition

**Files:**
- Create: `src/features/reports/definitions/topProducts.ts`
- Test: `src/features/reports/definitions/__tests__/topProducts.test.ts`

**Interfaces:** Pure `DetailSection` report — genuinely new (no primitive covers product-level profit/discount/returns joins). Two semantics made explicit per Task 0 P0 findings 8-9, not left implicit in SQL: **"Most Returned" = units returned** (`SUM(qty_returned)`), not return-transaction count, since one return can cover several units. **"Profit" = gross sale-line profit, NOT net of returns** — netting would require joining each returned unit back to its original sale's cost via the same `return_line_items` → `sale_line_items` cost-lookup pattern `getStaffMetrics` already uses for per-staff return-COGS, which is a real, separate piece of work this task deliberately does not duplicate; the section title says "gross, not net of returns" so this is never silently ambiguous to a reader of the output.

```ts
// src/features/reports/definitions/topProducts.ts
import { db } from '@/data/powersync/db'
import { detailSection } from '../report.types'
import type { Report, ReportDateRange } from '../report.types'
import { REPORT_DEFINITIONS } from '../reportRegistry'

export interface TopProductByMetricRow { productId: string; nameAr: string; value: number }

async function topBy(shopId: string, range: ReportDateRange, sql: string): Promise<TopProductByMetricRow[]> {
  return db.getAll<TopProductByMetricRow>(sql, [shopId, range.from, range.to])
}

export async function computeTopProductsReport(shopId: string, range: ReportDateRange): Promise<Report> {
  const [byRevenue, byQty, byProfit, mostDiscounted, mostReturned] = await Promise.all([
    topBy(shopId, range, `SELECT sli.product_id AS productId, p.name_ar AS nameAr, SUM(sli.line_total_usd) AS value
      FROM sale_line_items sli JOIN products p ON p.id = sli.product_id JOIN sales s ON s.id = sli.sale_id
      WHERE sli.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
      GROUP BY sli.product_id, p.name_ar ORDER BY value DESC LIMIT 20`),
    topBy(shopId, range, `SELECT sli.product_id AS productId, p.name_ar AS nameAr, SUM(sli.quantity) AS value
      FROM sale_line_items sli JOIN products p ON p.id = sli.product_id JOIN sales s ON s.id = sli.sale_id
      WHERE sli.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
      GROUP BY sli.product_id, p.name_ar ORDER BY value DESC LIMIT 20`),
    // "Profit" = GROSS sale-line profit, not net of returns -- see this task's
    // Interfaces note above for why netting is deliberately out of scope here.
    topBy(shopId, range, `SELECT sli.product_id AS productId, p.name_ar AS nameAr,
        SUM(sli.line_total_usd - sli.quantity * COALESCE(sli.unit_cost_usd, 0)) AS value
      FROM sale_line_items sli JOIN products p ON p.id = sli.product_id JOIN sales s ON s.id = sli.sale_id
      WHERE sli.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
      GROUP BY sli.product_id, p.name_ar ORDER BY value DESC LIMIT 20`),
    topBy(shopId, range, `SELECT sli.product_id AS productId, p.name_ar AS nameAr,
        SUM(COALESCE(sli.discount_amount_usd, 0)) AS value
      FROM sale_line_items sli JOIN products p ON p.id = sli.product_id JOIN sales s ON s.id = sli.sale_id
      WHERE sli.shop_id = ? AND sli.discount_amount_usd > 0
        AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
      GROUP BY sli.product_id, p.name_ar ORDER BY value DESC LIMIT 20`),
    // "Most Returned" = UNITS returned (SUM(qty_returned)), not return-
    // transaction count -- one return transaction can return several units.
    topBy(shopId, range, `SELECT rli.product_id AS productId, p.name_ar AS nameAr, SUM(rli.qty_returned) AS value
      FROM return_line_items rli JOIN products p ON p.id = rli.product_id JOIN returns r ON r.id = rli.return_id
      WHERE r.shop_id = ? AND DATE(r.created_at, 'localtime') BETWEEN ? AND ?
      GROUP BY rli.product_id, p.name_ar ORDER BY value DESC LIMIT 20`),
  ])

  const cols = [{ key: 'nameAr' as const, label: 'Product' }, { key: 'value' as const, label: 'Value' }]
  return {
    id: 'top-products', name: 'Top Products Report', dateRange: range, generatedAt: new Date().toISOString(),
    sections: [
      detailSection<TopProductByMetricRow>({ title: 'Top 20 by Revenue', columns: cols, rows: byRevenue }),
      detailSection<TopProductByMetricRow>({ title: 'Top 20 by Quantity Sold', columns: cols, rows: byQty }),
      detailSection<TopProductByMetricRow>({ title: 'Top 20 by Profit (gross, not net of returns)', columns: cols, rows: byProfit }),
      detailSection<TopProductByMetricRow>({ title: 'Most Discounted', columns: cols, rows: mostDiscounted }),
      detailSection<TopProductByMetricRow>({ title: 'Most Returned (units)', columns: cols, rows: mostReturned }),
    ],
  }
}

REPORT_DEFINITIONS['top-products'] = { id: 'top-products', name: 'Top Products Report', cadenceHint: 'monthly', compute: computeTopProductsReport }
```

Note: "Most discounted" sums `sale_line_items.discount_amount_usd`, the same real per-line discount column Task 11's Discount Report uses — true attribution, not an approximation.

- [ ] **Steps 1-2, 4-5:** standard TDD cycle + commit.

---

### Task 16: Inventory Health report definition

**Files:**
- Create: `src/features/reports/definitions/inventoryHealth.ts`
- Test: `src/features/reports/definitions/__tests__/inventoryHealth.test.ts`

**Interfaces:** Consumes `queryDeadStockRows` (Task 4c — a shared primitive, not exported from this file; Task 17 imports it from `primitives/`, not from here). New: turnover rate, low-stock alerts (reuses `products.current_stock <= products.low_stock_threshold`, the existing low-stock check's own condition — see `lowStockCheck.ts`), fast/slow movers (30-day sales velocity), shrinkage (confirmed de-scoped, Task 0 finding 7 / spec §8).

```ts
// src/features/reports/definitions/inventoryHealth.ts
import { db } from '@/data/powersync/db'
import { summarySection, detailSection } from '../report.types'
import type { Report, ReportDateRange } from '../report.types'
import { REPORT_DEFINITIONS } from '../reportRegistry'
import { queryDeadStockRows } from '../primitives/queryDeadStockRows'
import type { DeadStockRow } from '../primitives/queryDeadStockRows'

export interface LowStockRow { productId: string; nameAr: string; currentStock: number; lowStockThreshold: number }
export interface VelocityRow { productId: string; nameAr: string; quantitySold: number }

const DEAD_STOCK_THRESHOLD_DAYS = 90 // spec offers 60/90/180; 90 is the shared default (matches useDeadStockReport.ts)

export async function computeInventoryHealthReport(shopId: string, range: ReportDateRange): Promise<Report> {
  const [lowStock, fastMovers, slowMovers, valuationRow, deadStock] = await Promise.all([
    db.getAll<LowStockRow>(
      `SELECT id AS productId, name_ar AS nameAr, current_stock AS currentStock, low_stock_threshold AS lowStockThreshold
       FROM products WHERE shop_id = ? AND (deleted = 0 OR deleted IS NULL)
         AND low_stock_threshold IS NOT NULL AND current_stock <= low_stock_threshold`,
      [shopId],
    ),
    db.getAll<VelocityRow>(
      `SELECT sli.product_id AS productId, p.name_ar AS nameAr, SUM(sli.quantity) AS quantitySold
       FROM sale_line_items sli JOIN products p ON p.id = sli.product_id JOIN sales s ON s.id = sli.sale_id
       WHERE sli.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY sli.product_id, p.name_ar ORDER BY quantitySold DESC LIMIT 20`,
      [shopId, range.from, range.to],
    ),
    db.getAll<VelocityRow>(
      `SELECT sli.product_id AS productId, p.name_ar AS nameAr, SUM(sli.quantity) AS quantitySold
       FROM sale_line_items sli JOIN products p ON p.id = sli.product_id JOIN sales s ON s.id = sli.sale_id
       WHERE sli.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY sli.product_id, p.name_ar ORDER BY quantitySold ASC LIMIT 20`,
      [shopId, range.from, range.to],
    ),
    db.getOptional<{ totalCost: number; totalCogs: number }>(
      `SELECT COALESCE(SUM(current_stock * cost_price_usd), 0) AS totalCost, 0 AS totalCogs
       FROM products WHERE shop_id = ? AND (deleted = 0 OR deleted IS NULL)`,
      [shopId],
    ),
    queryDeadStockRows(shopId, DEAD_STOCK_THRESHOLD_DAYS),
  ])

  // Turnover rate = COGS sold in range / average inventory value. Average inventory
  // value needs a start-of-period snapshot this codebase does not retain (products
  // only carry current_stock, not historical stock-on-hand-by-date) -- approximate
  // with current valuation as the denominator, documented as an approximation in
  // the metric label itself so it is never confused with a true historical average.
  const cogsInRange = await db.getOptional<{ cogs: number }>(
    `SELECT COALESCE(SUM(sli.quantity * COALESCE(sli.unit_cost_usd, 0)), 0) AS cogs
     FROM sale_line_items sli JOIN sales s ON s.id = sli.sale_id
     WHERE sli.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?`,
    [shopId, range.from, range.to],
  )
  const currentValuation = valuationRow?.totalCost ?? 0
  const turnoverRate = currentValuation > 0 ? (cogsInRange?.cogs ?? 0) / currentValuation : 0

  return {
    id: 'inventory-health', name: 'Inventory Health Report', dateRange: range, generatedAt: new Date().toISOString(),
    sections: [
      summarySection({
        // "(current snapshot)" is load-bearing, not decoration -- current_stock/
        // cost_price_usd reflect today's state regardless of `range` (Global
        // Constraints / Task 0 finding: historical vs. current-snapshot metrics
        // must be labeled explicitly). An Inventory Health report for last week
        // still shows TODAY's stock levels.
        title: 'Inventory Overview (current snapshot)',
        metrics: [
          { label: 'Current inventory value', value: currentValuation, unit: 'USD' },
          { label: 'Turnover rate (approx., current valuation basis)', value: Math.round(turnoverRate * 100) / 100 },
        ],
      }),
      detailSection<LowStockRow>({ title: 'Low Stock Alerts (current snapshot)', columns: [{ key: 'nameAr', label: 'Product' }, { key: 'currentStock', label: 'Stock' }, { key: 'lowStockThreshold', label: 'Threshold' }], rows: lowStock }),
      detailSection<VelocityRow>({ title: 'Fast-Moving SKUs', columns: [{ key: 'nameAr', label: 'Product' }, { key: 'quantitySold', label: 'Qty Sold' }], rows: fastMovers }),
      detailSection<VelocityRow>({ title: 'Slow-Moving SKUs', columns: [{ key: 'nameAr', label: 'Product' }, { key: 'quantitySold', label: 'Qty Sold' }], rows: slowMovers }),
      detailSection<DeadStockRow>({
        title: `Dead Stock (${DEAD_STOCK_THRESHOLD_DAYS}+ days, current snapshot)`,
        columns: [{ key: 'nameAr', label: 'Product' }, { key: 'currentStock', label: 'Stock' }, { key: 'valueUsd', label: 'Value' }],
        rows: deadStock,
      }),
    ],
  }
}

REPORT_DEFINITIONS['inventory-health'] = { id: 'inventory-health', name: 'Inventory Health Report', cadenceHint: 'weekly', compute: computeInventoryHealthReport }
```

Note: "Shrinkage summary" is a confirmed de-scope (Task 0 finding 7 / spec §8) — this codebase has no reconciled expected-vs-counted shrinkage mechanism. Ship the 5 sections above (Overview, Low Stock, Fast-Moving, Slow-Moving, Dead Stock).

- [ ] **Steps 1-2, 4-5:** standard TDD cycle + commit.

---

### Task 17: Dead Stock report definition

**Files:**
- Create: `src/features/reports/definitions/deadStock.ts`
- Test: `src/features/reports/definitions/__tests__/deadStock.test.ts`

**Interfaces:** Consumes `queryDeadStockRows` (Task 4c, a shared primitive — genuinely shared, not duplicated SQL, per Task 0 P0 finding 6) at a fixed 90-day threshold, returning one `DetailSection` plus a summary of frozen capital.

```ts
// src/features/reports/definitions/deadStock.ts
import { summarySection, detailSection } from '../report.types'
import type { Report, ReportDateRange } from '../report.types'
import { REPORT_DEFINITIONS } from '../reportRegistry'
import { queryDeadStockRows } from '../primitives/queryDeadStockRows'
import type { DeadStockRow } from '../primitives/queryDeadStockRows'

const THRESHOLD_DAYS = 90 // spec offers 60/90/180; 90 is this report's fixed default, matching Task 16 and useDeadStockReport.ts

export async function computeDeadStockReport(shopId: string, range: ReportDateRange): Promise<Report> {
  const deadStock = await queryDeadStockRows(shopId, THRESHOLD_DAYS)

  return {
    id: 'dead-stock', name: 'Dead Stock Report', dateRange: range, generatedAt: new Date().toISOString(),
    sections: [
      // "(current snapshot)" -- see Task 16's identical labeling rationale:
      // current_stock/cost_price_usd reflect today, not `range`.
      summarySection({ title: 'Capital Tied Up (current snapshot)', metrics: [{ label: `Capital in dead stock (${THRESHOLD_DAYS}+ days)`, value: deadStock.reduce((s, r) => s + r.valueUsd, 0), unit: 'USD' }] }),
      detailSection<DeadStockRow>({
        title: `Products with No Sales in ${THRESHOLD_DAYS}+ Days (current snapshot)`,
        columns: [{ key: 'nameAr', label: 'Product' }, { key: 'currentStock', label: 'Stock' }, { key: 'valueUsd', label: 'Value' }, { key: 'lastSoldAt', label: 'Last Sold' }],
        rows: deadStock,
      }),
    ],
  }
}

REPORT_DEFINITIONS['dead-stock'] = { id: 'dead-stock', name: 'Dead Stock Report', cadenceHint: 'weekly', compute: computeDeadStockReport }
```

Note: "Suggested actions (discount, bundle, discontinue)" from the original spec is a product/business-rules decision, not a data query — deliberately not built here (would need real heuristics or a follow-up WAFI-156 business rule, not fabricated logic in a report definition). Ship the data; suggested actions is a future enhancement to this report, not a blocker.

- [ ] **Steps 1-2, 4-5:** standard TDD cycle + commit.

---

### Task 18: Monthly Business Health report definition

**Files:**
- Create: `src/features/reports/definitions/monthlyHealth.ts`
- Test: `src/features/reports/definitions/__tests__/monthlyHealth.test.ts`

**Interfaces:** The rollup report — reuses `readProfitCache`, `getStaffMetrics`, plus the same top-10-products/top-10-customers query shapes as Tasks 15/14 and the inventory valuation query shape from Task 16. Built last per the build order since it depends on every other primitive/report already existing. **Does NOT use `getCustomerAgingSnapshot`** (Task 0 P1 finding 16 — an earlier draft's Interfaces line claimed this dependency, but the original spec's Monthly Health field list has no customer-credit line item, and the implementation below never calls it; corrected here rather than adding an unrequested section just because the primitive exists).

```ts
// src/features/reports/definitions/monthlyHealth.ts
import { readProfitCache } from '../primitives/readProfitCache'
import { getStaffMetrics } from '../primitives/getStaffMetrics'
import { db } from '@/data/powersync/db'
import { summarySection, detailSection } from '../report.types'
import type { Report, ReportDateRange } from '../report.types'
import { REPORT_DEFINITIONS } from '../reportRegistry'
import type { TopProductByMetricRow } from './topProducts'
import type { TopCustomerRow } from './topCustomers'

export async function computeMonthlyHealthReport(shopId: string, range: ReportDateRange): Promise<Report> {
  const [profit, staff, topProducts, topCustomers, valuationRow] = await Promise.all([
    readProfitCache(shopId, range),
    getStaffMetrics(shopId, range),
    db.getAll<TopProductByMetricRow>(
      `SELECT sli.product_id AS productId, p.name_ar AS nameAr, SUM(sli.line_total_usd) AS value
       FROM sale_line_items sli JOIN products p ON p.id = sli.product_id JOIN sales s ON s.id = sli.sale_id
       WHERE sli.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY sli.product_id, p.name_ar ORDER BY value DESC LIMIT 10`,
      [shopId, range.from, range.to],
    ),
    db.getAll<TopCustomerRow>(
      `SELECT c.id AS customerId, c.name AS customerName, SUM(s.total_usd) AS revenueUsd, COUNT(*) AS visitCount
       FROM sales s JOIN customers c ON c.id = s.customer_id
       WHERE s.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY c.id, c.name ORDER BY revenueUsd DESC LIMIT 10`,
      [shopId, range.from, range.to],
    ),
    db.getOptional<{ total: number }>(
      `SELECT COALESCE(SUM(current_stock * cost_price_usd), 0) AS total FROM products WHERE shop_id = ? AND (deleted = 0 OR deleted IS NULL)`,
      [shopId],
    ),
  ])

  return {
    id: 'monthly-health', name: 'Monthly Business Health', dateRange: range, generatedAt: new Date().toISOString(),
    sections: [
      summarySection({
        title: 'P&L Summary',
        metrics: [
          { label: 'Revenue', value: profit.revenueUsd, unit: 'USD' },
          { label: 'COGS', value: profit.netCogsUsd, unit: 'USD' },
          { label: 'Gross profit', value: profit.netRevenueUsd - profit.netCogsUsd, unit: 'USD' },
          { label: 'Expenses', value: profit.expensesUsd, unit: 'USD' },
          { label: 'Net profit', value: profit.profitUsd, unit: 'USD' },
        ],
      }),
      summarySection({ title: 'Inventory Valuation (current snapshot)', metrics: [{ label: 'Current inventory value', value: valuationRow?.total ?? 0, unit: 'USD' }] }),
      detailSection<TopProductByMetricRow>({ title: 'Top 10 Products', columns: [{ key: 'nameAr', label: 'Product' }, { key: 'value', label: 'Revenue' }], rows: topProducts }),
      detailSection<TopCustomerRow>({ title: 'Top 10 Customers', columns: [{ key: 'customerName', label: 'Customer' }, { key: 'revenueUsd', label: 'Revenue' }], rows: topCustomers }),
      detailSection({ title: 'Staff Performance Review', columns: [{ key: 'name', label: 'Staff' }, { key: 'marginUsd', label: 'Margin' }], rows: staff, visibility: 'staff' }),
    ],
  }
}

REPORT_DEFINITIONS['monthly-health'] = { id: 'monthly-health', name: 'Monthly Business Health', cadenceHint: 'monthly', compute: computeMonthlyHealthReport }
```

Note: "Margin trend" and "Cash flow summary" sub-items from the original spec are covered by Profit Trend and Cash Flow as their own standalone reports (Tasks 9, 7) — deliberately not duplicated inline here; the Reports list (Task 20) is where an owner navigates between related reports, not a reason to inline one report's content into another.

- [ ] **Steps 1-2, 4-5:** standard TDD cycle + commit.

---

### Task 19: `SummaryReportView` and `DetailReportView` presentation components

**Files:**
- Create: `src/features/reports/components/SummaryReportView.vue`
- Create: `src/features/reports/components/DetailReportView.vue`
- Test: `src/features/reports/components/__tests__/SummaryReportView.test.ts`, `src/features/reports/components/__tests__/DetailReportView.test.ts`

**Interfaces:**
- Consumes: `SummarySection`, `DetailSection` (Task 1).
- Produces: two dumb presentation components with no data-fetching of their own.

- [ ] **Step 1: Write the failing tests**

```ts
// src/features/reports/components/__tests__/SummaryReportView.test.ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import SummaryReportView from '../SummaryReportView.vue'

describe('SummaryReportView', () => {
  it('renders every metric label and value', () => {
    const wrapper = mount(SummaryReportView, {
      props: { section: { type: 'summary', title: 'Totals', metrics: [{ label: 'Revenue', value: 100, unit: 'USD' }], visibility: 'shop' } },
    })
    expect(wrapper.text()).toContain('Totals')
    expect(wrapper.text()).toContain('Revenue')
    expect(wrapper.text()).toContain('100')
    expect(wrapper.text()).toContain('USD')
  })
})
```

```ts
// src/features/reports/components/__tests__/DetailReportView.test.ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import DetailReportView from '../DetailReportView.vue'

describe('DetailReportView', () => {
  it('renders a table with columns and rows', () => {
    const wrapper = mount(DetailReportView, {
      props: {
        section: {
          type: 'detail', title: 'Rows',
          columns: [{ key: 'name', label: 'Name' }, { key: 'total', label: 'Total' }],
          rows: [{ name: 'A', total: 10 }],
          visibility: 'shop',
        },
      },
    })
    expect(wrapper.text()).toContain('Rows')
    expect(wrapper.text()).toContain('Name')
    expect(wrapper.text()).toContain('A')
    expect(wrapper.text()).toContain('10')
  })

  it('renders an empty-state message when rows is empty', () => {
    const wrapper = mount(DetailReportView, {
      props: { section: { type: 'detail', title: 'Rows', columns: [{ key: 'name', label: 'Name' }], rows: [], visibility: 'shop' } },
    })
    expect(wrapper.text()).toContain('لا توجد بيانات')
  })
})
```

- [ ] **Step 2: Run to verify both fail**

Run: `npx vitest run src/features/reports/components/__tests__/`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `SummaryReportView.vue`**

```vue
<!-- src/features/reports/components/SummaryReportView.vue -->
<script setup lang="ts">
import type { SummarySection } from '../report.types'
defineProps<{ section: SummarySection }>()
</script>

<template>
  <section class="summary-section" dir="rtl">
    <p class="section-title">{{ section.title }}</p>
    <div class="metrics-grid">
      <div v-for="(m, i) in section.metrics" :key="i" class="metric-row">
        <span class="metric-label">{{ m.label }}</span>
        <span class="metric-value">{{ m.value }}<span v-if="m.unit" class="metric-unit"> {{ m.unit }}</span></span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.summary-section { background: linear-gradient(135deg, rgba(26, 86, 219, 0.11), rgba(255, 255, 255, 0.04)); border: 1px solid rgba(26, 86, 219, 0.28); border-radius: 1rem; padding: 0.9rem; margin-bottom: 0.75rem; }
.section-title { font-size: 0.8rem; font-weight: 700; color: #9AA8BE; margin: 0 0 0.5rem; }
.metric-row { display: flex; justify-content: space-between; padding: 0.4rem 0; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 0.85rem; }
.metric-row:last-child { border-bottom: none; }
.metric-label { color: #C8D5E8; }
.metric-value { font-weight: 700; color: #E8EDF5; }
.metric-unit { font-weight: 400; color: #9AA8BE; font-size: 0.75rem; }
</style>
```

- [ ] **Step 4: Write `DetailReportView.vue`**

```vue
<!-- src/features/reports/components/DetailReportView.vue -->
<script setup lang="ts">
import type { DetailSection } from '../report.types'
defineProps<{ section: DetailSection }>()

function cell(row: object, key: string): unknown {
  return (row as Record<string, unknown>)[key]
}
</script>

<template>
  <section class="detail-section" dir="rtl">
    <p class="section-title">{{ section.title }}</p>
    <p v-if="section.rows.length === 0" class="empty-state">لا توجد بيانات</p>
    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr><th v-for="col in section.columns" :key="col.key">{{ col.label }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in section.rows" :key="i">
            <td v-for="col in section.columns" :key="col.key">{{ cell(row, col.key) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.detail-section { background: linear-gradient(135deg, rgba(26, 86, 219, 0.11), rgba(255, 255, 255, 0.04)); border: 1px solid rgba(26, 86, 219, 0.28); border-radius: 1rem; padding: 0.9rem; margin-bottom: 0.75rem; overflow-x: auto; }
.section-title { font-size: 0.8rem; font-weight: 700; color: #9AA8BE; margin: 0 0 0.5rem; }
.empty-state { color: #637285; font-size: 0.8rem; margin: 0; }
table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
th { text-align: start; padding: 0.4rem; color: #9AA8BE; border-bottom: 1px solid rgba(26,86,219,0.2); }
td { padding: 0.4rem; color: #E8EDF5; border-bottom: 1px solid rgba(255,255,255,0.05); }
</style>
```

- [ ] **Step 5: Run to verify both pass**

Run: `npx vitest run src/features/reports/components/__tests__/`
Expected: PASS (2/2).

- [ ] **Step 6: Commit**

```bash
git add src/features/reports/components/
git commit -m "feat(WAFI-147A): add SummaryReportView and DetailReportView presentation components"
```

---

### Task 19b: Registration barrel (moved earlier — Task 0 P0 finding 9, second review)

An earlier draft of this plan created this barrel inside Task 21 (the last UI task), but Task 20 (the very next task) also needs `REPORT_DEFINITIONS` guaranteed populated — importing straight from `./reportRegistry` in either page gets an EMPTY registry, since `reportRegistry.ts` itself never imports the 13 definition files (doing so would be circular: they import `REPORT_DEFINITIONS` from it). Created here, before either page, so Tasks 20 and 21 both import from `./index` from the start — not a "fix it later" step.

**Files:**
- Create: `src/features/reports/index.ts`

**Interfaces:**
- Consumes: every report definition file (Tasks 6-18, all already committed by this point in the build order), `REPORT_DEFINITIONS`/`report.types` exports.
- Produces: the single import path (`./index`) both `ReportsListPage.vue` and `ReportDetailPage.vue` use for `REPORT_DEFINITIONS`/`ReportId`/`ReportContext`/etc.

- [ ] **Step 1: Write `index.ts`**

```ts
// src/features/reports/index.ts
// WAFI-147A: the registration barrel. reportRegistry.ts cannot import the 13
// definition files itself (they import REPORT_DEFINITIONS from it -- circular).
// This file's only job is to import every definition file for its
// REPORT_DEFINITIONS[...] = {...} registration side-effect, then re-export
// the registry/types so ReportsListPage.vue and ReportDetailPage.vue have
// exactly one import path that's guaranteed to see a fully populated registry.
export * from './reportRegistry'
export * from './report.types'
import './definitions/dailyClosing'
import './definitions/cashFlow'
import './definitions/weeklySummary'
import './definitions/profitTrend'
import './definitions/employeeSummary'
import './definitions/discountReport'
import './definitions/returnsReport'
import './definitions/creditReport'
import './definitions/topCustomers'
import './definitions/topProducts'
import './definitions/inventoryHealth'
import './definitions/deadStock'
import './definitions/monthlyHealth'
```

- [ ] **Step 2: Write a smoke test confirming the barrel actually populates the registry**

```ts
// src/features/reports/__tests__/index.test.ts
import { describe, it, expect, vi } from 'vitest'
// Importing the barrel pulls in all 13 real definition files, each of which
// imports the real db singleton -- mock it so this smoke test never tries to
// initialize a real PowerSync client.
vi.mock('@/data/powersync/db', () => ({ db: { getAll: vi.fn().mockResolvedValue([]), getOptional: vi.fn().mockResolvedValue(null) } }))

import { REPORT_DEFINITIONS } from '../index'

describe('reports registration barrel', () => {
  it('populates all 13 report definitions via import side-effects', () => {
    expect(Object.keys(REPORT_DEFINITIONS)).toHaveLength(13)
  })
})
```

- [ ] **Step 3: Run to verify it passes**

Run: `npx vitest run src/features/reports/__tests__/index.test.ts`
Expected: PASS — this is the test that would have caught the empty-registry bug an earlier draft of this plan shipped (pages importing from `./reportRegistry` directly instead of `./index`).

- [ ] **Step 4: Commit**

```bash
git add src/features/reports/index.ts src/features/reports/__tests__/index.test.ts
git commit -m "feat(WAFI-147A): add registration barrel, moved before the UI tasks that depend on it"
```

---

### Task 20: Reports list page (registry metadata only, no compute)

**Files:**
- Create: `src/features/reports/ReportsListPage.vue`
- Test: `src/features/reports/__tests__/ReportsListPage.test.ts`

**Interfaces:**
- Consumes: `REPORT_DEFINITIONS` (Task 5+), `can_view_staff_performance` permission check via `canUserDo` (`@/router/permissions`, existing) to hide Employee Summary from the list for a non-permitted viewer.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/reports/__tests__/ReportsListPage.test.ts
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('@/store/session.store', () => ({ useSessionStore: () => ({ activeStaff: { role: 'owner', permissions: {} } }) }))
// ReportsListPage imports from ./index (Task 19b's barrel), which imports all
// 13 real definition files -- each of those imports the real db singleton
// (@/data/powersync/db), which would otherwise try to initialize a real
// PowerSync client in this test environment. Mock it here so merely
// IMPORTING the barrel doesn't attempt that (matching every other test file
// in this plan's own convention for any file that touches ./index).
vi.mock('@/data/powersync/db', () => ({ db: { getAll: vi.fn().mockResolvedValue([]), getOptional: vi.fn().mockResolvedValue(null) } }))

import ReportsListPage from '../ReportsListPage.vue'

describe('ReportsListPage', () => {
  it('lists every registered report by name, without calling compute', async () => {
    const computeSpy = vi.fn()
    const { REPORT_DEFINITIONS } = await import('../index')
    REPORT_DEFINITIONS['daily-closing'] = { id: 'daily-closing', name: 'Daily Closing Report', cadenceHint: 'daily', compute: computeSpy }

    const wrapper = mount(ReportsListPage, { global: { stubs: { RouterLink: true } } })
    expect(wrapper.text()).toContain('Daily Closing Report')
    expect(computeSpy).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/reports/__tests__/ReportsListPage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `ReportsListPage.vue`**

```vue
<!-- src/features/reports/ReportsListPage.vue -->
<!--
  WAFI-147A: reads ONLY registry metadata (id/name/cadenceHint) -- never calls
  compute() here. Per-report generation happens lazily on ReportDetailPage.vue
  when the owner opens one specific report (design spec S1's lazy-computation
  requirement).
-->
<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import { useSessionStore } from '@/store/session.store'
import { canUserDo } from '@/router/permissions'
import { REPORT_DEFINITIONS } from './index'
import type { ReportId } from './index'

const router = useRouter()
const session = useSessionStore()

// Employee Summary's entire purpose is staff identification -- whole-report
// gating (design spec S5), matching /reports/staff's precedent.
const STAFF_ONLY_REPORT_IDS: ReportId[] = ['employee-summary']

const reports = computed(() =>
  Object.values(REPORT_DEFINITIONS).filter((def) =>
    !STAFF_ONLY_REPORT_IDS.includes(def.id) || canUserDo(session.activeStaff, 'can_view_staff_performance'),
  ),
)
</script>

<template>
  <div class="lg:hidden">
    <AppHeader title="التقارير" :show-back="true" @back="router.back()" />
  </div>
  <div class="page-body" dir="rtl">
    <div class="settings-card">
      <button
        v-for="def in reports"
        :key="def.id"
        type="button"
        class="report-row"
        :data-testid="`report-row-${def.id}`"
        @click="router.push(`/reports/${def.id}`)"
      >
        <span>{{ def.name }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.page-body { padding: 16px; max-width: 560px; margin: 0 auto; width: 100%; font-family: 'Tajawal', system-ui, sans-serif; }
.settings-card { background: linear-gradient(135deg, rgba(26, 86, 219, 0.11), rgba(255, 255, 255, 0.04)); border: 1px solid rgba(26, 86, 219, 0.28); border-radius: 1rem; overflow: hidden; }
.report-row { display: block; width: 100%; text-align: start; padding: 0.8rem 0.95rem; border: none; background: transparent; border-bottom: 1px solid rgba(26, 86, 219, 0.14); color: #E8EDF5; font-size: 0.9rem; font-family: inherit; cursor: pointer; }
.report-row:last-child { border-bottom: none; }
</style>
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/features/reports/__tests__/ReportsListPage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/reports/ReportsListPage.vue src/features/reports/__tests__/ReportsListPage.test.ts
git commit -m "feat(WAFI-147A): add Reports list page reading registry metadata only, no eager compute"
```

---

### Task 21: Per-report detail page (lazy compute) + route/nav wiring

**Files:**
- Create: `src/features/reports/ReportDetailPage.vue`
- Modify: `src/router/index.ts` (add `/reports/:reportId` route)
- Test: `src/features/reports/__tests__/ReportDetailPage.test.ts`

**Interfaces:**
- Consumes: `REPORT_DEFINITIONS` (from `./index`, Task 19b — the registration barrel already guarantees all 13 definitions are registered by this point, no separate wiring step needed here), `SummaryReportView`/`DetailReportView` (Task 19), `can_view_staff_performance` for section-visibility filtering AND whole-report gating on Employee Summary (Task 0 P0 finding 5, second review), `ReportContext` (Task 1) for Employee Summary's staff selection.

**Scope note (Task 0 finding 14, partial):** this task adds the two UI pieces that are correctness/functionality requirements, not polish — a date-range editor (without one, "on-demand" silently means "whatever default range the code picked," which is a product decision, not merely a UI nicety) and a staff selector (required for Employee Summary's `ReportContext.staffId` to ever be populated at all — without it that report is permanently stuck in its "not selected" state from Task 10). Deliberately NOT added in this pass, left as later polish since they don't affect report correctness: currency/number formatting, an explicit "generated at" timestamp display, and Arabic numeral/locale formatting. Flagging these explicitly rather than silently shipping without them.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/reports/__tests__/ReportDetailPage.test.ts
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// useSessionStore and useRoute are wrapped in vi.fn() (not plain arrow functions)
// specifically so later tests can call vi.mocked(...).mockReturnValue(...) to
// change the active staff / selected reportId per-test, per Task 0 P0 finding 3.
vi.mock('@/store/session.store', () => ({ useSessionStore: vi.fn(() => ({ activeStaff: { role: 'owner', permissions: {} } })) }))
vi.mock('@/store/device.store', () => ({ useDeviceStore: () => ({ shopId: 'shop1' }) }))
vi.mock('vue-router', async (orig) => ({ ...(await orig<any>()), useRoute: vi.fn(() => ({ params: { reportId: 'daily-closing' } })) }))

const mockGetAll = vi.fn().mockResolvedValue([])
vi.mock('@/data/powersync/db', () => ({ db: { getAll: (...a: unknown[]) => mockGetAll(...a) } }))

import ReportDetailPage from '../ReportDetailPage.vue'
import { REPORT_DEFINITIONS } from '../index'

describe('ReportDetailPage', () => {
  it('calls compute() exactly once for the selected report, with a local-calendar-date range, and renders its sections', async () => {
    const computeSpy = vi.fn().mockResolvedValue({
      id: 'daily-closing', name: 'Daily Closing Report',
      dateRange: { from: '2026-08-18', to: '2026-08-18' }, generatedAt: '2026-08-18T00:00:00.000Z',
      sections: [{ type: 'summary', title: 'Totals', metrics: [{ label: 'Revenue', value: 100 }], visibility: 'shop' }],
    })
    REPORT_DEFINITIONS['daily-closing'] = { id: 'daily-closing', name: 'Daily Closing Report', cadenceHint: 'daily', compute: computeSpy }

    const wrapper = mount(ReportDetailPage)
    await flushPromises()

    expect(computeSpy).toHaveBeenCalledTimes(1)
    // exactly YYYY-MM-DD, sourced from local date parts, not toISOString()
    expect(computeSpy.mock.calls[0][1].from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(wrapper.text()).toContain('Daily Closing Report')
    expect(wrapper.text()).toContain('Totals')
  })

  it('shows a staff selector and withholds compute() until a staff member is chosen, for a per-shift report', async () => {
    mockGetAll.mockResolvedValueOnce([{ id: 's1', name: 'Ali' }])
    const computeSpy = vi.fn().mockResolvedValue({
      id: 'employee-summary', name: 'Employee Summary',
      dateRange: { from: '2026-08-18', to: '2026-08-18' }, generatedAt: '2026-08-18T00:00:00.000Z',
      sections: [{ type: 'summary', title: 'Ali', metrics: [], visibility: 'staff' }],
    })
    REPORT_DEFINITIONS['employee-summary'] = { id: 'employee-summary', name: 'Employee Summary', cadenceHint: 'per-shift', contextRequirement: 'staff', compute: computeSpy }

    const vueRouterForStaffTest = await import('vue-router')
    vi.mocked(vueRouterForStaffTest.useRoute).mockReturnValue({ params: { reportId: 'employee-summary' } } as any)
    const wrapper = mount(ReportDetailPage)
    await flushPromises()

    expect(computeSpy).not.toHaveBeenCalled() // withheld until staff is chosen
    await wrapper.find('[data-testid="staff-select"]').setValue('s1')
    await flushPromises()

    expect(computeSpy).toHaveBeenCalledWith('shop1', expect.any(Object), { staffId: 's1' })
  })

  it('omits a staff-visibility section for a viewer without can_view_staff_performance, without hiding the rest of the report (Task 0 P0 finding 3)', async () => {
    const sessionModule = await import('@/store/session.store')
    vi.mocked(sessionModule.useSessionStore).mockReturnValue({ activeStaff: { role: 'cashier', permissions: {} } } as any)

    const computeSpy = vi.fn().mockResolvedValue({
      id: 'weekly-summary', name: 'Weekly Summary',
      dateRange: { from: '2026-08-12', to: '2026-08-18' }, generatedAt: '2026-08-18T00:00:00.000Z',
      sections: [
        { type: 'summary', title: 'Week over Week', metrics: [], visibility: 'shop' },
        { type: 'detail', title: 'Staff Ranking', columns: [], rows: [], visibility: 'staff' },
      ],
    })
    REPORT_DEFINITIONS['weekly-summary'] = { id: 'weekly-summary', name: 'Weekly Summary', cadenceHint: 'weekly', compute: computeSpy }
    const vueRouter = await import('vue-router')
    vi.mocked(vueRouter.useRoute).mockReturnValue({ params: { reportId: 'weekly-summary' } } as any)

    const wrapper = mount(ReportDetailPage)
    await flushPromises()

    expect(wrapper.text()).toContain('Week over Week') // shop-visibility section still renders
    expect(wrapper.text()).not.toContain('Staff Ranking') // staff-visibility section omitted, not the whole report

    vi.mocked(sessionModule.useSessionStore).mockReturnValue({ activeStaff: { role: 'owner', permissions: {} } } as any)
  })

  it('whole-report gates Employee Summary for a viewer without can_view_staff_performance -- no staff query, no compute() call (Task 0 P0 finding 5)', async () => {
    const sessionModule = await import('@/store/session.store')
    vi.mocked(sessionModule.useSessionStore).mockReturnValue({ activeStaff: { role: 'cashier', permissions: {} } } as any)
    mockGetAll.mockClear()

    const computeSpy = vi.fn()
    REPORT_DEFINITIONS['employee-summary'] = { id: 'employee-summary', name: 'Employee Summary', cadenceHint: 'per-shift', contextRequirement: 'staff', compute: computeSpy }
    const vueRouter = await import('vue-router')
    vi.mocked(vueRouter.useRoute).mockReturnValue({ params: { reportId: 'employee-summary' } } as any)

    const wrapper = mount(ReportDetailPage)
    await flushPromises()

    expect(wrapper.find('[data-testid="not-authorized"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="staff-select"]').exists()).toBe(false)
    expect(mockGetAll).not.toHaveBeenCalled() // never even queried the staff list
    expect(computeSpy).not.toHaveBeenCalled()

    vi.mocked(sessionModule.useSessionStore).mockReturnValue({ activeStaff: { role: 'owner', permissions: {} } } as any)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/reports/__tests__/ReportDetailPage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `ReportDetailPage.vue`**

```vue
<!-- src/features/reports/ReportDetailPage.vue -->
<!--
  WAFI-147A: lazy per-report generation -- compute() runs exactly once per
  (range, staffId) combination the owner asks for, for the one report this
  route selected. Never called from ReportsListPage.vue.
-->
<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { useSessionStore } from '@/store/session.store'
import { canUserDo } from '@/router/permissions'
import { formatLocalDate, addCalendarDays } from './dateUtils'
import { REPORT_DEFINITIONS } from './index'
import type { ReportId } from './index'
import type { Report, ReportDateRange, ReportSection } from './report.types'
import SummaryReportView from './components/SummaryReportView.vue'
import DetailReportView from './components/DetailReportView.vue'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const report = ref<Report | null>(null)
const error = ref<string | null>(null)
const loading = ref(false)
const staffOptions = ref<{ id: string; name: string }[]>([])
const selectedStaffId = ref<string>('')
const rangeError = ref<string | null>(null)

const reportId = route.params.reportId as ReportId
const definition = REPORT_DEFINITIONS[reportId]

// Task 0 P0 finding 3: section-level authorization happens HERE, not just as
// whole-report list hiding (Task 20 still hides Employee Summary from the
// list for a non-permitted viewer, but a composite report like Weekly
// Summary must render normally minus its staff-identifying sections, not be
// hidden outright over one section). visibility: 'shop' sections always pass.
const canSeeStaffSections = computed(() => canUserDo(session.activeStaff, 'can_view_staff_performance'))
const visibleSections = computed((): ReportSection[] =>
  (report.value?.sections ?? []).filter((s) => s.visibility === 'shop' || canSeeStaffSections.value),
)

function defaultRangeForCadence(cadenceHint: string): ReportDateRange {
  const today = formatLocalDate(new Date())
  // Task 0 finding 9: rolling windows, not calendar-aligned week/month -- a
  // report opened mid-week/mid-month should show a meaningful trailing
  // window, not a partial current one. Isolated here, no report definition
  // hardcodes a window length itself.
  if (cadenceHint === 'weekly') return { from: addCalendarDays(today, -6), to: today }
  if (cadenceHint === 'monthly') return { from: addCalendarDays(today, -29), to: today }
  return { from: today, to: today }
}

const range = ref<ReportDateRange>(definition ? defaultRangeForCadence(definition.cadenceHint) : { from: '', to: '' })
// Task 0 P0 finding 4: contextRequirement, NOT cadenceHint, is what drives
// invocation behavior here. cadenceHint stays purely a display/default-range
// hint (defaultRangeForCadence above is the one place it legitimately
// matters, and even there only for picking a default window length).
const needsStaffContext = computed(() => definition?.contextRequirement === 'staff')

// Task 0 P0 finding 5 (second review): Employee Summary is WHOLE-REPORT
// gated, not merely section-filtered -- unlike a composite report (Weekly
// Summary etc.) where hiding one section still leaves a meaningful report,
// Employee Summary's entire purpose is staff-identifying figures, so an
// unpermitted viewer should never reach the staff selector or trigger
// compute() at all, not just see an empty result after the fact. Every
// report requiring 'staff' context is, by definition, whole-report gated
// this way (currently only Employee Summary; if a future report is added
// with contextRequirement: 'staff', it inherits the same gate for free).
const isAuthorizedForThisReport = computed(() =>
  !needsStaffContext.value || canUserDo(session.activeStaff, 'can_view_staff_performance'),
)

async function generate() {
  if (!definition) { error.value = 'التقرير غير موجود'; return }
  if (!isAuthorizedForThisReport.value) return // whole-report gate; UI never reaches the staff selector for this case either
  if (needsStaffContext.value && !selectedStaffId.value) return // withhold until a staff member is chosen

  // Task 0 P0 finding 18: reject an inverted range before calling compute() --
  // an invalid range must surface as a visible error, never a silently empty
  // "valid-looking" report.
  rangeError.value = null
  if (range.value.from > range.value.to) {
    rangeError.value = 'يجب أن يكون تاريخ البداية قبل تاريخ النهاية أو مساويًا له'
    return
  }

  loading.value = true
  error.value = null
  try {
    const { shopId } = useDeviceStore()
    const context = selectedStaffId.value ? { staffId: selectedStaffId.value } : undefined
    report.value = await definition.compute(shopId, range.value, context)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'تعذّر إنشاء التقرير'
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  if (!isAuthorizedForThisReport.value) return // do not generate, do not show the staff selector, do not query staff -- "not authorized" renders from the template's own check
  if (needsStaffContext.value) {
    const { shopId } = useDeviceStore()
    staffOptions.value = await db.getAll<{ id: string; name: string }>(
      `SELECT id, name FROM staff WHERE shop_id = ? AND is_active = 1 ORDER BY name`,
      [shopId],
    )
    return // wait for staff selection before generating (see `generate()`'s own guard)
  }
  await generate()
})

watch(selectedStaffId, (id) => { if (id) generate() })
</script>

<template>
  <div class="lg:hidden">
    <AppHeader :title="definition?.name ?? 'تقرير'" :show-back="true" @back="router.back()" />
  </div>
  <div class="page-body" dir="rtl">
    <!-- Task 0 P0 finding 5 (second review): whole-report gate, checked BEFORE
         the staff selector or anything else renders -- an unpermitted viewer
         never sees the selector, never triggers a staff query, never calls
         compute(). -->
    <p v-if="!isAuthorizedForThisReport" class="state-message state-message--error" data-testid="not-authorized">
      لا تملك صلاحية عرض هذا التقرير
    </p>
    <template v-else>
      <div v-if="needsStaffContext" class="staff-picker">
        <label>الموظف</label>
        <select data-testid="staff-select" v-model="selectedStaffId">
          <option value="" disabled>اختر موظفًا</option>
          <option v-for="s in staffOptions" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </div>

      <div v-if="definition && !needsStaffContext" class="range-picker">
        <label>من<input type="date" v-model="range.from" data-testid="range-from"></label>
        <label>إلى<input type="date" v-model="range.to" data-testid="range-to"></label>
        <button type="button" data-testid="regenerate-button" @click="generate">تحديث</button>
      </div>
      <p v-if="rangeError" class="state-message state-message--error" data-testid="range-error">{{ rangeError }}</p>

      <p v-if="loading" class="state-message">...جارٍ إنشاء التقرير</p>
      <p v-else-if="error" class="state-message state-message--error">{{ error }}</p>
      <template v-else-if="report">
        <template v-for="(s, i) in visibleSections" :key="i">
          <SummaryReportView v-if="s.type === 'summary'" :section="s" />
          <DetailReportView v-else :section="s" />
        </template>
      </template>
    </template>
  </div>
</template>

<style scoped>
.page-body { padding: 16px; max-width: 560px; margin: 0 auto; width: 100%; font-family: 'Tajawal', system-ui, sans-serif; }
.state-message { text-align: center; color: #9AA8BE; font-size: 0.85rem; padding: 2rem 0; }
.state-message--error { color: #EF4444; }
.staff-picker, .range-picker { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 1rem; font-size: 0.8rem; color: #C8D5E8; }
.staff-picker select, .range-picker input { background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.18); border-radius: 8px; padding: 6px 8px; color: #E8EDF5; font-family: inherit; }
.range-picker button { background: linear-gradient(135deg, #1A56DB, #1248B3); border: none; border-radius: 8px; padding: 6px 12px; color: #fff; font-weight: 700; cursor: pointer; }
</style>
```

This iterates `report.sections` once, in the order `compute()` returned them, dispatching each individual section to the matching view by its own `type` — a report like Daily Closing (summary/summary/summary/detail/detail) renders in exactly that order, not summaries-then-details. The test in Step 1 above already asserts this: it renders "Totals" (the only section in that fixture) correctly regardless of order, but Step 6 below extends coverage for a genuinely mixed-order report.

- [ ] **Step 3b: Extend the test to assert section order is preserved for a mixed report**

Add to `ReportDetailPage.test.ts`:

```ts
  it('preserves compute()\'s section order when rendering mixed summary/detail sections', async () => {
    const computeSpy = vi.fn().mockResolvedValue({
      id: 'daily-closing', name: 'Daily Closing Report',
      dateRange: { from: '2026-08-18', to: '2026-08-18' }, generatedAt: '2026-08-18T00:00:00.000Z',
      sections: [
        { type: 'summary', title: 'Sales Totals', metrics: [], visibility: 'shop' },
        { type: 'summary', title: 'Cash Reconciliation', metrics: [], visibility: 'shop' },
        { type: 'detail', title: 'Top 5 Products', columns: [], rows: [], visibility: 'shop' },
      ],
    })
    REPORT_DEFINITIONS['daily-closing'] = { id: 'daily-closing', name: 'Daily Closing Report', cadenceHint: 'daily', compute: computeSpy }

    const wrapper = mount(ReportDetailPage)
    await flushPromises()

    const text = wrapper.text()
    expect(text.indexOf('Cash Reconciliation')).toBeLessThan(text.indexOf('Top 5 Products'))
  })
```

- [ ] **Step 4: Add the route**

In `src/router/index.ts`, add near the existing `/reports` entry:

```ts
{ path: '/reports/:reportId', component: () => import('@/features/reports/ReportDetailPage.vue'), meta: { permission: 'can_view_reports', feature: 'reporting_pack' } },
```

- [ ] **Step 5: Run to verify the detail page tests pass**

Run: `npx vitest run src/features/reports/__tests__/ReportDetailPage.test.ts`
Expected: PASS. (No separate "wire registration" step needed here — Task 19b already created the `./index` barrel this page imports from, and it's already guaranteed to be populated by the time this task runs.)

- [ ] **Step 6: Commit**

```bash
git add src/features/reports/ReportDetailPage.vue src/router/index.ts src/features/reports/__tests__/ReportDetailPage.test.ts
git commit -m "feat(WAFI-147A): add lazy per-report detail page and route wiring"
```

---

### Task 22: Real-SQLite integration tests for shared primitives and high-risk queries

**Files (1 helper + 5 test files — Task 0 P2 finding 23: be exact about the count and what each one actually covers, not "all 6 files" as an earlier draft imprecisely said):**
- Create: `src/features/reports/__tests__/helpers/reportsSqliteDb.ts` — the shared real-SQLite harness (not itself a test file).
- Create: `src/features/reports/__tests__/integration/primitives.integration.test.ts` — `getCustomerAgingSnapshot`'s as-of-date filter (a payment made after `asOfDate` must not reduce the balance).
- Create: `src/features/reports/__tests__/integration/dateBoundary.integration.test.ts` — local-calendar-day inclusion at a timezone boundary, via `getStaffMetrics`.
- Create: `src/features/reports/__tests__/integration/moneyUnits.integration.test.ts` — `readProfitCache` divides `profit_cache`'s bigint-cents columns by 100; `getStaffMetrics` does NOT divide `sales.total_usd` (plain dollars).
- Create: `src/features/reports/__tests__/integration/cashReconciliation.integration.test.ts` — `readShiftCashReconciliation`'s `z_report_data` JSON-extraction and summing across shifts, the open-shift exclusion, and the malformed-JSON throw (Task 0 P0 finding 12).
- Create: `src/features/reports/__tests__/integration/discountAttribution.integration.test.ts` — discount-by-product (`discount_amount_usd`), returns-by-product (`SUM(qty_returned)`, Task 0 P0 finding 10), and top-N `LIMIT 20` truncation with >20 candidate rows (Task 0 P0 finding 11), as three separate `describe` blocks in one file.

**Interfaces:**
- Consumes: Node's built-in `node:sqlite` (already a dependency per `src/__tests__/helpers/realSqliteDb.ts`'s precedent), all 5 primitives (Tasks 2-4c).
- Produces: a reusable `createReportsTestDb()` helper seeding plain (non-PowerSync-view-wrapped) tables — unlike `realSqliteDb.ts`, these are ordinary synced tables, not a `localOnly` table, so no JSON-blob view/trigger machinery is needed, only `CREATE TABLE` matching the columns each primitive's queries touch.

**Acceptance criterion (Task 0 finding 10):** every genuinely distinct high-risk query *shape* introduced across Tasks 2-18 gets at least one real-SQLite test here — not one per report. This task covers: date-boundary inclusion, `getCustomerAgingSnapshot`'s as-of-date filter, the cents-vs-dollars distinction (finding 3 — `readProfitCache` divides by 100, nothing else does), `readShiftCashReconciliation`'s JSON-extraction aggregation (finding 2), and discount-by-product/returns-by-product attribution (the `discount_amount_usd` column Task 11/15 depend on). Top-N ranking (`ORDER BY ... LIMIT 20`) is exercised implicitly by the discount-attribution test's ordering assertion below, rather than a 7th dedicated file.

- [ ] **Step 1: Write `reportsSqliteDb.ts`**

```ts
// src/features/reports/__tests__/helpers/reportsSqliteDb.ts
// WAFI-147A: a real SQLite database (Node's built-in node:sqlite), for
// integration-testing the shared primitives and high-risk report queries
// against real SQL semantics -- date boundaries, joins, aggregation -- which
// db-mocking (used by every report definition's own unit test) cannot
// validate. Unlike src/__tests__/helpers/realSqliteDb.ts (built for a
// PowerSync localOnly table's JSON-blob view), these are ordinary synced
// tables, so plain CREATE TABLE statements matching schema.ts's columns
// suffice -- no view/trigger machinery needed.
import { DatabaseSync } from 'node:sqlite'

export function createReportsTestDb(path = ':memory:') {
  const conn = new DatabaseSync(path)
  conn.exec(`
    CREATE TABLE sales (
      id TEXT PRIMARY KEY, shop_id TEXT, staff_id TEXT, customer_id TEXT,
      total_usd REAL, created_at TEXT, is_credit INTEGER, payment_method TEXT,
      sale_discount_amount_usd REAL DEFAULT 0
    );
    CREATE TABLE sale_line_items (
      id TEXT PRIMARY KEY, sale_id TEXT, shop_id TEXT, product_id TEXT,
      quantity INTEGER, unit_price_usd REAL, unit_cost_usd REAL, line_total_usd REAL,
      discount_amount_usd REAL DEFAULT 0
    );
    CREATE TABLE returns (
      id TEXT PRIMARY KEY, shop_id TEXT, original_sale_id TEXT, created_at TEXT,
      refund_amount_usd REAL, shift_id TEXT, refund_method TEXT, reason TEXT
    );
    CREATE TABLE return_line_items (
      id TEXT PRIMARY KEY, return_id TEXT, product_id TEXT, qty_returned INTEGER,
      unit_price_usd REAL, restock INTEGER
    );
    CREATE TABLE customer_payments (
      id TEXT PRIMARY KEY, shop_id TEXT, customer_id TEXT, sale_id TEXT,
      amount_usd REAL, paid_at TEXT, created_at TEXT
    );
    CREATE TABLE customers (id TEXT PRIMARY KEY, shop_id TEXT, name TEXT, deleted INTEGER DEFAULT 0, created_at TEXT);
    CREATE TABLE staff (id TEXT PRIMARY KEY, shop_id TEXT, name TEXT);
    CREATE TABLE cashier_shifts (
      id TEXT PRIMARY KEY, shop_id TEXT, staff_id TEXT, status TEXT,
      opened_at TEXT, closed_at TEXT, opening_cash_usd REAL, closing_cash_usd REAL, variance_usd REAL,
      z_report_data TEXT
    );
    CREATE TABLE products (
      id TEXT PRIMARY KEY, shop_id TEXT, name_ar TEXT, current_stock INTEGER,
      cost_price_usd REAL, low_stock_threshold INTEGER, created_at TEXT, deleted INTEGER DEFAULT 0
    );
    CREATE TABLE profit_cache (
      shop_id TEXT, day TEXT, revenue_usd INTEGER, revenue_syp INTEGER, cogs_usd INTEGER,
      cogs_reversal_usd INTEGER, expenses_usd INTEGER, refunds_usd INTEGER, discount_usd INTEGER,
      invoice_count INTEGER, return_count INTEGER, costless_sale_count INTEGER
    );
  `)
  return conn
}
```

- [ ] **Step 2: Write the failing integration test for `getCustomerAgingSnapshot`'s as-of-date filter**

```ts
// src/features/reports/__tests__/integration/primitives.integration.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createReportsTestDb } from '../helpers/reportsSqliteDb'

let conn: ReturnType<typeof createReportsTestDb>

vi.mock('@/data/powersync/db', () => ({
  db: {
    getAll: async (sql: string, params: unknown[]) => conn.prepare(sql.replace(/\?/g, () => '?')).all(...(params as any[])),
    getOptional: async (sql: string, params: unknown[]) => {
      const rows = conn.prepare(sql).all(...(params as any[]))
      return rows[0] ?? null
    },
  },
}))

import { getCustomerAgingSnapshot } from '../../primitives/getCustomerAgingSnapshot'

describe('getCustomerAgingSnapshot integration', () => {
  beforeEach(() => { conn = createReportsTestDb() })

  it('a payment made AFTER asOfDate must not reduce the as-of-date balance', async () => {
    conn.exec(`
      INSERT INTO customers (id, shop_id, name) VALUES ('c1', 'shop1', 'Sara');
      INSERT INTO sales (id, shop_id, customer_id, total_usd, created_at, is_credit) VALUES ('s1', 'shop1', 'c1', 100, '2026-08-01T10:00:00Z', 1);
      INSERT INTO customer_payments (id, shop_id, customer_id, sale_id, amount_usd, paid_at) VALUES ('p1', 'shop1', 'c1', 's1', 60, '2026-08-15');
    `)

    const asOfAug9 = await getCustomerAgingSnapshot('shop1', '2026-08-09')
    expect(asOfAug9.find((r) => r.customerId === 'c1')?.balanceUsd).toBe(100) // payment on Aug 15 doesn't count yet

    const asOfAug20 = await getCustomerAgingSnapshot('shop1', '2026-08-20')
    expect(asOfAug20.find((r) => r.customerId === 'c1')?.balanceUsd).toBe(40) // payment now counted
  })
})
```

- [ ] **Step 3: Run to verify it fails, fix any query bugs it surfaces, run again to verify it passes**

Run: `npx vitest run src/features/reports/__tests__/integration/primitives.integration.test.ts`
Expected: fails first only if Task 4's query has a real bug this integration layer catches (this is the point of this task — a mocked-db unit test cannot catch a SQL bug like a wrong comparison operator or an incorrectly bound parameter position); fix the primitive, not the test, if it fails for a real query reason. Then PASS.

- [ ] **Step 4: Write the date-boundary integration test**

```ts
// src/features/reports/__tests__/integration/dateBoundary.integration.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createReportsTestDb } from '../helpers/reportsSqliteDb'

let conn: ReturnType<typeof createReportsTestDb>
vi.mock('@/data/powersync/db', () => ({
  db: { getAll: async (sql: string, params: unknown[]) => conn.prepare(sql).all(...(params as any[])) },
}))

import { getStaffMetrics } from '../../primitives/getStaffMetrics'

describe('date-boundary semantics integration', () => {
  beforeEach(() => { conn = createReportsTestDb() })

  it('a sale timestamped just after UTC midnight, on the local calendar day, is still included', async () => {
    // 2026-08-18T00:30:00Z with SQLite's 'localtime' modifier interprets against the
    // TEST RUNNER's local timezone, not a fixed offset -- this test's purpose is only
    // to prove the query includes rows exactly at the boundary it claims to use, per
    // its own semantics, not to assert a specific timezone's behavior.
    conn.exec(`
      INSERT INTO staff (id, shop_id, name) VALUES ('st1', 'shop1', 'Ali');
      INSERT INTO sales (id, shop_id, staff_id, total_usd, created_at) VALUES ('s1', 'shop1', 'st1', 50, '2026-08-18T00:30:00Z');
    `)
    const rows = await getStaffMetrics('shop1', { from: '2026-08-18', to: '2026-08-18' })
    expect(rows.find((r) => r.staffId === 'st1')?.revenueUsd).toBe(50)
  })
})
```

- [ ] **Step 5: Run to verify the first two integration files pass**

Run: `npx vitest run src/features/reports/__tests__/integration/primitives.integration.test.ts src/features/reports/__tests__/integration/dateBoundary.integration.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the money-units integration test (Task 0 finding 3)**

```ts
// src/features/reports/__tests__/integration/moneyUnits.integration.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createReportsTestDb } from '../helpers/reportsSqliteDb'

let conn: ReturnType<typeof createReportsTestDb>
vi.mock('@/data/powersync/db', () => ({
  db: { getAll: async (sql: string, params: unknown[]) => conn.prepare(sql).all(...(params as any[])) },
}))

import { readProfitCache } from '../../primitives/readProfitCache'
import { getStaffMetrics } from '../../primitives/getStaffMetrics'

describe('money-units integration', () => {
  beforeEach(() => { conn = createReportsTestDb() })

  it('readProfitCache divides profit_cache\'s bigint-cents columns by 100', async () => {
    conn.exec(`INSERT INTO profit_cache (shop_id, day, revenue_usd, revenue_syp, cogs_usd, cogs_reversal_usd, expenses_usd, refunds_usd, discount_usd, invoice_count, return_count, costless_sale_count)
      VALUES ('shop1', '2026-08-18', 10000, 0, 4000, 0, 0, 0, 0, 1, 0, 0)`) // 10000 cents
    const result = await readProfitCache('shop1', { from: '2026-08-18', to: '2026-08-18' })
    expect(result.revenueUsd).toBe(100) // $100.00, not $10,000 and not $1.00
  })

  it('getStaffMetrics sums sales.total_usd as a plain dollar NUMERIC column -- no /100 division', async () => {
    conn.exec(`
      INSERT INTO staff (id, shop_id, name) VALUES ('st1', 'shop1', 'Ali');
      INSERT INTO sales (id, shop_id, staff_id, total_usd, created_at) VALUES ('s1', 'shop1', 'st1', 100.50, '2026-08-18T10:00:00');
    `)
    const rows = await getStaffMetrics('shop1', { from: '2026-08-18', to: '2026-08-18' })
    expect(rows.find((r) => r.staffId === 'st1')?.revenueUsd).toBe(100.5) // NOT 1.005 or 10050
  })
})
```

- [ ] **Step 7: Write the cash-reconciliation integration test (Task 0 finding 2)**

```ts
// src/features/reports/__tests__/integration/cashReconciliation.integration.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createReportsTestDb } from '../helpers/reportsSqliteDb'

let conn: ReturnType<typeof createReportsTestDb>
vi.mock('@/data/powersync/db', () => ({
  db: { getAll: async (sql: string, params: unknown[]) => conn.prepare(sql).all(...(params as any[])) },
}))

import { readShiftCashReconciliation } from '../../primitives/readShiftCashReconciliation'

describe('readShiftCashReconciliation integration', () => {
  beforeEach(() => { conn = createReportsTestDb() })

  it('extracts and sums ZReportMetrics fields out of z_report_data JSON across multiple closed shifts', async () => {
    conn.exec(`
      INSERT INTO cashier_shifts (id, shop_id, status, closed_at, z_report_data) VALUES
        ('sh1', 'shop1', 'closed', '2026-08-18T14:00:00', '${JSON.stringify({ expectedUsd: 100, actualUsd: 98, varianceUsd: -2, cashUsdSales: 80, cashExpensesUsd: 10, cashRefundsUsd: 0, cashCreditPaymentsUsd: 20, cashPayInsUsd: 0, cashPayOutsUsd: 12 })}'),
        ('sh2', 'shop1', 'closed', '2026-08-18T20:00:00', '${JSON.stringify({ expectedUsd: 50, actualUsd: 50, varianceUsd: 0, cashUsdSales: 40, cashExpensesUsd: 0, cashRefundsUsd: 5, cashCreditPaymentsUsd: 0, cashPayInsUsd: 10, cashPayOutsUsd: 0 })}')
    `)
    const result = await readShiftCashReconciliation('shop1', { from: '2026-08-18', to: '2026-08-18' })
    expect(result.expectedUsd).toBe(150)
    expect(result.varianceUsd).toBe(-2)
    expect(result.cashCreditPaymentsUsd).toBe(20)
  })

  it('an open (not-yet-closed) shift is excluded even if its z_report_data column happens to be non-null', async () => {
    conn.exec(`INSERT INTO cashier_shifts (id, shop_id, status, closed_at, z_report_data) VALUES
      ('sh3', 'shop1', 'open', NULL, NULL)`)
    const result = await readShiftCashReconciliation('shop1', { from: '2026-08-18', to: '2026-08-18' })
    expect(result.expectedUsd).toBe(0)
  })

  it('a closed shift with malformed z_report_data throws against a real query result, not just a mocked one (Task 0 P0 finding 12)', async () => {
    conn.exec(`INSERT INTO cashier_shifts (id, shop_id, status, closed_at, z_report_data) VALUES
      ('sh4', 'shop1', 'closed', '2026-08-18T12:00:00', 'not json at all')`)
    await expect(readShiftCashReconciliation('shop1', { from: '2026-08-18', to: '2026-08-18' })).rejects.toThrow(/sh4/)
  })
})
```

- [ ] **Step 8: Write the discount/returns-by-product attribution integration test**

```ts
// src/features/reports/__tests__/integration/discountAttribution.integration.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createReportsTestDb } from '../helpers/reportsSqliteDb'

let conn: ReturnType<typeof createReportsTestDb>
vi.mock('@/data/powersync/db', () => ({
  db: { getAll: async (sql: string, params: unknown[]) => conn.prepare(sql).all(...(params as any[])) },
}))

describe('discount-by-product attribution integration', () => {
  beforeEach(() => { conn = createReportsTestDb() })

  it('sums sale_line_items.discount_amount_usd per product, ranked descending -- the exact query shape Task 11/15 both use', async () => {
    conn.exec(`
      INSERT INTO products (id, shop_id, name_ar) VALUES ('p1', 'shop1', 'قلم'), ('p2', 'shop1', 'دفتر');
      INSERT INTO sales (id, shop_id, created_at) VALUES ('s1', 'shop1', '2026-08-18T10:00:00');
      INSERT INTO sale_line_items (id, sale_id, shop_id, product_id, quantity, unit_price_usd, discount_amount_usd) VALUES
        ('li1', 's1', 'shop1', 'p1', 1, 10, 5),
        ('li2', 's1', 'shop1', 'p2', 1, 20, 2),
        ('li3', 's1', 'shop1', 'p1', 1, 10, 0);
    `)
    const rows = conn.prepare(
      `SELECT sli.product_id AS productId, p.name_ar AS nameAr, SUM(COALESCE(sli.discount_amount_usd, 0)) AS discountUsd
       FROM sale_line_items sli JOIN products p ON p.id = sli.product_id JOIN sales s ON s.id = sli.sale_id
       WHERE sli.shop_id = ? AND sli.discount_amount_usd > 0 AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY sli.product_id, p.name_ar ORDER BY discountUsd DESC`,
    ).all('shop1', '2026-08-18', '2026-08-18') as { productId: string; nameAr: string; discountUsd: number }[]

    expect(rows).toHaveLength(2) // p2's zero-discount third line correctly excluded by the > 0 filter
    expect(rows[0]).toMatchObject({ productId: 'p1', discountUsd: 5 })
    expect(rows[1]).toMatchObject({ productId: 'p2', discountUsd: 2 })
  })

  // Task 0 P0 finding 10: an earlier draft of this task claimed coverage for
  // returns-by-product but only actually exercised discount-by-product --
  // the two are separate query shapes (different tables, different join
  // path) and both need real coverage.
  it('sums return_line_items.qty_returned per product (Task 12/15\'s "units returned" query shape), not return-transaction count', async () => {
    conn.exec(`
      INSERT INTO products (id, shop_id, name_ar) VALUES ('p1', 'shop1', 'قلم');
      INSERT INTO sales (id, shop_id, created_at) VALUES ('s1', 'shop1', '2026-08-10T10:00:00');
      INSERT INTO returns (id, shop_id, original_sale_id, created_at) VALUES
        ('r1', 'shop1', 's1', '2026-08-18T10:00:00'), ('r2', 'shop1', 's1', '2026-08-18T11:00:00');
      INSERT INTO return_line_items (id, return_id, product_id, qty_returned, unit_price_usd) VALUES
        ('rli1', 'r1', 'p1', 3, 10), ('rli2', 'r2', 'p1', 2, 10);
    `)
    const rows = conn.prepare(
      `SELECT rli.product_id AS productId, p.name_ar AS nameAr, SUM(rli.qty_returned) AS value
       FROM return_line_items rli JOIN products p ON p.id = rli.product_id JOIN returns r ON r.id = rli.return_id
       WHERE r.shop_id = ? AND DATE(r.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY rli.product_id, p.name_ar ORDER BY value DESC`,
    ).all('shop1', '2026-08-18', '2026-08-18') as { productId: string; value: number }[]

    // 2 return transactions, 5 total units -- proves SUM(qty_returned), not
    // COUNT(*), is what's actually being tested (the bug this finding exists
    // to catch would silently pass a COUNT(*)-based assertion of 2).
    expect(rows[0]).toMatchObject({ productId: 'p1', value: 5 })
  })
})
```

- [ ] **Step 9: Write the Top-N ranking integration test (Task 0 P0 finding 11)**

An earlier draft of Task 22 claimed `ORDER BY ... LIMIT 20` coverage "implicitly" via the discount-attribution test's 2-row ordering assertion — that's not the same risk: LIMIT's truncation behavior is only exercised when the candidate set exceeds the limit. This test seeds 25 rows and asserts exactly 20 come back, in the right order.

```ts
// (append to discountAttribution.integration.test.ts, or a new file --
// either is fine; shown here as its own describe block in the same file)
describe('top-N ranking integration (LIMIT 20 with >20 candidate rows)', () => {
  beforeEach(() => { conn = createReportsTestDb() })

  it('returns exactly 20 rows, ranked descending, when 25 products have sales -- proves LIMIT truncates correctly, not just that ORDER BY works on a small set', async () => {
    conn.exec(`INSERT INTO sales (id, shop_id, created_at) VALUES ('s1', 'shop1', '2026-08-18T10:00:00')`)
    for (let i = 0; i < 25; i++) {
      conn.exec(
        `INSERT INTO products (id, shop_id, name_ar) VALUES ('p${i}', 'shop1', 'p${i}');
         INSERT INTO sale_line_items (id, sale_id, shop_id, product_id, quantity, unit_price_usd, line_total_usd)
         VALUES ('li${i}', 's1', 'shop1', 'p${i}', 1, ${i}, ${i})`,
      )
    }
    const rows = conn.prepare(
      `SELECT sli.product_id AS productId, SUM(sli.line_total_usd) AS value
       FROM sale_line_items sli JOIN sales s ON s.id = sli.sale_id
       WHERE sli.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY sli.product_id ORDER BY value DESC LIMIT 20`,
    ).all('shop1', '2026-08-18', '2026-08-18') as { productId: string; value: number }[]

    expect(rows).toHaveLength(20) // not 25 -- LIMIT actually truncates
    expect(rows[0]).toMatchObject({ productId: 'p24', value: 24 }) // highest value first
    expect(rows[19]).toMatchObject({ productId: 'p5', value: 5 }) // the 20th-highest, not an arbitrary row
  })
})
```

- [ ] **Step 10: Run the full integration suite**

Run: `npx vitest run src/features/reports/__tests__/integration/`
Expected: PASS (all 5 integration test files — the helper isn't itself a test file).

- [ ] **Step 11: Commit**

```bash
git add src/features/reports/__tests__/helpers/reportsSqliteDb.ts src/features/reports/__tests__/integration/
git commit -m "test(WAFI-147A): add real-SQLite integration tests for primitives, money units, cash reconciliation, discount/returns attribution, and top-N ranking"
```

---

### Task 23: Full-suite verification and whole-branch review prep

**Files:** none new — verification only.

- [ ] **Step 1: Run the full client test suite and type-check**

Run: `npx vitest run && npx vue-tsc -b`
Expected: full suite passes (all Task 1-22 tests + no regression in pre-existing suites — confirm any pre-existing failures are identical to `main` via `git stash`, matching this codebase's established verification convention), no new type errors.

- [ ] **Step 2: Manually confirm no eager compute() calls**

Run: `grep -rn "REPORT_DEFINITIONS\[" src/features/reports/ReportsListPage.vue` — expected: no matches (the list page must never index into `REPORT_DEFINITIONS` to call `.compute`, only `Object.values(...)` for metadata).

- [ ] **Step 3: Manual on-device check**

Flag as an outstanding manual step (same recurring limitation as prior WAFI-1xx tickets in this codebase's history — no running dev instance in an agent sandbox): sign in as the owner, open `/reports`, confirm all 13 reports appear, open each one and confirm it generates without error against real seeded data, confirm Employee Summary is hidden for a non-`can_view_staff_performance` viewer and Weekly Summary/Monthly Health render without their staff-ranking section for that same viewer.

- [ ] **Step 4: Invoke `superpowers:requesting-code-review`**

Per this codebase's established workflow — a whole-branch review before this is considered done, same as every prior WAFI-1xx ticket.
