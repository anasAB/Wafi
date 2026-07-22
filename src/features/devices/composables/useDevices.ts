import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'
import { supabase } from '@/data/supabase/client'

/**
 * WAFI-130: owner-facing device management over the existing self-registration.
 * Devices are identified to the user by their code (= receipt prefix) and an
 * owner-set label. Deactivation is a soft flag enforced at shift-open
 * (useShift.openShift) — local data on the device stays intact for audit.
 */
export interface ManagedDevice {
  id:           string
  code:         string
  label:        string | null
  isTemporary:  boolean
  registeredAt: string
  lastSeenAt:   string | null
  isActive:     boolean
  /** True when this row is the device the app is currently running on. */
  isThisDevice: boolean
}

type DeviceRow = {
  id: string; code: string; label: string | null; is_temporary: number
  registered_at: string; last_seen_at: string | null; is_active: number | null
}

/** null/1 = active; only an explicit 0 deactivates (legacy rows have null). */
export function rowIsActive(v: number | null | undefined): boolean {
  return v !== 0
}

export function useDevices() {
  const devices = ref<ManagedDevice[]>([])
  const deviceStore = useDeviceStore()
  const { logDeviceRenamed, logDeviceActivation } = useAuditLog()

  async function load(): Promise<void> {
    const rows = await db.getAll<DeviceRow>(
      `SELECT id, code, label, is_temporary, registered_at, last_seen_at, is_active
       FROM devices WHERE shop_id = ? ORDER BY registered_at ASC`,
      [deviceStore.shopId]
    )
    devices.value = rows.map(r => ({
      id:           r.id,
      code:         r.code,
      label:        r.label,
      isTemporary:  r.is_temporary === 1,
      registeredAt: r.registered_at,
      lastSeenAt:   r.last_seen_at,
      isActive:     rowIsActive(r.is_active),
      isThisDevice: r.code === deviceStore.deviceCode,
    }))
  }

  async function rename(id: string, label: string): Promise<void> {
    const trimmed = label.trim()
    await db.execute(
      `UPDATE devices SET label = ?, sync_status = 'pending' WHERE id = ?`,
      [trimmed || null, id]
    )
    const d = devices.value.find(x => x.id === id)
    await logDeviceRenamed(id, d?.code ?? id, trimmed)
    await load()
  }

  /**
   * Deactivate/reactivate. The device the owner is currently ON cannot be
   * deactivated (self-lockout foot-gun); enforcement happens on the target
   * device at its next shift-open after sync.
   */
  async function setActive(id: string, active: boolean): Promise<void> {
    const d = devices.value.find(x => x.id === id)
    if (!active && d?.isThisDevice) {
      throw new Error('لا يمكن إيقاف الجهاز الذي تستخدمه الآن')
    }
    await db.execute(
      `UPDATE devices SET is_active = ?, sync_status = 'pending' WHERE id = ?`,
      [active ? 1 : 0, id]
    )
    let sessionRevoked = false
    if (!active) {
      const { error } = await supabase.rpc('revoke_device_session', { p_device_id: id })
      sessionRevoked = !error
    }
    await logDeviceActivation(id, d?.code ?? id, active, sessionRevoked)
    await load()
  }

  return { devices, load, rename, setActive }
}

/**
 * Best-effort last-seen heartbeat for this device's own row (called once per
 * app session from the device store once shop + code are known). Never throws.
 */
export async function touchDeviceLastSeen(shopId: string, code: string): Promise<void> {
  if (!shopId || !code) return
  try {
    await db.execute(
      `UPDATE devices SET last_seen_at = ?, sync_status = 'pending' WHERE shop_id = ? AND code = ?`,
      [new Date().toISOString(), shopId, code]
    )
  } catch { /* advisory signal only */ }
}
