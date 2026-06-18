import { ref, computed } from 'vue'
import { db } from '@/data/powersync/db'

export interface ProductSaleEntry {
  saleId:        string
  displayNumber: string
  createdAt:     string
  quantity:      number
  unitPriceUsd:  number
  lineTotalUsd:  number
}

type Row = {
  sale_id: string; display_sale_number: string; created_at: string
  quantity: number; unit_price_usd: number; line_total_usd: number
}

/**
 * Per-product sales activity: every time the product was sold, how many, and at
 * what price (which may vary day to day when the cashier negotiates). Read-only.
 */
export function useProductActivity() {
  const entries = ref<ProductSaleEntry[]>([])
  const loading = ref(false)

  async function load(productId: string) {
    loading.value = true
    try {
      const rows = await db.getAll<Row>(
        `SELECT s.id AS sale_id, s.display_sale_number, s.created_at,
                sli.quantity, sli.unit_price_usd, sli.line_total_usd
         FROM sale_line_items sli
         JOIN sales s ON s.id = sli.sale_id
         WHERE sli.product_id = ?
         ORDER BY s.created_at DESC
         LIMIT 200`,
        [productId]
      )
      entries.value = rows.map(r => ({
        saleId:        r.sale_id,
        displayNumber: r.display_sale_number,
        createdAt:     r.created_at,
        quantity:      r.quantity,
        unitPriceUsd:  r.unit_price_usd,
        lineTotalUsd:  r.line_total_usd,
      }))
    } finally {
      loading.value = false
    }
  }

  const totalQty = computed(() => entries.value.reduce((s, e) => s + e.quantity, 0))
  const totalRevenueUsd = computed(() => entries.value.reduce((s, e) => s + e.lineTotalUsd, 0))

  // Distinct prices the product sold at, with the total quantity sold at each
  // price (summed across sales, not a count of sales).
  const byPrice = computed(() => {
    const map = new Map<number, number>()
    for (const e of entries.value) {
      map.set(e.unitPriceUsd, (map.get(e.unitPriceUsd) ?? 0) + e.quantity)
    }
    return [...map.entries()]
      .map(([price, qty]) => ({ price, qty }))
      .sort((a, b) => b.price - a.price)
  })

  return { entries, loading, load, totalQty, totalRevenueUsd, byPrice }
}
