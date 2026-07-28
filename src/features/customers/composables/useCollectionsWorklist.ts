import { computed, ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { fetchCreditDebtors } from './creditDebtors'
import type { CollectionsWorklistRow } from '@/features/customers/customer.types'

export type CollectionsSortOption = 'balance_desc' | 'oldest_first' | 'last_reminded_asc'

export function useCollectionsWorklist() {
  const rows = ref<CollectionsWorklistRow[]>([])
  const sort = ref<CollectionsSortOption>('balance_desc')
  const overdueThresholdDays = ref(30)

  // "لهم رصيد" — customers the shop owes (negative balance). Never chased.
  const creditRows = computed(() => rows.value.filter(r => r.balanceUsd < -0.001))
  const debtorRows = computed(() => {
    const list = rows.value.filter(r => r.balanceUsd > 0.001)
    const sorted = [...list]
    if (sort.value === 'balance_desc') {
      sorted.sort((a, b) => b.balanceUsd - a.balanceUsd)
    } else if (sort.value === 'oldest_first') {
      sorted.sort((a, b) => b.daysOutstanding - a.daysOutstanding)
    } else {
      // recently-reminded-last: never-reminded first, then oldest reminder first.
      sorted.sort((a, b) => {
        const aT = a.lastRemindedAt ? new Date(a.lastRemindedAt).getTime() : -1
        const bT = b.lastRemindedAt ? new Date(b.lastRemindedAt).getTime() : -1
        return aT - bT
      })
    }
    return sorted
  })

  const overdueCount = computed(() =>
    debtorRows.value.filter(r => r.daysOutstanding >= overdueThresholdDays.value).length
  )

  async function load() {
    const device = useDeviceStore()
    rows.value = await fetchCreditDebtors(device.shopId)
  }

  async function markReminded(customerId: string): Promise<void> {
    const device = useDeviceStore()
    const now = new Date().toISOString()
    await db.execute(
      `UPDATE customers SET last_reminded_at = ?, sync_status = 'pending' WHERE id = ? AND shop_id = ?`,
      [now, customerId, device.shopId]
    )
    const row = rows.value.find(r => r.customerId === customerId)
    if (row) row.lastRemindedAt = now
  }

  return {
    rows,
    debtorRows,
    creditRows,
    sort,
    overdueThresholdDays,
    overdueCount,
    load,
    markReminded,
  }
}
