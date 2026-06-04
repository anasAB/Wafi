import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { hashPin } from './usePinAuth'
import type { Staff, NewStaff, StaffPermissions } from '../staff.types'
import { OWNER_PERMISSIONS } from '../staff.types'

function rowToStaff(r: any): Staff {
  return {
    id: r.id,
    shopId: r.shop_id,
    name: r.name,
    pinHash: r.pin_hash,
    role: r.role,
    permissions:
      r.role === 'owner'
        ? OWNER_PERMISSIONS
        : JSON.parse(r.permissions ?? '{}'),
    isActive: r.is_active === 1,
    createdAt: r.created_at,
  }
}

export function useStaff() {
  const staff = ref<Staff[]>([])
  const loading = ref(false)

  async function loadStaff(): Promise<void> {
    const device = useDeviceStore()
    loading.value = true
    try {
      const result = await db.execute(
        `SELECT * FROM staff WHERE shop_id = ? AND is_active = 1 ORDER BY role DESC, created_at ASC`,
        [device.shopId]
      )
      staff.value = (result as any).rows._array.map(rowToStaff)
    } finally {
      loading.value = false
    }
  }

  async function hasAnyStaff(): Promise<boolean> {
    const device = useDeviceStore()
    const row = await db.getOptional<{ count: number }>(
      `SELECT COUNT(*) as count FROM staff WHERE shop_id = ?`,
      [device.shopId]
    )
    return (row?.count ?? 0) > 0
  }

  async function createStaff(data: NewStaff): Promise<Staff> {
    const device = useDeviceStore()
    const id = crypto.randomUUID()
    const pinHash = await hashPin(data.pin)
    const now = new Date().toISOString()
    const permsJson =
      data.role === 'owner'
        ? JSON.stringify(OWNER_PERMISSIONS)
        : JSON.stringify(data.permissions)

    await db.execute(
      `INSERT INTO staff (id, shop_id, name, pin_hash, role, permissions, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      [id, device.shopId, data.name, pinHash, data.role, permsJson, now]
    )
    await loadStaff()
    const created = staff.value.find((s) => s.id === id)
    if (!created) throw new Error(`Staff ${id} not found after insert`)
    return created
  }

  async function updateStaffPin(staffId: string, newPin: string): Promise<void> {
    await db.execute(`UPDATE staff SET pin_hash = ? WHERE id = ?`, [
      await hashPin(newPin),
      staffId,
    ])
  }

  async function updateStaffPermissions(
    staffId: string,
    permissions: StaffPermissions
  ): Promise<void> {
    await db.execute(`UPDATE staff SET permissions = ? WHERE id = ?`, [
      JSON.stringify(permissions),
      staffId,
    ])
    await loadStaff()
  }

  async function deactivateStaff(staffId: string): Promise<void> {
    await db.execute(
      `UPDATE staff SET is_active = 0 WHERE id = ?`,
      [staffId]
    )
    await loadStaff()
  }

  return {
    staff,
    loading,
    loadStaff,
    hasAnyStaff,
    createStaff,
    updateStaffPin,
    updateStaffPermissions,
    deactivateStaff,
  }
}
