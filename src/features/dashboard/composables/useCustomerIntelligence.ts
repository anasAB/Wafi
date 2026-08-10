import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

export interface InactiveCustomerRow {
  customerId: string
  customerName: string
  lastPurchaseAt: string
  daysSincePurchase: number
}

export interface CustomerIntelligenceData {
  inactiveCount: number
  inactiveCustomers: InactiveCustomerRow[]
}

const INACTIVE_THRESHOLD_DAYS = 60

export function useCustomerIntelligence() {
  const data = ref<CustomerIntelligenceData | null>(null)
  const state = ref<'loading' | 'ready' | 'error'>('loading')

  async function load() {
    state.value = 'loading'
    try {
      const device = useDeviceStore()
      const cutoff = new Date(Date.now() - INACTIVE_THRESHOLD_DAYS * 24 * 3_600_000).toISOString()

      // A qualifying sale is any sales row with a non-null customer_id for
      // that customer — credit sales count, and a sale that was later
      // returned still counts (it was still a visit; see design spec's
      // explicit domain rule). Customers with zero qualifying sales ever
      // are excluded by the JOIN itself (no matching sales row = not
      // present in the GROUP BY result at all).
      const rows = await db.getAll<{ customerId: string; customerName: string; lastPurchaseAt: string }>(
        `SELECT s.customer_id AS customerId, c.name AS customerName, MAX(s.created_at) AS lastPurchaseAt
         FROM sales s
         JOIN customers c ON c.id = s.customer_id
         WHERE s.shop_id = ? AND s.customer_id IS NOT NULL
           AND (c.deleted = 0 OR c.deleted IS NULL)
         GROUP BY s.customer_id, c.name
         HAVING MAX(s.created_at) < ?
         ORDER BY lastPurchaseAt ASC`,
        [device.shopId, cutoff]
      )

      const now = Date.now()
      const inactiveCustomers: InactiveCustomerRow[] = rows.map(r => ({
        customerId: r.customerId,
        customerName: r.customerName,
        lastPurchaseAt: r.lastPurchaseAt,
        daysSincePurchase: Math.floor((now - new Date(r.lastPurchaseAt).getTime()) / (24 * 3_600_000)),
      }))

      data.value = { inactiveCount: inactiveCustomers.length, inactiveCustomers }
      state.value = 'ready'
    } catch {
      state.value = 'error'
    }
  }

  return { data, state, load }
}
