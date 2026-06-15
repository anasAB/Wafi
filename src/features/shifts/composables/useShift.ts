import { db }             from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { useShiftStore }  from '@/features/shifts/shift.store'
import type { Staff }     from '@/features/staff/staff.types'
import type { CashierShift } from '../shift.types'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'

function rowToShift(r: any): CashierShift {
  return {
    id:             r.id,
    shopId:         r.shop_id,
    deviceId:       r.device_id,
    staffId:        r.staff_id,
    openedAt:       r.opened_at,
    closedAt:       r.closed_at ?? null,
    openingCashUsd: r.opening_cash_usd,
    closingCashUsd: r.closing_cash_usd ?? null,
    closingCashSyp: r.closing_cash_syp ?? null,
    status:         r.status,
  }
}

export function useShift() {
  const { logShiftOpened, logShiftClosed } = useAuditLog()

  const device     = useDeviceStore()
  const shiftStore = useShiftStore()

  async function openShift(staff: Staff, openingCashUsd: number): Promise<string> {
    const shiftId = crypto.randomUUID()
    const now     = new Date().toISOString()
    await db.execute(
      `INSERT INTO cashier_shifts
         (id, shop_id, device_id, staff_id, opened_at, opening_cash_usd, status)
       VALUES (?, ?, ?, ?, ?, ?, 'open')`,
      [shiftId, device.shopId, device.deviceId, staff.id, now, openingCashUsd]
    )
    shiftStore.openShift(shiftId, staff)
    await logShiftOpened(shiftId)
    return shiftId
  }

  async function closeShift(closingCashUsd: number, closingCashSyp: number): Promise<void> {
    const shiftId = shiftStore.activeShiftId
    if (!shiftId) throw new Error('No open shift to close')
    const now = new Date().toISOString()
    await db.execute(
      `UPDATE cashier_shifts
       SET status = 'closed', closed_at = ?, closing_cash_usd = ?, closing_cash_syp = ?
       WHERE id = ?`,
      [now, closingCashUsd, closingCashSyp, shiftId]
    )
    shiftStore.closeShift()
    await logShiftClosed(shiftId)
  }

  async function loadActiveShift(): Promise<CashierShift | null> {
    const shiftId = shiftStore.activeShiftId
    if (!shiftId) return null
    const row = await db.getOptional<any>(
      `SELECT * FROM cashier_shifts WHERE id = ?`,
      [shiftId]
    )
    if (!row || row.status !== 'open') {
      shiftStore.closeShift()
      return null
    }
    return rowToShift(row)
  }

  async function loadShiftHistory(): Promise<CashierShift[]> {
    const result = await db.execute(
      `SELECT * FROM cashier_shifts WHERE shop_id = ? ORDER BY opened_at DESC LIMIT 50`,
      [device.shopId]
    )
    return (result as any).rows._array.map(rowToShift)
  }

  return { openShift, closeShift, loadActiveShift, loadShiftHistory }
}
