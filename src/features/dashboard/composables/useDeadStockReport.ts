import { computed, ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

export type DeadStockThresholdDays = 30 | 60 | 90 | 180
export type DeadStockSort = 'value' | 'age'

export interface DeadStockRow {
  productId:    string
  nameAr:       string
  currentStock: number
  costUsd:      number
  valueUsd:     number      // stock × cost
  lastSoldAt:   string | null  // null = never sold
  ageBasisDate: string      // lastSoldAt, or createdAt when never sold
  neverSold:    boolean
  isUncosted:   boolean     // cost_price_usd = 0 — excluded from the value headline
}

type Row = {
  id: string; name_ar: string; current_stock: number; cost_price_usd: number
  created_at: string; last_sold_at: string | null
}

function daysBetween(fromIso: string, toIso: string): number {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime()
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)))
}

export function useDeadStockReport() {
  const rows = ref<DeadStockRow[]>([])
  const thresholdDays = ref<DeadStockThresholdDays>(90)
  const sort = ref<DeadStockSort>('value')

  const costedRows = computed(() => rows.value.filter(r => !r.isUncosted))
  const uncostedRows = computed(() => rows.value.filter(r => r.isUncosted))
  const totalFrozenCapitalUsd = computed(() =>
    costedRows.value.reduce((sum, r) => sum + r.valueUsd, 0)
  )

  const sortedRows = computed(() => {
    const list = [...rows.value]
    if (sort.value === 'value') {
      list.sort((a, b) => b.valueUsd - a.valueUsd)
    } else {
      list.sort((a, b) => new Date(a.ageBasisDate).getTime() - new Date(b.ageBasisDate).getTime())
    }
    return list
  })

  async function load() {
    const device = useDeviceStore()
    const cutoff = new Date(Date.now() - thresholdDays.value * 24 * 3_600_000).toISOString()

    // Single query: one GROUP BY subquery for last-sold-per-product, joined
    // once — never one query per product (WAFI-108 perf requirement at
    // 2,000 products / 50k line items).
    const dbRows = await db.getAll<Row>(
      `SELECT p.id, p.name_ar, p.current_stock, p.cost_price_usd, p.created_at,
              ls.last_sold_at
       FROM products p
       LEFT JOIN (
         SELECT sli.product_id, MAX(s.created_at) AS last_sold_at
         FROM sale_line_items sli
         JOIN sales s ON s.id = sli.sale_id
         WHERE s.shop_id = ?
         GROUP BY sli.product_id
       ) ls ON ls.product_id = p.id
       WHERE p.shop_id = ? AND (p.deleted = 0 OR p.deleted IS NULL)
         AND p.current_stock > 0
         AND (ls.last_sold_at IS NULL OR ls.last_sold_at < ?)
       `,
      [device.shopId, device.shopId, cutoff]
    )

    rows.value = dbRows.map(r => {
      const neverSold = r.last_sold_at === null
      const ageBasisDate = r.last_sold_at ?? r.created_at
      return {
        productId:    r.id,
        nameAr:       r.name_ar,
        currentStock: r.current_stock,
        costUsd:      r.cost_price_usd,
        valueUsd:     r.current_stock * r.cost_price_usd,
        lastSoldAt:   r.last_sold_at,
        ageBasisDate,
        neverSold,
        isUncosted:   r.cost_price_usd <= 0,
      }
    })
  }

  return {
    rows: sortedRows,
    costedRows,
    uncostedRows,
    totalFrozenCapitalUsd,
    thresholdDays,
    sort,
    load,
    daysSince: (iso: string) => daysBetween(iso, new Date().toISOString()),
  }
}
