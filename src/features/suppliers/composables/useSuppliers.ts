import { ref } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import type { Supplier, SupplierWithStats, NewSupplier } from '../supplier.types'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'

type SupplierStatsRow = {
  id: string; shop_id: string; name: string; phone: string | null
  contact_person: string | null; address: string | null; notes: string | null
  deleted: number; created_at: string; sync_status: string
  total_purchased_usd: number | null; last_received_at: string | null
}

function rowToSupplier(r: SupplierStatsRow): SupplierWithStats {
  return {
    id: r.id, shopId: r.shop_id, name: r.name,
    phone:         r.phone          ?? undefined,
    contactPerson: r.contact_person ?? undefined,
    address:       r.address        ?? undefined,
    notes:         r.notes          ?? undefined,
    deleted:   r.deleted === 1,
    createdAt: r.created_at, syncStatus: r.sync_status,
    totalPurchasedUsd: r.total_purchased_usd ?? 0,
    lastReceivedAt:    r.last_received_at,
  }
}

export function useSuppliers() {
  const suppliers = ref<SupplierWithStats[]>([])
  const { logSupplierCreated, logSupplierUpdated } = useAuditLog()

  // last_received_at DESC puts NULLs last in SQLite, so never-received suppliers sink.
  async function load() {
    const device = useDeviceStore()
    const rows = await db.getAll<SupplierStatsRow>(
      `SELECT s.*,
              COALESCE(SUM(sr.total_cost_usd), 0) AS total_purchased_usd,
              MAX(sr.received_at)                 AS last_received_at
       FROM suppliers s
       LEFT JOIN stock_receivings sr ON sr.supplier_id = s.id
       WHERE s.shop_id = ? AND (s.deleted = 0 OR s.deleted IS NULL)
       GROUP BY s.id
       ORDER BY last_received_at DESC, s.name ASC`,
      [device.shopId],
    )
    suppliers.value = rows.map(rowToSupplier)
  }

  async function getById(id: string): Promise<Supplier | null> {
    const r = await db.getOptional<SupplierStatsRow>(
      `SELECT *, 0 AS total_purchased_usd, NULL AS last_received_at
       FROM suppliers WHERE id = ?`, [id],
    )
    return r ? rowToSupplier(r) : null
  }

  async function search(q: string): Promise<SupplierWithStats[]> {
    const device = useDeviceStore()
    const rows = await db.getAll<SupplierStatsRow>(
      `SELECT *, 0 AS total_purchased_usd, NULL AS last_received_at
       FROM suppliers
       WHERE shop_id = ? AND (deleted = 0 OR deleted IS NULL) AND name LIKE ?
       ORDER BY name ASC`,
      [device.shopId, `%${q}%`],
    )
    return rows.map(rowToSupplier)
  }

  async function save(data: NewSupplier): Promise<string> {
    const device = useDeviceStore()
    const id = uuidv4()
    const now = new Date().toISOString()
    await db.execute(
      `INSERT INTO suppliers
         (id, shop_id, name, phone, contact_person, address, notes, deleted, created_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'pending')`,
      [id, device.shopId, data.name, data.phone ?? null, data.contactPerson ?? null,
       data.address ?? null, data.notes ?? null, now],
    )
    await logSupplierCreated(id, data.name)
    return id
  }

  async function update(id: string, data: Partial<NewSupplier>): Promise<void> {
    const device = useDeviceStore()
    const sets: string[] = []
    const vals: (string | null)[] = []
    if (data.name          !== undefined) { sets.push('name = ?');           vals.push(data.name) }
    if (data.phone         !== undefined) { sets.push('phone = ?');          vals.push(data.phone ?? null) }
    if (data.contactPerson !== undefined) { sets.push('contact_person = ?'); vals.push(data.contactPerson ?? null) }
    if (data.address       !== undefined) { sets.push('address = ?');        vals.push(data.address ?? null) }
    if (data.notes         !== undefined) { sets.push('notes = ?');          vals.push(data.notes ?? null) }
    if (!sets.length) return
    sets.push("sync_status = 'pending'")
    await db.execute(
      `UPDATE suppliers SET ${sets.join(', ')} WHERE id = ? AND shop_id = ?`,
      [...vals, id, device.shopId],
    )
    const nameRow = await db.getOptional<{ name: string }>(
      `SELECT name FROM suppliers WHERE id = ?`, [id],
    )
    await logSupplierUpdated(id, nameRow?.name ?? id)
  }

  async function softDelete(id: string): Promise<void> {
    const device = useDeviceStore()
    await db.execute(
      `UPDATE suppliers SET deleted = 1, sync_status = 'pending' WHERE id = ? AND shop_id = ?`,
      [id, device.shopId],
    )
  }

  return { suppliers, load, getById, search, save, update, softDelete }
}
