import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

function lastDayOfMonth(periodMonth: string): string {
  const [year, month] = periodMonth.split('-').map(Number)
  const last = new Date(year, month, 0).getDate()
  return `${periodMonth.slice(0, 8)}${String(last).padStart(2, '0')}`
}

export function useStaffActivity() {
  async function getPosActivityDays(staffId: string, periodMonth: string): Promise<string[]> {
    const device = useDeviceStore()
    const rows = await db.getAll<{ activity_date: string }>(
      `SELECT DISTINCT date(opened_at) AS activity_date
       FROM cashier_shifts
       WHERE shop_id = ? AND staff_id = ? AND date(opened_at) BETWEEN ? AND ?
       ORDER BY activity_date ASC`,
      [device.shopId, staffId, periodMonth, lastDayOfMonth(periodMonth)],
    )
    return rows.map(r => r.activity_date)
  }

  return { getPosActivityDays }
}
