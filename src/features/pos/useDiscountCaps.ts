import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { listDeadLetter } from '@/data/powersync/dead-letter'
import { isValidCapPct } from '@/features/pos/discountCapsValidation'

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
    // Defense in depth: PowerSync's local Table schema has no CHECK-constraint
    // syntax, so this guard is what stands in for one. The settings screen
    // already validates before calling save(); this exists for any other
    // caller and to fail loudly rather than silently persisting a bad value.
    if (!isValidCapPct(next.cashierPct) || !isValidCapPct(next.managerPct)) {
      throw new Error('Discount cap values must be between 0 and 100')
    }
    if (next.cashierPct > next.managerPct) {
      throw new Error('Cashier discount cap cannot exceed manager discount cap')
    }

    const device = useDeviceStore()
    await db.execute(
      `UPDATE shops SET cashier_discount_cap_pct = ?, manager_discount_cap_pct = ? WHERE id = ?`,
      [next.cashierPct, next.managerPct, device.shopId],
    )
    cashierPct.value = next.cashierPct
    managerPct.value = next.managerPct
  }

  /**
   * A permanently-rejected upload (constraint violation, RLS) lands in
   * sync_dead_letter via SupabaseConnector.uploadData -> quarantineOp. This
   * checks for one matching this shop's row created at/after `sinceIso`, so
   * the caller can tell a "successful" local save apart from one that never
   * actually reached the server.
   */
  async function checkSaveFailed(sinceIso: string): Promise<string | null> {
    const device = useDeviceStore()
    const entries = await listDeadLetter(db)
    const failure = entries.find(
      (e) => e.table_name === 'shops' && e.row_id === device.shopId && e.failed_at >= sinceIso,
    )
    return failure?.error_message ?? null
  }

  return { cashierPct, managerPct, loaded, load, save, checkSaveFailed }
}
