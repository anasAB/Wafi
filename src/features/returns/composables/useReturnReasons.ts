import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import type { ReturnReason } from '../returns.types'

export function useReturnReasons() {
  const reasons = ref<ReturnReason[]>([])

  async function loadReasons(): Promise<void> {
    const { shopId } = useDeviceStore()
    const rows = await db.getAll<{ id: string; label: string; sort_order: number }>(
      `SELECT id, label, sort_order
       FROM return_reasons
       WHERE shop_id = ? AND is_active = 1
       ORDER BY sort_order ASC`,
      [shopId],
    )
    reasons.value = rows.map(r => ({
      id:        r.id,
      label:     r.label,
      sortOrder: r.sort_order,
    }))
  }

  return { reasons, loadReasons }
}
