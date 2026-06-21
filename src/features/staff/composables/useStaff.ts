import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { supabase } from '@/data/supabase/client'
import { hashPin, generateSalt } from './usePinAuth'
import type { Staff, NewStaff, StaffPermissions } from '../staff.types'
import { OWNER_PERMISSIONS } from '../staff.types'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'

function rowToStaff(r: any): Staff {
  return {
    id: r.id,
    shopId: r.shop_id,
    name: r.name,
    pinHash: r.pin_hash,
    role: r.role,
    pinSalt: r.pin_salt ?? null,
    permissions:
      r.role === 'owner'
        ? OWNER_PERMISSIONS
        : JSON.parse(r.permissions ?? '{}'),
    isActive: r.is_active === 1,
    createdAt: r.created_at,
  }
}

export function useStaff() {
  const { logStaffCreated, logStaffUpdated, logStaffDeactivated, logStaffPermissionsChanged, logPinChanged } = useAuditLog()

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
    const pinSalt = generateSalt()
    const pinHash = await hashPin(data.pin, pinSalt)
    const now = new Date().toISOString()
    const permsJson =
      data.role === 'owner'
        ? JSON.stringify(OWNER_PERMISSIONS)
        : JSON.stringify(data.permissions)

    // Keep one active owner per shop: if owner already exists, update it instead
    // of inserting a second row that would violate uq_staff_one_active_owner_per_shop.
    if (data.role === 'owner') {
      const existingOwner = await db.getOptional<{ id: string }>(
        `SELECT id FROM staff WHERE shop_id = ? AND role = 'owner' AND is_active = 1 LIMIT 1`,
        [device.shopId]
      )
      if (existingOwner?.id) {
        await db.execute(
          `UPDATE staff SET name = ?, pin_hash = ?, pin_salt = ?, permissions = ?, is_active = 1 WHERE id = ?`,
          [data.name, pinHash, pinSalt, permsJson, existingOwner.id]
        )
        await loadStaff()
        const updated = staff.value.find((s) => s.id === existingOwner.id)
        if (!updated) throw new Error(`Owner ${existingOwner.id} not found after update`)
        // Re-provisioning an existing owner (name/PIN/permissions all rewritten)
        // is an update, not specifically a permission change — label it honestly.
        await logStaffUpdated(updated.id, updated.name)
        return updated
      }

      // If cloud already has an active owner but local cache is stale, reuse
      // that same row ID locally. This avoids uploading a second active owner
      // that would violate uq_staff_one_active_owner_per_shop.
      const { data: remoteOwner, error: remoteOwnerError } = await supabase
        .from('staff')
        .select('id')
        .eq('shop_id', device.shopId)
        .eq('role', 'owner')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()

      if (!remoteOwnerError && remoteOwner?.id) {
        await db.execute(
          `INSERT OR IGNORE INTO staff (id, shop_id, name, pin_hash, pin_salt, role, permissions, is_active, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
          [remoteOwner.id, device.shopId, data.name, pinHash, pinSalt, 'owner', permsJson, now]
        )
        await db.execute(
          `UPDATE staff SET name = ?, pin_hash = ?, pin_salt = ?, permissions = ?, is_active = 1 WHERE id = ?`,
          [data.name, pinHash, pinSalt, permsJson, remoteOwner.id]
        )
        await loadStaff()
        const updated = staff.value.find((s) => s.id === remoteOwner.id)
        if (!updated) throw new Error(`Owner ${remoteOwner.id} not found after sync-safe update`)
        await logStaffUpdated(updated.id, updated.name)
        return updated
      }
    }

    const id = crypto.randomUUID()

    await db.execute(
      `INSERT INTO staff (id, shop_id, name, pin_hash, pin_salt, role, permissions, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [id, device.shopId, data.name, pinHash, pinSalt, data.role, permsJson, now]
    )
    await loadStaff()
    const created = staff.value.find((s) => s.id === id)
    if (!created) throw new Error(`Staff ${id} not found after insert`)
    await logStaffCreated(created.id, created.name, created.role)
    return created
  }

  async function updateStaffPin(staffId: string, newPin: string): Promise<void> {
    // Mint a fresh salt on every PIN change — this also upgrades any legacy
    // unsalted row to salted on its next PIN set (verify-until-reset).
    const pinSalt = generateSalt()
    await db.execute(`UPDATE staff SET pin_hash = ?, pin_salt = ? WHERE id = ?`, [
      await hashPin(newPin, pinSalt),
      pinSalt,
      staffId,
    ])
    const nameRow = await db.getOptional<{ name: string }>(
      `SELECT name FROM staff WHERE id = ?`, [staffId]
    )
    await logPinChanged(staffId, nameRow?.name ?? staffId)
  }

  /** Update a staff member's name, role and permissions (owner-only action). */
  async function updateStaff(
    staffId: string,
    data: { name: string; role: Staff['role']; permissions: StaffPermissions }
  ): Promise<void> {
    const permsJson =
      data.role === 'owner'
        ? JSON.stringify(OWNER_PERMISSIONS)
        : JSON.stringify(data.permissions)
    await db.execute(
      `UPDATE staff SET name = ?, role = ?, permissions = ? WHERE id = ?`,
      [data.name, data.role, permsJson, staffId]
    )
    await loadStaff()
    await logStaffPermissionsChanged(staffId, data.name)
  }

  async function updateStaffPermissions(
    staffId: string,
    permissions: StaffPermissions
  ): Promise<void> {
    const nameRow = await db.getOptional<{ name: string }>(
      `SELECT name FROM staff WHERE id = ?`, [staffId]
    )
    await db.execute(`UPDATE staff SET permissions = ? WHERE id = ?`, [
      JSON.stringify(permissions),
      staffId,
    ])
    await loadStaff()
    await logStaffPermissionsChanged(staffId, nameRow?.name ?? staffId)
  }

  async function deactivateStaff(staffId: string): Promise<void> {
    const nameRow = await db.getOptional<{ name: string }>(
      `SELECT name FROM staff WHERE id = ?`, [staffId]
    )
    await db.execute(
      `UPDATE staff SET is_active = 0 WHERE id = ?`,
      [staffId]
    )
    await loadStaff()
    await logStaffDeactivated(staffId, nameRow?.name ?? staffId)
  }

  return {
    staff,
    loading,
    loadStaff,
    hasAnyStaff,
    createStaff,
    updateStaffPin,
    updateStaff,
    updateStaffPermissions,
    deactivateStaff,
  }
}
