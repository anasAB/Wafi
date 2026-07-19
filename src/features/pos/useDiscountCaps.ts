import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

export function useDiscountCaps() {
  const cashierPct = ref(0)
  const managerPct = ref(15)
  const loaded     = ref(false)

  async function load(): Promise<void> {
    const device = useDeviceStore()
    const row = await db.getOptional<{
      cashier_discount_cap_pct: number | null
      manager_discount_cap_pct: number | null
    }>(
      `SELECT cashier_discount_cap_pct, manager_discount_cap_pct FROM shops WHERE id = ?`,
      [device.shopId],
    )
    cashierPct.value = row?.cashier_discount_cap_pct ?? 0
    managerPct.value = row?.manager_discount_cap_pct ?? 15
    loaded.value = true
  }

  async function save(next: { cashierPct: number; managerPct: number }): Promise<void> {
    const device = useDeviceStore()
    await db.execute(
      `UPDATE shops SET cashier_discount_cap_pct = ?, manager_discount_cap_pct = ? WHERE id = ?`,
      [next.cashierPct, next.managerPct, device.shopId],
    )
    cashierPct.value = next.cashierPct
    managerPct.value = next.managerPct
  }

  return { cashierPct, managerPct, loaded, load, save }
}
