import { ref, computed } from 'vue'
import { useDeviceStore } from '@/store/device.store'
import { fetchPendingInstallmentDues } from './installmentDues'
import type { DueAlertItem } from './installmentDues'

export type { DueAlertItem }

export function useInstallmentsDueAlert() {
  const items = ref<DueAlertItem[]>([])

  const dueOrOverdue = computed(() =>
    items.value.filter(i => i.bucket === 'due' || i.bucket === 'overdue'),
  )
  const count = computed(() => dueOrOverdue.value.length)
  const totalDueUsd = computed(() =>
    dueOrOverdue.value.reduce((s, i) => s + (i.amountDueUsd - i.amountPaidUsd), 0),
  )
  const top3 = computed(() => dueOrOverdue.value.slice(0, 3))
  const allClear = computed(() => count.value === 0)

  async function load() {
    const device = useDeviceStore()
    items.value = await fetchPendingInstallmentDues(device.shopId)
  }

  return { items, count, totalDueUsd, top3, allClear, load }
}
