// src/features/reports/primitives/getCustomerAgingSnapshot.ts
// WAFI-147A primitive 3: as-of-date snapshot, NOT current-state (design spec S4's
// correction). Adapted from creditDebtors.ts's canonical balance formula -- that
// formula has no date boundary (always means "balance right now"), which would
// silently misreport a historical report's period-end balance as today's live
// balance. Every subquery here is bounded by asOfDate.
//
// Task 0 P1 finding 13, verified: customer_payments.paid_at is a DATE column
// (migration 009_expand_domain_tables_for_sync.sql), not a TIMESTAMPTZ -- no
// time-of-day component, so `paid_at <= asOfDate` needs no end-of-day boundary
// adjustment. Also verified: the oldest-unpaid-sale subquery below intentionally
// nets only `returns` against `is_credit = 1` sales, mirroring the main balance
// formula's first+third components -- NOT its fourth component (is_credit = 0
// store-credit refunds), which is a debt source with no originating credit sale
// to anchor a FIFO age against, so it's correctly excluded here, not an
// oversight or an inconsistency to fix.
import { db } from '@/data/powersync/db'

export interface CustomerAgingRow {
  customerId: string
  customerName: string
  balanceUsd: number
  oldestUnpaidDate: string
  daysOutstanding: number
  lastPaymentDate: string | null
}

type CustomerBalanceRow = { id: string; name: string; balance_usd: number }
type OldestRow = { oldest: string | null }
type LastPaymentRow = { paid_at: string | null }

const BALANCE_USD_EXPR_AS_OF = `
  (COALESCE((SELECT SUM(total_usd) FROM sales
              WHERE customer_id = c.id AND is_credit = 1 AND shop_id = ? AND DATE(created_at, 'localtime') <= ?), 0)
 - COALESCE((SELECT SUM(amount_usd) FROM customer_payments
              WHERE customer_id = c.id AND shop_id = ? AND paid_at <= ?), 0)
 - COALESCE((SELECT SUM(r.refund_amount_usd) FROM returns r JOIN sales s ON s.id = r.original_sale_id
              WHERE s.customer_id = c.id AND s.is_credit = 1 AND r.shop_id = ? AND DATE(r.created_at, 'localtime') <= ?), 0)
 - COALESCE((SELECT SUM(r.refund_amount_usd) FROM returns r JOIN sales s ON s.id = r.original_sale_id
              WHERE s.customer_id = c.id AND s.is_credit = 0 AND r.refund_method = 'store_credit' AND r.shop_id = ? AND DATE(r.created_at, 'localtime') <= ?), 0)
  ) AS balance_usd`

/** I12: `toIso` here is always `asOfDate`, a 'YYYY-MM-DD' calendar date with no
 *  time component -- `new Date('YYYY-MM-DD')` parses that as UTC MIDNIGHT
 *  (start of day), which differs from the existing Collections feature's
 *  creditDebtors.ts convention of comparing against `new Date().toISOString()`
 *  (a full current timestamp, i.e. END of "now"). Treating asOfDate as the END
 *  of that calendar day keeps this figure consistent with that precedent --
 *  "how many days have elapsed as of the end of this date" -- instead of
 *  under-counting by ~1 day. Credit Report's 30/60/90-day risk buckets are
 *  built directly from this value. */
function daysBetween(fromIso: string, toIso: string): number {
  const toEndOfDay = /^\d{4}-\d{2}-\d{2}$/.test(toIso) ? `${toIso}T23:59:59.999` : toIso
  const ms = new Date(toEndOfDay).getTime() - new Date(fromIso).getTime()
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)))
}

export async function getCustomerAgingSnapshot(shopId: string, asOfDate: string): Promise<CustomerAgingRow[]> {
  const customerRows = await db.getAll<CustomerBalanceRow>(
    `SELECT c.id, c.name, ${BALANCE_USD_EXPR_AS_OF}
     FROM customers c
     WHERE c.shop_id = ? AND (c.deleted = 0 OR c.deleted IS NULL)`,
    [shopId, asOfDate, shopId, asOfDate, shopId, asOfDate, shopId, asOfDate, shopId],
  )

  const results: CustomerAgingRow[] = []
  for (const c of customerRows) {
    if (Math.abs(c.balance_usd) <= 0.001) continue

    let oldestUnpaidDate = asOfDate
    if (c.balance_usd > 0.001) {
      const oldestRow = await db.getOptional<OldestRow>(
        `SELECT MIN(s.created_at) AS oldest FROM (
           SELECT s.id, s.created_at, s.total_usd
             - COALESCE((SELECT SUM(amount_usd) FROM customer_payments cp WHERE cp.sale_id = s.id AND cp.paid_at <= ?), 0)
             - COALESCE((SELECT SUM(r.refund_amount_usd) FROM returns r WHERE r.original_sale_id = s.id AND DATE(r.created_at, 'localtime') <= ?), 0)
             AS remaining_usd
           FROM sales s WHERE s.customer_id = ? AND s.is_credit = 1 AND s.shop_id = ?
             AND DATE(s.created_at, 'localtime') <= ?
         ) s WHERE s.remaining_usd > 0.001`,
        [asOfDate, asOfDate, c.id, shopId, asOfDate],
      )
      oldestUnpaidDate = oldestRow?.oldest ?? asOfDate
    }

    const lastPaymentRow = await db.getOptional<LastPaymentRow>(
      `SELECT MAX(paid_at) AS paid_at FROM customer_payments WHERE customer_id = ? AND shop_id = ? AND paid_at <= ?`,
      [c.id, shopId, asOfDate],
    )

    results.push({
      customerId: c.id,
      customerName: c.name,
      balanceUsd: c.balance_usd,
      oldestUnpaidDate,
      daysOutstanding: daysBetween(oldestUnpaidDate, asOfDate),
      lastPaymentDate: lastPaymentRow?.paid_at ?? null,
    })
  }
  return results
}
