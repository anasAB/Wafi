import { computed, ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import type { CollectionsWorklistRow } from '@/features/customers/customer.types'

export type CollectionsSortOption = 'balance_desc' | 'oldest_first' | 'last_reminded_asc'

type CustomerBalanceRow = {
  id: string; name: string; phone: string | null; mobile: string | null
  last_reminded_at: string | null; balance_usd: number
}

type OldestRow = { oldest: string | null }
type LastPaymentRow = { paid_at: string | null }

// Same balance formula as useCustomerBalance/useCustomers, kept in lockstep so
// the worklist never drifts from the customer detail page's authoritative number.
const BALANCE_USD_EXPR = `
  (COALESCE((SELECT SUM(total_usd)  FROM sales            WHERE customer_id = c.id AND is_credit = 1 AND shop_id = ?), 0)
 - COALESCE((SELECT SUM(amount_usd) FROM customer_payments WHERE customer_id = c.id                   AND shop_id = ?), 0)
 - COALESCE((SELECT SUM(r.refund_amount_usd) FROM returns r JOIN sales s ON s.id = r.original_sale_id WHERE s.customer_id = c.id AND s.is_credit = 1 AND r.shop_id = ?), 0)
 - COALESCE((SELECT SUM(r.refund_amount_usd) FROM returns r JOIN sales s ON s.id = r.original_sale_id WHERE s.customer_id = c.id AND s.is_credit = 0 AND r.refund_method = 'store_credit' AND r.shop_id = ?), 0)
  ) AS balance_usd`

function daysBetween(fromIso: string, toIso: string): number {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime()
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)))
}

export function useCollectionsWorklist() {
  const rows = ref<CollectionsWorklistRow[]>([])
  const sort = ref<CollectionsSortOption>('balance_desc')
  const overdueThresholdDays = ref(30)

  // "لهم رصيد" — customers the shop owes (negative balance). Never chased.
  const creditRows = computed(() => rows.value.filter(r => r.balanceUsd < -0.001))
  const debtorRows = computed(() => {
    const list = rows.value.filter(r => r.balanceUsd > 0.001)
    const sorted = [...list]
    if (sort.value === 'balance_desc') {
      sorted.sort((a, b) => b.balanceUsd - a.balanceUsd)
    } else if (sort.value === 'oldest_first') {
      sorted.sort((a, b) => b.daysOutstanding - a.daysOutstanding)
    } else {
      // recently-reminded-last: never-reminded first, then oldest reminder first.
      sorted.sort((a, b) => {
        const aT = a.lastRemindedAt ? new Date(a.lastRemindedAt).getTime() : -1
        const bT = b.lastRemindedAt ? new Date(b.lastRemindedAt).getTime() : -1
        return aT - bT
      })
    }
    return sorted
  })

  const overdueCount = computed(() =>
    debtorRows.value.filter(r => r.daysOutstanding >= overdueThresholdDays.value).length
  )

  async function load() {
    const device = useDeviceStore()
    const shopId = device.shopId
    const now = new Date().toISOString()

    const customerRows = await db.getAll<CustomerBalanceRow>(
      `SELECT c.id, c.name, c.phone, c.mobile, c.last_reminded_at, ${BALANCE_USD_EXPR}
       FROM customers c
       WHERE c.shop_id = ? AND (c.deleted = 0 OR c.deleted IS NULL)`,
      [shopId, shopId, shopId, shopId, shopId]
    )

    const withAge: CollectionsWorklistRow[] = await Promise.all(
      customerRows
        .filter(c => Math.abs(c.balance_usd) > 0.001)
        .map(async c => {
          let oldestUnpaidDate = ''
          let daysOutstanding = 0
          if (c.balance_usd > 0.001) {
            // Oldest sale with any unpaid remainder — same per-sale remaining
            // formula as useCustomerBalance's openInvoices query (FIFO age anchor,
            // handles partially-paid oldest sales per WAFI-104 edge case).
            const oldestRow = await db.getOptional<OldestRow>(
              `SELECT MIN(s.created_at) AS oldest FROM (
                 SELECT s.id, s.created_at, s.total_usd
                   - COALESCE((SELECT SUM(amount_usd) FROM customer_payments cp WHERE cp.sale_id = s.id), 0)
                   - COALESCE((SELECT SUM(r.refund_amount_usd) FROM returns r WHERE r.original_sale_id = s.id), 0)
                   AS remaining_usd
                 FROM sales s WHERE s.customer_id = ? AND s.is_credit = 1 AND s.shop_id = ?
               ) s WHERE s.remaining_usd > 0.001`,
              [c.id, shopId]
            )
            oldestUnpaidDate = oldestRow?.oldest ?? now
            daysOutstanding = daysBetween(oldestUnpaidDate, now)
          }
          const lastPaymentRow = await db.getOptional<LastPaymentRow>(
            `SELECT MAX(paid_at) AS paid_at FROM customer_payments WHERE customer_id = ? AND shop_id = ?`,
            [c.id, shopId]
          )
          return {
            customerId:       c.id,
            customerName:     c.name,
            phone:            c.phone ?? c.mobile ?? null,
            balanceUsd:       c.balance_usd,
            oldestUnpaidDate,
            daysOutstanding,
            lastPaymentDate:  lastPaymentRow?.paid_at ?? null,
            lastRemindedAt:   c.last_reminded_at,
          }
        })
    )
    rows.value = withAge
  }

  async function markReminded(customerId: string): Promise<void> {
    const device = useDeviceStore()
    const now = new Date().toISOString()
    await db.execute(
      `UPDATE customers SET last_reminded_at = ?, sync_status = 'pending' WHERE id = ? AND shop_id = ?`,
      [now, customerId, device.shopId]
    )
    const row = rows.value.find(r => r.customerId === customerId)
    if (row) row.lastRemindedAt = now
  }

  return {
    rows,
    debtorRows,
    creditRows,
    sort,
    overdueThresholdDays,
    overdueCount,
    load,
    markReminded,
  }
}
