import { computed, toValue, type MaybeRef } from 'vue'
import { useSaleStore } from '@/store/sale.store'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

export function useSale(currentRateParam: MaybeRef<number | null>) {
  const saleStore = useSaleStore()

  const totalSyp = computed(() => {
    const rate = saleStore.lockedExchangeRate
    if (rate === null) return 0
    return Math.round(saleStore.totalUsd * rate)
  })

  async function addLine(productId: string) {
    const currentRate = toValue(currentRateParam)
    if (currentRate === null) throw new Error('Exchange rate not set')

    const result = await db.execute(
      `SELECT id, name_ar, price_usd, current_stock FROM products WHERE id = ? AND is_active = 1`,
      [productId]
    )
    const rows: Array<{ id: string; name_ar: string; price_usd: number; current_stock: number }> =
      (result as any).rows._array
    if (!rows.length) throw new Error(`Product ${productId} not found`)

    const p = rows[0]
    const availableStock = p.current_stock ?? 0

    // Block overselling. The store also clamps as the authoritative guard, but
    // checking here lets us surface a clear, localized message to the cashier.
    if (availableStock < 1) throw new Error('نفد المخزون')
    const inCart = saleStore.lines.find(l => l.productId === p.id)?.quantity ?? 0
    if (inCart >= availableStock) {
      throw new Error(`الكمية المتوفرة فقط ${availableStock}`)
    }

    saleStore.setLockedRate(currentRate)
    saleStore.addLine({
      productId:    p.id,
      nameAr:       p.name_ar,
      quantity:     1,
      unitPriceUsd: p.price_usd,
      lineTotalUsd: p.price_usd,
      availableStock,
    })
  }

  function checkRateChanged() {
    const currentRate = toValue(currentRateParam)
    if (saleStore.lines.length > 0 && currentRate !== saleStore.lockedExchangeRate) {
      saleStore.setRateChangeNotice(true)
    }
  }

  async function lookupByBarcode(barcode: string): Promise<string | null> {
    const device = useDeviceStore()
    const result = await db.execute(
      `SELECT id FROM products WHERE shop_id = ? AND barcode = ? AND is_active = 1`,
      [device.shopId, barcode]
    )
    const rows: Array<{ id: string }> = (result as any).rows._array
    return rows[0]?.id ?? null
  }

  return {
    lines:               saleStore.lines,
    totalUsd:            saleStore.totalUsd,
    totalSyp,
    lockedRate:          computed(() => saleStore.lockedExchangeRate),
    hasRateChangeNotice: computed(() => saleStore.hasRateChangeNotice),
    addLine,
    removeLine:          saleStore.removeLine,
    updateQuantity:      saleStore.updateQuantity,
    checkRateChanged,
    lookupByBarcode,
  }
}
