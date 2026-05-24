import { computed } from 'vue'
import { useSaleStore } from '@/store/sale.store'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

export function useSale(currentRate: number | null) {
  const saleStore = useSaleStore()

  const totalSyp = computed(() => {
    const rate = saleStore.lockedExchangeRate
    if (rate === null) return 0
    return Math.round(saleStore.totalUsd * rate)
  })

  async function addLine(productId: string) {
    if (currentRate === null) throw new Error('Exchange rate not set')

    const result = await db.execute(
      `SELECT id, name_ar, price_usd FROM products WHERE id = ? AND is_active = 1`,
      [productId]
    )
    const rows: Array<{ id: string; name_ar: string; price_usd: number }> =
      (result as any).rows._array
    if (!rows.length) throw new Error(`Product ${productId} not found`)

    const p = rows[0]
    saleStore.setLockedRate(currentRate)
    saleStore.addLine({
      productId:    p.id,
      nameAr:       p.name_ar,
      quantity:     1,
      unitPriceUsd: p.price_usd,
      lineTotalUsd: p.price_usd,
    })
  }

  function checkRateChanged() {
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
