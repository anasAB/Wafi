import { ref } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

export interface DenominationConfigRow {
  id:         string
  currency:   'USD' | 'SYP'
  value:      number
  sortOrder:  number
}

// Sensible defaults so a fresh shop can tally immediately, before the owner
// ever visits Settings. Seeded into denomination_configs on first read.
const DEFAULT_SYP = [500, 1000, 2000, 5000, 10000, 20000, 50000, 100000]
const DEFAULT_USD = [1, 5, 10, 20, 50, 100]

type Row = { id: string; currency: string; value: number; sort_order: number }

export function useDenominationConfig() {
  const syp = ref<DenominationConfigRow[]>([])
  const usd = ref<DenominationConfigRow[]>([])

  async function seedIfEmpty(shopId: string) {
    const existing = await db.getAll<{ c: number }>(
      `SELECT COUNT(*) AS c FROM denomination_configs WHERE shop_id = ? AND (deleted = 0 OR deleted IS NULL)`,
      [shopId]
    )
    if ((existing[0]?.c ?? 0) > 0) return
    const now = new Date().toISOString()
    await db.writeTransaction(async tx => {
      let order = 0
      for (const value of DEFAULT_SYP) {
        await tx.execute(
          `INSERT INTO denomination_configs (id, shop_id, currency, value, sort_order, deleted, created_at, sync_status)
           VALUES (?, ?, 'SYP', ?, ?, 0, ?, 'pending')`,
          [uuidv4(), shopId, value, order++, now]
        )
      }
      order = 0
      for (const value of DEFAULT_USD) {
        await tx.execute(
          `INSERT INTO denomination_configs (id, shop_id, currency, value, sort_order, deleted, created_at, sync_status)
           VALUES (?, ?, 'USD', ?, ?, 0, ?, 'pending')`,
          [uuidv4(), shopId, value, order++, now]
        )
      }
    })
  }

  async function load() {
    const device = useDeviceStore()
    await seedIfEmpty(device.shopId)
    const rows = await db.getAll<Row>(
      `SELECT id, currency, value, sort_order FROM denomination_configs
       WHERE shop_id = ? AND (deleted = 0 OR deleted IS NULL)
       ORDER BY currency, sort_order ASC, value ASC`,
      [device.shopId]
    )
    syp.value = rows.filter(r => r.currency === 'SYP').map(rowToConfig)
    usd.value = rows.filter(r => r.currency === 'USD').map(rowToConfig)
  }

  function rowToConfig(r: Row): DenominationConfigRow {
    return { id: r.id, currency: r.currency as 'USD' | 'SYP', value: r.value, sortOrder: r.sort_order }
  }

  async function add(currency: 'USD' | 'SYP', value: number): Promise<void> {
    const device = useDeviceStore()
    const now = new Date().toISOString()
    const list = currency === 'SYP' ? syp.value : usd.value
    const nextOrder = list.length
    await db.execute(
      `INSERT INTO denomination_configs (id, shop_id, currency, value, sort_order, deleted, created_at, sync_status)
       VALUES (?, ?, ?, ?, ?, 0, ?, 'pending')`,
      [uuidv4(), device.shopId, currency, value, nextOrder, now]
    )
    await load()
  }

  async function remove(id: string): Promise<void> {
    const device = useDeviceStore()
    await db.execute(
      `UPDATE denomination_configs SET deleted = 1, sync_status = 'pending' WHERE id = ? AND shop_id = ?`,
      [id, device.shopId]
    )
    await load()
  }

  return { syp, usd, load, add, remove }
}
