import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface SaleLine {
  productId:    string
  nameAr:       string
  quantity:     number
  unitPriceUsd: number
  lineTotalUsd: number
  /** Stock available for this product at the time it was added. Acts as the
   *  hard ceiling on quantity so the cart can never oversell. */
  availableStock: number
}

export const useSaleStore = defineStore('sale', () => {
  const lines               = ref<SaleLine[]>([])
  const lockedExchangeRate  = ref<number | null>(null)
  const hasRateChangeNotice = ref(false)
  const deviceSequence      = ref<number>(
    parseInt(localStorage.getItem('wafi_device_seq') ?? '0', 10)
  )

  const totalUsd = computed(() =>
    lines.value.reduce((sum, l) => sum + l.lineTotalUsd, 0)
  )

  function addLine(line: SaleLine) {
    const max = line.availableStock ?? Infinity
    const existing = lines.value.find(l => l.productId === line.productId)
    if (existing) {
      // Keep the latest known stock figure, then increment only if there's room.
      // This clamp is the authoritative guard against overselling — it holds even
      // when rapid taps race past the pre-check in useSale.addLine.
      existing.availableStock = line.availableStock
      if (existing.quantity >= max) return
      existing.quantity    += 1
      existing.lineTotalUsd = existing.quantity * existing.unitPriceUsd
    } else {
      if (max < 1) return
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
      // Clamp to available stock so the "+" control can never push past it.
      const clamped     = Math.min(quantity, line.availableStock ?? Infinity)
      line.quantity     = clamped
      line.lineTotalUsd = clamped * line.unitPriceUsd
    }
  }

  function setLockedRate(rate: number) {
    if (lockedExchangeRate.value === null) {
      lockedExchangeRate.value = rate
    }
  }

  function setRateChangeNotice(val: boolean) {
    hasRateChangeNotice.value = val
  }

  function incrementSequence() {
    deviceSequence.value += 1
    localStorage.setItem('wafi_device_seq', String(deviceSequence.value))
  }

  function clear() {
    lines.value              = []
    lockedExchangeRate.value = null
    hasRateChangeNotice.value = false
    // deviceSequence is intentionally NOT reset — it is a monotonically increasing
    // per-device counter that persists across sales to guarantee unique receipt numbers.
  }

  return {
    lines,
    lockedExchangeRate,
    hasRateChangeNotice,
    deviceSequence,
    totalUsd,
    addLine,
    removeLine,
    updateQuantity,
    setLockedRate,
    setRateChangeNotice,
    incrementSequence,
    clear,
  }
})
