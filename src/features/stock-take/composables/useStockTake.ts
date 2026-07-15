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

  return { currentSession, lines, startSession }
}
