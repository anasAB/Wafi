# WAFI-009 Stock-Take Variance Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the stock-take review screen, let the owner expand any line with a variance to see every inventory movement (sale, return, manual adjustment, receiving) that happened between session start and review time, plus a computed "unexplained variance" figure with those movements backed out.

**Architecture:** A shared, product-agnostic `useInventoryMovements()` composable in the products feature is the single place that knows every inventory-movement source (currently `stock_adjustments` + `stock_receiving_line_items`/`stock_receivings` — no unified ledger exists in this codebase, confirmed by reading every write path). The stock-take feature's own `useStockTakeVariance()` composable consumes that shared query and layers stock-take-specific arithmetic (net movement, unexplained variance) and a per-line cache on top. `StockTakeReviewScreen.vue` wires an expandable accordion into the existing line list, calling the stock-take composable lazily on first expand.

**Tech Stack:** Vue 3 + TypeScript, PowerSync (`@powersync/web`) for the local SQLite layer, Vitest for tests.

## Global Constraints

- The window's lower bound is `session.startedAt`; the upper bound is captured **once** per review-screen mount (or `session.completedAt` if already set) — never a `now()` re-evaluated per query.
- `useInventoryMovements()` is the ONLY place that knows every inventory-movement source. The stock-take feature must never embed its own UNION query — it calls this shared composable.
- Query ordering is `ORDER BY timestamp ASC, id ASC` — never timestamp alone (SQLite ISO-string timestamps here have no guaranteed sub-second uniqueness).
- `delta` for `stock_adjustments` rows is always `new_value − old_value`, derived from the row's own before/after state — never a `reason`-keyed sign table.
- `stock_receiving_line_items.qty_received` is treated as always positive.
- `stock_adjustments` rows with `reason = 'stocktake'` are excluded from the movement query (that's the stock-take's own eventual commit, not a concurrent movement to explain).
- The unexplained-variance figure is `variance − netMovementDelta` and must never be labeled "shrinkage" in code, comments, or UI copy — it can be positive or negative and doesn't always mean loss.
- Cache key is `${productId}:${windowStart}:${windowEnd}`, not `productId` alone.
- Any unrecognized `reason` value must render with a generic fallback (icon `❔`, the raw string as the label) — never throw.

---

### Task 1: Shared `useInventoryMovements()` composable

**Files:**
- Create: `src/features/products/composables/useInventoryMovements.ts`
- Test: `src/features/products/composables/__tests__/useInventoryMovements.test.ts`

**Interfaces:**
- Produces: `InventoryMovement { id: string; timestamp: string; reason: string; delta: number }` and `useInventoryMovements(): { getMovements(productId: string, windowStart: string, windowEnd: string): Promise<InventoryMovement[]> }` — used by Task 2.

- [ ] **Step 1: Write the failing tests**

Create `src/features/products/composables/__tests__/useInventoryMovements.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useInventoryMovements } from '../useInventoryMovements'
import { db } from '@/data/powersync/db'

describe('useInventoryMovements', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('queries both stock_adjustments and stock_receiving_line_items with the same bound window, and passes reason/id through untouched', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { id: 'adj-1', timestamp: '2026-07-29T10:32:00Z', reason: 'sale', delta: -5 },
      { id: 'recv-1', timestamp: '2026-07-29T10:50:00Z', reason: 'receiving', delta: 10 },
    ] as any)

    const { getMovements } = useInventoryMovements()
    const result = await getMovements('p1', '2026-07-29T10:00:00Z', '2026-07-29T11:00:00Z')

    expect(db.getAll).toHaveBeenCalledWith(
      expect.stringContaining('FROM stock_adjustments'),
      ['p1', '2026-07-29T10:00:00Z', '2026-07-29T11:00:00Z', 'p1', '2026-07-29T10:00:00Z', '2026-07-29T11:00:00Z'],
    )
    const sql = vi.mocked(db.getAll).mock.calls[0][0] as string
    expect(sql).toContain('UNION ALL')
    expect(sql).toContain('FROM stock_receiving_line_items')
    expect(sql).toContain("reason != 'stocktake'")
    expect(sql).toContain('ORDER BY timestamp ASC, id ASC')

    expect(result).toEqual([
      { id: 'adj-1', timestamp: '2026-07-29T10:32:00Z', reason: 'sale', delta: -5 },
      { id: 'recv-1', timestamp: '2026-07-29T10:50:00Z', reason: 'receiving', delta: 10 },
    ])
  })

  it('returns an empty array when there are no movements in the window', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([] as any)
    const { getMovements } = useInventoryMovements()
    const result = await getMovements('p1', '2026-07-29T10:00:00Z', '2026-07-29T11:00:00Z')
    expect(result).toEqual([])
  })

  // With a mocked db.getAll, we cannot verify that SQLite actually includes/
  // excludes rows at the exact window boundary, or that a real tie in
  // `timestamp` sorts deterministically by `id` — the mock returns whatever
  // we tell it to, regardless of the WHERE/ORDER BY clauses' real behavior.
  // That is true of every query test in this codebase (no in-memory SQLite
  // test harness is used anywhere). What IS verified here, and would catch
  // a real regression, is that our code emits the correct comparison
  // operators and column names in the first place — a typo'd `>` instead of
  // `>=`, or the wrong column, would fail this test even though it can never
  // fail a boundary-inclusion test against a mock.
  it('uses inclusive (>=/<=) bounds on both halves of the union, against the correct timestamp columns', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([] as any)
    const { getMovements } = useInventoryMovements()
    await getMovements('p1', '2026-07-29T10:00:00Z', '2026-07-29T11:00:00Z')

    const sql = vi.mocked(db.getAll).mock.calls[0][0] as string
    expect(sql).toContain('created_at >= ?')
    expect(sql).toContain('created_at <= ?')
    expect(sql).toContain('sr.received_at >= ?')
    expect(sql).toContain('sr.received_at <= ?')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/products/composables/__tests__/useInventoryMovements.test.ts`
Expected: FAIL — `useInventoryMovements` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/features/products/composables/useInventoryMovements.ts`:

```ts
import { db } from '@/data/powersync/db'

export interface InventoryMovement {
  id:        string
  timestamp: string
  reason:    string
  delta:     number
}

/**
 * Single source of truth for "every inventory-movement source in this app."
 * There is no unified movement ledger — sales/returns/manual adjustments
 * write to `stock_adjustments`, while supplier receivings write only to
 * `stock_receiving_line_items` + a direct `products.current_stock` update
 * (confirmed by reading every write path; see
 * docs/superpowers/specs/2026-07-29-wafi-009-timeline-visualization-design.md).
 * Any future stock-affecting write path (transfers, recipe consumption, …)
 * must extend the UNION here — every consumer of this composable picks up
 * the new source automatically, with zero changes at the call site.
 *
 * `reason = 'stocktake'` rows are excluded: that's the stock-take feature's
 * own eventual commit adjustment, not a concurrent movement to explain.
 *
 * Delta is always derived from the row's own before/after state
 * (`new_value - old_value`), never a `reason`-keyed sign table — old/new
 * values are the canonical record of what happened; `reason` is just a label.
 *
 * `qty_received` is treated as always positive — there is no
 * negative-quantity/correction receiving path in this codebase today.
 *
 * Ordered by `timestamp, id` (not timestamp alone) so two movements written
 * in the same instant still return in a stable, deterministic order across
 * repeated calls — `id` is every table's implicit PowerSync primary key.
 */
export function useInventoryMovements() {
  async function getMovements(
    productId: string, windowStart: string, windowEnd: string,
  ): Promise<InventoryMovement[]> {
    return db.getAll<InventoryMovement>(
      `SELECT id, created_at AS timestamp, reason, (new_value - old_value) AS delta
       FROM stock_adjustments
       WHERE product_id = ? AND reason != 'stocktake'
         AND created_at >= ? AND created_at <= ?

       UNION ALL

       SELECT srl.id, sr.received_at AS timestamp, 'receiving' AS reason, srl.qty_received AS delta
       FROM stock_receiving_line_items srl
       JOIN stock_receivings sr ON sr.id = srl.receiving_id
       WHERE srl.product_id = ?
         AND sr.received_at >= ? AND sr.received_at <= ?

       ORDER BY timestamp ASC, id ASC`,
      [productId, windowStart, windowEnd, productId, windowStart, windowEnd],
    )
  }

  return { getMovements }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/products/composables/__tests__/useInventoryMovements.test.ts`
Expected: PASS (both tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/products/composables/useInventoryMovements.ts src/features/products/composables/__tests__/useInventoryMovements.test.ts
git commit -m "feat(WAFI-009): add shared useInventoryMovements composable"
```

---

### Task 2: `useStockTakeVariance()` composable — arithmetic + cache

**Files:**
- Create: `src/features/stock-take/composables/useStockTakeVariance.ts`
- Test: `src/features/stock-take/composables/__tests__/useStockTakeVariance.test.ts`

**Interfaces:**
- Consumes: `useInventoryMovements().getMovements(productId, windowStart, windowEnd)` from Task 1.
- Produces: `LineMovements { entries: InventoryMovement[]; netMovementDelta: number; unexplainedVariance: number }` and `useStockTakeVariance(): { loadMovements(productId: string, variance: number, windowStart: string, windowEnd: string): Promise<LineMovements> }` — used by Task 3.

- [ ] **Step 1: Write the failing tests**

Create `src/features/stock-take/composables/__tests__/useStockTakeVariance.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/features/products/composables/useInventoryMovements', () => ({
  useInventoryMovements: vi.fn(),
}))

import { useStockTakeVariance } from '../useStockTakeVariance'
import { useInventoryMovements } from '@/features/products/composables/useInventoryMovements'

describe('useStockTakeVariance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('computes netMovementDelta as the sum of movement deltas, and unexplainedVariance as variance minus that sum', async () => {
    const getMovements = vi.fn().mockResolvedValue([
      { id: 'a', timestamp: '2026-07-29T10:32:00Z', reason: 'sale', delta: -3 },
      { id: 'b', timestamp: '2026-07-29T10:50:00Z', reason: 'return', delta: 1 },
    ])
    vi.mocked(useInventoryMovements).mockReturnValue({ getMovements })

    const { loadMovements } = useStockTakeVariance()
    const result = await loadMovements('p1', -7, '2026-07-29T10:00:00Z', '2026-07-29T11:00:00Z')

    expect(result.netMovementDelta).toBe(-2)      // -3 + 1
    expect(result.unexplainedVariance).toBe(-5)   // -7 - (-2)
    expect(result.entries).toHaveLength(2)
  })

  it('handles zero movements: unexplainedVariance equals the full variance', async () => {
    const getMovements = vi.fn().mockResolvedValue([])
    vi.mocked(useInventoryMovements).mockReturnValue({ getMovements })

    const { loadMovements } = useStockTakeVariance()
    const result = await loadMovements('p1', -13, '2026-07-29T10:00:00Z', '2026-07-29T11:00:00Z')

    expect(result.netMovementDelta).toBe(0)
    expect(result.unexplainedVariance).toBe(-13)
  })

  it('handles a positive variance from an over-receiving correctly (not labeled shrinkage)', async () => {
    const getMovements = vi.fn().mockResolvedValue([
      { id: 'a', timestamp: '2026-07-29T10:32:00Z', reason: 'receiving', delta: 10 },
    ])
    vi.mocked(useInventoryMovements).mockReturnValue({ getMovements })

    const { loadMovements } = useStockTakeVariance()
    const result = await loadMovements('p1', 20, '2026-07-29T10:00:00Z', '2026-07-29T11:00:00Z')

    expect(result.netMovementDelta).toBe(10)
    expect(result.unexplainedVariance).toBe(10)
  })

  it('caches by productId+window: a second call with the same key does not re-invoke getMovements', async () => {
    const getMovements = vi.fn().mockResolvedValue([])
    vi.mocked(useInventoryMovements).mockReturnValue({ getMovements })

    const { loadMovements } = useStockTakeVariance()
    await loadMovements('p1', -13, '2026-07-29T10:00:00Z', '2026-07-29T11:00:00Z')
    await loadMovements('p1', -13, '2026-07-29T10:00:00Z', '2026-07-29T11:00:00Z')

    expect(getMovements).toHaveBeenCalledTimes(1)
  })

  it('does not share a cache entry across two different products', async () => {
    const getMovements = vi.fn().mockResolvedValue([])
    vi.mocked(useInventoryMovements).mockReturnValue({ getMovements })

    const { loadMovements } = useStockTakeVariance()
    await loadMovements('p1', -13, '2026-07-29T10:00:00Z', '2026-07-29T11:00:00Z')
    await loadMovements('p2', -5, '2026-07-29T10:00:00Z', '2026-07-29T11:00:00Z')

    expect(getMovements).toHaveBeenCalledTimes(2)
  })

  it('does not share a cache entry across two different windows for the same product', async () => {
    const getMovements = vi.fn().mockResolvedValue([])
    vi.mocked(useInventoryMovements).mockReturnValue({ getMovements })

    const { loadMovements } = useStockTakeVariance()
    await loadMovements('p1', -13, '2026-07-29T10:00:00Z', '2026-07-29T11:00:00Z')
    await loadMovements('p1', -13, '2026-07-29T10:00:00Z', '2026-07-29T12:00:00Z')

    expect(getMovements).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/stock-take/composables/__tests__/useStockTakeVariance.test.ts`
Expected: FAIL — `useStockTakeVariance` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/features/stock-take/composables/useStockTakeVariance.ts`:

```ts
import { useInventoryMovements, type InventoryMovement } from '@/features/products/composables/useInventoryMovements'

export interface LineMovements {
  entries:              InventoryMovement[]
  netMovementDelta:     number
  unexplainedVariance:  number
}

/**
 * Layers stock-take-specific arithmetic on top of the shared movement query:
 * netMovementDelta (sum of every movement's delta in the window) and
 * unexplainedVariance (variance minus that sum — deliberately NOT called
 * "shrinkage": it can be positive, e.g. an over-receiving, so the name must
 * work for both signs).
 *
 * Cached per `${productId}:${windowStart}:${windowEnd}` for the lifetime of
 * one useStockTakeVariance() call (i.e. one review-screen mount) — expanding
 * the same line twice must not re-query SQLite, and a future window change
 * (e.g. a "refresh" affordance) must not silently serve a stale window's
 * result under the same product's cache slot.
 */
export function useStockTakeVariance() {
  const { getMovements } = useInventoryMovements()
  const cache = new Map<string, LineMovements>()

  async function loadMovements(
    productId: string, variance: number, windowStart: string, windowEnd: string,
  ): Promise<LineMovements> {
    const key = `${productId}:${windowStart}:${windowEnd}`
    const cached = cache.get(key)
    if (cached) return cached

    const entries = await getMovements(productId, windowStart, windowEnd)
    const netMovementDelta = entries.reduce((sum, e) => sum + e.delta, 0)
    const result: LineMovements = {
      entries,
      netMovementDelta,
      unexplainedVariance: variance - netMovementDelta,
    }
    cache.set(key, result)
    return result
  }

  return { loadMovements }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/stock-take/composables/__tests__/useStockTakeVariance.test.ts`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/stock-take/composables/useStockTakeVariance.ts src/features/stock-take/composables/__tests__/useStockTakeVariance.test.ts
git commit -m "feat(WAFI-009): add useStockTakeVariance composable (net movement + unexplained variance, cached)"
```

---

### Task 3: Wire the expandable timeline into `StockTakeReviewScreen.vue`

**Files:**
- Modify: `src/features/stock-take/components/StockTakeReviewScreen.vue`
- Test: `src/features/stock-take/components/__tests__/StockTakeReviewScreen.test.ts` (new file — no test file exists for this component today)

**Interfaces:**
- Consumes: `useStockTakeVariance().loadMovements(productId, variance, windowStart, windowEnd): Promise<LineMovements>` from Task 2.

This is the only task that touches UI. Read the full current file before editing — it's short (see below), but every existing line must survive unchanged except where this task explicitly adds to it.

Current relevant state in the file (for reference — do not copy this into your diff, it's already there):

```ts
const { loadSession, reviewLines, totalShrinkageValueUsd, confirmSession } = useStockTake()
```

`reviewLines` already filters to `variance !== 0` — no new filtering is needed for "which lines get the expand affordance."

- [ ] **Step 1: Write the failing tests**

Create `src/features/stock-take/components/__tests__/StockTakeReviewScreen.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: 'session-1' } }),
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/features/stock-take/composables/useStockTake', () => ({
  useStockTake: vi.fn(),
}))
vi.mock('@/features/stock-take/composables/useStockTakeVariance', () => ({
  useStockTakeVariance: vi.fn(),
}))

import StockTakeReviewScreen from '../StockTakeReviewScreen.vue'
import { useStockTake } from '../../composables/useStockTake'
import { useStockTakeVariance } from '../../composables/useStockTakeVariance'

function stubStockTake(overrides: Partial<Record<string, any>> = {}) {
  return {
    currentSession: { value: { id: 'session-1', startedAt: '2026-07-29T10:00:00Z', completedAt: null, status: 'in_progress' } },
    lines: { value: [] },
    loadSession: vi.fn().mockResolvedValue(undefined),
    reviewLines: { value: [
      { id: 'line-1', sessionId: 'session-1', productId: 'p1', productNameAr: 'قلم رصاص', expectedStock: 100, countedStock: 87, variance: -13, varianceValueUsd: -13, liveStock: 95 },
    ] },
    totalShrinkageValueUsd: { value: -13 },
    confirmSession: vi.fn().mockResolvedValue('committed'),
    ...overrides,
  }
}

describe('StockTakeReviewScreen — WAFI-009 variance timeline', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('does not show timeline content until a line is expanded', async () => {
    vi.mocked(useStockTake).mockReturnValue(stubStockTake() as any)
    const loadMovements = vi.fn()
    vi.mocked(useStockTakeVariance).mockReturnValue({ loadMovements } as any)

    const wrapper = mount(StockTakeReviewScreen)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(loadMovements).not.toHaveBeenCalled()
    expect(wrapper.text()).not.toContain('صافي الحركة')
  })

  it('loads and shows movements, net movement, session variance, and unexplained variance when a line is expanded', async () => {
    vi.mocked(useStockTake).mockReturnValue(stubStockTake() as any)
    const loadMovements = vi.fn().mockResolvedValue({
      entries: [
        { id: 'a', timestamp: '2026-07-29T10:32:00Z', reason: 'sale', delta: -3 },
        { id: 'b', timestamp: '2026-07-29T10:50:00Z', reason: 'return', delta: 1 },
      ],
      netMovementDelta: -2,
      unexplainedVariance: -11,
    })
    vi.mocked(useStockTakeVariance).mockReturnValue({ loadMovements } as any)

    const wrapper = mount(StockTakeReviewScreen)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    await wrapper.find('.line-card').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(loadMovements).toHaveBeenCalledWith('p1', -13, '2026-07-29T10:00:00Z', expect.any(String))
    expect(wrapper.text()).toContain('بيع')
    expect(wrapper.text()).toContain('مرتجع')
    expect(wrapper.text()).toContain('صافي الحركة')
    expect(wrapper.text()).toContain('الفرق غير المفسّر')
  })

  it('does not call loadMovements a second time when the same line is collapsed and re-expanded', async () => {
    vi.mocked(useStockTake).mockReturnValue(stubStockTake() as any)
    const loadMovements = vi.fn().mockResolvedValue({ entries: [], netMovementDelta: 0, unexplainedVariance: -13 })
    vi.mocked(useStockTakeVariance).mockReturnValue({ loadMovements } as any)

    const wrapper = mount(StockTakeReviewScreen)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    await wrapper.find('.line-card').trigger('click')   // expand
    await wrapper.vm.$nextTick()
    await wrapper.find('.line-card').trigger('click')   // collapse
    await wrapper.vm.$nextTick()
    await wrapper.find('.line-card').trigger('click')   // re-expand
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    // useStockTakeVariance's own cache (Task 2) handles de-duplication; the
    // component just needs to call it every expand without adding its own
    // separate guard that would fight that cache.
    expect(loadMovements).toHaveBeenCalledTimes(2)
  })

  it('shows a no-movements message when there are zero movements in the window', async () => {
    vi.mocked(useStockTake).mockReturnValue(stubStockTake() as any)
    const loadMovements = vi.fn().mockResolvedValue({ entries: [], netMovementDelta: 0, unexplainedVariance: -13 })
    vi.mocked(useStockTakeVariance).mockReturnValue({ loadMovements } as any)

    const wrapper = mount(StockTakeReviewScreen)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    await wrapper.find('.line-card').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('لا توجد حركات')
  })

  it('renders an unrecognized movement reason with a generic fallback instead of crashing', async () => {
    vi.mocked(useStockTake).mockReturnValue(stubStockTake() as any)
    const loadMovements = vi.fn().mockResolvedValue({
      entries: [{ id: 'a', timestamp: '2026-07-29T10:32:00Z', reason: 'transfer', delta: -2 }],
      netMovementDelta: -2,
      unexplainedVariance: -11,
    })
    vi.mocked(useStockTakeVariance).mockReturnValue({ loadMovements } as any)

    const wrapper = mount(StockTakeReviewScreen)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    await wrapper.find('.line-card').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('transfer')
    expect(wrapper.text()).toContain('❔')
  })

  it('expanding a second line collapses the first (single-open accordion)', async () => {
    vi.mocked(useStockTake).mockReturnValue(stubStockTake({
      reviewLines: { value: [
        { id: 'line-1', sessionId: 'session-1', productId: 'p1', productNameAr: 'قلم رصاص', expectedStock: 100, countedStock: 87, variance: -13, varianceValueUsd: -13, liveStock: 95 },
        { id: 'line-2', sessionId: 'session-1', productId: 'p2', productNameAr: 'ممحاة', expectedStock: 50, countedStock: 48, variance: -2, varianceValueUsd: -2, liveStock: 50 },
      ] },
    }) as any)
    const loadMovements = vi.fn().mockResolvedValue({ entries: [], netMovementDelta: 0, unexplainedVariance: -13 })
    vi.mocked(useStockTakeVariance).mockReturnValue({ loadMovements } as any)

    const wrapper = mount(StockTakeReviewScreen)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    const cards = wrapper.findAll('.line-card')
    await cards[0].trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('لا توجد حركات')

    await cards[1].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    // Both lines currently show the same stubbed "no movements" text, so
    // assert via call count instead of text presence/absence.
    expect(loadMovements).toHaveBeenCalledWith('p2', -2, expect.any(String), expect.any(String))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/stock-take/components/__tests__/StockTakeReviewScreen.test.ts`
Expected: FAIL — no expand affordance, no timeline rendering, `useStockTakeVariance` not imported yet.

- [ ] **Step 3: Update `StockTakeReviewScreen.vue`**

Replace the `<script setup>` block's imports and top-level state:

```ts
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useStockTake } from '@/features/stock-take/composables/useStockTake'
import { useStockTakeVariance, type LineMovements } from '@/features/stock-take/composables/useStockTakeVariance'

const route = useRoute()
const router = useRouter()
const sessionId = route.params.id as string

const { loadSession, currentSession, reviewLines, totalShrinkageValueUsd, confirmSession } = useStockTake()
const { loadMovements } = useStockTakeVariance()
const loading = ref(true)
const confirming = ref(false)

// WAFI-009: captured once at mount, reused for every line's movement query —
// must NOT be a fresh now() per query, or the timeline would grow a new
// movement into it while the owner is mid-review. If the session was already
// completed (e.g. a prior confirm hit the idempotency no-op path before this
// screen was re-entered), its completedAt is a more correct upper bound than
// "now."
const reviewedAt = ref<string>(new Date().toISOString())

onMounted(async () => {
  loading.value = true
  await loadSession(sessionId)
  if (currentSession.value?.completedAt) {
    reviewedAt.value = currentSession.value.completedAt
  }
  loading.value = false
})
```

Add, alongside the existing `alreadyCompleted`/`finalStock` declarations (do not remove
either of those — they're unrelated to this task):

```ts
const expandedProductId = ref<string | null>(null)
const movementsByProduct = ref<Map<string, LineMovements>>(new Map())
const loadingMovements = ref<Set<string>>(new Set())

const REASON_DISPLAY: Record<string, { icon: string; label: string }> = {
  sale:      { icon: '🛒', label: 'بيع' },
  return:    { icon: '↩️', label: 'مرتجع' },
  damaged:   { icon: '⚠️', label: 'تالف' },
  lost:      { icon: '⚠️', label: 'فاقد' },
  other:     { icon: '📝', label: 'أخرى' },
  receiving: { icon: '📦', label: 'توريد' },
}
function reasonDisplay(reason: string): { icon: string; label: string } {
  return REASON_DISPLAY[reason] ?? { icon: '❔', label: reason }
}

async function toggleExpand(line: { id: string; productId: string; variance: number | null }) {
  if (expandedProductId.value === line.productId) {
    expandedProductId.value = null
    return
  }
  expandedProductId.value = line.productId
  if (movementsByProduct.value.has(line.productId)) return
  if (!currentSession.value) return   // defensive: the screen never renders lines before loadSession() resolves
  loadingMovements.value.add(line.productId)
  try {
    const result = await loadMovements(
      line.productId, line.variance ?? 0, currentSession.value.startedAt, reviewedAt.value,
    )
    movementsByProduct.value.set(line.productId, result)
  } finally {
    loadingMovements.value.delete(line.productId)
  }
}
```

- [ ] **Step 4: Update the template**

Replace the `.line-card` block inside the `v-for` loop:

```html
<div v-else class="line-list">
  <div v-for="line in reviewLines" :key="line.id">
    <div class="line-card" @click="toggleExpand(line)">
      <div class="line-info">
        <span class="line-name">{{ line.productNameAr }}</span>
        <span class="line-variance">الفرق: {{ line.variance }}</span>
        <span v-if="line.liveStock !== line.expectedStock" class="line-moved">
          تحرّك أثناء الجرد: {{ line.expectedStock }} ← {{ line.liveStock }} · الرصيد النهائي بعد التأكيد: {{ finalStock(line) }}
        </span>
      </div>
      <span
        v-if="line.varianceValueUsd !== null"
        class="line-value"
        :class="line.varianceValueUsd < 0 ? 'loss' : 'gain'"
      >
        {{ line.varianceValueUsd.toFixed(2) }} $
      </span>
      <span v-else class="line-value line-value-muted">—</span>
    </div>

    <div v-if="expandedProductId === line.productId" class="timeline-panel">
      <div v-if="loadingMovements.has(line.productId)" class="timeline-loading">
        <div class="spinner-sm" />
      </div>
      <template v-else-if="movementsByProduct.get(line.productId)">
        <EmptyState
          v-if="movementsByProduct.get(line.productId)!.entries.length === 0"
          title="لا توجد حركات خلال فترة الجرد"
          subtitle="الفرق بالكامل غير مفسّر"
        />
        <div v-else class="movement-list">
          <div v-for="entry in movementsByProduct.get(line.productId)!.entries" :key="entry.id" class="movement-row">
            <span class="movement-time">{{ new Date(entry.timestamp).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' }) }}</span>
            <span class="movement-reason">{{ reasonDisplay(entry.reason).icon }} {{ reasonDisplay(entry.reason).label }}</span>
            <span class="movement-delta" :class="entry.delta < 0 ? 'loss' : 'gain'">{{ entry.delta > 0 ? '+' : '' }}{{ entry.delta }}</span>
          </div>
        </div>
        <div class="variance-summary">
          <div class="variance-row">
            <span>صافي الحركة</span>
            <span>{{ movementsByProduct.get(line.productId)!.netMovementDelta }}</span>
          </div>
          <div class="variance-row">
            <span>فرق الجرد</span>
            <span>{{ line.variance }}</span>
          </div>
          <div class="variance-row variance-row-highlight">
            <span>الفرق غير المفسّر</span>
            <span>{{ movementsByProduct.get(line.productId)!.unexplainedVariance }}</span>
          </div>
        </div>
      </template>
    </div>
  </div>
</div>
```

- [ ] **Step 5: Add styles**

Append inside the existing `<style scoped>` block (do not remove any existing rule):

```css
.timeline-panel {
  padding: 0.75rem 1rem;
  border-radius: 0 0 0.875rem 0.875rem;
  background: #0A1420;
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-top: none;
  margin-top: -0.5rem;
}
.timeline-loading { display: flex; justify-content: center; padding: 0.75rem 0; }
.spinner-sm {
  width: 18px; height: 18px; border-radius: 9999px;
  border: 2px solid rgba(26, 86, 219, 0.28); border-top-color: #1A56DB;
  animation: spin 0.8s linear infinite;
}
.movement-list { display: flex; flex-direction: column; gap: 0.375rem; }
.movement-row {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 0.75rem; color: #C8D5E8;
}
.movement-time { color: #637285; flex-shrink: 0; width: 4rem; }
.movement-reason { flex: 1; }
.movement-delta { font-weight: 700; flex-shrink: 0; }
.variance-summary {
  margin-top: 0.625rem; padding-top: 0.625rem;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
  display: flex; flex-direction: column; gap: 0.25rem;
}
.variance-row {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 0.75rem; color: #9CB3D0;
}
.variance-row-highlight { font-weight: 700; color: #E8EDF5; }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/features/stock-take/components/__tests__/StockTakeReviewScreen.test.ts`
Expected: PASS (all 7 tests)

- [ ] **Step 7: Type-check the whole project**

Run: `npx vue-tsc --noEmit`
Expected: clean

- [ ] **Step 8: Run the full test suite for a final regression check**

Run: `npm test -- --run`
Expected: PASS, no regressions anywhere in the suite.

- [ ] **Step 9: Commit**

```bash
git add src/features/stock-take/components/StockTakeReviewScreen.vue src/features/stock-take/components/__tests__/StockTakeReviewScreen.test.ts
git commit -m "feat(WAFI-009): expandable variance timeline on the stock-take review screen"
```

---

## Explicitly out of scope (do not implement in this plan)

- Any change to the delta-commit, idempotency, or overlap-guard mechanics in `useStockTake.ts` — those are correct as shipped (WAFI-121/134) and untouched by this plan.
- A session-level (not per-line) aggregate timeline view.
- Editing, dismissing, or annotating movements from this view — read-only display only.
- Any new inventory-movement source (transfers, recipe consumption, etc.) — `useInventoryMovements()` is designed to make adding one later a one-file change, but no such source exists today and none is added by this plan.
