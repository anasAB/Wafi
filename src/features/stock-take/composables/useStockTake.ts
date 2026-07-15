import { ref, computed } from 'vue'
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
}
