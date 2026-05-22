import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface SaleLine {
  productId:    string
  nameAr:       string
  quantity:     number
  unitPriceUsd: number
  lineTotalUsd: number
}

export const useSaleStore = defineStore('sale', () => {
  const lines               = ref<SaleLine[]>([])
  const lockedExchangeRate  = ref<number | null>(null)
  const deviceSequence      = ref<number>(
    parseInt(localStorage.getItem('wafi_device_seq') ?? '0', 10)
  )

  const totalUsd = computed(() =>
    lines.value.reduce((sum, l) => sum + l.lineTotalUsd, 0)
  )

  function addLine(line: SaleLine) {
    const existing = lines.value.find(l => l.productId === line.productId)
    if (existing) {
      existing.quantity    += 1
      existing.lineTotalUsd = existing.quantity * existing.unitPriceUsd
    } else {
      lines.value.push({ ...line })
    }
  }

  function removeLine(productId: string) {
    const idx = lines.value.findIndex(l => l.productId === productId)
    if (idx !== -1) lines.value.splice(idx, 1)
  }

  function updateQuantity(productId: string, quantity: number) {
    if (quantity < 1) return
    const line = lines.value.find(l => l.productId === productId)
    if (line) {
      line.quantity     = quantity
      line.lineTotalUsd = quantity * line.unitPriceUsd
    }
  }

  function setLockedRate(rate: number) {
    if (lockedExchangeRate.value === null) {
      lockedExchangeRate.value = rate
    }
  }

  function incrementSequence() {
    deviceSequence.value += 1
    localStorage.setItem('wafi_device_seq', String(deviceSequence.value))
  }

  function clear() {
    lines.value              = []
    lockedExchangeRate.value = null
    // deviceSequence is intentionally NOT reset — it is a monotonically increasing
    // per-device counter that persists across sales to guarantee unique receipt numbers.
  }

  return {
    lines,
    lockedExchangeRate,
    deviceSequence,
    totalUsd,
    addLine,
    removeLine,
    updateQuantity,
    setLockedRate,
    incrementSequence,
    clear,
  }
})
