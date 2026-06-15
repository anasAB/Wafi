import { ref } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import type { Customer, NewCustomer } from '@/features/customers/customer.types'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'

type CustomerRow = {
  id: string; shop_id: string; name: string; phone: string | null
  mobile: string | null; address: string | null; deleted: number
  created_at: string; sync_status: string
}

function rowToCustomer(r: CustomerRow): Customer {
  return {
    id: r.id, shopId: r.shop_id, name: r.name,
    phone:    r.phone    ?? undefined,
    mobile:   r.mobile   ?? undefined,
    address:  r.address  ?? undefined,
    deleted:  r.deleted === 1,
    createdAt: r.created_at, syncStatus: r.sync_status,
  }
}

export function useCustomers() {
  const customers = ref<Customer[]>([])
  const { logCustomerCreated, logCustomerUpdated, logCustomerDeleted } = useAuditLog()

  async function load() {
    const device = useDeviceStore()
    const rows = await db.getAll<CustomerRow>(
      `SELECT * FROM customers WHERE shop_id = ? AND (deleted = 0 OR deleted IS NULL) ORDER BY name ASC`,
      [device.shopId]
    )
    customers.value = rows.map(rowToCustomer)
  }

  async function search(q: string): Promise<Customer[]> {
    const device = useDeviceStore()
    const rows = await db.getAll<CustomerRow>(
      `SELECT * FROM customers WHERE shop_id = ? AND (deleted = 0 OR deleted IS NULL) AND name LIKE ? ORDER BY name ASC`,
      [device.shopId, `%${q}%`]
    )
    return rows.map(rowToCustomer)
  }

  async function save(data: NewCustomer): Promise<string> {
    const device = useDeviceStore()
    const id = uuidv4()
    const now = new Date().toISOString()
    await db.execute(
      `INSERT INTO customers (id, shop_id, name, phone, mobile, address, deleted, created_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'pending')`,
      [id, device.shopId, data.name, data.phone ?? null, data.mobile ?? null, data.address ?? null, now]
    )
    await logCustomerCreated(id, data.name)
    return id
  }

  async function update(id: string, data: Partial<NewCustomer>): Promise<void> {
    const device = useDeviceStore()
    const sets: string[] = []
    const vals: (string | null)[] = []
    if (data.name    !== undefined) { sets.push('name = ?');    vals.push(data.name) }
    if (data.phone   !== undefined) { sets.push('phone = ?');   vals.push(data.phone ?? null) }
    if (data.mobile  !== undefined) { sets.push('mobile = ?');  vals.push(data.mobile ?? null) }
    if (data.address !== undefined) { sets.push('address = ?'); vals.push(data.address ?? null) }
    if (!sets.length) return
    sets.push("sync_status = 'pending'")
    await db.execute(
      `UPDATE customers SET ${sets.join(', ')} WHERE id = ? AND shop_id = ?`,
      [...vals, id, device.shopId]
    )
    const nameRow = await db.getOptional<{ name: string }>(
      `SELECT name FROM customers WHERE id = ?`, [id]
    )
    await logCustomerUpdated(id, nameRow?.name ?? id)
  }

  async function softDelete(id: string): Promise<void> {
    const device = useDeviceStore()
    const nameRow = await db.getOptional<{ name: string }>(
      `SELECT name FROM customers WHERE id = ?`, [id]
    )
    await db.execute(
      `UPDATE customers SET deleted = 1, sync_status = 'pending' WHERE id = ? AND shop_id = ?`,
      [id, device.shopId]
    )
    await logCustomerDeleted(id, nameRow?.name ?? id)
  }

  return { customers, load, search, save, update, softDelete }
}
