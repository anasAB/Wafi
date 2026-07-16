import { ref, computed } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import type { StockTakeSession, StockTakeLine, StockTakeSessionRow, StockTakeLineRow } from '@/features/stock-take/stock-take.types'
import { useProducts } from '@/features/products/composables/useProducts'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'

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
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [sessionId, device.shopId, now, 'in_progress', device.deviceId, scope, 'pending']
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
      `UPDATE stock_take_sessions SET status = ?, completed_at = ?, sync_status = 'pending' WHERE id = ?`,
      ['completed', now, currentSession.value.id]
    )
    currentSession.value.status = 'completed'
    currentSession.value.completedAt = now

    await logStockTakeCompleted(currentSession.value.id, reviewLines.value.length, totalShrinkageValueUsd.value)
  }

  return {
    currentSession, lines, startSession, loadSession, recordCount, progress,
    reviewLines, totalShrinkageValueUsd, confirmSession,
  }
}
