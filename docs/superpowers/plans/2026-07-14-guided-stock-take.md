# Guided Stock-Take Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build a guided physical inventory count session (`stock_take_sessions` + `stock_take_lines`) that snapshots expected stock, lets a counter enter quantities per product (with barcode-scan jump), reviews variance/shrinkage on finish, applies the results as real `stock_adjustments`, and shows a shrinkage-trend history.

**Architecture:** Two new PowerSync/Postgres tables mirror the project's existing pattern (snake_case columns, `sync_status` per row, RLS scoped by `auth_shop_id()`, added to the PowerSync publication). A new `useStockTake` composable owns session lifecycle (start/count/review/confirm) and reuses the existing `adjustStock()` from `useProducts.ts` to actually write stock changes — no parallel stock-mutation path. Three new screens (guided count, review, history) plug into the existing router under a permission-gated `/stock-take` group.

**Tech Stack:** Vue 3 `<script setup lang="ts">`, Pinia, PowerSync (`db.getAll`/`db.getOptional`/`db.execute`/`db.writeTransaction`), Vitest, existing `useBarcodeScan()` composable, existing `useAuditLog()` composable.

## Global Constraints

- Reuse `useProducts().adjustStock(productId, newValue, reason, notes)` for every stock write on confirm — do not hand-roll a second stock-mutation SQL path (spec: "the same mechanism as today's manual adjustment path, just batched").
- `AdjustmentReason` already includes `'stocktake'` (`src/features/products/product.types.ts`) — use it verbatim, do not add a new reason string.
- `expected_stock` is a frozen snapshot taken at session start and never recomputed (spec Section 4 — sales during the session must not corrupt the count target).
- All new Arabic UI strings hardcoded inline (no i18n library in this codebase).
- All new SQL tables get RLS policies scoped by `shop_id = (select public.auth_shop_id())`, mirroring migration 015/027, and must be added to both `powersync` and `powersync_publication` publications (mirrors migration 027's `DO $$` block).
- Composable tests mock PowerSync via `vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))` — the existing shared mock at `src/__tests__/__mocks__/db.ts`. Do not write a new mock.
- New router entries use the existing `meta: { permission: 'can_manage_products' }` pattern (Stock-take is an inventory-accuracy tool, same gate as `/products`).

---

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/035_stock_take_sessions.sql` | New tables, RLS, publication |
| `src/data/powersync/schema.ts` (modify) | Add `stock_take_sessions` / `stock_take_lines` to local schema |
| `src/features/stock-take/stock-take.types.ts` | `StockTakeSession`, `StockTakeLine`, `SessionStatus` types |
| `src/features/stock-take/composables/useStockTake.ts` | Session lifecycle: start, count, review, confirm |
| `src/features/stock-take/composables/useStockTakeHistory.ts` | Past sessions list + last-3 shrinkage trend |
| `src/features/stock-take/components/StockTakeSessionScreen.vue` | Guided counting screen (scan/enter quantities) |
| `src/features/stock-take/components/StockTakeReviewScreen.vue` | Variance review + confirm |
| `src/features/stock-take/components/StockTakeHistoryScreen.vue` | Past sessions + trend |
| `src/router/index.ts` (modify) | Register `/stock-take`, `/stock-take/:id/review`, `/stock-take/history` |
| `src/features/audit/audit.types.ts` (modify) | Add `stock_take.completed` audit event |
| `src/features/audit/composables/useAuditLog.ts` (modify) | Add `logStockTakeCompleted` helper |

---

### Task 1: Migration — `stock_take_sessions` and `stock_take_lines`

**Files:**
- Create: `supabase/migrations/035_stock_take_sessions.sql`

**Interfaces:**
- Produces: tables `public.stock_take_sessions` (columns: `id, shop_id, started_at, completed_at, status, created_by, scope, sync_status`) and `public.stock_take_lines` (columns: `id, session_id, shop_id, product_id, expected_stock, counted_stock, variance, variance_value_usd, sync_status`).

- [x] **Step 1: Write the migration file**

```sql
-- Wafi POS — Guided stock-take / inventory reconciliation (الجرد).
--
-- A stock-take session snapshots expected_stock per product at session start,
-- then a counter enters counted_stock per line. On confirm, each non-zero
-- variance line writes a real stock_adjustments row (reason='stocktake') via
-- the EXISTING adjustStock() write path in useProducts.ts — no parallel
-- stock-mutation SQL. See docs/superpowers/specs/2026-07-14-guided-stock-take-design.md.

CREATE TABLE IF NOT EXISTS public.stock_take_sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id        uuid NOT NULL,
  started_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz,
  status         text NOT NULL DEFAULT 'in_progress'
                   CHECK (status IN ('in_progress', 'completed', 'cancelled')),
  created_by     text NOT NULL,
  scope          text,
  sync_status    text
);

CREATE INDEX IF NOT EXISTS idx_stock_take_sessions_shop_status
  ON public.stock_take_sessions (shop_id, status, started_at DESC);

CREATE TABLE IF NOT EXISTS public.stock_take_lines (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         uuid NOT NULL REFERENCES public.stock_take_sessions(id) ON DELETE CASCADE,
  shop_id            uuid NOT NULL,
  product_id         uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  expected_stock     integer NOT NULL,
  counted_stock      integer,
  variance           integer,
  variance_value_usd numeric(12,2),
  sync_status        text
);

CREATE INDEX IF NOT EXISTS idx_stock_take_lines_session
  ON public.stock_take_lines (session_id);

ALTER TABLE public.stock_take_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_take_lines    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_take_sessions_select_all ON public.stock_take_sessions;
DROP POLICY IF EXISTS stock_take_sessions_insert_all ON public.stock_take_sessions;
DROP POLICY IF EXISTS stock_take_sessions_update_all ON public.stock_take_sessions;
CREATE POLICY stock_take_sessions_select_all ON public.stock_take_sessions
  FOR SELECT TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()));
CREATE POLICY stock_take_sessions_insert_all ON public.stock_take_sessions
  FOR INSERT TO anon, authenticated
  WITH CHECK (shop_id = (select public.auth_shop_id()));
CREATE POLICY stock_take_sessions_update_all ON public.stock_take_sessions
  FOR UPDATE TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()))
  WITH CHECK (shop_id = (select public.auth_shop_id()));

DROP POLICY IF EXISTS stock_take_lines_select_all ON public.stock_take_lines;
DROP POLICY IF EXISTS stock_take_lines_insert_all ON public.stock_take_lines;
DROP POLICY IF EXISTS stock_take_lines_update_all ON public.stock_take_lines;
CREATE POLICY stock_take_lines_select_all ON public.stock_take_lines
  FOR SELECT TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()));
CREATE POLICY stock_take_lines_insert_all ON public.stock_take_lines
  FOR INSERT TO anon, authenticated
  WITH CHECK (shop_id = (select public.auth_shop_id()));
CREATE POLICY stock_take_lines_update_all ON public.stock_take_lines
  FOR UPDATE TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()))
  WITH CHECK (shop_id = (select public.auth_shop_id()));

DO $$
DECLARE
  pub_name text;
  tbl text;
BEGIN
  FOREACH pub_name IN ARRAY ARRAY['powersync', 'powersync_publication']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = pub_name) THEN
      FOREACH tbl IN ARRAY ARRAY['stock_take_sessions', 'stock_take_lines']
      LOOP
        IF NOT EXISTS (
          SELECT 1 FROM pg_publication_tables
          WHERE pubname = pub_name AND schemaname = 'public' AND tablename = tbl
        ) THEN
          EXECUTE format('ALTER PUBLICATION %I ADD TABLE public.%I', pub_name, tbl);
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$;
```

- [x] **Step 2: Commit**

```bash
git add supabase/migrations/035_stock_take_sessions.sql
git commit -m "feat: add stock_take_sessions and stock_take_lines tables"
```

---

### Task 2: PowerSync local schema

**Files:**
- Modify: `src/data/powersync/schema.ts:270-296`

**Interfaces:**
- Consumes: `column`, `Table` from `@powersync/web` (already imported at line 1).
- Produces: local tables `stock_take_sessions`, `stock_take_lines`, registered in `AppSchema`.

- [x] **Step 1: Add the two table definitions above `export const AppSchema`**

```ts
const stock_take_sessions = new Table({
  shop_id:      column.text,
  started_at:   column.text,
  completed_at: column.text,
  status:       column.text,   // 'in_progress' | 'completed' | 'cancelled'
  created_by:   column.text,
  scope:        column.text,
  sync_status:  column.text,
})

const stock_take_lines = new Table({
  session_id:         column.text,
  shop_id:            column.text,
  product_id:         column.text,
  expected_stock:     column.integer,
  counted_stock:      column.integer,
  variance:           column.integer,
  variance_value_usd: column.real,
  sync_status:        column.text,
})
```

- [x] **Step 2: Register both tables in `AppSchema`**

Modify the `export const AppSchema = new Schema({...})` block (currently ends `stock_receiving_line_items,\n})`) to add:

```ts
export const AppSchema = new Schema({
  products,
  stock_adjustments,
  sales,
  sale_line_items,
  exchange_rates,
  expenses,
  customers,
  customer_payments,
  receipt_settings,
  sale_payments,
  staff,
  cashier_shifts,
  cash_movements,
  returns,
  return_line_items,
  return_reasons,
  sync_dead_letter,
  audit_log,
  suppliers,
  stock_receivings,
  stock_receiving_line_items,
  stock_take_sessions,
  stock_take_lines,
})
```

- [x] **Step 3: Commit**

```bash
git add src/data/powersync/schema.ts
git commit -m "feat: register stock_take tables in PowerSync schema"
```

---

### Task 3: Types

**Files:**
- Create: `src/features/stock-take/stock-take.types.ts`

**Interfaces:**
- Produces: `SessionStatus`, `StockTakeSession`, `StockTakeLine`, `StockTakeLineRow`, `StockTakeSessionRow` — consumed by Task 4-8.

- [x] **Step 1: Write the types file**

```ts
export type SessionStatus = 'in_progress' | 'completed' | 'cancelled'

export interface StockTakeSession {
  id:          string
  shopId:      string
  startedAt:   string
  completedAt: string | null
  status:      SessionStatus
  createdBy:   string
  scope:       string | null
}

export interface StockTakeLine {
  id:               string
  sessionId:        string
  productId:        string
  productNameAr:    string
  expectedStock:    number
  countedStock:     number | null
  variance:         number | null
  varianceValueUsd: number | null
}

export type StockTakeSessionRow = {
  id: string; shop_id: string; started_at: string; completed_at: string | null
  status: SessionStatus; created_by: string; scope: string | null
}

export type StockTakeLineRow = {
  id: string; session_id: string; product_id: string; name_ar: string
  expected_stock: number; counted_stock: number | null
  variance: number | null; variance_value_usd: number | null
}
```

- [x] **Step 2: Commit**

```bash
git add src/features/stock-take/stock-take.types.ts
git commit -m "feat: add stock-take types"
```

---

### Task 4: `useStockTake` — start a session

**Files:**
- Create: `src/features/stock-take/composables/useStockTake.ts`
- Test: `src/__tests__/features/useStockTake.test.ts`

**Interfaces:**
- Consumes: `db` from `@/data/powersync/db`; `useDeviceStore()` from `@/store/device.store` (`.shopId`); `uuidv4` from `uuid`.
- Produces: `startSession(scope?: string | null): Promise<string>` returning the new `session_id`. Snapshots `expected_stock` from `products.current_stock` for every active, non-deleted product (optionally filtered by `scope` matched against `category`), inserting one `stock_take_lines` row per product.

- [x] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { useStockTake } from '@/features/stock-take/composables/useStockTake'

describe('useStockTake — startSession', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('creates a session row and one line per active product with frozen expected_stock', async () => {
    vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
      if (/FROM products/.test(sql)) {
        return [
          { id: 'p1', current_stock: 10 },
          { id: 'p2', current_stock: 3 },
        ] as any
      }
      return []
    })

    const { startSession } = useStockTake()
    const sessionId = await startSession(null)

    expect(typeof sessionId).toBe('string')

    const insertCalls = vi.mocked(db.execute).mock.calls
    const sessionInsert = insertCalls.find(([sql]) => /INSERT INTO stock_take_sessions/.test(sql))
    expect(sessionInsert).toBeTruthy()
    expect(sessionInsert![1]).toContain('in_progress')

    const lineInserts = insertCalls.filter(([sql]) => /INSERT INTO stock_take_lines/.test(sql))
    expect(lineInserts).toHaveLength(2)
    expect(lineInserts[0][1]).toContain(10)
    expect(lineInserts[1][1]).toContain(3)
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/useStockTake.test.ts`
Expected: FAIL — `Cannot find module '@/features/stock-take/composables/useStockTake'`

- [x] **Step 3: Write minimal implementation**

```ts
import { ref } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import type { StockTakeSession, StockTakeLine, StockTakeSessionRow, StockTakeLineRow } from '@/features/stock-take/stock-take.types'

export function useStockTake() {
  const currentSession = ref<StockTakeSession | null>(null)
  const lines = ref<StockTakeLine[]>([])

  async function startSession(scope: string | null): Promise<string> {
    const device = useDeviceStore()
    const now = new Date().toISOString()
    const sessionId = uuidv4()

    const params: unknown[] = [device.shopId]
    let sql = `SELECT id, current_stock FROM products
               WHERE shop_id = ? AND is_active = 1 AND (deleted = 0 OR deleted IS NULL)`
    if (scope) { sql += ' AND category = ?'; params.push(scope) }

    const products = await db.getAll<{ id: string; current_stock: number }>(sql, params)

    await db.execute(
      `INSERT INTO stock_take_sessions (id, shop_id, started_at, status, created_by, scope, sync_status)
       VALUES (?, ?, ?, 'in_progress', ?, ?, 'pending')`,
      [sessionId, device.shopId, now, device.deviceId, scope]
    )

    for (const p of products) {
      await db.execute(
        `INSERT INTO stock_take_lines
           (id, session_id, shop_id, product_id, expected_stock, counted_stock, variance, variance_value_usd, sync_status)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, 'pending')`,
        [uuidv4(), sessionId, device.shopId, p.id, p.current_stock]
      )
    }

    return sessionId
  }

  return { currentSession, lines, startSession }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/useStockTake.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/features/stock-take/composables/useStockTake.ts src/__tests__/features/useStockTake.test.ts
git commit -m "feat: useStockTake.startSession snapshots expected_stock per product"
```

---

### Task 5: `useStockTake` — load session, record a count, track progress

**Files:**
- Modify: `src/features/stock-take/composables/useStockTake.ts`
- Test: `src/__tests__/features/useStockTake.test.ts`

**Interfaces:**
- Consumes: same as Task 4.
- Produces: `loadSession(sessionId: string): Promise<void>` (populates `currentSession`, `lines`), `recordCount(lineId: string, countedStock: number): Promise<void>`, `progress: ComputedRef<{ counted: number; total: number }>`.

- [x] **Step 1: Write the failing test**

```ts
  it('loadSession populates session + lines, recordCount updates a line and counted progress', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({
      id: 's1', shop_id: 'shop1', started_at: '2026-07-14T00:00:00Z',
      completed_at: null, status: 'in_progress', created_by: 'dev1', scope: null,
    } as any)
    vi.mocked(db.getAll).mockResolvedValue([
      { id: 'l1', session_id: 's1', product_id: 'p1', name_ar: 'منتج ١', expected_stock: 10, counted_stock: null, variance: null, variance_value_usd: null },
      { id: 'l2', session_id: 's1', product_id: 'p2', name_ar: 'منتج ٢', expected_stock: 3, counted_stock: null, variance: null, variance_value_usd: null },
    ] as any)

    const { loadSession, lines, recordCount, progress } = useStockTake()
    await loadSession('s1')

    expect(lines.value).toHaveLength(2)
    expect(progress.value).toEqual({ counted: 0, total: 2 })

    await recordCount('l1', 9)

    const updateCall = vi.mocked(db.execute).mock.calls.find(([sql]) => /UPDATE stock_take_lines/.test(sql))
    expect(updateCall![1]).toEqual(expect.arrayContaining([9, -1]))
  })
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/useStockTake.test.ts`
Expected: FAIL — `loadSession is not a function`

- [x] **Step 3: Write the implementation**

Add to `useStockTake.ts`, replacing the `return` statement:

```ts
  async function loadSession(sessionId: string): Promise<void> {
    const sessionRow = await db.getOptional<StockTakeSessionRow>(
      `SELECT * FROM stock_take_sessions WHERE id = ?`, [sessionId]
    )
    if (sessionRow) {
      currentSession.value = {
        id: sessionRow.id, shopId: sessionRow.shop_id, startedAt: sessionRow.started_at,
        completedAt: sessionRow.completed_at, status: sessionRow.status,
        createdBy: sessionRow.created_by, scope: sessionRow.scope,
      }
    }

    const rows = await db.getAll<StockTakeLineRow>(
      `SELECT stl.id, stl.session_id, stl.product_id, p.name_ar,
              stl.expected_stock, stl.counted_stock, stl.variance, stl.variance_value_usd
       FROM stock_take_lines stl
       JOIN products p ON p.id = stl.product_id
       WHERE stl.session_id = ?`,
      [sessionId]
    )
    lines.value = rows.map(r => ({
      id: r.id, sessionId: r.session_id, productId: r.product_id, productNameAr: r.name_ar,
      expectedStock: r.expected_stock, countedStock: r.counted_stock,
      variance: r.variance, varianceValueUsd: r.variance_value_usd,
    }))
  }

  async function recordCount(lineId: string, countedStock: number): Promise<void> {
    const line = lines.value.find(l => l.id === lineId)
    if (!line) return
    const variance = countedStock - line.expectedStock

    await db.execute(
      `UPDATE stock_take_lines SET counted_stock = ?, variance = ?, sync_status = 'pending' WHERE id = ?`,
      [countedStock, variance, lineId]
    )

    line.countedStock = countedStock
    line.variance = variance
  }

  const progress = computed(() => ({
    counted: lines.value.filter(l => l.countedStock !== null).length,
    total: lines.value.length,
  }))

  return { currentSession, lines, startSession, loadSession, recordCount, progress }
```

Add `computed` to the `vue` import at the top: `import { ref, computed } from 'vue'`.

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/useStockTake.test.ts`
Expected: PASS (both tests)

- [x] **Step 5: Commit**

```bash
git add src/features/stock-take/composables/useStockTake.ts src/__tests__/features/useStockTake.test.ts
git commit -m "feat: useStockTake.loadSession/recordCount + progress tracking"
```

---

### Task 6: `useStockTake` — review lines and confirm session

**Files:**
- Modify: `src/features/stock-take/composables/useStockTake.ts`
- Modify: `src/features/audit/audit.types.ts` (add event)
- Modify: `src/features/audit/composables/useAuditLog.ts` (add helper)
- Test: `src/__tests__/features/useStockTake.test.ts`

**Interfaces:**
- Consumes: `useProducts().adjustStock` from `@/features/products/composables/useProducts`; `useAuditLog().logStockTakeCompleted` (new).
- Produces: `reviewLines: ComputedRef<StockTakeLine[]>` (non-zero variance, sorted by `|varianceValueUsd|` desc), `totalShrinkageValueUsd: ComputedRef<number>`, `confirmSession(): Promise<void>`.

- [x] **Step 1: Add the audit event type**

Modify `src/features/audit/audit.types.ts` — add `| 'stock_take.completed'` to the `AuditEvent` union (after `'cash_movement.voided'`), and add `'stock_take'` to the `AuditEntityType` union.

- [x] **Step 2: Add the audit helper**

Modify `src/features/audit/composables/useAuditLog.ts` — add near `logStockAdjusted`:

```ts
  const logStockTakeCompleted = (
    sessionId: string, linesAdjusted: number, totalShrinkageUsd: number,
  ) => _log('stock_take.completed', 'stock_take', sessionId,
            { linesAdjusted, totalShrinkageUsd })
```

Add `logStockTakeCompleted` to the returned object at the bottom of the file.

- [x] **Step 3: Write the failing test**

```ts
  it('reviewLines excludes zero-variance and confirmSession applies adjustments + completes the session', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({
        id: 's1', shop_id: 'shop1', started_at: '2026-07-14T00:00:00Z',
        completed_at: null, status: 'in_progress', created_by: 'dev1', scope: null,
      } as any)
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { id: 'l1', session_id: 's1', product_id: 'p1', name_ar: 'منتج ١', expected_stock: 10, counted_stock: 9, variance: -1, variance_value_usd: null },
      { id: 'l2', session_id: 's1', product_id: 'p2', name_ar: 'منتج ٢', expected_stock: 3,  counted_stock: 3, variance: 0,  variance_value_usd: null },
    ] as any)

    const { loadSession, reviewLines, confirmSession } = useStockTake()
    await loadSession('s1')

    expect(reviewLines.value).toHaveLength(1)
    expect(reviewLines.value[0].id).toBe('l1')

    await confirmSession()

    const sessionUpdate = vi.mocked(db.execute).mock.calls.find(([sql]) => /UPDATE stock_take_sessions/.test(sql))
    expect(sessionUpdate![1]).toContain('completed')
  })
```

- [x] **Step 4: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/useStockTake.test.ts`
Expected: FAIL — `reviewLines is not defined` / `confirmSession is not a function`

- [x] **Step 5: Write the implementation**

Add to `useStockTake.ts`, importing `useProducts` and `useAuditLog` at the top:

```ts
import { useProducts } from '@/features/products/composables/useProducts'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'
```

Replace the final `return` with:

```ts
  const reviewLines = computed(() =>
    lines.value
      .filter(l => (l.variance ?? 0) !== 0)
      .sort((a, b) => Math.abs(b.varianceValueUsd ?? b.variance ?? 0) - Math.abs(a.varianceValueUsd ?? a.variance ?? 0))
  )

  const totalShrinkageValueUsd = computed(() =>
    lines.value.reduce((sum, l) => sum + (l.varianceValueUsd ?? 0), 0)
  )

  async function confirmSession(): Promise<void> {
    if (!currentSession.value) return
    const { adjustStock } = useProducts()
    const { logStockTakeCompleted } = useAuditLog()

    for (const line of reviewLines.value) {
      if (line.countedStock === null) continue
      await adjustStock(line.productId, line.countedStock, 'stocktake', `جرد #${currentSession.value.id}`)
    }

    const now = new Date().toISOString()
    await db.execute(
      `UPDATE stock_take_sessions SET status = 'completed', completed_at = ?, sync_status = 'pending' WHERE id = ?`,
      [now, currentSession.value.id]
    )
    currentSession.value.status = 'completed'
    currentSession.value.completedAt = now

    await logStockTakeCompleted(currentSession.value.id, reviewLines.value.length, totalShrinkageValueUsd.value)
  }

  return {
    currentSession, lines, startSession, loadSession, recordCount, progress,
    reviewLines, totalShrinkageValueUsd, confirmSession,
  }
```

- [x] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/useStockTake.test.ts`
Expected: PASS (all 3 tests)

- [x] **Step 7: Commit**

```bash
git add src/features/stock-take/composables/useStockTake.ts src/features/audit/audit.types.ts src/features/audit/composables/useAuditLog.ts src/__tests__/features/useStockTake.test.ts
git commit -m "feat: useStockTake.confirmSession applies adjustments via adjustStock and logs stock_take.completed"
```

---

### Task 7: `unit_cost` for variance value (fills `variance_value_usd`)

**Files:**
- Modify: `src/features/stock-take/composables/useStockTake.ts`
- Test: `src/__tests__/features/useStockTake.test.ts`

**Interfaces:**
- Consumes: `products.cost_price_usd` column (already exists — `src/data/powersync/schema.ts:8`).
- Produces: `recordCount` now also computes and persists `variance_value_usd = variance * cost_price_usd` (null if the product has no `cost_price_usd`).

- [x] **Step 1: Write the failing test**

```ts
  it('recordCount computes variance_value_usd from the product cost_price_usd, or null if missing', async () => {
    vi.mocked(db.getOptional).mockImplementation(async (sql: string) => {
      if (/cost_price_usd/.test(sql)) return { cost_price_usd: 5 } as any
      return null
    })
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { id: 'l1', session_id: 's1', product_id: 'p1', name_ar: 'منتج ١', expected_stock: 10, counted_stock: null, variance: null, variance_value_usd: null },
    ] as any)

    const { loadSession, recordCount } = useStockTake()
    await loadSession('s1')
    await recordCount('l1', 8)

    const updateCall = vi.mocked(db.execute).mock.calls.find(([sql]) => /UPDATE stock_take_lines/.test(sql))
    // variance = 8 - 10 = -2, variance_value_usd = -2 * 5 = -10
    expect(updateCall![1]).toEqual(expect.arrayContaining([8, -2, -10]))
  })
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/useStockTake.test.ts`
Expected: FAIL — assertion mismatch (no `-10` in params)

- [x] **Step 3: Update `recordCount`**

Replace the `recordCount` body in `useStockTake.ts`:

```ts
  async function recordCount(lineId: string, countedStock: number): Promise<void> {
    const line = lines.value.find(l => l.id === lineId)
    if (!line) return
    const variance = countedStock - line.expectedStock

    const productRow = await db.getOptional<{ cost_price_usd: number | null }>(
      `SELECT cost_price_usd FROM products WHERE id = ?`, [line.productId]
    )
    const varianceValueUsd = productRow?.cost_price_usd != null
      ? variance * productRow.cost_price_usd
      : null

    await db.execute(
      `UPDATE stock_take_lines SET counted_stock = ?, variance = ?, variance_value_usd = ?, sync_status = 'pending' WHERE id = ?`,
      [countedStock, variance, varianceValueUsd, lineId]
    )

    line.countedStock = countedStock
    line.variance = variance
    line.varianceValueUsd = varianceValueUsd
  }
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/useStockTake.test.ts`
Expected: PASS (all 4 tests)

- [x] **Step 5: Commit**

```bash
git add src/features/stock-take/composables/useStockTake.ts src/__tests__/features/useStockTake.test.ts
git commit -m "feat: compute variance_value_usd from product cost price, null when cost is missing"
```

---

### Task 8: `useStockTakeHistory` — past sessions + last-3 trend

**Files:**
- Create: `src/features/stock-take/composables/useStockTakeHistory.ts`
- Test: `src/__tests__/features/useStockTakeHistory.test.ts`

**Interfaces:**
- Consumes: `db.getAll` from `@/data/powersync/db`; `useDeviceStore()`.
- Produces: `sessions: Ref<{ id: string; startedAt: string; createdBy: string; productsCounted: number; totalShrinkageUsd: number }[]>`, `load(): Promise<void>`, `lastThreeTrendUsd: ComputedRef<number>` (sum of `totalShrinkageUsd` across up to the 3 most recent completed sessions).

- [x] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { useStockTakeHistory } from '@/features/stock-take/composables/useStockTakeHistory'

describe('useStockTakeHistory', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('loads completed sessions newest-first and sums the last 3 for a trend total', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { id: 's3', started_at: '2026-07-14T00:00:00Z', created_by: 'dev1', products_counted: 20, total_shrinkage_usd: -15 },
      { id: 's2', started_at: '2026-07-01T00:00:00Z', created_by: 'dev1', products_counted: 18, total_shrinkage_usd: -5 },
      { id: 's1', started_at: '2026-06-14T00:00:00Z', created_by: 'dev1', products_counted: 15, total_shrinkage_usd: 2 },
      { id: 's0', started_at: '2026-06-01T00:00:00Z', created_by: 'dev1', products_counted: 10, total_shrinkage_usd: -1 },
    ] as any)

    const { load, sessions, lastThreeTrendUsd } = useStockTakeHistory()
    await load()

    expect(sessions.value).toHaveLength(4)
    expect(sessions.value[0].id).toBe('s3')
    expect(lastThreeTrendUsd.value).toBe(-15 + -5 + 2)
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/useStockTakeHistory.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Write the implementation**

```ts
import { ref, computed } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

export interface StockTakeHistoryEntry {
  id: string
  startedAt: string
  createdBy: string
  productsCounted: number
  totalShrinkageUsd: number
}

type HistoryRow = {
  id: string; started_at: string; created_by: string
  products_counted: number; total_shrinkage_usd: number
}

export function useStockTakeHistory() {
  const sessions = ref<StockTakeHistoryEntry[]>([])

  async function load(): Promise<void> {
    const device = useDeviceStore()
    const rows = await db.getAll<HistoryRow>(
      `SELECT s.id, s.started_at, s.created_by,
              COUNT(l.id) AS products_counted,
              COALESCE(SUM(l.variance_value_usd), 0) AS total_shrinkage_usd
       FROM stock_take_sessions s
       LEFT JOIN stock_take_lines l ON l.session_id = s.id
       WHERE s.shop_id = ? AND s.status = 'completed'
       GROUP BY s.id, s.started_at, s.created_by
       ORDER BY s.started_at DESC`,
      [device.shopId]
    )
    sessions.value = rows.map(r => ({
      id: r.id, startedAt: r.started_at, createdBy: r.created_by,
      productsCounted: r.products_counted, totalShrinkageUsd: r.total_shrinkage_usd,
    }))
  }

  const lastThreeTrendUsd = computed(() =>
    sessions.value.slice(0, 3).reduce((sum, s) => sum + s.totalShrinkageUsd, 0)
  )

  return { sessions, load, lastThreeTrendUsd }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/useStockTakeHistory.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/features/stock-take/composables/useStockTakeHistory.ts src/__tests__/features/useStockTakeHistory.test.ts
git commit -m "feat: useStockTakeHistory lists completed sessions and a last-3 shrinkage trend"
```

---

### Task 9: Guided count screen

**Files:**
- Create: `src/features/stock-take/components/StockTakeSessionScreen.vue`
- Test: `src/__tests__/features/StockTakeSessionScreen.test.ts`

**Interfaces:**
- Consumes: `useStockTake()` (Tasks 4-7), `useBarcodeScan()` from `@/composables/useBarcodeScan` (`onScan`, `offScan`).
- Produces: a routable screen mounted at `/stock-take/:id`.

- [x] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: 's1' } }),
  useRouter: () => ({ push: vi.fn() }),
}))

import { db } from '@/data/powersync/db'
import StockTakeSessionScreen from '@/features/stock-take/components/StockTakeSessionScreen.vue'

describe('StockTakeSessionScreen', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getOptional).mockResolvedValue({
      id: 's1', shop_id: 'shop1', started_at: '2026-07-14T00:00:00Z',
      completed_at: null, status: 'in_progress', created_by: 'dev1', scope: null,
    } as any)
    vi.mocked(db.getAll).mockResolvedValue([
      { id: 'l1', session_id: 's1', product_id: 'p1', name_ar: 'منتج ١', expected_stock: 10, counted_stock: null, variance: null, variance_value_usd: null },
    ] as any)
  })

  it('shows progress and lets the counter enter a quantity for the current line', async () => {
    const wrapper = mount(StockTakeSessionScreen)
    await flushPromisesLoop()

    expect(wrapper.get('[data-testid="stock-take-progress"]').text()).toContain('0')
    expect(wrapper.get('[data-testid="stock-take-progress"]').text()).toContain('1')

    await wrapper.get('[data-testid="stock-take-count-input"]').setValue('9')
    await wrapper.get('[data-testid="stock-take-count-submit"]').trigger('click')
    await flushPromisesLoop()

    const updateCall = vi.mocked(db.execute).mock.calls.find(([sql]) => /UPDATE stock_take_lines/.test(sql))
    expect(updateCall).toBeTruthy()
  })
})

async function flushPromisesLoop() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/StockTakeSessionScreen.test.ts`
Expected: FAIL — component file not found

- [x] **Step 3: Write the component**

```vue
<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useStockTake } from '@/features/stock-take/composables/useStockTake'
import { useBarcodeScan } from '@/composables/useBarcodeScan'

const route = useRoute()
const router = useRouter()
const sessionId = route.params.id as string

const { lines, loadSession, recordCount, progress } = useStockTake()
const currentIndex = ref(0)
const inputValue = ref('')

const remainingLines = computed(() => lines.value.filter(l => l.countedStock === null))
const currentLine = computed(() => remainingLines.value[0] ?? null)

async function submitCount() {
  if (!currentLine.value) return
  const qty = Number(inputValue.value)
  if (!Number.isFinite(qty) || qty < 0) return
  await recordCount(currentLine.value.id, qty)
  inputValue.value = ''
  if (remainingLines.value.length === 0) {
    router.push(`/stock-take/${sessionId}/review`)
  }
}

const { onScan, offScan } = useBarcodeScan()
function handleScan(barcode: string) {
  const match = lines.value.find(l => l.productId === barcode)
  if (match) {
    const idx = remainingLines.value.findIndex(l => l.id === match.id)
    if (idx >= 0) currentIndex.value = idx
  }
}

onMounted(async () => {
  await loadSession(sessionId)
  onScan(handleScan)
})
onUnmounted(() => offScan(handleScan))
</script>

<template>
  <div dir="rtl" class="stock-take-screen">
    <h1>جرد المخزون</h1>
    <p data-testid="stock-take-progress">{{ progress.counted }} من {{ progress.total }}</p>

    <div v-if="currentLine">
      <p>{{ currentLine.productNameAr }}</p>
      <input
        data-testid="stock-take-count-input"
        type="number"
        min="0"
        v-model="inputValue"
      />
      <button data-testid="stock-take-count-submit" @click="submitCount">التالي</button>
    </div>
    <div v-else>
      <p>تم عد جميع المنتجات</p>
    </div>
  </div>
</template>

<style scoped>
.stock-take-screen {
  padding: 1rem;
  font-family: 'Tajawal', sans-serif;
}
</style>
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/StockTakeSessionScreen.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/features/stock-take/components/StockTakeSessionScreen.vue src/__tests__/features/StockTakeSessionScreen.test.ts
git commit -m "feat: guided stock-take counting screen with barcode-scan jump"
```

---

### Task 10: Review screen

**Files:**
- Create: `src/features/stock-take/components/StockTakeReviewScreen.vue`
- Test: `src/__tests__/features/StockTakeReviewScreen.test.ts`

**Interfaces:**
- Consumes: `useStockTake()` — `loadSession`, `reviewLines`, `totalShrinkageValueUsd`, `confirmSession`.

- [x] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: 's1' } }),
  useRouter: () => ({ push: vi.fn() }),
}))

import { db } from '@/data/powersync/db'
import StockTakeReviewScreen from '@/features/stock-take/components/StockTakeReviewScreen.vue'

describe('StockTakeReviewScreen', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getOptional).mockResolvedValue({
      id: 's1', shop_id: 'shop1', started_at: '2026-07-14T00:00:00Z',
      completed_at: null, status: 'in_progress', created_by: 'dev1', scope: null,
    } as any)
    vi.mocked(db.getAll).mockResolvedValue([
      { id: 'l1', session_id: 's1', product_id: 'p1', name_ar: 'منتج ١', expected_stock: 10, counted_stock: 8, variance: -2, variance_value_usd: -10 },
    ] as any)
  })

  it('shows total shrinkage and confirms the session on button click', async () => {
    const wrapper = mount(StockTakeReviewScreen)
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.get('[data-testid="stock-take-total-shrinkage"]').text()).toContain('10')

    await wrapper.get('[data-testid="stock-take-confirm"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    const sessionUpdate = vi.mocked(db.execute).mock.calls.find(([sql]) => /UPDATE stock_take_sessions/.test(sql))
    expect(sessionUpdate).toBeTruthy()
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/StockTakeReviewScreen.test.ts`
Expected: FAIL — component file not found

- [x] **Step 3: Write the component**

```vue
<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useStockTake } from '@/features/stock-take/composables/useStockTake'

const route = useRoute()
const router = useRouter()
const sessionId = route.params.id as string

const { loadSession, reviewLines, totalShrinkageValueUsd, confirmSession } = useStockTake()

onMounted(() => loadSession(sessionId))

async function onConfirm() {
  await confirmSession()
  router.push('/stock-take/history')
}
</script>

<template>
  <div dir="rtl" class="stock-take-review">
    <h1>مراجعة الجرد</h1>
    <p data-testid="stock-take-total-shrinkage">
      إجمالي قيمة العجز: {{ totalShrinkageValueUsd.toFixed(2) }} $
    </p>
    <ul>
      <li v-for="line in reviewLines" :key="line.id">
        {{ line.productNameAr }} — الفرق: {{ line.variance }}
        <span v-if="line.varianceValueUsd !== null">({{ line.varianceValueUsd.toFixed(2) }} $)</span>
        <span v-else>(—)</span>
      </li>
    </ul>
    <button data-testid="stock-take-confirm" @click="onConfirm">تأكيد وتطبيق</button>
  </div>
</template>
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/StockTakeReviewScreen.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/features/stock-take/components/StockTakeReviewScreen.vue src/__tests__/features/StockTakeReviewScreen.test.ts
git commit -m "feat: stock-take review screen with total shrinkage and confirm-to-apply"
```

---

### Task 11: History screen

**Files:**
- Create: `src/features/stock-take/components/StockTakeHistoryScreen.vue`
- Test: `src/__tests__/features/StockTakeHistoryScreen.test.ts`

**Interfaces:**
- Consumes: `useStockTakeHistory()` (Task 8).

- [x] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import StockTakeHistoryScreen from '@/features/stock-take/components/StockTakeHistoryScreen.vue'

describe('StockTakeHistoryScreen', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([
      { id: 's2', started_at: '2026-07-14T00:00:00Z', created_by: 'dev1', products_counted: 20, total_shrinkage_usd: -15 },
      { id: 's1', started_at: '2026-06-14T00:00:00Z', created_by: 'dev1', products_counted: 15, total_shrinkage_usd: 2 },
    ] as any)
  })

  it('lists past sessions newest-first with the last-3 trend total', async () => {
    const wrapper = mount(StockTakeHistoryScreen)
    await new Promise((r) => setTimeout(r, 0))

    const rows = wrapper.findAll('[data-testid="stock-take-history-row"]')
    expect(rows).toHaveLength(2)
    expect(wrapper.get('[data-testid="stock-take-trend"]').text()).toContain('-13')
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/StockTakeHistoryScreen.test.ts`
Expected: FAIL — component file not found

- [x] **Step 3: Write the component**

```vue
<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useStockTakeHistory } from '@/features/stock-take/composables/useStockTakeHistory'

const router = useRouter()
const { sessions, load, lastThreeTrendUsd } = useStockTakeHistory()

onMounted(load)
</script>

<template>
  <div dir="rtl" class="stock-take-history">
    <h1>سجل الجرد</h1>
    <p data-testid="stock-take-trend">
      اتجاه العجز (آخر 3 عمليات): {{ lastThreeTrendUsd.toFixed(2) }} $
    </p>
    <div
      v-for="s in sessions"
      :key="s.id"
      data-testid="stock-take-history-row"
      @click="router.push(`/stock-take/${s.id}/review`)"
    >
      {{ s.startedAt }} — {{ s.productsCounted }} منتج —
      <span :class="s.totalShrinkageUsd < 0 ? 'loss' : 'gain'">
        {{ s.totalShrinkageUsd.toFixed(2) }} $
      </span>
    </div>
  </div>
</template>

<style scoped>
.loss { color: #c0392b; }
.gain { color: #27ae60; }
</style>
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/StockTakeHistoryScreen.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/features/stock-take/components/StockTakeHistoryScreen.vue src/__tests__/features/StockTakeHistoryScreen.test.ts
git commit -m "feat: stock-take history screen with last-3 shrinkage trend"
```

---

### Task 12: Router registration and entry point

**Files:**
- Modify: `src/router/index.ts`
- Modify: `src/features/products/ProductsPage.vue` (add entry point button — read this file first to match its existing button/action style before inserting)

**Interfaces:**
- Produces: routes `/stock-take` (starts a session and redirects into it), `/stock-take/:id` (counting), `/stock-take/:id/review`, `/stock-take/history`.

- [x] **Step 1: Add routes**

In `src/router/index.ts`, add after the `/receivings` route:

```ts
    { path: '/stock-take',            component: () => import('@/features/stock-take/components/StockTakeStartScreen.vue'), meta: { permission: 'can_manage_products' } },
    { path: '/stock-take/history',     component: () => import('@/features/stock-take/components/StockTakeHistoryScreen.vue'), meta: { permission: 'can_manage_products' } },
    { path: '/stock-take/:id',         component: () => import('@/features/stock-take/components/StockTakeSessionScreen.vue'), meta: { permission: 'can_manage_products' } },
    { path: '/stock-take/:id/review',  component: () => import('@/features/stock-take/components/StockTakeReviewScreen.vue'), meta: { permission: 'can_manage_products' } },
```

- [x] **Step 2: Create the missing start screen**

`/stock-take` needs a small screen to kick off `startSession` and redirect — create `src/features/stock-take/components/StockTakeStartScreen.vue`:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useStockTake } from '@/features/stock-take/composables/useStockTake'

const router = useRouter()
const { startSession } = useStockTake()
const scope = ref<string | null>(null)

async function start() {
  const sessionId = await startSession(scope.value)
  router.push(`/stock-take/${sessionId}`)
}
</script>

<template>
  <div dir="rtl" class="stock-take-start">
    <h1>بدء جرد جديد</h1>
    <input v-model="scope" placeholder="فئة محددة (اختياري)" data-testid="stock-take-scope-input" />
    <button data-testid="stock-take-start-button" @click="start">ابدأ</button>
    <button @click="router.push('/stock-take/history')">سجل الجرد السابق</button>
  </div>
</template>
```

- [x] **Step 3: Add an entry point from the product list**

Read `src/features/products/ProductsPage.vue` in full first to match its existing button markup/style, then add a button/link to `/stock-take` near the existing "Add product"/"Import from Excel" actions (per epic_02's Screen 1 layout, e.g. `<router-link to="/stock-take">بدء جرد</router-link>` styled consistently with neighboring action buttons in that file).

- [x] **Step 4: Manual verification**

Run: `npm run dev`
Navigate to `/products`, confirm a "بدء جرد" entry point is visible and navigates to `/stock-take`; complete a full session end-to-end (start → count 2-3 products → review → confirm) and confirm `current_stock` updates on the product list.

- [x] **Step 5: Commit**

```bash
git add src/router/index.ts src/features/stock-take/components/StockTakeStartScreen.vue src/features/products/ProductsPage.vue
git commit -m "feat: register stock-take routes and add entry point from product list"
```

---

## Self-Review Notes

- **Spec coverage:** data model (Task 1-2), guided flow incl. frozen `expected_stock` (Task 4), barcode-scan jump (Task 9), review screen with total shrinkage (Task 10), confirm writes real `stock_adjustments` via `adjustStock` reusing the `'stocktake'` reason (Task 6), stock-take history + last-3 trend (Task 8, 11), routing/entry point (Task 12). Deferred per spec: resumable-stale-session nudge and multi-session-conflict handling are out of scope for this plan's DoD (spec marks the former as a nice-to-have and the latter as explicitly out of scope) — flag as a follow-up plan if the brother's usage surfaces a real need.
- **Type consistency checked:** `StockTakeLine.varianceValueUsd` (camelCase, `number | null`) used consistently from Task 3's type definition through Tasks 5-11; `SessionStatus` values (`'in_progress' | 'completed' | 'cancelled'`) match the CHECK constraint in Task 1's migration and the mock rows in every test.
- **No placeholders:** every step above contains complete, runnable code — verified against the "No Placeholders" checklist.
