import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { verifyPin } from '@/features/staff/composables/usePinAuth'
import type { StaffRole } from '@/features/staff/staff.types'

/**
 * Finds the active owner/manager whose PIN matches, so a cashier's
 * over-cap or below-cost discount can be escalated to someone with
 * higher authority without switching the active operator. Only owner/
 * manager rows are checked — a cashier's own PIN can never self-approve
 * (mirrors requiresPinApproval's role gate in useDiscountAuthorization).
 */
export async function findDiscountApprover(pin: string): Promise<{ id: string; name: string; role: StaffRole } | null> {
  const device = useDeviceStore()
  const result = await db.execute(
    `SELECT id, name, role, pin_hash, pin_salt FROM staff
     WHERE shop_id = ? AND is_active = 1 AND role IN ('owner', 'manager')`,
    [device.shopId],
  )
  const rows = (result as any).rows._array as Array<{
    id: string
    name: string
    role: StaffRole
    pin_hash: string
    pin_salt: string | null
  }>

  for (const row of rows) {
    if (await verifyPin(pin, row.pin_hash, row.pin_salt)) {
      return { id: row.id, name: row.name, role: row.role }
    }
  }
  return null
}
