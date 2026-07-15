import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { supabase } from '@/data/supabase/client'
import { hashPin, generateSalt } from './usePinAuth'
import { usePinLockout } from './usePinLockout'
import type { Staff, NewStaff, StaffPermissions } from '../staff.types'
import { permissionsForRole } from '../staff.types'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'
import { canResetPin } from '@/router/permissions'

const STAFF_ACTIVE_LIMIT = 5
const STAFF_LIMIT_MESSAGE = `وصلت إلى الحد الأقصى (${STAFF_ACTIVE_LIMIT} موظفين) لباقتك`

/** Thrown when a PIN reset is attempted by an actor the role rule forbids. */
export class PinResetNotAllowedError extends Error {
  constructor() {
    super('Not authorised to reset this staff member’s PIN')
    this.name = 'PinResetNotAllowedError'
  }
}

/** Thrown when creating an active staff member above the current plan cap. */
export class StaffLimitReachedError extends Error {
  constructor() {
    super(STAFF_LIMIT_MESSAGE)
    this.name = 'StaffLimitReachedError'
  }
}

// staff.permissions was JSONB in Postgres against a TEXT column on the client
// (migration 032 fixed this), which double-encoded the JSON string on every
// sync round-trip: JSON.parse would yield a *string* holding the JSON text
// instead of the parsed object. Parse twice when that happens so any row
// synced before a device picks up 032's backfill still applies correctly.
function parsePermissions(raw: string | null): Partial<StaffPermissions> {
  let value: unknown = JSON.parse(raw ?? '{}')
  if (typeof value === 'string') value = JSON.parse(value)
  return (value && typeof value === 'object' ? value : {}) as Partial<StaffPermissions>
}

function rowToStaff(r: any): Staff {
  return {
    id: r.id,
    shopId: r.shop_id,
    name: r.name,
    pinHash: r.pin_hash,
    role: r.role,
    pinSalt: r.pin_salt ?? null,
    permissions: permissionsForRole(r.role, parsePermissions(r.permissions)),
    isActive: r.is_active === 1,
    createdAt: r.created_at,
  }
}

export function useStaff() {
  const { logStaffCreated, logStaffUpdated, logStaffDeactivated, logStaffPermissionsChanged, logPinChanged } = useAuditLog()
  const lockout = usePinLockout()

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
    const permsJson = JSON.stringify(permissionsForRole(data.role, data.permissions))

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

    // TODO: drive this limit from the customer's pack entitlement once per-tenant flags exist.
    const activeCountRow = await db.getOptional<{ count: number }>(
      `SELECT COUNT(*) as count FROM staff WHERE shop_id = ? AND is_active = 1`,
      [device.shopId]
    )
    if ((activeCountRow?.count ?? 0) >= STAFF_ACTIVE_LIMIT) {
      throw new StaffLimitReachedError()
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

  /** Write a fresh salted hash and clear any standing lockout for this staff
   *  member. Minting a new salt also upgrades a legacy unsalted row to salted on
   *  its next PIN set (verify-until-reset). Clearing the lockout here means a
   *  newly-set PIN always works immediately — no leftover cooldown (gap #2). */
  async function _writePinHash(staffId: string, newPin: string): Promise<void> {
    const pinSalt = generateSalt()
    await db.execute(`UPDATE staff SET pin_hash = ?, pin_salt = ? WHERE id = ?`, [
      await hashPin(newPin, pinSalt),
      pinSalt,
      staffId,
    ])
    lockout.reset(staffId)
  }

  /** Set a staff member's PIN. `actor` is optional: the owner-only edit path
   *  runs with an active operator (captured by the audit row's columns), while
   *  the WAFI-056 owner self-recovery path passes the owner explicitly because
   *  the shop is locked (no active operator) when the PIN is reset. */
  async function updateStaffPin(
    staffId: string,
    newPin: string,
    actor?: { id: string; name: string },
  ): Promise<void> {
    await _writePinHash(staffId, newPin)
    const nameRow = await db.getOptional<{ name: string }>(
      `SELECT name FROM staff WHERE id = ?`, [staffId]
    )
    await logPinChanged(staffId, nameRow?.name ?? staffId, actor)
  }

  /**
   * Reset a staff member's PIN on their behalf (WAFI-056 in-person recovery).
   *
   * `actor` is the operator who authenticated to authorise the reset; `target`
   * is the staff member who forgot their PIN. The role rule is enforced here too
   * (defence in depth) — the UI hides forbidden targets, but a forbidden reset
   * must also be impossible to drive programmatically. On success the new PIN
   * works immediately (lockout cleared) and the audit row names both parties.
   *
   * Fully offline: a local DB write plus a localStorage lockout clear, no network.
   */
  async function resetStaffPin(actor: Staff, target: Staff, newPin: string): Promise<void> {
    if (!canResetPin(actor, target)) throw new PinResetNotAllowedError()
    await _writePinHash(target.id, newPin)
    await logPinChanged(target.id, target.name, { id: actor.id, name: actor.name })
  }

  /** Update a staff member's name, role and permissions (owner-only action). */
  async function updateStaff(
    staffId: string,
    data: { name: string; role: Staff['role']; permissions: StaffPermissions }
  ): Promise<void> {
    const permsJson = JSON.stringify(permissionsForRole(data.role, data.permissions))
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
    resetStaffPin,
    updateStaff,
    updateStaffPermissions,
    deactivateStaff,
  }
}
