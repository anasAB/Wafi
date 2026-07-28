import { db } from '@/data/powersync/db'
import type { CollectionsWorklistRow } from '@/features/customers/customer.types'

// WAFI-017: extracted from useCollectionsWorklist.ts so the credit-debtor +
// aging query has exactly one implementation, reusable by both the
// Collections worklist (UI composable) and useMoneyOwed (data aggregation,
// which must not depend on a UI-oriented composable — see the WAFI-017
// design doc's §4 reuse-mechanism decision).

type CustomerBalanceRow = {
  id: string; name: string; phone: string | null; mobile: string | null
  last_reminded_at: string | null; balance_usd: number
}

type OldestRow = { oldest: string | null }
type LastPaymentRow = { paid_at: string | null }

// Same balance formula as useCustomerBalance/useCustomers, kept in lockstep so
// this never drifts from the customer detail page's authoritative number.
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

/**
 * Every customer in the shop with a non-zero credit balance (debtor or
 * shop-owes-customer), with the FIFO oldest-unpaid-sale age anchor computed
 * for debtors. Same query/logic `useCollectionsWorklist.ts` has always run —
 * moved here, not changed, so it has exactly one implementation.
 */
export async function fetchCreditDebtors(shopId: string): Promise<CollectionsWorklistRow[]> {
  const now = new Date().toISOString()

  const customerRows = await db.getAll<CustomerBalanceRow>(
    `SELECT c.id, c.name, c.phone, c.mobile, c.last_reminded_at, ${BALANCE_USD_EXPR}
     FROM customers c
     WHERE c.shop_id = ? AND (c.deleted = 0 OR c.deleted IS NULL)`,
    [shopId, shopId, shopId, shopId, shopId]
  )

  return Promise.all(
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
}
