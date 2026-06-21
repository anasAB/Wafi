import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface SaleLine {
  productId:    string
  nameAr:       string
  quantity:     number
  unitPriceUsd: number       // actual price charged (cashier may negotiate up/down)
  /** Cost snapshot at add-to-cart time, used for in-cart profit preview. */
  unitCostUsd?: number
  lineTotalUsd: number
  /** Stock available for this product at the time it was added. Acts as the
   *  hard ceiling on quantity so the cart can never oversell. */
  availableStock: number
  /** Catalog/list price snapshot, so the cart can flag when an item is sold
   *  above or below its listed price. Optional for back-compat. */
  listPriceUsd?: number
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
      // Keep a cost snapshot on the line for profit calculations; older cart lines
      // may not have it if they were created before this field existed.
      existing.unitCostUsd = line.unitCostUsd ?? existing.unitCostUsd ?? 0
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

  // Override the price charged for a line (e.g. sold above the listed price).
  function updateUnitPrice(productId: string, unitPriceUsd: number) {
    if (unitPriceUsd < 0 || Number.isNaN(unitPriceUsd)) return
    const line = lines.value.find(l => l.productId === productId)
    if (line) {
      line.unitPriceUsd = unitPriceUsd
      line.lineTotalUsd = line.quantity * unitPriceUsd
    }
  }

  // Scale every line's price proportionally so the cart total becomes targetUsd.
  // Used when an "overpaid" cash amount is actually a higher negotiated price:
  // the surplus is recorded as revenue across the lines rather than as change.
  function scalePricesToTotal(targetUsd: number) {
    const current = lines.value.reduce((s, l) => s + l.lineTotalUsd, 0)
    if (current <= 0 || targetUsd <= 0) return
    const factor = targetUsd / current
    for (const line of lines.value) {
      line.unitPriceUsd = Math.round(line.unitPriceUsd * factor * 100) / 100
      line.lineTotalUsd = Math.round(line.quantity * line.unitPriceUsd * 100) / 100
    }
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

  // The rate is locked at the first cart line and is immutable for the rest of
  // that sale (WAFI-002). There is deliberately no setter to overwrite it mid-cart:
  // a mid-sale rate edit applies to the NEXT sale only, surfaced via the notice.
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
    updateUnitPrice,
    scalePricesToTotal,
    setLockedRate,
    setRateChangeNotice,
    incrementSequence,
    clear,
  }
})
