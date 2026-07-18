import { ref, computed } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import type { StockTakeSession, StockTakeLine, StockTakeSessionRow, StockTakeLineRow } from '@/features/stock-take/stock-take.types'
import { useProducts } from '@/features/products/composables/useProducts'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'

/** Scope of a stock-take session (WAFI-134: real categories, not free text).
 *  null / all-null fields = all products. scopeName is the human-readable
 *  snapshot stored for history — a later category rename never rewrites it. */
export interface StockTakeScope {
  categoryId?:    string | null
  subcategoryId?: string | null
  scopeName?:     string | null
}

/** Thrown when another in_progress session overlaps the requested scope (WAFI-121). */
export class StockTakeOverlapError extends Error {
  constructor() {
    super('يوجد جرد نشط لهذه الأصناف حالياً. يرجى إكماله أو إلغاؤه أولاً.')
    this.name = 'StockTakeOverlapError'
  }
}

export function useStockTake() {
  const currentSession = ref<StockTakeSession | null>(null)
  const lines = ref<StockTakeLine[]>([])

  async function startSession(scope: StockTakeScope | null): Promise<string> {
    const device = useDeviceStore()
    const now = new Date().toISOString()
    const sessionId = uuidv4()
    const categoryId    = scope?.categoryId    ?? null
    const subcategoryId = scope?.subcategoryId ?? null
    const scopeName     = scope?.scopeName     ?? null

    // WAFI-121 concurrency guard (founder decision 2026-07-18): block on scope
    // overlap, allow disjoint scopes. Overlap = either side is all-products, or
    // same category with either side covering the whole category or the same
    // subcategory. Two committing variance systems over the same products would
    // corrupt each other's snapshot math.
    const openSessions = await db.getAll<{ scope_category_id: string | null; scope_subcategory_id: string | null }>(
      `SELECT scope_category_id, scope_subcategory_id FROM stock_take_sessions
       WHERE shop_id = ? AND status = 'in_progress'`,
      [device.shopId]
    )
    const overlaps = openSessions.some((s) => {
      if (!s.scope_category_id || !categoryId) return true
      if (s.scope_category_id !== categoryId) return false
      if (!s.scope_subcategory_id || !subcategoryId) return true
      return s.scope_subcategory_id === subcategoryId
    })
    if (overlaps) throw new StockTakeOverlapError()

    const params: unknown[] = [device.shopId]
    let sql = `SELECT id, current_stock FROM products
               WHERE shop_id = ? AND is_active = 1 AND (deleted = 0 OR deleted IS NULL)`
    if (categoryId)    { sql += ' AND category_id = ?';    params.push(categoryId) }
    if (subcategoryId) { sql += ' AND subcategory_id = ?'; params.push(subcategoryId) }

    const products = await db.getAll<{ id: string; current_stock: number }>(sql, params)

    await db.execute(
      `INSERT INTO stock_take_sessions
         (id, shop_id, started_at, status, created_by, scope, scope_category_id, scope_subcategory_id, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [sessionId, device.shopId, now, 'in_progress', device.deviceId, scopeName, categoryId, subcategoryId, 'pending']
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

  async function loadSession(sessionId: string): Promise<void> {
    const sessionRow = await db.getOptional<StockTakeSessionRow>(
      `SELECT * FROM stock_take_sessions WHERE id = ?`, [sessionId]
    )
    if (sessionRow) {
      currentSession.value = {
        id: sessionRow.id, shopId: sessionRow.shop_id, startedAt: sessionRow.started_at,
        completedAt: sessionRow.completed_at, status: sessionRow.status,
        createdBy: sessionRow.created_by, scope: sessionRow.scope,
        scopeCategoryId: sessionRow.scope_category_id ?? null,
        scopeSubcategoryId: sessionRow.scope_subcategory_id ?? null,
      }
    }

    // live_stock rides along so the review screen can disclose intra-session
    // movement (live ≠ snapshot) and show the resulting final stock (WAFI-121).
    const rows = await db.getAll<StockTakeLineRow>(
      `SELECT stl.id, stl.session_id, stl.product_id, p.name_ar,
              stl.expected_stock, stl.counted_stock, stl.variance, stl.variance_value_usd,
              p.current_stock AS live_stock
       FROM stock_take_lines stl
       JOIN products p ON p.id = stl.product_id
       WHERE stl.session_id = ?`,
      [sessionId]
    )
    lines.value = rows.map(r => ({
      id: r.id, sessionId: r.session_id, productId: r.product_id, productNameAr: r.name_ar,
      expectedStock: r.expected_stock, countedStock: r.counted_stock,
      variance: r.variance, varianceValueUsd: r.variance_value_usd,
      liveStock: r.live_stock ?? r.expected_stock,
    }))
  }

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

  const progress = computed(() => ({
    counted: lines.value.filter(l => l.countedStock !== null).length,
    total: lines.value.length,
  }))

  const reviewLines = computed(() =>
    lines.value
      .filter(l => (l.variance ?? 0) !== 0)
      .sort((a, b) => Math.abs(b.varianceValueUsd ?? b.variance ?? 0) - Math.abs(a.varianceValueUsd ?? a.variance ?? 0))
  )

  const totalShrinkageValueUsd = computed(() =>
    lines.value.reduce((sum, l) => sum + (l.varianceValueUsd ?? 0), 0)
  )

  /**
   * WAFI-121 commit semantics:
   * - DELTAS, not absolutes: adjustment = counted − snapshot expected, applied
   *   to LIVE stock via adjustStockBy — a sale rung mid-count survives commit.
   * - Idempotent: status is re-read from the DB first; anything other than
   *   in_progress (already committed here, on another device, or cancelled)
   *   is a no-op reported as 'already-completed'.
   */
  async function confirmSession(): Promise<'committed' | 'already-completed'> {
    if (!currentSession.value) return 'already-completed'
    const sessionId = currentSession.value.id

    const statusRow = await db.getOptional<{ status: string }>(
      `SELECT status FROM stock_take_sessions WHERE id = ?`, [sessionId]
    )
    if (!statusRow || statusRow.status !== 'in_progress') {
      if (statusRow) currentSession.value.status = statusRow.status as StockTakeSession['status']
      return 'already-completed'
    }

    const { adjustStockBy } = useProducts()
    const { logStockTakeCompleted } = useAuditLog()

    for (const line of lines.value) {
      if (line.countedStock === null) continue
      const delta = line.countedStock - line.expectedStock
      if (delta === 0) continue // counted = snapshot: live stock stays as-is
      await adjustStockBy(line.productId, delta, 'stocktake', `جرد #${sessionId}`)
    }

    const now = new Date().toISOString()
    await db.execute(
      `UPDATE stock_take_sessions SET status = ?, completed_at = ?, sync_status = 'pending' WHERE id = ?`,
      ['completed', now, sessionId]
    )
    currentSession.value.status = 'completed'
    currentSession.value.completedAt = now

    await logStockTakeCompleted(sessionId, reviewLines.value.length, totalShrinkageValueUsd.value)
    return 'committed'
  }

  return {
    currentSession, lines, startSession, loadSession, recordCount, progress,
    reviewLines, totalShrinkageValueUsd, confirmSession,
  }
}
