import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { computeDiscountedPrice, computeDiscountAmount, type DiscountType } from '@/features/pos/discounts'

export interface SaleLine {
  productId:    string
  nameAr:       string
  quantity:     number
  unitPriceUsd: number       // actual price charged (net of any discount/markup)
  /** Cost snapshot at add-to-cart time, used for in-cart profit preview. */
  unitCostUsd?: number
  lineTotalUsd: number
  /** Stock available for this product at the time it was added. Acts as the
   *  hard ceiling on quantity so the cart can never oversell. */
  availableStock: number
  /** Catalog/list price snapshot, so the cart can flag when an item is sold
   *  above or below its listed price. Optional for back-compat. */
  listPriceUsd?: number
  /** WAFI-101 — sold via the "بند حر" open-item flow (a hidden synthetic
   *  product row, not a catalog item). Excluded from stock/stock-take logic. */
  isOpenItem?: boolean
  /** WAFI-100: set only when a discount (not a markup) is applied to this line. */
  discountType?:       DiscountType
  discountValue?:      number
  discountAmountUsd?:  number
  /** WAFI-100: true when this discount required (and received) owner/manager
   *  PIN approval — read by usePayment.confirm() to decide which lines need
   *  a sale.discount_applied audit entry once the sale id exists. */
  discountPinApproved?: boolean
}

export interface SaleDiscount {
  type:          DiscountType
  value:         number
  amountUsd:     number
  pinApproved?:  boolean
}

export const useSaleStore = defineStore('sale', () => {
  const lines               = ref<SaleLine[]>([])
  const lockedExchangeRate  = ref<number | null>(null)
  const hasRateChangeNotice = ref(false)
  const deviceSequence      = ref<number>(
    parseInt(localStorage.getItem('wafi_device_seq') ?? '0', 10)
  )
  const saleDiscount = ref<SaleDiscount | null>(null)

  const totalUsd = computed(() => {
    const linesTotal = lines.value.reduce((sum, l) => sum + l.lineTotalUsd, 0)
    return Math.max(0, linesTotal - (saleDiscount.value?.amountUsd ?? 0))
  })

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

  // WAFI-100: apply a capped/audited discount to one line. Recomputes the
  // line's unitPriceUsd/lineTotalUsd/discount* fields from listPriceUsd (the
  // undiscounted price), so re-applying a different discount is idempotent —
  // it never compounds on top of a previous discount.
  function applyLineDiscount(
    productId: string,
    discount: { type: DiscountType; value: number } | null,
    pinApproved = false,
  ) {
    const line = lines.value.find(l => l.productId === productId)
    if (!line) return
    const base = line.listPriceUsd ?? line.unitPriceUsd
    if (discount === null) {
      line.unitPriceUsd         = base
      line.lineTotalUsd         = base * line.quantity
      line.discountType         = undefined
      line.discountValue        = undefined
      line.discountAmountUsd    = undefined
      line.discountPinApproved  = undefined
      return
    }
    const finalPrice = computeDiscountedPrice(base, discount)
    line.unitPriceUsd        = finalPrice
    line.lineTotalUsd        = finalPrice * line.quantity
    line.discountType        = discount.type
    line.discountValue       = discount.value
    line.discountAmountUsd   = computeDiscountAmount(base, finalPrice)
    line.discountPinApproved = pinApproved
  }

  // WAFI-100: sell above list price. Uncapped, unaudited (never hurts the
  // shop financially) — a distinct path from applyLineDiscount so a markup
  // is never mistaken for a discount by the cap/PIN system.
  function applyMarkup(productId: string, newUnitPriceUsd: number) {
    const line = lines.value.find(l => l.productId === productId)
    if (!line) return
    const base = line.listPriceUsd ?? line.unitPriceUsd
    if (newUnitPriceUsd < base) return
    line.unitPriceUsd      = newUnitPriceUsd
    line.lineTotalUsd       = newUnitPriceUsd * line.quantity
    line.discountType       = undefined
    line.discountValue      = undefined
    line.discountAmountUsd  = undefined
  }

  // WAFI-100: sale-footer discount, applied on top of the (already net) line
  // totals — stacking, not exclusive with line discounts.
  function applySaleDiscount(
    discount: { type: DiscountType; value: number } | null,
    pinApproved = false,
  ) {
    if (discount === null) {
      saleDiscount.value = null
      return
    }
    const linesTotal = lines.value.reduce((sum, l) => sum + l.lineTotalUsd, 0)
    const finalTotal  = computeDiscountedPrice(linesTotal, discount)
    saleDiscount.value = {
      type:        discount.type,
      value:       discount.value,
      amountUsd:   computeDiscountAmount(linesTotal, finalTotal),
      pinApproved,
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

  // Make the receipt counter durable. localStorage alone is fragile: clearing
  // site data, reinstalling the PWA, or moving to a new device resets it to 0,
  // so the next sale re-issues A-000001 and collides with an already-synced sale
  // (uq_sale_number_per_shop), jamming sync. On startup (after first sync) seed
  // the counter to the higher of localStorage and MAX(device_sequence) of the
  // sales already in the local DB — device_sequence equals the receipt number,
  // so this guarantees the next number is past every synced sale. Scoped to this
  // device, whose code prefixes its own numbering. Never goes backwards.
  async function reconcileSequenceFromDb(): Promise<void> {
    try {
      const device = useDeviceStore()
      const row = await db.getOptional<{ max_seq: number | null }>(
        'SELECT MAX(device_sequence) AS max_seq FROM sales WHERE device_id = ?',
        [device.deviceId],
      )
      const dbMax = row?.max_seq ?? 0
      if (dbMax > deviceSequence.value) {
        deviceSequence.value = dbMax
        localStorage.setItem('wafi_device_seq', String(dbMax))
      }
    } catch {
      // DB not ready / offline with no local cache — keep the persisted value.
    }
  }

  function clear() {
    lines.value               = []
    lockedExchangeRate.value  = null
    hasRateChangeNotice.value = false
    saleDiscount.value        = null
    // deviceSequence is intentionally NOT reset — it is a monotonically increasing
    // per-device counter that persists across sales to guarantee unique receipt numbers.
  }

  return {
    lines,
    lockedExchangeRate,
    hasRateChangeNotice,
    deviceSequence,
    saleDiscount,
    totalUsd,
    addLine,
    removeLine,
    updateQuantity,
    applyLineDiscount,
    applyMarkup,
    applySaleDiscount,
    scalePricesToTotal,
    setLockedRate,
    setRateChangeNotice,
    incrementSequence,
    reconcileSequenceFromDb,
    clear,
  }
})
